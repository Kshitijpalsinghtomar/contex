// ============================================================================
// Prefix-Cache-Aware Output — Maximize KV cache reuse across requests
// ============================================================================
//
// Modern LLM inference engines (vLLM, SGLang, TensorRT-LLM) cache the KV
// state of previously seen token prefixes. If consecutive requests share a
// common prefix, the cached KV pairs are reused → faster inference, lower cost.
//
// This module structures contex output to maximize prefix reuse:
//   1. Schema header always comes first (stable across requests)
//   2. Field order is fixed (alphabetically sorted — already guaranteed)
//   3. Rows are sorted by a stable key (id, timestamp, etc.)
//   4. Optional: pad schema header to fixed token length for alignment
//
// The benchmark measures how many tokens of prefix overlap exist between
// consecutive queries — simulating KV cache reuse in production.

import { formatOutput } from '@contex-llm/core';
import type { TokenizerManager } from '@contex-llm/core';
import type { OutputFormat, TokenizerEncoding } from '@contex-llm/core';

// ---- Prefix-aware formatting ----

export interface PrefixAwareOptions {
  /** Format to use (default: toon) */
  format?: OutputFormat;
  /** Field to sort rows by for deterministic ordering */
  sortBy?: string;
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
  /** If true, pad header to fixed token count for alignment */
  padHeader?: boolean;
  /** Target header token length when padding (default: 32) */
  headerTokenTarget?: number;
}

/**
 * Format data with prefix-cache-aware ordering.
 * Sorts rows by a stable key so that incremental queries share maximum
 * prefix overlap with previous results.
 *
 * @param data - Array of objects to format
 * @param options - Prefix-aware formatting options
 * @returns Formatted string optimized for prefix cache reuse
 */
export function formatPrefixAware(
  data: Record<string, unknown>[],
  options: PrefixAwareOptions = {},
): string {
  const format = options.format ?? 'toon';
  const sortBy = options.sortBy;
  const direction = options.sortDirection ?? 'asc';

  // Sort rows by stable key for consistent ordering across requests
  const sorted = [...data];
  if (sortBy) {
    sorted.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = va < vb ? -1 : 1;
      return direction === 'asc' ? cmp : -cmp;
    });
  }

  return formatOutput(sorted, format);
}

// ---- Prefix Overlap Analysis ----

export interface PrefixAnalysis {
  /** Number of requests analyzed */
  requestCount: number;
  /** Average prefix overlap in tokens between consecutive requests */
  avgPrefixTokens: number;
  /** Average prefix overlap as % of total tokens */
  avgPrefixPercent: number;
  /** Total tokens across all requests */
  totalTokens: number;
  /** Tokens saved by prefix caching (reused tokens) */
  cachedTokens: number;
  /** Cache hit rate (reused tokens / total tokens) */
  cacheHitRate: number;
  /** Per-request breakdown */
  requests: {
    tokens: number;
    prefixOverlap: number;
    prefixPercent: number;
  }[];
}

/**
 * Find the longest common prefix between two token arrays.
 */
function commonPrefixLength(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return len;
}

/**
 * Measure prefix overlap across a sequence of formatted outputs.
 * Simulates KV cache reuse in vLLM/SGLang-style inference engines.
 *
 * @param outputs - Array of formatted strings (e.g., consecutive query results)
 * @param encoding - Tokenizer encoding to use
 * @param tokenizer - TokenizerManager instance
 * @returns Analysis of prefix reuse across the request sequence
 */
export function analyzePrefixReuse(
  outputs: string[],
  encoding: TokenizerEncoding,
  tokenizer: TokenizerManager,
): PrefixAnalysis {
  if (outputs.length === 0) {
    return {
      requestCount: 0,
      avgPrefixTokens: 0,
      avgPrefixPercent: 0,
      totalTokens: 0,
      cachedTokens: 0,
      cacheHitRate: 0,
      requests: [],
    };
  }

  const tokenized = outputs.map((o) => tokenizer.tokenize(o, encoding));
  const requests: PrefixAnalysis['requests'] = [];
  let totalTokens = 0;
  let cachedTokens = 0;

  for (let i = 0; i < tokenized.length; i++) {
    const tokens = tokenized[i].length;
    totalTokens += tokens;

    if (i === 0) {
      // First request: no prefix reuse possible
      requests.push({ tokens, prefixOverlap: 0, prefixPercent: 0 });
    } else {
      const overlap = commonPrefixLength(tokenized[i - 1], tokenized[i]);
      const percent = tokens > 0 ? Math.round((overlap / tokens) * 1000) / 10 : 0;
      cachedTokens += overlap;
      requests.push({ tokens, prefixOverlap: overlap, prefixPercent: percent });
    }
  }

  const overlaps = requests.slice(1).map((r) => r.prefixOverlap);
  const percents = requests.slice(1).map((r) => r.prefixPercent);

  const avgPrefixTokens =
    overlaps.length > 0 ? Math.round(overlaps.reduce((a, b) => a + b, 0) / overlaps.length) : 0;

  const avgPrefixPercent =
    percents.length > 0
      ? Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10
      : 0;

  return {
    requestCount: outputs.length,
    avgPrefixTokens,
    avgPrefixPercent,
    totalTokens,
    cachedTokens,
    cacheHitRate: totalTokens > 0 ? Math.round((cachedTokens / totalTokens) * 1000) / 10 : 0,
    requests,
  };
}
