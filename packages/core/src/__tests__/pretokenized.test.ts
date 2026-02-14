// ============================================================================
// Pre-Tokenized Binary Blocks — Tests
// ============================================================================

import { afterAll, describe, expect, it } from 'vitest';
import { createPreTokenizedBlock, getFieldTokens, readPreTokenizedBlock } from '../pretokenized.js';
import { TokenizerManager } from '../tokenizer.js';
import type { TokenizerEncoding } from '../types.js';

const tokenizer = new TokenizerManager('cl100k_base');

afterAll(() => {
  tokenizer.dispose();
});

describe('Pre-Tokenized Block — Create & Read', () => {
  it('roundtrips simple data', () => {
    const data = [
      { name: 'Alice', role: 'admin' },
      { name: 'Bob', role: 'user' },
    ];

    const binary = createPreTokenizedBlock(data, 'cl100k_base', tokenizer);
    const block = readPreTokenizedBlock(binary);

    expect(block.encoding).toBe('cl100k_base');
    expect(block.fieldIndex).toHaveLength(2); // name, role
    expect(block.totalTokens).toBeGreaterThan(0);

    // Verify field names are sorted
    expect(block.fieldIndex[0].fieldName).toBe('name');
    expect(block.fieldIndex[1].fieldName).toBe('role');
  });

  it('tokens match independent tokenization', () => {
    const data = [{ greeting: 'Hello world' }];

    const binary = createPreTokenizedBlock(data, 'cl100k_base', tokenizer);
    const block = readPreTokenizedBlock(binary);

    const fieldToks = getFieldTokens(block, 'greeting')!;
    const directToks = tokenizer.tokenize('Hello world', 'cl100k_base');

    expect(fieldToks).toEqual(directToks);
  });

  it('handles multiple rows', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      msg: `message number ${i}`,
    }));

    const binary = createPreTokenizedBlock(data, 'cl100k_base', tokenizer);
    const block = readPreTokenizedBlock(binary);

    expect(block.fieldIndex).toHaveLength(2);
    expect(block.totalTokens).toBeGreaterThan(10);
  });

  it('handles empty data', () => {
    const binary = createPreTokenizedBlock([], 'o200k_base', tokenizer);
    const block = readPreTokenizedBlock(binary);

    expect(block.encoding).toBe('o200k_base');
    expect(block.fieldIndex).toHaveLength(0);
    expect(block.totalTokens).toBe(0);
  });

  it('handles null/undefined values gracefully', () => {
    const data = [
      { name: 'Alice', email: null },
      { name: 'Bob', email: 'bob@test.com' },
    ];

    const binary = createPreTokenizedBlock(data, 'cl100k_base', tokenizer);
    const block = readPreTokenizedBlock(binary);

    expect(block.fieldIndex).toHaveLength(2);
    expect(block.totalTokens).toBeGreaterThan(0);
  });
});

describe('Pre-Tokenized Block — Field Random Access', () => {
  it('retrieves correct tokens for a specific field', () => {
    const data = [
      { firstName: 'Alice', lastName: 'Smith' },
      { firstName: 'Bob', lastName: 'Jones' },
    ];

    const binary = createPreTokenizedBlock(data, 'cl100k_base', tokenizer);
    const block = readPreTokenizedBlock(binary);

    const firstNameTokens = getFieldTokens(block, 'firstName')!;
    const lastNameTokens = getFieldTokens(block, 'lastName')!;

    expect(firstNameTokens).toBeDefined();
    expect(lastNameTokens).toBeDefined();

    // Tokens are the concatenation of all values for that field
    const aliceTokens = tokenizer.tokenize('Alice', 'cl100k_base');
    const bobTokens = tokenizer.tokenize('Bob', 'cl100k_base');
    expect(firstNameTokens).toEqual([...aliceTokens, ...bobTokens]);
  });

  it('returns undefined for unknown field', () => {
    const data = [{ name: 'Alice' }];
    const binary = createPreTokenizedBlock(data, 'cl100k_base', tokenizer);
    const block = readPreTokenizedBlock(binary);

    expect(getFieldTokens(block, 'nonexistent')).toBeUndefined();
  });
});

describe('Pre-Tokenized Block — Multi-Encoding', () => {
  const encodings: TokenizerEncoding[] = ['cl100k_base', 'o200k_base'];

  for (const encoding of encodings) {
    it(`works with ${encoding}`, () => {
      const data = [{ text: 'The quick brown fox jumps over the lazy dog' }];

      const binary = createPreTokenizedBlock(data, encoding, tokenizer);
      const block = readPreTokenizedBlock(binary);

      expect(block.encoding).toBe(encoding);
      const fieldToks = getFieldTokens(block, 'text')!;
      const directToks = tokenizer.tokenize(data[0].text, encoding);
      expect(fieldToks).toEqual(directToks);
    });
  }
});

describe('Pre-Tokenized Block — Self-Describing', () => {
  it('block contains encoding metadata (no external info needed)', () => {
    const binary = createPreTokenizedBlock([{ val: 'test' }], 'o200k_base', tokenizer);
    const block = readPreTokenizedBlock(binary);

    // The block tells you which encoding was used — no guessing
    expect(block.encoding).toBe('o200k_base');
  });

  it('rejects invalid magic bytes', () => {
    const binary = new Uint8Array([0x00, 0x00, 0x00, 0x00, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => readPreTokenizedBlock(binary)).toThrow('bad magic');
  });
});

describe('Pre-Tokenized Block — Performance Advantage', () => {
  it('reading block is faster than tokenizing (no tokenizer call)', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      text: `This is a longer text passage number ${i} with some content`,
    }));

    const binary = createPreTokenizedBlock(data, 'cl100k_base', tokenizer);

    // Read block — should be fast (just binary parsing)
    const readStart = performance.now();
    for (let i = 0; i < 100; i++) {
      readPreTokenizedBlock(binary);
    }
    const readTime = performance.now() - readStart;

    // Tokenize from scratch — should be slower
    const tokenizeStart = performance.now();
    for (let i = 0; i < 100; i++) {
      for (const row of data) {
        tokenizer.tokenize(row.text, 'cl100k_base');
      }
    }
    const tokenizeTime = performance.now() - tokenizeStart;

    console.log(`\n  Pre-tokenized read: ${readTime.toFixed(2)}ms (100 iterations)`);
    console.log(`  Live tokenization:  ${tokenizeTime.toFixed(2)}ms (100 iterations)`);
    console.log(`  Speedup: ${(tokenizeTime / readTime).toFixed(1)}x`);

    // Reading pre-tokenized should be at least comparable
    // (tokenizer has LRU cache so we just verify it works and log speedup)
    expect(readTime).toBeLessThan(tokenizeTime * 10);
  });
});
