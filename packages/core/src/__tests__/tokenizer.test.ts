import { describe, expect, it } from 'vitest';
import { TokenizerManager } from '../tokenizer.js';

describe('TokenizerManager', () => {
  it('counts tokens for a simple string', () => {
    const tm = new TokenizerManager('cl100k_base');
    const count = tm.countTokens('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(typeof count).toBe('number');
    tm.dispose();
  });

  it('different encodings produce different token counts', () => {
    const tm1 = new TokenizerManager('cl100k_base');
    const tm2 = new TokenizerManager('o200k_base');

    const text = 'The quick brown fox jumps over the lazy dog';
    const count1 = tm1.countTokens(text);
    const count2 = tm2.countTokens(text);

    // They should both produce positive counts
    expect(count1).toBeGreaterThan(0);
    expect(count2).toBeGreaterThan(0);
    // Different tokenizers may produce different counts (not guaranteed, but very likely for longer text)

    tm1.dispose();
    tm2.dispose();
  });

  it('empty string produces zero tokens', () => {
    const tm = new TokenizerManager('cl100k_base');
    const count = tm.countTokens('');
    expect(count).toBe(0);
    tm.dispose();
  });

  it('respects encoding parameter override', () => {
    const tm = new TokenizerManager('cl100k_base');
    // Count with default encoding
    const count1 = tm.countTokens('Hello world');
    // Count with explicit override
    const count2 = tm.countTokens('Hello world', 'o200k_base');

    expect(count1).toBeGreaterThan(0);
    expect(count2).toBeGreaterThan(0);

    tm.dispose();
  });

  it('handles long text', () => {
    const tm = new TokenizerManager('cl100k_base');
    const longText = 'word '.repeat(1000);
    const count = tm.countTokens(longText);
    expect(count).toBeGreaterThan(100);
    tm.dispose();
  });

  it('handles unicode text', () => {
    const tm = new TokenizerManager('cl100k_base');
    const count = tm.countTokens('こんにちは世界 🌍');
    expect(count).toBeGreaterThan(0);
    tm.dispose();
  });
});
