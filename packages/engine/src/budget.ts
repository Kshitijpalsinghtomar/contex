// ============================================================================
// Token Budget Engine — Intelligent context window packing
// ============================================================================
//
// Instead of "give me data with maxTokens: 4096", this module answers:
// "Given my system prompt, user prompt, and target model — how many rows
// fit, and in which format?"
//
// This is the killer feature that makes contex an intelligent context engine
// rather than a dumb data pipe.

import type { TokenizerManager } from '@contex/core';
import { TokenStreamEncoder, formatOutput } from '@contex/core';
import type { OutputFormat, TokenizerEncoding } from '@contex/core';

// Shared encoder for budget calculations to avoid re-instantiation
const budgetEncoder = new TokenStreamEncoder();

// ---- Model Registry ----
// Known models with their context limits and pricing.
// Pricing as of Feb 2026 ($/1M tokens).

export interface ModelSpec {
  name: string;
  encoding: TokenizerEncoding;
  contextWindow: number;
  inputPricePer1M: number; // $ per 1M input tokens
  outputPricePer1M: number; // $ per 1M output tokens
  /** Provider identifier (e.g. 'openai', 'anthropic', 'google', 'meta') */
  provider: string;
  /** Cost per 1M cached/prompt-cached input tokens (if supported) */
  cachedInputPricePer1M?: number;
  /** ISO date of model release (e.g. '2025-08-07') */
  releaseDate?: string;
  /** Model capabilities for feature-aware routing */
  capabilities?: string[];
}

import modelsConfig from '../models.json' with { type: 'json' };

// Mutable registry to allow runtime updates/overrides
export const MODEL_REGISTRY: Record<string, ModelSpec> = { ...modelsConfig.models } as Record<
  string,
  ModelSpec
>;

/**
 * Register a new model or update an existing one.
 */
export function registerModel(id: string, spec: ModelSpec) {
  MODEL_REGISTRY[id] = spec;
}

/**
 * Reset registry to defaults.
 */
export function resetModels() {
  for (const key in MODEL_REGISTRY) delete MODEL_REGISTRY[key];
  Object.assign(MODEL_REGISTRY, modelsConfig.models);
}

// ---- Budget Types ----

export interface BudgetRequest {
  /** Model ID from registry, or custom model spec */
  model: string | ModelSpec;
  /** Tokens used by system prompt */
  systemPromptTokens?: number;
  /** Tokens used by user prompt */
  userPromptTokens?: number;
  /** Tokens reserved for LLM response */
  responseReserve?: number;
  /** Safety margin as fraction (0.05 = 5%) */
  margin?: number;
  /** Preferred formats to consider (defaults to all) */
  formats?: OutputFormat[];
}

export interface FormatBudget {
  format: OutputFormat;
  maxRows: number;
  totalTokens: number;
  tokensPerRow: number;
  costPer1MRequests: number; // $ for data tokens only
}

export interface BudgetResult {
  /** Model used for calculation */
  model: ModelSpec;
  /** Total context window size */
  contextWindow: number;
  /** Tokens consumed by prompts */
  promptTokens: number;
  /** Tokens reserved for response */
  responseTokens: number;
  /** Tokens available for data after prompts + response + margin */
  availableTokens: number;
  /** The format that fits the most rows */
  recommendedFormat: OutputFormat;
  /** Max rows in the recommended format */
  maxRows: number;
  /** Per-format breakdown */
  formatBreakdown: FormatBudget[];
}

// ---- Budget Calculator ----

/**
 * Calculate how much data fits in a model's context window.
 *
 * @param data - Full dataset to budget against
 * @param request - Budget parameters (model, prompts, margins)
 * @param tokenizer - TokenizerManager instance for counting
 * @returns Budget result with recommended format and row counts
 */
export function calculateBudget(
  data: Record<string, unknown>[],
  request: BudgetRequest,
  tokenizer: TokenizerManager,
): BudgetResult {
  // Resolve model
  const model = typeof request.model === 'string' ? MODEL_REGISTRY[request.model] : request.model;

  if (!model) {
    throw new Error(
      `Unknown model: ${request.model}. Available: ${Object.keys(MODEL_REGISTRY).join(', ')}`,
    );
  }

  // Calculate available token budget
  const systemTokens = request.systemPromptTokens ?? 0;
  const userTokens = request.userPromptTokens ?? 0;
  const responseTokens = request.responseReserve ?? 4096;
  const margin = request.margin ?? 0.05;

  const promptTokens = systemTokens + userTokens;
  const reserved = promptTokens + responseTokens;
  const availableRaw = model.contextWindow - reserved;
  const availableTokens = Math.floor(availableRaw * (1 - margin));

  if (availableTokens <= 0) {
    return {
      model,
      contextWindow: model.contextWindow,
      promptTokens,
      responseTokens,
      availableTokens: 0,
      recommendedFormat: 'toon',
      maxRows: 0,
      formatBreakdown: [],
    };
  }

  // Test each format: how many rows fit?
  const formats: OutputFormat[] = request.formats ?? ['toon', 'csv', 'markdown', 'json'];

  const breakdown: FormatBudget[] = formats.map((format) => {
    // Binary search for max rows that fit
    const maxRows = binarySearchMaxRows(data, format, availableTokens, model.encoding, tokenizer);

    // Calculate actual token cost for those rows
    let totalTokens = 0;
    if (maxRows > 0) {
      if (format === 'tens' || format === 'tokens') {
        const subset = data.slice(0, maxRows);
        totalTokens = budgetEncoder.encodeToTokenStream(subset, model.encoding).length;
      } else {
        const subset = data.slice(0, maxRows);
        const output = formatOutput(subset, format);
        totalTokens = tokenizer.countTokens(output, model.encoding);
      }
    }

    const tokensPerRow = maxRows > 0 ? Math.ceil(totalTokens / maxRows) : 0;

    // Cost for data tokens per 1M requests
    const costPer1MRequests = Math.round(totalTokens * model.inputPricePer1M * 100) / 100;

    return { format, maxRows, totalTokens, tokensPerRow, costPer1MRequests };
  });

  // Sort by maxRows descending — the format that fits the most wins
  breakdown.sort((a, b) => b.maxRows - a.maxRows);

  return {
    model,
    contextWindow: model.contextWindow,
    promptTokens,
    responseTokens,
    availableTokens,
    recommendedFormat: breakdown[0]?.format ?? 'toon',
    maxRows: breakdown[0]?.maxRows ?? 0,
    formatBreakdown: breakdown,
  };
}

/**
 * Estimate the maximum number of rows that fit within a token budget.
 *
 * Uses interpolation instead of full binary search:
 *   1. Sample at 1 row and all rows → get tokens-per-row ratio
 *   2. Estimate target row count from ratio
 *   3. Validate with 1 final format call + adjust
 *
 * Reduces ~12 format+tokenize calls to ~3, a major speedup for large datasets.
 */
function binarySearchMaxRows(
  data: Record<string, unknown>[],
  format: OutputFormat,
  maxTokens: number,
  encoding: TokenizerEncoding,
  tokenizer: TokenizerManager,
): number {
  if (data.length === 0) return 0;

  // Helper: count tokens for N rows
  const countTokensFor = (n: number): number => {
    const subset = data.slice(0, n);
    if (format === 'tens' || format === 'tokens') {
      return budgetEncoder.encodeToTokenStream(subset, encoding).length;
    }
    return tokenizer.countTokens(formatOutput(subset, format), encoding);
  };

  // Quick check: does all data fit?
  const fullTokens = countTokensFor(data.length);
  if (fullTokens <= maxTokens) return data.length;

  // Quick check: does even 1 row fit?
  const oneTokens = countTokensFor(1);
  if (oneTokens > maxTokens) return 0;

  // Interpolation: estimate tokens-per-row from the two samples
  // Account for fixed header overhead by computing marginal cost
  const headerOverhead = oneTokens; // approximate header cost
  const marginalPerRow = (fullTokens - headerOverhead) / Math.max(data.length - 1, 1);
  const estimatedRows = Math.floor((maxTokens - headerOverhead) / marginalPerRow) + 1;
  const candidate = Math.max(1, Math.min(estimatedRows, data.length));

  // Validate: format at estimated row count and adjust
  const candidateTokens = countTokensFor(candidate);

  if (candidateTokens <= maxTokens) {
    // Try one step up to tighten the bound
    if (candidate < data.length) {
      const nextTokens = countTokensFor(candidate + 1);
      if (nextTokens <= maxTokens) {
        // Could fit more — do a small linear scan upward (at most 3 steps)
        let best = candidate + 1;
        for (let i = candidate + 2; i <= Math.min(candidate + 4, data.length); i++) {
          if (countTokensFor(i) <= maxTokens) best = i;
          else break;
        }
        return best;
      }
    }
    return candidate;
  }
  // Overshot — step down linearly (at most 3 steps)
  for (let i = candidate - 1; i >= 1; i--) {
    if (countTokensFor(i) <= maxTokens) return i;
  }
  return 1;
}
