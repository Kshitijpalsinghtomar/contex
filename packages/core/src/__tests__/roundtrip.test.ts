// ============================================================================
// Deterministic Roundtrip Proof — TENS Binary & TENS-Text
// ============================================================================
//
// Proves that TENS encoding is canonical and deterministic:
//   data → encode → decode → re-encode → binary₁ === binary₂
//   data → text-encode → text-decode → text-re-encode → text₁ === text₂
//
// This is a trust foundation: if roundtrip is byte-identical, the format
// is safe for caching, dedup, and structural hashing.
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TokenStreamDecoder } from '../decoder.js';
import { TensTextDecoder, TensTextEncoder } from '../tens_text.js';
import { TokenStreamEncoder } from '../token_stream_encoder.js';

// ── Shared instances ────────────────────────────────────────────────────────

const encoder = new TokenStreamEncoder('cl100k_base');
const decoder = new TokenStreamDecoder();
const textEncoder = new TensTextEncoder('cl100k_base');
const textDecoder = new TensTextDecoder();

afterAll(() => {
  encoder.dispose();
  decoder.dispose();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function assertBinaryRoundtrip(data: Record<string, unknown>[]) {
  const binary1 = encoder.encode(data);
  const decoded = decoder.decode(binary1) as Record<string, unknown>[];
  const binary2 = encoder.encode(decoded);

  expect(binary1.length).toBe(binary2.length);
  expect(Buffer.from(binary1).equals(Buffer.from(binary2))).toBe(true);
}

function assertTextRoundtrip(data: Record<string, unknown>[]) {
  const text1 = textEncoder.encode(data);
  const result = textDecoder.decode(text1);
  const text2 = textEncoder.encode(result.data);

  expect(text1).toBe(text2);
}

// ============================================================================
// Binary Roundtrip Tests
// ============================================================================

describe('TENS Binary — Deterministic Roundtrip', () => {
  it('simple flat objects', () => {
    const data = [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
      { id: 3, name: 'Charlie', role: 'user' },
    ];
    assertBinaryRoundtrip(data);
  });

  it('objects with numeric values', () => {
    const data = [
      { x: 0, y: 1.5, z: -100 },
      { x: 42, y: 3.14159, z: 0 },
      { x: Number.MAX_SAFE_INTEGER, y: 0.1 + 0.2, z: -0.5 },
    ];
    assertBinaryRoundtrip(data);
  });

  it('objects with boolean values', () => {
    const data = [
      { active: true, verified: false },
      { active: false, verified: true },
    ];
    assertBinaryRoundtrip(data);
  });

  it('objects with null values', () => {
    const data = [
      { id: 1, name: 'Alice', email: null },
      { id: 2, name: null, email: 'bob@test.com' },
    ];
    assertBinaryRoundtrip(data);
  });

  it('objects with array values', () => {
    const data = [
      { id: 1, tags: ['admin', 'active'] },
      { id: 2, tags: ['user'] },
    ];
    assertBinaryRoundtrip(data);
  });

  it('objects with unicode strings', () => {
    const data = [
      { name: '日本語テスト', emoji: '🚀🎉' },
      { name: 'Ñoño café', emoji: '❤️' },
    ];
    assertBinaryRoundtrip(data);
  });

  it('objects with empty strings', () => {
    const data = [
      { id: 1, name: '', note: 'test' },
      { id: 2, name: 'Bob', note: '' },
    ];
    assertBinaryRoundtrip(data);
  });

  it('single row', () => {
    assertBinaryRoundtrip([{ key: 'value' }]);
  });

  it('many rows (100)', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `user_${i}`,
      score: Math.random() * 100,
    }));
    assertBinaryRoundtrip(data);
  });

  it('repeated values (dictionary compression)', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      status: i % 2 === 0 ? 'active' : 'inactive',
      department: ['engineering', 'marketing', 'sales'][i % 3],
    }));
    assertBinaryRoundtrip(data);
  });

  it('idempotent: triple encode matches double encode', () => {
    const data = [
      { id: 1, name: 'test', value: 42 },
      { id: 2, name: 'test2', value: 99 },
    ];
    const binary1 = encoder.encode(data);
    const decoded1 = decoder.decode(binary1) as Record<string, unknown>[];
    const binary2 = encoder.encode(decoded1);
    const decoded2 = decoder.decode(binary2) as Record<string, unknown>[];
    const binary3 = encoder.encode(decoded2);

    expect(Buffer.from(binary2).equals(Buffer.from(binary3))).toBe(true);
  });
});

// ============================================================================
// TENS-Text Roundtrip Tests
// ============================================================================

describe('TENS-Text — Deterministic Roundtrip', () => {
  it('simple flat objects', () => {
    const data = [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
      { id: 3, name: 'Charlie', role: 'user' },
    ];
    assertTextRoundtrip(data);
  });

  it('objects with numeric values', () => {
    const data = [
      { x: 0, y: 1.5, z: -100 },
      { x: 42, y: 3.14, z: 0 },
    ];
    assertTextRoundtrip(data);
  });

  it('objects with boolean values', () => {
    const data = [
      { active: true, verified: false },
      { active: false, verified: true },
    ];
    assertTextRoundtrip(data);
  });

  it('objects with null values', () => {
    const data = [
      { id: 1, name: 'Alice', email: null },
      { id: 2, name: null, email: 'bob@test.com' },
    ];
    assertTextRoundtrip(data);
  });

  it('objects with arrays', () => {
    const data = [
      { id: 1, tags: ['admin', 'active'] },
      { id: 2, tags: ['user'] },
    ];
    assertTextRoundtrip(data);
  });

  it('objects with unicode', () => {
    const data = [
      { name: 'café', city: 'Zürich' },
      { name: 'naïve', city: 'São Paulo' },
    ];
    assertTextRoundtrip(data);
  });

  it('repeated values trigger dictionary', () => {
    const data = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      status: i % 2 === 0 ? 'active' : 'inactive',
      dept: ['eng', 'sales'][i % 2],
    }));
    assertTextRoundtrip(data);
  });

  it('idempotent: triple encode matches', () => {
    const data = [
      { id: 1, val: 'hello' },
      { id: 2, val: 'world' },
    ];
    const t1 = textEncoder.encode(data);
    const d1 = textDecoder.decode(t1).data;
    const t2 = textEncoder.encode(d1);
    const d2 = textDecoder.decode(t2).data;
    const t3 = textEncoder.encode(d2);

    expect(t2).toBe(t3);
  });
});

// ============================================================================
// Real-World Data Roundtrip (if available)
// ============================================================================

describe('Real-World Data Roundtrip', () => {
  const testDataPath = path.resolve(__dirname, '../../../../my_test_data.json');
  const hasTestData = fs.existsSync(testDataPath);

  it.skipIf(!hasTestData)(
    'binary roundtrip with my_test_data.json (stable from first encode)',
    () => {
      const raw = JSON.parse(fs.readFileSync(testDataPath, 'utf-8'));
      const data = Array.isArray(raw) ? raw.slice(0, 50) : [raw];
      // First encode may transform nested objects. Key property: stable after first pass.
      const binary1 = encoder.encode(data as Record<string, unknown>[]);
      const decoded1 = decoder.decode(binary1) as Record<string, unknown>[];
      const binary2 = encoder.encode(decoded1);
      const decoded2 = decoder.decode(binary2) as Record<string, unknown>[];
      const binary3 = encoder.encode(decoded2);

      expect(binary2.length).toBe(binary3.length);
      expect(Buffer.from(binary2).equals(Buffer.from(binary3))).toBe(true);
      expect(decoded1).toEqual(decoded2);
    },
  );

  it.skipIf(!hasTestData)(
    'text roundtrip with my_test_data.json (stable from first encode)',
    () => {
      const raw = JSON.parse(fs.readFileSync(testDataPath, 'utf-8'));
      const data = Array.isArray(raw) ? raw.slice(0, 50) : [raw];
      // First encode may transform nested objects to strings (expected for TENS-Text).
      // The key property is: from the first encode onward, it is deterministic.
      const text1 = textEncoder.encode(data as Record<string, unknown>[]);
      const decoded1 = textDecoder.decode(text1).data;
      const text2 = textEncoder.encode(decoded1);
      const decoded2 = textDecoder.decode(text2).data;
      const text3 = textEncoder.encode(decoded2);

      // Stable after first pass: text2 === text3
      expect(text2).toBe(text3);
      // Data equivalence after stabilization
      expect(decoded1).toEqual(decoded2);
    },
  );
});
