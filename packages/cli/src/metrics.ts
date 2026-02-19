// ============================================================================
// Isolated Metrics — Each metric measured independently
// ============================================================================

import type { TokenStreamEncoder, TokenizerManager } from '@contex-llm/core';
import type { TokenizerEncoding } from '@contex-llm/core';
import * as transcoders from './transcoders.js';
import type { SupportedFormat } from './transcoders.js';

// --- Helper: Extract all leaf values from data ---
export function extractLeafValues(obj: unknown): string[] {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== 'object') return [String(obj)];
  if (Array.isArray(obj)) return obj.flatMap(extractLeafValues);
  return Object.values(obj).flatMap(extractLeafValues);
}

// ============================================================================
// 1. Marginal Cost Slope
// ============================================================================
export interface MarginalCostEntry {
  dataset: string;
  format: string;
  interval: string; // e.g. "100→500"
  fromSize: number;
  toSize: number;
  fromTokens: number;
  toTokens: number;
  deltaTokensPerRow: number;
}

export function measureMarginalCost(
  datasetName: string,
  generateFn: (count: number) => unknown[],
  formats: SupportedFormat[],
  tokenizer: TokenizerManager,
  tensEncoder: TokenStreamEncoder,
): MarginalCostEntry[] {
  const intervals: [number, number][] = [
    [100, 500],
    [500, 1000],
    [1000, 5000],
  ];
  const results: MarginalCostEntry[] = [];

  // Pre-generate all needed sizes
  const sizes = new Set<number>();
  for (const [from, to] of intervals) {
    sizes.add(from);
    sizes.add(to);
  }

  const tokenCache = new Map<string, number>();

  function getTokens(size: number, fmt: SupportedFormat): number {
    const key = `${size}:${fmt}`;
    const cached = tokenCache.get(key);
    if (cached !== undefined) return cached;

    const data = generateFn(size);
    const rows = data as Record<string, unknown>[];
    let tokens: number;
    if (fmt === 'tens') {
      const stream = tensEncoder.encodeToTokenStream(rows);
      tokens = stream.length;
    } else {
      const output = transcoders.transcode(rows, fmt);
      tokens = tokenizer.countTokens(output as string, 'o200k_base');
    }
    tokenCache.set(key, tokens);
    return tokens;
  }

  for (const fmt of formats) {
    for (const [from, to] of intervals) {
      const fromTokens = getTokens(from, fmt);
      const toTokens = getTokens(to, fmt);
      const deltaRows = to - from;
      const deltaTokensPerRow = deltaRows > 0 ? (toTokens - fromTokens) / deltaRows : 0;

      results.push({
        dataset: datasetName,
        format: fmt,
        interval: `${from}→${to}`,
        fromSize: from,
        toSize: to,
        fromTokens,
        toTokens,
        deltaTokensPerRow: Math.round(deltaTokensPerRow * 100) / 100,
      });
    }
  }

  return results;
}

// ============================================================================
// 2. Structural Overhead Measurement
// ============================================================================
export interface StructuralOverheadEntry {
  dataset: string;
  format: string;
  rows: number;
  totalTokens: number;
  valueTokens: number;
  structuralTokens: number;
  overheadRatio: number;
}

export function measureStructuralOverhead(
  datasetName: string,
  data: unknown[],
  formats: SupportedFormat[],
  tokenizer: TokenizerManager,
  tensEncoder: TokenStreamEncoder,
): StructuralOverheadEntry[] {
  // Calculate value tokens (leaf values only, no keys, no structure)
  const allValues = extractLeafValues(data).join(' ');
  const valueTokens = tokenizer.countTokens(allValues, 'o200k_base');
  const results: StructuralOverheadEntry[] = [];

  for (const fmt of formats) {
    const rows = data as Record<string, unknown>[];
    let totalTokens: number;
    if (fmt === 'tens') {
      const stream = tensEncoder.encodeToTokenStream(rows);
      totalTokens = stream.length;
    } else {
      const output = transcoders.transcode(rows, fmt);
      totalTokens = tokenizer.countTokens(output as string, 'o200k_base');
    }

    const structuralTokens = Math.max(0, totalTokens - valueTokens);
    results.push({
      dataset: datasetName,
      format: fmt,
      rows: data.length,
      totalTokens,
      valueTokens,
      structuralTokens,
      overheadRatio:
        totalTokens > 0 ? Math.round((structuralTokens / totalTokens) * 10000) / 10000 : 0,
    });
  }

  return results;
}

// ============================================================================
// 3. Schema Width Sensitivity
// ============================================================================
export interface SchemaWidthEntry {
  format: string;
  columns: number;
  tokens: number;
  bytes: number;
  tokensPerColumn: number;
}

export function measureSchemaWidthSensitivity(
  columnCounts: number[],
  rowCount: number,
  formats: SupportedFormat[],
  tokenizer: TokenizerManager,
  tensEncoder: TokenStreamEncoder,
): SchemaWidthEntry[] {
  // Import dynamically to avoid circular
  const { generateWideSchema } = require('./generators.js');
  const results: SchemaWidthEntry[] = [];

  for (const cols of columnCounts) {
    const data = generateWideSchema(rowCount, cols);

    for (const fmt of formats) {
      let tokens: number;
      let bytes: number;
      if (fmt === 'tens') {
        const stream = tensEncoder.encodeToTokenStream(data);
        const bin = tensEncoder.encode(data);
        tokens = stream.length;
        bytes = bin.length;
      } else {
        const output = transcoders.transcode(data, fmt);
        tokens = tokenizer.countTokens(output as string, 'o200k_base');
        bytes = Buffer.byteLength(output as string);
      }

      results.push({
        format: fmt,
        columns: cols,
        tokens,
        bytes,
        tokensPerColumn: Math.round((tokens / cols) * 100) / 100,
      });
    }
  }

  return results;
}

// ============================================================================
// 4. Tokenizer Spread
// ============================================================================
export interface TokenizerSpreadEntry {
  format: string;
  encoding: string;
  dataset: string;
  tokens: number;
}

export function measureTokenizerSpread(
  datasetName: string,
  data: unknown[],
  formats: SupportedFormat[],
  tokenizer: TokenizerManager,
): TokenizerSpreadEntry[] {
  const encodings: TokenizerEncoding[] = ['cl100k_base', 'o200k_base', 'p50k_base', 'r50k_base'];
  const results: TokenizerSpreadEntry[] = [];

  for (const fmt of formats) {
    if (fmt === 'tens') continue; // TENS uses its own encoding, skip multi-tokenizer
    const output = transcoders.transcode(data as Record<string, unknown>[], fmt) as string;

    for (const enc of encodings) {
      try {
        const tokens = tokenizer.countTokens(output, enc);
        results.push({
          format: fmt,
          encoding: enc,
          dataset: datasetName,
          tokens,
        });
      } catch {
        // Some encodings may not be available
      }
    }
  }

  return results;
}

// ============================================================================
// 5. Entropy / Repetition Correlation
// ============================================================================
export interface EntropyCorrelationEntry {
  dataset: string;
  format: string;
  entropy: number;
  stringReuseRatio: number;
  tokens: number;
  tokensVsJson: number; // ratio vs JSON token count
}

export function measureEntropyCorrelation(
  datasetName: string,
  data: unknown[],
  formats: SupportedFormat[],
  tokenizer: TokenizerManager,
  tensEncoder: TokenStreamEncoder,
  repetitionStats: { entropy: number; stringReuseRatio: number },
): EntropyCorrelationEntry[] {
  const results: EntropyCorrelationEntry[] = [];

  // Get JSON baseline
  const rows = data as Record<string, unknown>[];
  const jsonOutput = transcoders.transcode(rows, 'json') as string;
  const jsonTokens = tokenizer.countTokens(jsonOutput, 'o200k_base');

  for (const fmt of formats) {
    let tokens: number;
    if (fmt === 'tens') {
      const stream = tensEncoder.encodeToTokenStream(rows);
      tokens = stream.length;
    } else {
      const output = transcoders.transcode(rows, fmt) as string;
      tokens = tokenizer.countTokens(output, 'o200k_base');
    }

    results.push({
      dataset: datasetName,
      format: fmt,
      entropy: repetitionStats.entropy,
      stringReuseRatio: repetitionStats.stringReuseRatio,
      tokens,
      tokensVsJson: jsonTokens > 0 ? Math.round((tokens / jsonTokens) * 10000) / 10000 : 0,
    });
  }

  return results;
}
