import { describe, expect, it } from 'vitest';
import { analyzeSavings, quick } from '../quick.js';

const SAMPLE_DATA = [
  { id: 1, name: 'Alice', role: 'admin', email: 'alice@example.com', score: 95 },
  { id: 2, name: 'Bob', role: 'user', email: 'bob@example.com', score: 82 },
  { id: 3, name: 'Carol', role: 'user', email: 'carol@example.com', score: 88 },
  { id: 4, name: 'Dave', role: 'moderator', email: 'dave@example.com', score: 71 },
  { id: 5, name: 'Eve', role: 'admin', email: 'eve@example.com', score: 93 },
];

describe('quick() v3', () => {
  it('returns IR + tokens for valid data', () => {
    const result = quick(SAMPLE_DATA, 'gpt-4o');

    // IR pipeline outputs
    expect(result.tens.ir).toBeDefined(); // Binary IR
    expect(result.tens.hash).toBeTruthy();
    expect(result.tens.fullIR.data).toEqual(SAMPLE_DATA);
    expect(result.tokens).toBeInstanceOf(Array);
    expect(result.tokens.length).toBeGreaterThan(0);
    expect(result.tokenCount).toBe(result.tokens.length);

    // Metadata
    expect(result.rows).toBe(5);
    expect(result.totalRows).toBe(5);
    expect(result.tens.hash).toBe(result.tens.fullIR.hash);
    expect(result.encoding).toBe('o200k_base');
    expect(result.model).toBe('gpt-4o');
  });

  it('returns deterministic results for same data', () => {
    const r1 = quick(SAMPLE_DATA, 'gpt-4o');
    const r2 = quick([...SAMPLE_DATA], 'gpt-4o');

    expect(r1.tens.hash).toBe(r2.tens.hash);
    expect(r1.tokens).toEqual(r2.tokens);
    expect(r1.tokenCount).toBe(r2.tokenCount);
  });

  it('returns empty result for empty data', () => {
    const result = quick([], 'gpt-4o');

    expect(result.tokens).toEqual([]);
    expect(result.tokenCount).toBe(0);
    expect(result.rows).toBe(0);
    expect(result.asText()).toBe('');
  });

  it('throws on unknown model', () => {
    expect(() => quick(SAMPLE_DATA, 'nonexistent-model')).toThrow('Unknown model');
  });

  it('calculates savings vs JSON', () => {
    const result = quick(SAMPLE_DATA, 'gpt-4o');

    expect(result.jsonTokens).toBeGreaterThan(0);
    expect(result.savings.costPerCall).toBeGreaterThanOrEqual(0);
    expect(result.savings.jsonCostPerCall).toBeGreaterThanOrEqual(0);
    expect(typeof result.savings.percent).toBe('number');
    expect(typeof result.savings.tokensSaved).toBe('number');
  });

  it('.asText() returns Contex Compact format by default', () => {
    const result = quick(SAMPLE_DATA, 'gpt-4o');
    const text = result.asText();

    expect(text).toBeTruthy();
    // Should contain all field names and values
    expect(text).toContain('Alice');
    expect(text).toContain('name');
    // Should NOT be JSON (no brackets or colons)
    expect(text).not.toContain('{');
    // Should be tab-separated
    expect(text).toContain('\t');
  });

  it('.asText(format) returns formatted output', () => {
    const result = quick(SAMPLE_DATA, 'gpt-4o');
    const csv = result.asText('csv');

    expect(csv).toContain('Alice');
    // CSV should be different from JSON
    expect(csv.startsWith('[')).toBe(false);
  });

  it('supports maxTokens budget cap', () => {
    const full = quick(SAMPLE_DATA, 'gpt-4o');
    const capped = quick(SAMPLE_DATA, 'gpt-4o', { maxTokens: 10 });

    expect(capped.tokenCount).toBeLessThanOrEqual(10);
    expect(capped.tokenCount).toBeLessThan(full.tokenCount);
  });
});

describe('analyzeSavings() v3', () => {
  it('analyzes savings across default models using IR', () => {
    const results = analyzeSavings(SAMPLE_DATA);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.model).toBeTruthy();
      expect(r.jsonTokens).toBeGreaterThan(0);
      expect(r.irTokens).toBeGreaterThan(0);
      expect(typeof r.savingsPercent).toBe('number');
    }
  });

  it('returns empty for empty data', () => {
    const results = analyzeSavings([]);
    expect(results).toEqual([]);
  });
});
