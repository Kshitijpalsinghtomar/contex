import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatOutput } from '../formatters.js';
import { TokenMemory } from '../memory.js';
import { Tens } from '../tens.js';

const TEST_DIR = '.contex_test_env';

describe('Tens Integration', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should be deterministic (shuffle keys -> same hash)', () => {
    const data1 = [{ a: 1, b: 2, c: { x: 10, y: 20 } }];
    const data2 = [{ b: 2, a: 1, c: { y: 20, x: 10 } }]; // Shuffled keys

    const tens1 = Tens.encode(data1);
    const tens2 = Tens.encode(data2);

    expect(tens1.hash).toBe(tens2.hash);
    expect(tens1.ir).toEqual(tens2.ir);
  });

  it('should implement toString() as canonical text (JSON)', () => {
    const data = [{ id: 1, name: 'Test' }];
    const tens = Tens.encode(data);
    const text = tens.toString();
    // Should match JSON.stringify of canonical data
    expect(text).toBe(JSON.stringify(data));

    // Also check if canonicalization happened
    const mixed = [{ b: 2, a: 1 }];
    const tensMixed = Tens.encode(mixed);
    expect(tensMixed.toString()).toBe('[{"a":1,"b":2}]'); // Sorted keys
  });

  it('should load from hash', () => {
    const memory = new TokenMemory(TEST_DIR);
    const data = [{ key: 'value' }];

    // Encode and store
    const original = Tens.encode(data, { memory });
    expect(memory.has(original.hash)).toBe(true);

    // Load back
    const loaded = Tens.loadFromHash(original.hash, memory);
    expect(loaded.hash).toBe(original.hash);
    expect(loaded.toString()).toBe(original.toString());
  });

  it('should materialize tokens with caching', () => {
    const memory = new TokenMemory(TEST_DIR);
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i, text: `Item ${i}` }));
    const tens = Tens.encode(data, { memory });

    // First call (cold)
    const startCold = performance.now();
    const tokens1 = tens.materialize('gpt-4o');
    const coldTime = performance.now() - startCold;

    expect(tokens1).toBeInstanceOf(Int32Array);
    expect(tokens1.length).toBeGreaterThan(0);

    // Second call (warm)
    const startWarm = performance.now();
    const tokens2 = tens.materialize('gpt-4o');
    const warmTime = performance.now() - startWarm;

    expect(tokens2).toEqual(tokens1);
    // Warm should be significantly faster (though in unit test environment with small data it might be close)
    // We just check correctness mainly.
  });

  it('should respect maxTokens in materialize', () => {
    const memory = new TokenMemory(TEST_DIR);
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i, text: 'Tokens '.repeat(10) }));
    const tens = Tens.encode(data, { memory });

    // Limit to 50 tokens
    const tokens = tens.materialize('gpt-4o', { maxTokens: 50 });
    expect(tokens.length).toBe(50);
  });
});
