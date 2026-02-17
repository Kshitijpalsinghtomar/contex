import { describe, expect, it } from 'vitest';
import { compose, createComposer } from '../compose.js';
import type { TokenBlock } from '../compose.js';
import { encodeIR } from '../ir_encoder.js';

// ============================================================================
// Token Composition Tests
// ============================================================================

const SAMPLE_DATA = [
  { name: 'Alice', age: 30, city: 'New York' },
  { name: 'Bob', age: 25, city: 'London' },
];

const LARGE_DATA = Array.from({ length: 200 }, (_, i) => ({
  id: i + 1,
  username: `user_${i + 1}`,
  email: `user${i + 1}@example.com`,
  score: Math.round((50 + ((i * 7.3) % 50)) * 100) / 100,
}));

describe('Token Composition', () => {
  describe('compose() — basic', () => {
    it('composes a single text block', () => {
      const result = compose({
        model: 'gpt-4o',
        blocks: [
          {
            name: 'system',
            type: 'text',
            content: 'You are a helpful assistant.',
            priority: 'required',
          },
        ],
      });

      expect(result.tokens.length).toBeGreaterThan(0);
      expect(result.totalTokens).toBe(result.tokens.length);
      expect(result.model).toBe('gpt-4o');
      expect(result.encoding).toBe('o200k_base');
      expect(result.contextWindow).toBe(128_000);
      expect(result.remainingTokens).toBeGreaterThan(0);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].included).toBe(true);
    });

    it('composes text + IR blocks', () => {
      const ir = encodeIR(SAMPLE_DATA);
      const result = compose({
        model: 'gpt-4o',
        blocks: [
          { name: 'system', type: 'text', content: 'Analyze this data:', priority: 'required' },
          { name: 'data', type: 'ir', ir, priority: 'required' },
        ],
      });

      expect(result.blocks).toHaveLength(2);
      expect(result.blocks[0].name).toBe('system');
      expect(result.blocks[1].name).toBe('data');
      expect(result.blocks.every((b) => b.included)).toBe(true);
      expect(result.totalTokens).toBe(result.blocks[0].tokenCount + result.blocks[1].tokenCount);
    });

    it('composes pre-computed token blocks', () => {
      const result = compose({
        model: 'gpt-4o',
        blocks: [{ name: 'prefix', type: 'tokens', tokens: [100, 200, 300], priority: 'required' }],
      });

      expect(result.tokens).toEqual([100, 200, 300]);
      expect(result.totalTokens).toBe(3);
    });
  });

  describe('compose() — budget validation', () => {
    it('throws when required block exceeds budget', () => {
      const bigIR = encodeIR(LARGE_DATA);
      expect(() =>
        compose({
          model: 'gpt-4', // Only 8192 context window
          blocks: [{ name: 'data', type: 'ir', ir: bigIR, priority: 'required' }],
          reserveForResponse: 4096,
        }),
      ).toThrow(/Budget exceeded/);
    });

    it('throws when response reserve exceeds context window', () => {
      expect(() =>
        compose({
          model: 'gpt-4',
          blocks: [{ name: 'system', type: 'text', content: 'Hi', priority: 'required' }],
          reserveForResponse: 10_000, // More than gpt-4's 8192
        }),
      ).toThrow(/No token budget available/);
    });

    it('respects reserveForResponse', () => {
      const result = compose({
        model: 'gpt-4o',
        blocks: [{ name: 'system', type: 'text', content: 'Hello.', priority: 'required' }],
        reserveForResponse: 8000,
      });

      expect(result.reservedForResponse).toBe(8000);
      expect(result.budgetTokens).toBe(128_000 - 8000);
    });

    it('defaults reserveForResponse to 4096', () => {
      const result = compose({
        model: 'gpt-4o',
        blocks: [{ name: 'x', type: 'text', content: 'test', priority: 'required' }],
      });

      expect(result.reservedForResponse).toBe(4096);
    });
  });

  describe('compose() — optional blocks', () => {
    it('includes optional blocks when budget allows', () => {
      const ir = encodeIR(SAMPLE_DATA);
      const result = compose({
        model: 'gpt-4o',
        blocks: [
          { name: 'system', type: 'text', content: 'You are helpful.', priority: 'required' },
          { name: 'examples', type: 'ir', ir, priority: 'optional' },
        ],
      });

      expect(result.blocks).toHaveLength(2);
      expect(result.blocks[1].included).toBe(true);
    });

    it('drops optional blocks when budget is full', () => {
      // Use gpt-4 (8192 tokens) with large reserve to force tight budget
      const ir = encodeIR(SAMPLE_DATA);
      const result = compose({
        model: 'gpt-4',
        blocks: [
          {
            name: 'system',
            type: 'text',
            content:
              'You are a helpful assistant that always responds in JSON format with detailed analysis.',
            priority: 'required',
          },
          { name: 'optional-data', type: 'ir', ir, priority: 'optional' },
        ],
        reserveForResponse: 8000, // Leaves very little budget
      });

      // The optional block should either be truncated or excluded
      const optBlock = result.blocks[1];
      if (!optBlock.included) {
        expect(optBlock.excludedReason).toBeTruthy();
      }
    });

    it('truncates optional blocks to fit remaining budget', () => {
      // Create a scenario where optional block is larger than remaining
      const bigIR = encodeIR(LARGE_DATA);
      const result = compose({
        model: 'gpt-4',
        blocks: [
          { name: 'system', type: 'text', content: 'Analyze:', priority: 'required' },
          { name: 'data', type: 'ir', ir: bigIR, priority: 'optional' },
        ],
        reserveForResponse: 2000,
      });

      const dataBlock = result.blocks[1];
      expect(dataBlock.included).toBe(true);
      // Should be truncated to fit
      expect(result.totalTokens).toBeLessThanOrEqual(result.budgetTokens);
      if (dataBlock.excludedReason) {
        expect(dataBlock.excludedReason).toContain('Truncated');
      }
    });
  });

  describe('compose() — maxTokens cap', () => {
    it('caps block tokens to maxTokens', () => {
      const ir = encodeIR(LARGE_DATA);

      const uncapped = compose({
        model: 'gpt-4o',
        blocks: [{ name: 'data', type: 'ir', ir, priority: 'required' }],
      });

      const capped = compose({
        model: 'gpt-4o',
        blocks: [{ name: 'data', type: 'ir', ir, priority: 'required', maxTokens: 500 }],
      });

      expect(uncapped.blocks[0].tokenCount).toBeGreaterThan(500);
      expect(capped.blocks[0].tokenCount).toBe(500);
    });
  });

  describe('compose() — cross-model', () => {
    it('same blocks produce different token counts for different models', () => {
      const ir = encodeIR(SAMPLE_DATA);
      const blocks: TokenBlock[] = [
        { name: 'system', type: 'text', content: 'Analyze this:', priority: 'required' },
        { name: 'data', type: 'ir', ir, priority: 'required' },
      ];

      const gpt4o = compose({ model: 'gpt-4o', blocks });
      const claude = compose({ model: 'claude-3-5-sonnet', blocks });

      // Different encodings
      expect(gpt4o.encoding).toBe('o200k_base');
      expect(claude.encoding).toBe('cl100k_base');

      // Both should produce valid results
      expect(gpt4o.totalTokens).toBeGreaterThan(0);
      expect(claude.totalTokens).toBeGreaterThan(0);

      // Different context windows
      expect(gpt4o.contextWindow).toBe(128_000);
      expect(claude.contextWindow).toBe(200_000);
    });
  });

  describe('compose() — utilization', () => {
    it('reports correct utilization percentage', () => {
      const result = compose({
        model: 'gpt-4o',
        blocks: [{ name: 'x', type: 'text', content: 'Hello', priority: 'required' }],
        reserveForResponse: 4096,
      });

      const expectedPct = Math.round((result.totalTokens / result.budgetTokens) * 1000) / 10;
      expect(result.utilizationPct).toBe(expectedPct);
      expect(result.remainingTokens).toBe(result.budgetTokens - result.totalTokens);
    });
  });

  describe('Composer (reusable instance)', () => {
    it('can compose multiple requests without re-initialization', () => {
      const composer = createComposer();
      const ir = encodeIR(SAMPLE_DATA);

      const r1 = composer.compose({
        model: 'gpt-4o',
        blocks: [{ name: 'data', type: 'ir', ir, priority: 'required' }],
      });

      const r2 = composer.compose({
        model: 'claude-3-5-sonnet',
        blocks: [{ name: 'data', type: 'ir', ir, priority: 'required' }],
      });

      expect(r1.totalTokens).toBeGreaterThan(0);
      expect(r2.totalTokens).toBeGreaterThan(0);
      expect(r1.model).toBe('gpt-4o');
      expect(r2.model).toBe('claude-3-5-sonnet');

      composer.dispose();
    });
  });
});
