import { describe, expect, it } from 'vitest';
import { CANONICALIZATION_VERSION, IR_VERSION, encodeIR } from '../ir_encoder.js';
import {
  TOKENIZER_VERSION,
  createMaterializer,
  materialize,
  resolveEncoding,
} from '../materialize.js';

describe('Materializer — IR → Model-Specific Tokens', () => {
  // Pre-encode some test data
  const testData = [
    { name: 'Alice', age: 30, city: 'New York' },
    { name: 'Bob', age: 25, city: 'London' },
  ];
  const testIR = encodeIR(testData);

  describe('materialize basic output', () => {
    it('returns { tokens, modelId, encoding, tokenCount, irHash }', () => {
      const result = materialize(testIR, 'gpt-4o');
      expect(Array.isArray(result.tokens)).toBe(true);
      expect(result.tokens.length).toBeGreaterThan(0);
      expect(result.modelId).toBe('gpt-4o');
      expect(result.encoding).toBe('o200k_base');
      expect(result.tokenCount).toBe(result.tokens.length);
      expect(result.irHash).toBe(testIR.hash);
    });

    it('tokens are positive integers', () => {
      const result = materialize(testIR, 'gpt-4o');
      for (const token of result.tokens) {
        expect(Number.isInteger(token)).toBe(true);
        expect(token).toBeGreaterThanOrEqual(0);
      }
    });

    it('tokenCount matches tokens.length', () => {
      const result = materialize(testIR, 'gpt-4o');
      expect(result.tokenCount).toBe(result.tokens.length);
    });
  });

  describe('Model encoding resolution', () => {
    it('resolves gpt-4o → o200k_base', () => {
      expect(resolveEncoding('gpt-4o')).toBe('o200k_base');
    });

    it('resolves claude-3-5-sonnet → cl100k_base', () => {
      expect(resolveEncoding('claude-3-5-sonnet')).toBe('cl100k_base');
    });

    it('throws for unknown model', () => {
      expect(() => resolveEncoding('unknown-model-xyz')).toThrow('Unknown model');
    });
  });

  describe('Cross-model materialization', () => {
    it('different models produce different token arrays', () => {
      const gpt4o = materialize(testIR, 'gpt-4o');
      const claude = materialize(testIR, 'claude-3-5-sonnet');

      expect(gpt4o.encoding).toBe('o200k_base');
      expect(claude.encoding).toBe('cl100k_base');
      expect(gpt4o.tokens).not.toEqual(claude.tokens);
    });

    it('same model always produces same tokens', () => {
      const result1 = materialize(testIR, 'gpt-4o');
      const result2 = materialize(testIR, 'gpt-4o');
      expect(result1.tokens).toEqual(result2.tokens);
    });
  });

  describe('Caching', () => {
    it('second call returns cached result (same reference)', () => {
      const m = createMaterializer();
      const result1 = m.materialize(testIR, 'gpt-4o');
      const result2 = m.materialize(testIR, 'gpt-4o');
      expect(result1).toBe(result2);
      m.dispose();
    });

    it('different models get different cache entries', () => {
      const m = createMaterializer();
      const r1 = m.materialize(testIR, 'gpt-4o');
      const r2 = m.materialize(testIR, 'claude-3-5-sonnet');
      expect(r1).not.toBe(r2);
      expect(r1.modelId).toBe('gpt-4o');
      expect(r2.modelId).toBe('claude-3-5-sonnet');
      m.dispose();
    });
  });

  describe('irHash tracking', () => {
    it('irHash matches the source IR hash', () => {
      const result = materialize(testIR, 'gpt-4o');
      expect(result.irHash).toBe(testIR.hash);
    });

    it('different IR → different irHash in materialized result', () => {
      const ir2 = encodeIR([{ x: 999 }]);
      const r1 = materialize(testIR, 'gpt-4o');
      const r2 = materialize(ir2, 'gpt-4o');
      expect(r1.irHash).not.toBe(r2.irHash);
    });
  });

  // ---- IR Versioning ----

  describe('IR versioning', () => {
    it('encodeIR sets irVersion', () => {
      expect(testIR.irVersion).toBe(IR_VERSION);
    });

    it('encodeIR sets canonicalizationVersion', () => {
      expect(testIR.canonicalizationVersion).toBe(CANONICALIZATION_VERSION);
    });
  });

  // ---- Tokenizer Fingerprinting ----

  describe('tokenizer fingerprinting', () => {
    it('result includes tokenizerVersion', () => {
      const result = materialize(testIR, 'gpt-4o');
      expect(result.tokenizerVersion).toBe(TOKENIZER_VERSION);
    });

    it('result includes tokenizerFingerprint (non-empty string)', () => {
      const result = materialize(testIR, 'gpt-4o');
      expect(typeof result.tokenizerFingerprint).toBe('string');
      expect(result.tokenizerFingerprint.length).toBeGreaterThan(10);
    });

    it('same encoding produces same fingerprint', () => {
      const r1 = materialize(testIR, 'gpt-4o');
      const r2 = materialize(testIR, 'gpt-4o-mini'); // same encoding
      expect(r1.tokenizerFingerprint).toBe(r2.tokenizerFingerprint);
    });

    it('different encodings produce different fingerprints', () => {
      const r1 = materialize(testIR, 'gpt-4o'); // o200k_base
      const r2 = materialize(testIR, 'gpt-4'); // cl100k_base
      expect(r1.tokenizerFingerprint).not.toBe(r2.tokenizerFingerprint);
    });

    it('getFingerprint() on materializer returns consistent result', () => {
      const m = createMaterializer();
      const fp = m.getFingerprint('o200k_base');
      const result = m.materialize(testIR, 'gpt-4o');
      expect(fp).toBe(result.tokenizerFingerprint);
      m.dispose();
    });
  });

  // ---- Budget-Aware Materialization (maxTokens) ----

  describe('maxTokens budget-aware materialization', () => {
    it('truncates result when maxTokens is less than full', () => {
      const full = materialize(testIR, 'gpt-4o');
      const capped = materialize(testIR, 'gpt-4o', { maxTokens: 5 });
      expect(capped.tokenCount).toBe(5);
      expect(capped.tokens.length).toBe(5);
      expect(capped.tokens).toEqual(full.tokens.slice(0, 5));
    });

    it('no truncation when maxTokens exceeds actual', () => {
      const full = materialize(testIR, 'gpt-4o');
      const capped = materialize(testIR, 'gpt-4o', { maxTokens: 100_000 });
      expect(capped.tokenCount).toBe(full.tokenCount);
    });

    it('maxTokens on cached result returns truncated copy', () => {
      const m = createMaterializer();
      const full = m.materialize(testIR, 'gpt-4o');
      const capped = m.materialize(testIR, 'gpt-4o', { maxTokens: 3 });
      expect(capped.tokenCount).toBe(3);
      expect(full.tokenCount).toBeGreaterThan(3);
      m.dispose();
    });
  });
});
