// ============================================================================
// @contex/engine — Predictive Packer (Budget-Constrained Optimal Packing)
// ============================================================================
//
// Given N context items with priorities and a token budget, finds the
// optimal subset that maximizes information value within constraints.
//
// Strategies:
//   - greedy:   Sort by priority desc, take until budget exhausted
//   - density:  Sort by priority/tokens (highest value-per-token first)
//   - knapsack: 0/1 DP for exact optimal (practical for N ≤ 200)
//
// ============================================================================

import { type TokenizerManager, formatOutput } from '@contex/core';
import type { OutputFormat, TokenizerEncoding } from '@contex/core';

// ── Types ───────────────────────────────────────────────────────────────────

/** A context item to consider for packing. */
export interface ContextItem {
  /** Unique identifier */
  id: string;
  /** The actual data (array of objects) */
  data: Record<string, unknown>[];
  /** Priority score (higher = more important, 0-100) */
  priority: number;
  /** Pre-computed token count (if known; computed if omitted) */
  tokens?: number;
  /** Recency score (0-1, higher = more recent) */
  recency?: number;
  /** Relevance score (0-1, higher = more relevant to query) */
  relevance?: number;
}

/** Configuration for the packer. */
export interface PackerConfig {
  /** Maximum token budget */
  maxTokens: number;
  /** Output format to measure tokens in */
  format: OutputFormat;
  /** Tokenizer encoding */
  encoding: TokenizerEncoding;
  /** Packing strategy */
  strategy: 'greedy' | 'density' | 'knapsack';
  /** Weight for recency in composite score (default: 0.2) */
  recencyWeight?: number;
  /** Weight for relevance in composite score (default: 0.3) */
  relevanceWeight?: number;
  /** Weight for priority in composite score (default: 0.5) */
  priorityWeight?: number;
}

/** A rejected item with the reason. */
export interface RejectedItem {
  /** Item ID */
  id: string;
  /** Reason for rejection */
  reason: 'over_budget' | 'zero_priority' | 'too_large';
  /** Token count of the item */
  tokens: number;
  /** Composite score */
  score: number;
}

/** Result of the packing operation. */
export interface PackResult {
  /** Items selected for inclusion */
  selectedItems: (ContextItem & { tokens: number; score: number })[];
  /** Items that didn't fit */
  rejectedItems: RejectedItem[];
  /** Total tokens used */
  totalTokens: number;
  /** Budget utilization percentage */
  utilization: number;
  /** Strategy used */
  strategy: string;
  /** Total composite score of selected items */
  totalScore: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeScore(item: ContextItem, config: PackerConfig): number {
  // Zero-priority items are always rejected
  if (item.priority === 0) return 0;

  const pW = config.priorityWeight ?? 0.5;
  const rW = config.recencyWeight ?? 0.2;
  const relW = config.relevanceWeight ?? 0.3;

  const priority = item.priority / 100; // normalize to 0-1
  const recency = item.recency ?? 0.5; // default: neutral
  const relevance = item.relevance ?? 0.5; // default: neutral

  return priority * pW + recency * rW + relevance * relW;
}

function measureTokens(
  item: ContextItem,
  config: PackerConfig,
  tokenizer: TokenizerManager,
): number {
  if (item.tokens !== undefined) return item.tokens;
  const output = formatOutput(item.data, config.format);
  return tokenizer.countTokens(output, config.encoding);
}

// ── Strategies ──────────────────────────────────────────────────────────────

function packGreedy(
  items: (ContextItem & { tokens: number; score: number })[],
  maxTokens: number,
): { selected: (ContextItem & { tokens: number; score: number })[]; rejected: RejectedItem[] } {
  // Sort by score descending
  const sorted = [...items].sort((a, b) => b.score - a.score);

  const selected: (ContextItem & { tokens: number; score: number })[] = [];
  const rejected: RejectedItem[] = [];
  let remaining = maxTokens;

  for (const item of sorted) {
    if (item.score === 0) {
      rejected.push({
        id: item.id,
        reason: 'zero_priority',
        tokens: item.tokens,
        score: item.score,
      });
      continue;
    }
    if (item.tokens <= remaining) {
      selected.push(item);
      remaining -= item.tokens;
    } else {
      rejected.push({ id: item.id, reason: 'over_budget', tokens: item.tokens, score: item.score });
    }
  }

  return { selected, rejected };
}

function packDensity(
  items: (ContextItem & { tokens: number; score: number })[],
  maxTokens: number,
): { selected: (ContextItem & { tokens: number; score: number })[]; rejected: RejectedItem[] } {
  // Sort by score/tokens ratio descending (best value-per-token first)
  const sorted = [...items]
    .filter((i) => i.tokens > 0)
    .sort((a, b) => b.score / b.tokens - a.score / a.tokens);

  const selected: (ContextItem & { tokens: number; score: number })[] = [];
  const rejected: RejectedItem[] = [];
  let remaining = maxTokens;

  // Handle zero-token items
  for (const item of items) {
    if (item.tokens === 0) {
      rejected.push({ id: item.id, reason: 'too_large', tokens: 0, score: item.score });
    }
  }

  for (const item of sorted) {
    if (item.score === 0) {
      rejected.push({
        id: item.id,
        reason: 'zero_priority',
        tokens: item.tokens,
        score: item.score,
      });
      continue;
    }
    if (item.tokens <= remaining) {
      selected.push(item);
      remaining -= item.tokens;
    } else {
      rejected.push({ id: item.id, reason: 'over_budget', tokens: item.tokens, score: item.score });
    }
  }

  return { selected, rejected };
}

function packKnapsack(
  items: (ContextItem & { tokens: number; score: number })[],
  maxTokens: number,
): { selected: (ContextItem & { tokens: number; score: number })[]; rejected: RejectedItem[] } {
  const n = items.length;

  // Filter out zero-score items first
  const candidates = items.filter((i) => i.score > 0 && i.tokens > 0);
  const zeroItems = items.filter((i) => i.score === 0 || i.tokens === 0);

  const rejected: RejectedItem[] = zeroItems.map((i) => ({
    id: i.id,
    reason: i.score === 0 ? ('zero_priority' as const) : ('too_large' as const),
    tokens: i.tokens,
    score: i.score,
  }));

  // For large N or large budget, fall back to density (DP would be too expensive)
  if (candidates.length > 200 || maxTokens > 50000) {
    return packDensity(items, maxTokens);
  }

  // 0/1 Knapsack DP
  // Scale scores to integers for DP (multiply by 1000 for precision)
  const scaledScores = candidates.map((i) => Math.round(i.score * 1000));
  const weights = candidates.map((i) => i.tokens);

  // DP table: dp[w] = max score achievable with budget w
  const dp = new Float64Array(maxTokens + 1);
  const keep: boolean[][] = Array.from({ length: candidates.length }, () =>
    new Array(maxTokens + 1).fill(false),
  );

  for (let i = 0; i < candidates.length; i++) {
    for (let w = maxTokens; w >= weights[i]; w--) {
      if (dp[w - weights[i]] + scaledScores[i] > dp[w]) {
        dp[w] = dp[w - weights[i]] + scaledScores[i];
        keep[i][w] = true;
      }
    }
  }

  // Backtrack to find selected items
  const selected: (ContextItem & { tokens: number; score: number })[] = [];
  const selectedIds = new Set<string>();
  let w = maxTokens;
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (keep[i][w]) {
      selected.push(candidates[i]);
      selectedIds.add(candidates[i].id);
      w -= weights[i];
    }
  }

  // These candidates weren't selected
  for (const item of candidates) {
    if (!selectedIds.has(item.id)) {
      rejected.push({ id: item.id, reason: 'over_budget', tokens: item.tokens, score: item.score });
    }
  }

  return { selected: selected.reverse(), rejected };
}

// ── Main API ────────────────────────────────────────────────────────────────

/**
 * Pack context items into a token budget using the specified strategy.
 *
 * @param items - Context items to consider
 * @param config - Packer configuration (budget, format, strategy)
 * @param tokenizer - TokenizerManager for token counting
 * @returns Pack result with selected items, rejections, and utilization
 *
 * @example
 * ```ts
 * const result = packContext(
 *   [
 *     { id: 'users', data: userData, priority: 90 },
 *     { id: 'logs', data: logData, priority: 30 },
 *     { id: 'config', data: configData, priority: 70 },
 *   ],
 *   { maxTokens: 4000, format: 'tens-text', encoding: 'o200k_base', strategy: 'density' },
 *   tokenizer,
 * );
 *
 * console.log(result.selectedItems.map(i => i.id));
 * // → ['users', 'config']  (highest value items that fit)
 * ```
 */
export function packContext(
  items: ContextItem[],
  config: PackerConfig,
  tokenizer: TokenizerManager,
): PackResult {
  // Compute tokens and scores for all items
  const scored = items.map((item) => ({
    ...item,
    tokens: measureTokens(item, config, tokenizer),
    score: computeScore(item, config),
  }));

  let result: {
    selected: (ContextItem & { tokens: number; score: number })[];
    rejected: RejectedItem[];
  };

  switch (config.strategy) {
    case 'greedy':
      result = packGreedy(scored, config.maxTokens);
      break;
    case 'density':
      result = packDensity(scored, config.maxTokens);
      break;
    case 'knapsack':
      result = packKnapsack(scored, config.maxTokens);
      break;
    default:
      result = packGreedy(scored, config.maxTokens);
  }

  const totalTokens = result.selected.reduce((sum, i) => sum + i.tokens, 0);
  const totalScore = result.selected.reduce((sum, i) => sum + i.score, 0);

  return {
    selectedItems: result.selected,
    rejectedItems: result.rejected,
    totalTokens,
    utilization:
      config.maxTokens > 0 ? Math.round((totalTokens / config.maxTokens) * 1000) / 10 : 0,
    strategy: config.strategy,
    totalScore: Math.round(totalScore * 1000) / 1000,
  };
}
