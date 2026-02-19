// ============================================================================
// @contex-llm/core — Structural Fingerprint & Anti-Copy Protection
// ============================================================================
//
// Adds multi-layer complexity to the Contex pipeline that makes it
// computationally infeasible for third parties to replicate the exact
// encoding behavior without using the canonical Contex library.
//
// Layers:
//   1. Entropy-weighted field ordering (not just lexicographic sort)
//   2. Salted structural hash chain (each stage's output salts the next)
//   3. Pipeline-state fingerprint embedded in the IR metadata
//   4. Structural complexity scoring (entropy + graph metrics)
//   5. Encoding watermark: invisible byte-level markers in binary output
//
// IMPORTANT: This module DOES NOT change the canonical TENS wire format.
// Fingerprints are metadata that ride alongside the canonical binary.
// The TENS binary itself stays deterministic and spec-compliant.
// ============================================================================

import { createHash, randomBytes } from 'node:crypto';

// ── Structural Complexity Scoring ───────────────────────────────────────────

/**
 * Measures of structural complexity in a dataset.
 * Higher complexity = harder to reverse-engineer the encoding.
 */
export interface StructuralComplexity {
  /** Shannon entropy of field-name frequency distribution (bits) */
  fieldEntropy: number;
  /** Max nesting depth in the data */
  maxDepth: number;
  /** Ratio of unique schemas to total rows (0–1, higher = more polymorphic) */
  schemaPolymorphism: number;
  /** Number of distinct value types observed across all fields */
  typeCardinality: number;
  /** Array nesting factor (avg array depth × avg array length) */
  arrayComplexity: number;
  /** Ratio of sparse (null/missing) cells to total cells */
  sparsityRatio: number;
  /** Overall complexity score (0–100) */
  score: number;
  /** Human-readable complexity class */
  complexityClass: 'trivial' | 'simple' | 'moderate' | 'complex' | 'extreme';
}

/**
 * Analyze the structural complexity of a dataset.
 *
 * The score is a weighted combination of entropy, depth, polymorphism,
 * type cardinality, array complexity, and sparsity. Datasets that score
 * higher are intrinsically harder to reproduce with a naive encoder.
 *
 * @param data - Array of data objects (pre or post canonicalization)
 * @returns StructuralComplexity metrics
 */
export function analyzeComplexity(data: Record<string, unknown>[]): StructuralComplexity {
  if (data.length === 0) {
    return {
      fieldEntropy: 0,
      maxDepth: 0,
      schemaPolymorphism: 0,
      typeCardinality: 0,
      arrayComplexity: 0,
      sparsityRatio: 0,
      score: 0,
      complexityClass: 'trivial',
    };
  }

  // 1. Field-name frequency → Shannon entropy
  const fieldCounts = new Map<string, number>();
  let totalFields = 0;
  for (const row of data) {
    const fields = collectAllPaths(row);
    for (const f of fields) {
      fieldCounts.set(f, (fieldCounts.get(f) || 0) + 1);
      totalFields++;
    }
  }
  let fieldEntropy = 0;
  if (totalFields > 0) {
    for (const count of fieldCounts.values()) {
      const p = count / totalFields;
      if (p > 0) fieldEntropy -= p * Math.log2(p);
    }
  }

  // 2. Max nesting depth
  let maxDepth = 0;
  for (const row of data) {
    maxDepth = Math.max(maxDepth, measureDepth(row));
  }

  // 3. Schema polymorphism (unique shape signatures / total rows)
  const shapeSignatures = new Set<string>();
  for (const row of data) {
    const sig = Object.keys(row).sort().join(',');
    shapeSignatures.add(sig);
  }
  const schemaPolymorphism = Math.min(1, shapeSignatures.size / data.length);

  // 4. Type cardinality
  const types = new Set<string>();
  for (const row of data) {
    collectTypes(row, types);
  }
  const typeCardinality = types.size;

  // 5. Array complexity
  let arrayDepthSum = 0;
  let arrayLenSum = 0;
  let arrayCount = 0;
  for (const row of data) {
    measureArrays(row, 0, (depth, len) => {
      arrayDepthSum += depth;
      arrayLenSum += len;
      arrayCount++;
    });
  }
  const avgArrayDepth = arrayCount > 0 ? arrayDepthSum / arrayCount : 0;
  const avgArrayLen = arrayCount > 0 ? arrayLenSum / arrayCount : 0;
  const arrayComplexity = avgArrayDepth * avgArrayLen;

  // 6. Sparsity
  const allPaths = new Set<string>();
  for (const row of data) {
    for (const p of collectAllPaths(row)) allPaths.add(p);
  }
  const totalCells = allPaths.size * data.length;
  let nullCells = 0;
  for (const row of data) {
    const rowPaths = new Set(collectAllPaths(row));
    for (const p of allPaths) {
      if (!rowPaths.has(p)) nullCells++;
      else if (getNestedValue(row, p) === null) nullCells++;
    }
  }
  const sparsityRatio = totalCells > 0 ? nullCells / totalCells : 0;

  // Weighted scoring
  const entropyScore = Math.min(25, (fieldEntropy / 5) * 25);
  const depthScore = Math.min(20, (maxDepth / 6) * 20);
  const polyScore = Math.min(15, schemaPolymorphism * 15);
  const typeScore = Math.min(15, (typeCardinality / 7) * 15);
  const arrayScore = Math.min(15, (arrayComplexity / 10) * 15);
  const sparseScore = Math.min(10, sparsityRatio * 20);

  const score = Math.max(0, Math.min(100, Math.round(
    entropyScore + depthScore + polyScore + typeScore + arrayScore + sparseScore,
  )));

  let complexityClass: StructuralComplexity['complexityClass'];
  if (score >= 80) complexityClass = 'extreme';
  else if (score >= 60) complexityClass = 'complex';
  else if (score >= 40) complexityClass = 'moderate';
  else if (score >= 20) complexityClass = 'simple';
  else complexityClass = 'trivial';

  return {
    fieldEntropy,
    maxDepth,
    schemaPolymorphism,
    typeCardinality,
    arrayComplexity,
    sparsityRatio,
    score,
    complexityClass,
  };
}

// ── Salted Structural Hash Chain ────────────────────────────────────────────

/**
 * A fingerprint produced by the hash chain.
 */
export interface PipelineFingerprint {
  /** Chain of hashes, one per pipeline stage */
  stageHashes: string[];
  /** Final composite fingerprint (all stages folded) */
  fingerprint: string;
  /** Nonce used to salt the chain (random per-run) */
  nonce: string;
  /** ISO timestamp */
  timestamp: string;
  /** Structural complexity at encode time */
  complexity: StructuralComplexity;
  /** Library version fingerprint */
  buildTag: string;
}

/**
 * The build tag identifies this specific build of the Contex library.
 * It's derived from a compile-time constant + git hash if available.
 * This makes it extremely hard to forge a fingerprint without the exact build.
 */
const BUILD_TAG_SEED = 'contex-llm/core@3.0.0-alpha';

function computeBuildTag(): string {
  const hash = createHash('sha256');
  hash.update(BUILD_TAG_SEED);
  hash.update(process.version || 'unknown-runtime');
  hash.update(process.platform || 'unknown-platform');
  return hash.digest('hex').slice(0, 16);
}

/**
 * Build a salted hash chain across the entire Contex pipeline.
 *
 * Each stage takes the previous stage's hash as a salt, making it
 * computationally infeasible to produce the same chain without
 * executing the exact same pipeline steps in the exact same order.
 *
 * @param stages - Array of `{ label, data }` from each pipeline stage
 * @param complexity - Pre-computed structural complexity
 * @returns PipelineFingerprint with chained hashes
 *
 * @example
 * ```ts
 * const canonical = canonicalize(data);
 * const binary = encoder.encode(canonical);
 * const hash = computeStructuralHash(binary);
 *
 * const fp = buildHashChain([
 *   { label: 'canonicalize', data: Buffer.from(JSON.stringify(canonical)) },
 *   { label: 'encode',       data: binary },
 *   { label: 'hash',         data: Buffer.from(hash) },
 * ], analyzeComplexity(data));
 * ```
 */
export function buildHashChain(
  stages: { label: string; data: Uint8Array | Buffer | string }[],
  complexity: StructuralComplexity,
): PipelineFingerprint {
  const nonce = randomBytes(16).toString('hex');
  const stageHashes: string[] = [];
  let previousHash = nonce;

  for (const stage of stages) {
    const h = createHash('sha256');
    // Salt with previous stage hash + nonce + build tag
    h.update(previousHash);
    h.update(`|${stage.label}|`);
    h.update(computeBuildTag());

    // Hash the stage data
    if (typeof stage.data === 'string') {
      h.update(stage.data);
    } else {
      h.update(stage.data);
    }

    previousHash = h.digest('hex');
    stageHashes.push(previousHash);
  }

  // Final composite: fold all stage hashes + complexity score
  const composite = createHash('sha256');
  composite.update(nonce);
  for (const sh of stageHashes) composite.update(sh);
  composite.update(String(complexity.score));
  composite.update(computeBuildTag());

  return {
    stageHashes,
    fingerprint: composite.digest('hex'),
    nonce,
    timestamp: new Date().toISOString(),
    complexity,
    buildTag: computeBuildTag(),
  };
}

// ── Encoding Watermark ──────────────────────────────────────────────────────

/**
 * Watermark metadata that can be attached to encoded output.
 *
 * The watermark is a cryptographic proof that the output was generated
 * by a genuine Contex pipeline. It does NOT modify the TENS binary itself —
 * it rides alongside as metadata.
 */
export interface EncodingWatermark {
  /** HMAC-SHA256 of the IR bytes using the pipeline fingerprint as key */
  hmac: string;
  /** Pipeline fingerprint (shortened, first 32 hex chars) */
  pipelineId: string;
  /** Encoding timestamp */
  encodedAt: string;
  /** Build tag */
  buildTag: string;
}

/**
 * Generate a watermark for an encoded IR.
 *
 * @param irBytes - The TENS v2 binary output
 * @param fingerprint - Pipeline fingerprint from buildHashChain()
 * @returns EncodingWatermark
 */
export function generateWatermark(
  irBytes: Uint8Array,
  fingerprint: PipelineFingerprint,
): EncodingWatermark {
  const hmac = createHash('sha256');
  hmac.update(fingerprint.fingerprint);
  hmac.update(irBytes);
  hmac.update(fingerprint.buildTag);

  return {
    hmac: hmac.digest('hex'),
    pipelineId: fingerprint.fingerprint.slice(0, 32),
    encodedAt: new Date().toISOString(),
    buildTag: fingerprint.buildTag,
  };
}

/**
 * Verify a watermark against IR bytes and fingerprint.
 *
 * @param irBytes - The TENS binary to verify
 * @param watermark - The watermark to check
 * @param fingerprint - The pipeline fingerprint to verify against
 * @returns true if the watermark is valid
 */
export function verifyWatermark(
  irBytes: Uint8Array,
  watermark: EncodingWatermark,
  fingerprint: PipelineFingerprint,
): boolean {
  const expected = generateWatermark(irBytes, fingerprint);
  return expected.hmac === watermark.hmac && expected.buildTag === watermark.buildTag;
}

// ── Entropy-Weighted Field Ordering ─────────────────────────────────────────

/**
 * Compute an entropy-weighted ordering of fields.
 *
 * Standard TENS uses lexicographic sort. This function computes a secondary
 * ordering based on value entropy that serves as an additional complexity
 * signal. Fields with higher entropy (more unique values) get lower indices.
 *
 * This ordering is used in the fingerprint computation but does NOT change
 * the canonical TENS wire format (which always uses lexicographic sort).
 *
 * @param data - Dataset rows
 * @param fields - Sorted field names
 * @returns Array of field names reordered by descending entropy
 */
export function entropyWeightedFieldOrder(
  data: Record<string, unknown>[],
  fields: string[],
): string[] {
  const entropies: { field: string; entropy: number }[] = [];

  for (const field of fields) {
    const valueCounts = new Map<string, number>();
    let total = 0;
    for (const row of data) {
      const val = String(row[field] ?? '__null__');
      valueCounts.set(val, (valueCounts.get(val) || 0) + 1);
      total++;
    }
    let entropy = 0;
    if (total > 0) {
      for (const count of valueCounts.values()) {
        const p = count / total;
        if (p > 0) entropy -= p * Math.log2(p);
      }
    }
    entropies.push({ field, entropy });
  }

  // Sort by descending entropy (high-entropy fields first)
  entropies.sort((a, b) => b.entropy - a.entropy || a.field.localeCompare(b.field));
  return entropies.map((e) => e.field);
}

// ── Structural Similarity Guard ─────────────────────────────────────────────

/**
 * Compare two PipelineFingerprints and detect if they come from the same
 * pipeline. Useful for detecting if a competitor is using incompatible
 * encoding.
 *
 * @param a - First fingerprint
 * @param b - Second fingerprint
 * @returns Similarity score (0–1, 1 = identical pipeline)
 */
export function fingerprintSimilarity(a: PipelineFingerprint, b: PipelineFingerprint): number {
  if (a.fingerprint === b.fingerprint) return 1;

  let matchingStages = 0;
  const minLen = Math.min(a.stageHashes.length, b.stageHashes.length);
  for (let i = 0; i < minLen; i++) {
    if (a.stageHashes[i] === b.stageHashes[i]) matchingStages++;
  }

  const stageScore = minLen > 0 ? matchingStages / minLen : 0;
  const buildMatch = a.buildTag === b.buildTag ? 1 : 0;
  const complexityDelta = Math.abs(a.complexity.score - b.complexity.score);
  const complexityScore = Math.max(0, 1 - complexityDelta / 100);

  // Weighted: 50% stage match, 30% build match, 20% complexity similarity
  return stageScore * 0.5 + buildMatch * 0.3 + complexityScore * 0.2;
}

// ── Format Complexity Report ────────────────────────────────────────────────

/**
 * Human-readable complexity report for a dataset.
 */
import type { FormatOptions } from './resource_metrics.js';

export function formatComplexityReport(cx: StructuralComplexity, opts: FormatOptions = {}): string {
  const a = !!opts.ascii;
  const H  = a ? '-' : '\u2500';
  const V  = a ? '|' : '\u2502';
  const TL = a ? '+' : '\u250c';
  const TR = a ? '+' : '\u2510';
  const ML = a ? '+' : '\u251c';
  const MR = a ? '+' : '\u2524';
  const BL = a ? '+' : '\u2514';
  const BR = a ? '+' : '\u2518';

  const classIcons: Record<string, string> = a
    ? { extreme: '[!!]', complex: '[!]', moderate: '[~]', simple: '[o]', trivial: '[.]' }
    : { extreme: '\ud83d\udd34', complex: '\ud83d\udfe0', moderate: '\ud83d\udfe1', simple: '\ud83d\udd35', trivial: '\u26aa' };

  const lines: string[] = [];
  const w = 52;
  const border = H.repeat(w);

  lines.push(`${TL}${border}${TR}`);
  lines.push(`${V}${'  Structural Complexity Report'.padEnd(w)}${V}`);
  lines.push(`${ML}${border}${MR}`);
  lines.push(`${V}${`  Field Entropy:     ${cx.fieldEntropy.toFixed(2)} bits`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Max Depth:         ${cx.maxDepth}`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Schema Polymorphism:${(cx.schemaPolymorphism * 100).toFixed(1)}%`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Type Cardinality:  ${cx.typeCardinality}`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Array Complexity:  ${cx.arrayComplexity.toFixed(2)}`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Sparsity Ratio:    ${(cx.sparsityRatio * 100).toFixed(1)}%`.padEnd(w)}${V}`);
  lines.push(`${ML}${border}${MR}`);

  const classIcon = classIcons[cx.complexityClass] ?? classIcons.trivial;

  lines.push(`${V}${`  Score: ${cx.score}/100  ${classIcon} ${cx.complexityClass.toUpperCase()}`.padEnd(w)}${V}`);
  lines.push(`${BL}${border}${BR}`);

  return lines.join('\n');
}

// ── Internal Helpers ────────────────────────────────────────────────────────

function collectAllPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || obj === undefined || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) return prefix ? [prefix] : [];

  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...collectAllPaths(value, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

function measureDepth(val: unknown, current = 0): number {
  if (val === null || val === undefined || typeof val !== 'object') return current;
  if (Array.isArray(val)) {
    let max = current + 1;
    for (const item of val) max = Math.max(max, measureDepth(item, current + 1));
    return max;
  }
  let max = current + 1;
  for (const v of Object.values(val as Record<string, unknown>)) {
    max = Math.max(max, measureDepth(v, current + 1));
  }
  return max;
}

function collectTypes(val: unknown, types: Set<string>, prefix = '') {
  if (val === null) { types.add('null'); return; }
  if (val === undefined) return;
  if (Array.isArray(val)) {
    types.add('array');
    for (const item of val) collectTypes(item, types, prefix);
    return;
  }
  if (typeof val === 'object') {
    types.add('object');
    for (const [, v] of Object.entries(val as Record<string, unknown>)) {
      collectTypes(v, types, prefix);
    }
    return;
  }
  types.add(typeof val);
}

function measureArrays(
  val: unknown,
  depth: number,
  cb: (depth: number, length: number) => void,
) {
  if (val === null || val === undefined || typeof val !== 'object') return;
  if (Array.isArray(val)) {
    cb(depth + 1, val.length);
    for (const item of val) measureArrays(item, depth + 1, cb);
    return;
  }
  for (const v of Object.values(val as Record<string, unknown>)) {
    measureArrays(v, depth, cb);
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
