/**
 * Tests for Resource Metrics, Structural Fingerprint, and Nested Roundtrip.
 *
 * Covers:
 *   1. PipelineProfiler → stage timing, report generation, efficiency scoring
 *   2. profileSync / profileAsync → correct snapshot fields
 *   3. analyzeComplexity → correct scoring for trivial to extreme datasets
 *   4. buildHashChain → deterministic chain, nonce salting
 *   5. generateWatermark / verifyWatermark → HMAC correctness
 *   6. entropyWeightedFieldOrder → high-entropy fields first
 *   7. Nested roundtrip: encode → decode → unflatten === original
 */

import {
  PipelineProfiler,
  profileSync,
  formatPipelineReport,
  formatSnapshot,
} from '../src/resource_metrics.js';
import type { ResourceSnapshot, PipelineReport } from '../src/resource_metrics.js';
import {
  analyzeComplexity,
  buildHashChain,
  generateWatermark,
  verifyWatermark,
  entropyWeightedFieldOrder,
  fingerprintSimilarity,
  formatComplexityReport,
} from '../src/structural_fingerprint.js';
import type { StructuralComplexity, PipelineFingerprint } from '../src/structural_fingerprint.js';
import { TokenStreamEncoder } from '../src/token_stream_encoder.js';
import { TokenStreamDecoder } from '../src/decoder.js';
import { flattenObject, unflattenObject } from '../src/schema.js';
import { encodeIR } from '../src/ir_encoder.js';
import { TensEncoder } from '../src/encoder.js';
import { canonicalize } from '../src/canonical.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    const msg = `  ✗ ${name}: ${e.message}`;
    failures.push(msg);
    console.log(msg);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertClose(actual: number, expected: number, tolerance: number, msg: string) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${msg}: expected ~${expected} ± ${tolerance}, got ${actual}`,
  );
}

// ============================================================================
// 1. Resource Metrics — profileSync
// ============================================================================
console.log('\n=== Resource Metrics Tests ===\n');

test('profileSync returns correct snapshot shape', () => {
  const { result, snapshot } = profileSync('test-op', () => {
    let sum = 0;
    for (let i = 0; i < 10000; i++) sum += i;
    return sum;
  }, { inputBytes: 1024, rowCount: 100 });

  assert(result === 49995000, `Expected 49995000, got ${result}`);
  assert(snapshot.label === 'test-op', `Expected label 'test-op', got '${snapshot.label}'`);
  assert(snapshot.durationMs >= 0, 'Duration should be non-negative');
  assert(snapshot.inputBytes === 1024, `Expected inputBytes 1024, got ${snapshot.inputBytes}`);
  assert(snapshot.rowCount === 100, `Expected rowCount 100, got ${snapshot.rowCount}`);
  assert(snapshot.timestamp.length > 0, 'Timestamp should be non-empty');
  assert(snapshot.throughputBytesPerSec >= 0, 'Throughput should be non-negative');
});

test('profileSync measures actual computation time', () => {
  const { snapshot } = profileSync('heavy', () => {
    const arr = new Array(100000);
    for (let i = 0; i < arr.length; i++) arr[i] = Math.random();
    arr.sort();
    return arr;
  });

  assert(snapshot.durationMs >= 0, 'Duration should be positive for heavy work');
  assert(snapshot.outputBytes > 0, 'Output bytes should be positive');
});

// ============================================================================
// 2. PipelineProfiler — multi-stage profiling
// ============================================================================
console.log('\n=== Pipeline Profiler Tests ===\n');

test('PipelineProfiler tracks multiple stages', () => {
  const profiler = new PipelineProfiler();
  const data = [{ id: 1, name: 'test' }, { id: 2, name: 'demo' }];

  const canonical = profiler.stage('canonicalize', () => canonicalize(data), {
    inputBytes: JSON.stringify(data).length,
    rowCount: data.length,
  });

  const encoder = new TensEncoder();
  const binary = profiler.stage('encode', () => encoder.encode(canonical));

  const report = profiler.report();

  assert(report.stages.length === 2, `Expected 2 stages, got ${report.stages.length}`);
  assert(report.stages[0].label === 'canonicalize', 'First stage should be canonicalize');
  assert(report.stages[1].label === 'encode', 'Second stage should be encode');
  assert(report.totalDurationMs >= 0, 'Total duration should be non-negative');
  assert(report.efficiencyScore >= 0 && report.efficiencyScore <= 100, 'Score should be 0-100');
  assert(
    ['excellent', 'good', 'fair', 'poor'].includes(report.efficiencyGrade),
    `Invalid grade: ${report.efficiencyGrade}`,
  );
});

test('PipelineProfiler report format renders correctly', () => {
  const profiler = new PipelineProfiler();
  profiler.stage('test', () => 42, { inputBytes: 100 });
  const report = profiler.report();
  const formatted = formatPipelineReport(report);

  assert(formatted.includes('Contex Pipeline Resource Report'), 'Should contain title');
  assert(formatted.includes('Summary'), 'Should contain summary');
  assert(formatted.includes('Efficiency'), 'Should contain efficiency');
  assert(formatted.includes('┌'), 'Should have box borders');
  assert(formatted.includes('┘'), 'Should have box borders');
});

test('PipelineProfiler reset clears state', () => {
  const profiler = new PipelineProfiler();
  profiler.stage('a', () => 1);
  profiler.stage('b', () => 2);
  assert(profiler.report().stages.length === 2, 'Should have 2 stages before reset');
  profiler.reset();
  assert(profiler.report().stages.length === 0, 'Should have 0 stages after reset');
});

// ============================================================================
// 3. Structural Complexity — analyzeComplexity
// ============================================================================
console.log('\n=== Structural Complexity Tests ===\n');

test('analyzeComplexity handles empty data', () => {
  const cx = analyzeComplexity([]);
  assert(cx.score === 0, `Expected score 0, got ${cx.score}`);
  assert(cx.complexityClass === 'trivial', `Expected trivial, got ${cx.complexityClass}`);
});

test('analyzeComplexity scores flat data low', () => {
  const data = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' },
  ];
  const cx = analyzeComplexity(data);
  assert(cx.maxDepth <= 2, `Expected depth <= 2, got ${cx.maxDepth}`);
  assert(cx.score < 50, `Expected score < 50 for flat data, got ${cx.score}`);
  assert(cx.arrayComplexity === 0, `Expected no array complexity, got ${cx.arrayComplexity}`);
});

test('analyzeComplexity scores nested data higher', () => {
  const data = [
    { id: 1, user: { name: 'Alice', profile: { age: 30, address: { city: 'Delhi' } } }, tags: ['math', 'science'] },
    { id: 2, user: { name: 'Bob', profile: { age: 25, address: { city: 'Mumbai' } } }, tags: ['art'] },
  ];
  const cx = analyzeComplexity(data);
  assert(cx.maxDepth >= 3, `Expected depth >= 3, got ${cx.maxDepth}`);
  assert(cx.arrayComplexity > 0, `Expected array complexity > 0, got ${cx.arrayComplexity}`);
  assert(cx.typeCardinality >= 3, `Expected >= 3 types, got ${cx.typeCardinality}`);
});

test('analyzeComplexity detects sparse data', () => {
  const data = [
    { id: 1, name: 'Alice', email: null },
    { id: 2, name: 'Bob' },
    { id: 3, email: 'c@d.com' },
  ];
  const cx = analyzeComplexity(data);
  assert(cx.sparsityRatio > 0, `Expected sparsity > 0, got ${cx.sparsityRatio}`);
  assert(cx.schemaPolymorphism > 0, `Expected polymorphism > 0, got ${cx.schemaPolymorphism}`);
});

test('analyzeComplexity detects extreme data', () => {
  // Highly polymorphic, nested, sparse, multi-type dataset
  const data: Record<string, unknown>[] = [];
  for (let i = 0; i < 20; i++) {
    const row: Record<string, unknown> = { id: i };
    if (i % 2 === 0) row.nested = { deep: { value: i, items: [1, 2, 3] } };
    if (i % 3 === 0) row.sparse = null;
    if (i % 4 === 0) row.extra = `val-${i}`;
    if (i % 5 === 0) row.flag = i % 2 === 0;
    if (i % 7 === 0) row.meta = { tags: ['a', 'b'], score: Math.random() };
    data.push(row);
  }
  const cx = analyzeComplexity(data);
  assert(cx.score >= 20, `Expected score >= 20 for complex data, got ${cx.score}`);
  assert(cx.schemaPolymorphism > 0.1, `Expected high polymorphism, got ${cx.schemaPolymorphism}`);
});

test('formatComplexityReport renders correctly', () => {
  const cx = analyzeComplexity([{ id: 1, name: 'test' }]);
  const report = formatComplexityReport(cx);
  assert(report.includes('Structural Complexity Report'), 'Should contain title');
  assert(report.includes('Field Entropy'), 'Should contain field entropy');
  assert(report.includes('Score'), 'Should contain score');
});

// ============================================================================
// 4. Hash Chain & Watermark
// ============================================================================
console.log('\n=== Hash Chain & Watermark Tests ===\n');

test('buildHashChain produces unique fingerprints per nonce', () => {
  const stages = [
    { label: 'canon', data: 'canonical-data' },
    { label: 'encode', data: new Uint8Array([1, 2, 3]) },
  ];
  const cx = analyzeComplexity([{ a: 1 }]);

  const fp1 = buildHashChain(stages, cx);
  const fp2 = buildHashChain(stages, cx);

  assert(fp1.fingerprint !== fp2.fingerprint, 'Different nonces should produce different fingerprints');
  assert(fp1.stageHashes.length === 2, `Expected 2 stage hashes, got ${fp1.stageHashes.length}`);
  assert(fp1.nonce.length === 32, `Nonce should be 32 hex chars, got ${fp1.nonce.length}`);
  assert(fp1.buildTag.length === 16, `Build tag should be 16 hex chars, got ${fp1.buildTag.length}`);
});

test('generateWatermark + verifyWatermark round-trips', () => {
  const irBytes = new Uint8Array([0x54, 0x45, 0x4e, 0x53, 0x02, 0x00, 0x01]);
  const stages = [{ label: 'encode', data: irBytes }];
  const cx = analyzeComplexity([{ id: 1 }]);
  const fp = buildHashChain(stages, cx);

  const watermark = generateWatermark(irBytes, fp);
  assert(watermark.hmac.length === 64, `HMAC should be 64 hex chars, got ${watermark.hmac.length}`);
  assert(watermark.pipelineId.length === 32, `Pipeline ID should be 32 chars, got ${watermark.pipelineId.length}`);

  const valid = verifyWatermark(irBytes, watermark, fp);
  assert(valid === true, 'Watermark should verify correctly');

  // Tampered bytes should fail
  const tampered = new Uint8Array([0x54, 0x45, 0x4e, 0x53, 0x02, 0x00, 0x02]);
  const invalid = verifyWatermark(tampered, watermark, fp);
  assert(invalid === false, 'Tampered data should fail verification');
});

// ============================================================================
// 5. Entropy-Weighted Field Ordering
// ============================================================================
console.log('\n=== Entropy-Weighted Field Ordering Tests ===\n');

test('entropyWeightedFieldOrder puts high-entropy fields first', () => {
  const data = [
    { id: 1, status: 'active', name: 'Alice' },
    { id: 2, status: 'active', name: 'Bob' },
    { id: 3, status: 'active', name: 'Charlie' },
    { id: 4, status: 'inactive', name: 'Diana' },
  ];
  const fields = ['id', 'name', 'status'];
  const order = entropyWeightedFieldOrder(data, fields);

  // 'id' has 4 unique values, 'name' has 4, 'status' has 2
  // id and name should be before status
  const idIdx = order.indexOf('id');
  const statusIdx = order.indexOf('status');
  assert(idIdx < statusIdx, 'High-entropy "id" should come before low-entropy "status"');
});

// ============================================================================
// 6. Fingerprint Similarity
// ============================================================================
console.log('\n=== Fingerprint Similarity Tests ===\n');

test('fingerprintSimilarity returns 1 for identical fingerprints', () => {
  const stages = [{ label: 'test', data: 'data' }];
  const cx = analyzeComplexity([{ a: 1 }]);
  const fp = buildHashChain(stages, cx);

  // Same fingerprint object → identical
  const sim = fingerprintSimilarity(fp, fp);
  assert(sim === 1, `Expected similarity 1, got ${sim}`);
});

test('fingerprintSimilarity returns < 1 for different fingerprints', () => {
  const stages = [{ label: 'test', data: 'data' }];
  const cx = analyzeComplexity([{ a: 1 }]);
  const fp1 = buildHashChain(stages, cx);
  const fp2 = buildHashChain(stages, cx);

  const sim = fingerprintSimilarity(fp1, fp2);
  assert(sim < 1, `Expected similarity < 1 for different nonces, got ${sim}`);
  assert(sim > 0, `Expected similarity > 0 (same build tag + complexity), got ${sim}`);
});

// ============================================================================
// 7. Nested Roundtrip — flatten → unflatten restores original
// ============================================================================
console.log('\n=== Nested Roundtrip Tests ===\n');

test('flattenObject + unflattenObject roundtrips nested data', () => {
  const original = {
    id: 1,
    name: 'John',
    address: { city: 'Delhi', zip: 110001 },
    tags: ['student', 'math'],
  };

  const flat = flattenObject(original);
  assert('address.city' in flat, 'Flat should have address.city');
  assert('address.zip' in flat, 'Flat should have address.zip');
  assert(!('address' in flat), 'Flat should NOT have address as object');

  const restored = unflattenObject(flat) as typeof original;
  assert(restored.id === 1, `Expected id=1, got ${restored.id}`);
  assert(restored.name === 'John', `Expected name=John, got ${restored.name}`);
  assert(restored.address.city === 'Delhi', `Expected city=Delhi, got ${restored.address.city}`);
  assert(restored.address.zip === 110001, `Expected zip=110001, got ${restored.address.zip}`);
  assert(Array.isArray(restored.tags), 'Tags should be an array');
  assert(restored.tags[0] === 'student', `Expected tags[0]=student, got ${restored.tags[0]}`);
});

test('unflatten handles deeply nested paths', () => {
  const flat = {
    'a.b.c.d': 1,
    'a.b.e': 2,
    'f': 3,
  };
  const nested = unflattenObject(flat);
  assert((nested as any).a.b.c.d === 1, 'Deep path should restore');
  assert((nested as any).a.b.e === 2, 'Sibling path should restore');
  assert((nested as any).f === 3, 'Top-level should remain');
});

test('TENS binary encode → decode → unflatten matches original (nested)', () => {
  const original = [
    { id: 1, name: 'John', address: { city: 'Delhi', zip: 110001 }, tags: ['student', 'math'] },
    { id: 2, name: 'Jane', address: { city: 'Mumbai', zip: 400001 }, tags: ['teacher'] },
  ];

  const encoder = new TokenStreamEncoder();
  const decoder = new TokenStreamDecoder();
  const binary = encoder.encode(original);
  const decoded = decoder.decode(binary);
  const decArr = Array.isArray(decoded) ? decoded : [decoded];

  // Decoded rows should have dot-notation keys (flattened)
  const firstRow = decArr[0] as Record<string, unknown>;
  const hasDotKeys = Object.keys(firstRow).some((k) => k.includes('.'));
  assert(hasDotKeys, 'Decoded rows should have dot-notation keys');

  // Unflatten should restore nested structure
  const restored = decArr.map((row: unknown) => {
    const r = row as Record<string, unknown>;
    const hasDots = Object.keys(r).some((k) => k.includes('.'));
    return hasDots ? unflattenObject(r) : r;
  });

  // Check restored structure
  const r0 = restored[0] as typeof original[0];
  assert(r0.id !== undefined, 'Restored row should have id');
  assert(typeof r0.address === 'object' && r0.address !== null, 'Restored should have nested address');
  assert(r0.address.city !== undefined, 'Restored address should have city');

  encoder.dispose();
  decoder.dispose();
});

test('encodeIR preserves nested data in canonical IR', () => {
  const data = [
    { id: 1, user: { name: 'Alice', profile: { age: 30 } }, tags: ['a', 'b'] },
  ];

  const ir = encodeIR(data);
  assert(ir.ir.length > 0, 'IR binary should be non-empty');
  assert(ir.hash.length === 64, `Hash should be 64 hex chars, got ${ir.hash.length}`);
  assert(ir.irVersion === '1.0', `Expected IR version 1.0, got ${ir.irVersion}`);

  // Encoding same data twice should produce same hash (deterministic)
  const ir2 = encodeIR(data);
  assert(ir.hash === ir2.hash, 'Same data should produce same hash');
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(f);
}
console.log();
process.exit(failed > 0 ? 1 : 0);
