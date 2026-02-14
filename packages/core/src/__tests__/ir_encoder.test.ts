import { describe, expect, it } from 'vitest';
import { encodeIR } from '../ir_encoder.js';

describe('IR Encoder — Model-Agnostic Canonical IR', () => {
  describe('encodeIR basic output', () => {
    it('returns { ir, schema, hash }', () => {
      const result = encodeIR([{ name: 'Alice', age: 30 }]);
      expect(result.ir).toBeInstanceOf(Uint8Array);
      expect(result.ir.length).toBeGreaterThan(0);
      expect(result.schema).toBeInstanceOf(Array);
      expect(result.schema.length).toBeGreaterThanOrEqual(1);
      expect(typeof result.hash).toBe('string');
    });

    it('hash is 64-char hex (SHA-256)', () => {
      const result = encodeIR([{ x: 1 }]);
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('IR bytes start with TENS magic', () => {
      const result = encodeIR([{ x: 1 }]);
      // TENS magic: 0x54 0x45 0x4E 0x53
      expect(result.ir[0]).toBe(0x54);
      expect(result.ir[1]).toBe(0x45);
      expect(result.ir[2]).toBe(0x4e);
      expect(result.ir[3]).toBe(0x53);
    });

    it('handles empty input', () => {
      const result = encodeIR([]);
      expect(result.ir).toBeInstanceOf(Uint8Array);
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.schema).toEqual([]);
    });
  });

  describe('Determinism — the core guarantee', () => {
    it('same data different key orders → identical hash', () => {
      const ir1 = encodeIR([{ a: 1, b: 2, c: 3 }]);
      const ir2 = encodeIR([{ c: 3, a: 1, b: 2 }]);
      const ir3 = encodeIR([{ b: 2, c: 3, a: 1 }]);

      expect(ir1.hash).toBe(ir2.hash);
      expect(ir2.hash).toBe(ir3.hash);
    });

    it('same data different key orders → identical IR bytes', () => {
      const ir1 = encodeIR([{ name: 'Alice', age: 30, city: 'NYC' }]);
      const ir2 = encodeIR([{ city: 'NYC', name: 'Alice', age: 30 }]);

      expect(ir1.ir).toEqual(ir2.ir);
    });

    it('consistent hash across 100 calls', () => {
      const data = [{ id: 1, name: 'test', value: 42.5, active: true }];
      const reference = encodeIR(data).hash;

      for (let i = 0; i < 100; i++) {
        expect(encodeIR(data).hash).toBe(reference);
      }
    });

    it('different data → different hash', () => {
      const ir1 = encodeIR([{ x: 1 }]);
      const ir2 = encodeIR([{ x: 2 }]);
      expect(ir1.hash).not.toBe(ir2.hash);
    });
  });

  describe('Schema extraction', () => {
    it('extracts schema with sorted field names', () => {
      const result = encodeIR([{ z: 1, a: 2, m: 3 }]);
      expect(result.schema[0].fields).toEqual(['a', 'm', 'z']);
    });

    it('deduplicates identical schemas', () => {
      const result = encodeIR([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);
      expect(result.schema).toHaveLength(1);
    });

    it('captures multiple schemas for different shapes', () => {
      const result = encodeIR([
        { name: 'Alice', age: 30 },
        { city: 'NYC', population: 8_000_000 },
      ]);
      expect(result.schema).toHaveLength(2);
    });
  });

  describe('Large dataset', () => {
    it('handles 100+ rows with consistent hash', () => {
      const data = Array.from({ length: 150 }, (_, i) => ({
        id: i,
        name: `user_${i}`,
        score: Math.round(Math.random() * 100),
        active: i % 2 === 0,
      }));

      const hash1 = encodeIR(data).hash;
      const hash2 = encodeIR(data).hash;
      expect(hash1).toBe(hash2);
    });
  });
});
