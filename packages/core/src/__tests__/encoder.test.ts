import { describe, expect, it } from 'vitest';
import { TokenStreamDecoder } from '../decoder.js';
import { TokenStreamEncoder } from '../token_stream_encoder.js';

describe('TokenStreamEncoder / TokenStreamDecoder', () => {
  const encoder = new TokenStreamEncoder('cl100k_base');
  const decoder = new TokenStreamDecoder();

  describe('Roundtrip — encode then decode produces identical data', () => {
    it('handles flat objects', () => {
      const data = [
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'user' },
      ];
      const binary = encoder.encode(data);
      const restored = decoder.decode(binary);
      expect(restored).toEqual(data);
    });

    it('handles nested objects (flattened to dot-notation)', () => {
      const data = [
        { id: 1, meta: { score: 95, tags: ['a', 'b'] } },
        { id: 2, meta: { score: 80, tags: ['c'] } },
      ];
      const binary = encoder.encode(data);
      const restored = decoder.decode(binary);
      // TENS encoder flattens nested objects to dot-notation keys
      expect(restored).toEqual([
        { id: 1, 'meta.score': 95, 'meta.tags': ['a', 'b'] },
        { id: 2, 'meta.score': 80, 'meta.tags': ['c'] },
      ]);
    });

    it('handles null values', () => {
      const data = [
        { id: 1, name: null, active: true },
        { id: 2, name: 'Bob', active: null },
      ];
      const binary = encoder.encode(data);
      const restored = decoder.decode(binary);
      expect(restored).toEqual(data);
    });

    it('handles boolean values', () => {
      const data = [{ enabled: true, disabled: false }];
      const binary = encoder.encode(data);
      const restored = decoder.decode(binary);
      expect(restored).toEqual(data);
    });

    it('handles numeric values', () => {
      const data = [{ int: 42, float: 3.14, negative: -100, zero: 0 }];
      const binary = encoder.encode(data);
      const restored = decoder.decode(binary);
      expect(restored).toEqual(data);
    });

    it('handles empty array', () => {
      const data: Record<string, unknown>[] = [];
      const binary = encoder.encode(data);
      const restored = decoder.decode(binary);
      expect(restored).toEqual(data);
    });

    it('handles single-element array', () => {
      const data = [{ x: 1 }];
      const binary = encoder.encode(data);
      const restored = decoder.decode(binary);
      expect(restored).toEqual(data);
    });

    it('handles mixed types in values', () => {
      const data = [{ a: 'string', b: 42, c: true, d: null, e: [1, 2, 3] }];
      const binary = encoder.encode(data);
      const restored = decoder.decode(binary);
      expect(restored).toEqual(data);
    });
  });

  describe('Canonical output — same data, different key order', () => {
    it('produces same binary regardless of key insertion order', () => {
      const data1 = [{ a: 1, b: 2, c: 3 }];
      const data2 = [{ c: 3, a: 1, b: 2 }];

      const binary1 = encoder.encode(data1);
      const binary2 = encoder.encode(data2);

      expect(binary1).toEqual(binary2);
    });
  });

  describe('Binary format', () => {
    it('starts with TENS magic bytes', () => {
      const data = [{ x: 1 }];
      const binary = encoder.encode(data);

      // TENS magic: 0x54454E53
      expect(binary[0]).toBe(0x54);
      expect(binary[1]).toBe(0x45);
      expect(binary[2]).toBe(0x4e);
      expect(binary[3]).toBe(0x53);
    });

    it('has version byte 2', () => {
      const data = [{ x: 1 }];
      const binary = encoder.encode(data);
      expect(binary[4]).toBe(2);
    });

    it('encodes encoding name length', () => {
      const data = [{ x: 1 }];
      const binary = encoder.encode(data);
      const nameLen = binary[5];
      expect(nameLen).toBeGreaterThan(0);
    });
  });

  describe('Stats', () => {
    it('returns valid stats object', () => {
      const data = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      const stats = encoder.getStats(data);

      expect(stats.schemaCount).toBeGreaterThanOrEqual(1);
      expect(stats.rowCount).toBe(2);
      expect(stats.totalTokenCount).toBeGreaterThan(0);
      expect(stats.byteSize).toBeGreaterThan(0);
      expect(stats.jsonByteSize).toBeGreaterThan(0);
    });
  });
});
