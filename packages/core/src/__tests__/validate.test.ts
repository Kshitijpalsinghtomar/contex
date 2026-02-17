import { describe, expect, it } from 'vitest';
import { TensValidationError, validateInput } from '../tens/validate.js';

describe('validateInput', () => {
  describe('valid inputs', () => {
    it('accepts flat objects array', () => {
      expect(() => validateInput([{ id: 1, name: 'Alice' }])).not.toThrow();
    });

    it('accepts nested objects', () => {
      expect(() => validateInput([{ meta: { score: 95 } }])).not.toThrow();
    });

    it('accepts null values', () => {
      expect(() => validateInput([{ val: null }])).not.toThrow();
    });

    it('accepts booleans', () => {
      expect(() => validateInput([{ flag: true }])).not.toThrow();
    });

    it('accepts numbers', () => {
      expect(() => validateInput([{ n: 42, f: 3.14 }])).not.toThrow();
    });

    it('accepts arrays', () => {
      expect(() => validateInput([{ tags: ['a', 'b'] }])).not.toThrow();
    });

    it('accepts empty array', () => {
      expect(() => validateInput([])).not.toThrow();
    });
  });

  describe('rejects invalid types', () => {
    it('rejects Date objects', () => {
      expect(() => validateInput([{ date: new Date() }])).toThrow(TensValidationError);
      expect(() => validateInput([{ date: new Date() }])).toThrow(/Date/);
    });

    it('rejects RegExp objects', () => {
      expect(() => validateInput([{ pattern: /test/i }])).toThrow(TensValidationError);
      expect(() => validateInput([{ pattern: /test/i }])).toThrow(/RegExp/);
    });

    it('rejects Map objects', () => {
      expect(() => validateInput([{ map: new Map() }])).toThrow(TensValidationError);
    });

    it('rejects Set objects', () => {
      expect(() => validateInput([{ set: new Set() }])).toThrow(TensValidationError);
    });

    it('rejects functions', () => {
      expect(() => validateInput([{ fn: () => {} }])).toThrow(TensValidationError);
    });

    it('rejects BigInt', () => {
      expect(() => validateInput([{ big: BigInt(42) }])).toThrow(TensValidationError);
    });

    it('rejects Symbol', () => {
      expect(() => validateInput([{ sym: Symbol('test') }])).toThrow(TensValidationError);
    });
  });

  describe('circular references', () => {
    it('detects simple circular reference', () => {
      const obj: { id: number; self?: unknown } = { id: 1 };
      obj.self = obj;
      expect(() => validateInput([obj])).toThrow(TensValidationError);
      expect(() => validateInput([obj])).toThrow(/Circular/);
    });
  });

  describe('prototype pollution', () => {
    it('rejects __proto__ keys', () => {
      const data = JSON.parse('{"__proto__": {"admin": true}}');
      expect(() => validateInput([data])).toThrow(TensValidationError);
      expect(() => validateInput([data])).toThrow(/Prototype/);
    });
  });
});
