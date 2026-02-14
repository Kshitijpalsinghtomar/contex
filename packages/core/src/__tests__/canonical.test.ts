import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  canonicalizeArray,
  canonicalizeNumber,
  canonicalizeObject,
  canonicalizeString,
  canonicalizeValue,
} from '../canonical.js';

describe('Canonical — Deterministic Data Normalization', () => {
  describe('canonicalizeString', () => {
    it('applies NFKC normalization', () => {
      // ﬁ (U+FB01 LATIN SMALL LIGATURE FI) → fi
      expect(canonicalizeString('\uFB01')).toBe('fi');
    });

    it('normalizes superscript characters', () => {
      // ² (U+00B2 SUPERSCRIPT TWO) → 2
      expect(canonicalizeString('\u00B2')).toBe('2');
    });

    it('strips trailing whitespace from each line', () => {
      expect(canonicalizeString('hello   ')).toBe('hello');
      expect(canonicalizeString('line1   \nline2   ')).toBe('line1\nline2');
    });

    it('preserves leading whitespace', () => {
      expect(canonicalizeString('  hello')).toBe('  hello');
    });

    it('handles empty strings', () => {
      expect(canonicalizeString('')).toBe('');
    });
  });

  describe('canonicalizeNumber', () => {
    it('preserves integers', () => {
      expect(canonicalizeNumber(42)).toBe(42);
      expect(canonicalizeNumber(0)).toBe(0);
      expect(canonicalizeNumber(-100)).toBe(-100);
    });

    it('converts -0 to 0', () => {
      expect(canonicalizeNumber(-0)).toBe(0);
      expect(Object.is(canonicalizeNumber(-0), 0)).toBe(true);
    });

    it('preserves floats', () => {
      expect(canonicalizeNumber(3.14)).toBe(3.14);
      expect(canonicalizeNumber(1.5)).toBe(1.5);
    });

    it('returns null for NaN', () => {
      expect(canonicalizeNumber(Number.NaN)).toBeNull();
    });

    it('returns null for Infinity', () => {
      expect(canonicalizeNumber(Number.POSITIVE_INFINITY)).toBeNull();
      expect(canonicalizeNumber(Number.NEGATIVE_INFINITY)).toBeNull();
    });
  });

  describe('canonicalizeValue', () => {
    it('returns undefined for undefined', () => {
      expect(canonicalizeValue(undefined)).toBeUndefined();
    });

    it('returns null for null', () => {
      expect(canonicalizeValue(null)).toBeNull();
    });

    it('passes through booleans', () => {
      expect(canonicalizeValue(true)).toBe(true);
      expect(canonicalizeValue(false)).toBe(false);
    });

    it('converts Date to ISO 8601 UTC', () => {
      const d = new Date('2026-02-14T12:00:00Z');
      expect(canonicalizeValue(d)).toBe('2026-02-14T12:00:00.000Z');
    });

    it('returns null for invalid Date', () => {
      expect(canonicalizeValue(new Date('not a date'))).toBeNull();
    });
  });

  describe('canonicalizeObject — key sorting', () => {
    it('sorts keys lexicographically', () => {
      const obj = { c: 3, a: 1, b: 2 };
      const result = canonicalizeObject(obj);
      expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
    });

    it('produces identical output for different key orders', () => {
      const obj1 = { name: 'Alice', age: 30, city: 'NYC' };
      const obj2 = { city: 'NYC', name: 'Alice', age: 30 };
      const obj3 = { age: 30, city: 'NYC', name: 'Alice' };

      const c1 = JSON.stringify(canonicalizeObject(obj1));
      const c2 = JSON.stringify(canonicalizeObject(obj2));
      const c3 = JSON.stringify(canonicalizeObject(obj3));

      expect(c1).toBe(c2);
      expect(c2).toBe(c3);
    });

    it('omits undefined values', () => {
      const obj = { a: 1, b: undefined, c: 3 };
      const result = canonicalizeObject(obj);
      expect(result).toEqual({ a: 1, c: 3 });
      expect('b' in result).toBe(false);
    });

    it('preserves null values', () => {
      const obj = { a: 1, b: null };
      const result = canonicalizeObject(obj);
      expect(result).toEqual({ a: 1, b: null });
    });

    it('recursively canonicalizes nested objects', () => {
      const obj = { z: { b: 2, a: 1 }, a: 'first' };
      const result = canonicalizeObject(obj);
      expect(Object.keys(result)).toEqual(['a', 'z']);
      expect(Object.keys(result.z as Record<string, unknown>)).toEqual(['a', 'b']);
    });
  });

  describe('canonicalizeArray', () => {
    it('preserves element order', () => {
      expect(canonicalizeArray([3, 1, 2])).toEqual([3, 1, 2]);
    });

    it('converts undefined elements to null', () => {
      expect(canonicalizeArray([1, undefined, 3])).toEqual([1, null, 3]);
    });

    it('canonicalizes nested objects in arrays', () => {
      const arr = [{ b: 2, a: 1 }];
      const result = canonicalizeArray(arr);
      expect(Object.keys(result[0] as Record<string, unknown>)).toEqual(['a', 'b']);
    });
  });

  describe('canonicalize — top-level dataset', () => {
    it('canonicalizes an array of objects', () => {
      const data = [
        { name: 'Bob', age: 25 },
        { name: 'Alice', age: 30 },
      ];
      const result = canonicalize(data);
      expect(result).toHaveLength(2);
      // Keys sorted in each row
      expect(Object.keys(result[0])).toEqual(['age', 'name']);
      expect(Object.keys(result[1])).toEqual(['age', 'name']);
    });

    it('handles empty input', () => {
      expect(canonicalize([])).toEqual([]);
    });

    it('same data different key orders → identical JSON', () => {
      const data1 = [{ z: 1, a: 2, m: 3 }];
      const data2 = [{ a: 2, m: 3, z: 1 }];
      const data3 = [{ m: 3, z: 1, a: 2 }];

      const j1 = JSON.stringify(canonicalize(data1));
      const j2 = JSON.stringify(canonicalize(data2));
      const j3 = JSON.stringify(canonicalize(data3));

      expect(j1).toBe(j2);
      expect(j2).toBe(j3);
    });

    it('performs deterministically across 100 iterations', () => {
      const data = [{ z: 'last', a: 'first', m: 'middle', num: 42, flag: true }];
      const reference = JSON.stringify(canonicalize(data));
      for (let i = 0; i < 100; i++) {
        expect(JSON.stringify(canonicalize(data))).toBe(reference);
      }
    });
  });
});
