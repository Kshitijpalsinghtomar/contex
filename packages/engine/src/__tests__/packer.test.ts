// ============================================================================
// Predictive Packer — Tests
// ============================================================================

import { TokenizerManager } from '@contex-llm/core';
import { afterAll, describe, expect, it } from 'vitest';
import { packContext } from '../packer.js';
import type { ContextItem, PackerConfig } from '../packer.js';

const tokenizer = new TokenizerManager('cl100k_base');

afterAll(() => {
  tokenizer.dispose();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeItem(
  id: string,
  priority: number,
  rows: number,
  overrides?: Partial<ContextItem>,
): ContextItem {
  return {
    id,
    data: Array.from({ length: rows }, (_, i) => ({
      id: i,
      name: `${id}_item_${i}`,
      value: `some text content for item ${i} in context ${id}`,
    })),
    priority,
    ...overrides,
  };
}

const baseConfig: PackerConfig = {
  maxTokens: 500,
  format: 'tens-text',
  encoding: 'cl100k_base',
  strategy: 'greedy',
};

// ============================================================================
// Greedy Strategy
// ============================================================================

describe('Packer — Greedy Strategy', () => {
  it('selects high-priority items first', () => {
    const items = [makeItem('low', 10, 5), makeItem('high', 90, 5), makeItem('med', 50, 5)];

    const result = packContext(items, { ...baseConfig, maxTokens: 2000 }, tokenizer);

    // All should fit in 2000 tokens
    expect(result.selectedItems.length).toBe(3);
    // First selected should be highest priority
    expect(result.selectedItems[0].id).toBe('high');
  });

  it('rejects items that exceed remaining budget', () => {
    const items = [
      makeItem('big', 90, 50), // many rows = many tokens
      makeItem('small', 80, 2), // few rows
    ];

    const result = packContext(items, { ...baseConfig, maxTokens: 200 }, tokenizer);

    // At least the small one should fit
    expect(result.selectedItems.length).toBeGreaterThanOrEqual(1);
    expect(result.rejectedItems.length).toBeGreaterThanOrEqual(0);
    expect(result.totalTokens).toBeLessThanOrEqual(200);
  });

  it('reports correct utilization', () => {
    const items = [makeItem('a', 80, 3)];
    const result = packContext(items, { ...baseConfig, maxTokens: 10000 }, tokenizer);

    expect(result.utilization).toBeGreaterThan(0);
    expect(result.utilization).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// Density Strategy
// ============================================================================

describe('Packer — Density Strategy', () => {
  it('prefers high value-per-token items', () => {
    const items = [
      // Low priority but very small (high density)
      makeItem('tiny-valuable', 70, 1),
      // High priority but very large (low density)
      makeItem('big-important', 80, 30),
    ];

    const config = { ...baseConfig, strategy: 'density' as const, maxTokens: 200 };
    const result = packContext(items, config, tokenizer);

    // The tiny-valuable item should be selected because it has better density
    const selected = result.selectedItems.map((i) => i.id);
    expect(selected).toContain('tiny-valuable');
  });
});

// ============================================================================
// Knapsack Strategy
// ============================================================================

describe('Packer — Knapsack Strategy', () => {
  it('finds exact optimal for small N', () => {
    // Known knapsack scenario:
    // 3 items, budget allows exactly 2 of the right combination
    const items: ContextItem[] = [
      { id: 'a', data: [{ v: 'x' }], priority: 60, tokens: 100 },
      { id: 'b', data: [{ v: 'y' }], priority: 100, tokens: 200 },
      { id: 'c', data: [{ v: 'z' }], priority: 80, tokens: 150 },
    ];

    const config = { ...baseConfig, strategy: 'knapsack' as const, maxTokens: 250 };
    const result = packContext(items, config, tokenizer);

    // Optimal: a(60, 100) + c(80, 150) = score 140, tokens 250
    // vs b(100, 200) = score 100, tokens 200
    // Knapsack should find a+c as optimal
    expect(result.totalTokens).toBeLessThanOrEqual(250);

    const selectedIds = result.selectedItems.map((i) => i.id).sort();
    expect(selectedIds).toEqual(['a', 'c']);
  });

  it('handles single item within budget', () => {
    const items: ContextItem[] = [{ id: 'only', data: [{ v: 'test' }], priority: 50, tokens: 10 }];

    const config = { ...baseConfig, strategy: 'knapsack' as const, maxTokens: 100 };
    const result = packContext(items, config, tokenizer);

    expect(result.selectedItems).toHaveLength(1);
    expect(result.selectedItems[0].id).toBe('only');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Packer — Edge Cases', () => {
  it('empty items returns empty result', () => {
    const result = packContext([], baseConfig, tokenizer);

    expect(result.selectedItems).toHaveLength(0);
    expect(result.rejectedItems).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
    expect(result.utilization).toBe(0);
  });

  it('zero budget rejects everything', () => {
    const items = [makeItem('a', 80, 2)];
    const result = packContext(items, { ...baseConfig, maxTokens: 0 }, tokenizer);

    expect(result.selectedItems).toHaveLength(0);
  });

  it('zero-priority items are rejected', () => {
    const items = [makeItem('zero', 0, 2)];
    const result = packContext(items, { ...baseConfig, maxTokens: 10000 }, tokenizer);

    expect(result.selectedItems).toHaveLength(0);
    expect(result.rejectedItems[0].reason).toBe('zero_priority');
  });

  it('recency and relevance affect scoring', () => {
    const items: ContextItem[] = [
      { id: 'old', data: [{ v: 'a' }], priority: 80, recency: 0.1, relevance: 0.1, tokens: 5 },
      { id: 'new', data: [{ v: 'b' }], priority: 80, recency: 0.9, relevance: 0.9, tokens: 5 },
    ];

    const config = { ...baseConfig, strategy: 'greedy' as const, maxTokens: 100 };
    const result = packContext(items, config, tokenizer);

    // Both should fit, but 'new' should have higher score
    const newItem = result.selectedItems.find((i) => i.id === 'new');
    const oldItem = result.selectedItems.find((i) => i.id === 'old');
    expect(newItem).toBeDefined();
    expect(oldItem).toBeDefined();
    if (!newItem || !oldItem) {
      throw new Error('Expected both items to be selected');
    }
    expect(newItem.score).toBeGreaterThan(oldItem.score);
  });
});

describe('Packer — Result Reporting', () => {
  it('reports strategy used', () => {
    const items = [makeItem('a', 50, 2)];
    for (const strategy of ['greedy', 'density', 'knapsack'] as const) {
      const result = packContext(items, { ...baseConfig, strategy, maxTokens: 10000 }, tokenizer);
      expect(result.strategy).toBe(strategy);
    }
  });

  it('reports total score', () => {
    const items = [makeItem('a', 80, 2), makeItem('b', 60, 2)];
    const result = packContext(items, { ...baseConfig, maxTokens: 10000 }, tokenizer);
    expect(result.totalScore).toBeGreaterThan(0);
  });
});
