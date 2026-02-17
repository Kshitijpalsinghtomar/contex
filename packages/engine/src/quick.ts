// ============================================================================
// @contex/engine — quick() v3 One-Shot API
// ============================================================================
//
// The "3-line" experience, now powered by the v3 IR pipeline.
//
//   import { quick } from '@contex/engine';
//   const result = quick(myData, 'gpt-4o');
//   console.log(result.tokens);        // number[] — direct token array
//   console.log(result.asText());      // string — backward-compatible text
//   console.log(result.savings);       // { percent, tokens, cost }
//
// ============================================================================

import {
  Materializer,
  type OutputFormat,
  Tens,
  type TokenizerEncoding,
  TokenizerManager,
  encodeIR,
  formatOutput,
} from '@contex/core';
import { MODEL_REGISTRY } from './budget.js';
import type { ModelSpec } from './budget.js';

export interface QuickOptions {
  /** Tokens already used by system prompt (default: 0) */
  systemPromptTokens?: number;
  /** Tokens reserved for LLM response (default: 4096) */
  reserve?: number;
  /** Maximum tokens for the data (budget cap). If not set, uses model context window. */
  maxTokens?: number;
  /** Force a specific text fallback format instead of auto-selecting */
  format?: OutputFormat;
}

export interface QuickSavings {
  /** Tokens saved vs JSON */
  tokensSaved: number;
  /** Percentage saved vs JSON */
  percent: number;
  /** Cost per API call with compact format ($) */
  costPerCall: number;
  /** Cost per API call with JSON ($) */
  jsonCostPerCall: number;
  /** Dollar savings per API call */
  costSavedPerCall: number;
}

export interface QuickResult {
  /** The TENS Protocol Object */
  tens: Tens;
  /** Token array for the target model */
  tokens: number[];
  /** Number of tokens */
  tokenCount: number;
  /** Number of data rows in the IR */
  rows: number;
  /** Total rows in the original input */
  totalRows: number;
  /** Tokenizer encoding used */
  encoding: TokenizerEncoding;
  /** Token count of the same data as JSON */
  jsonTokens: number;
  /** Model used */
  model: string;
  /** Cost & savings comparison vs JSON */
  savings: QuickSavings;
  /**
   * Backward-compatible text output.
   * Returns the canonical JSON representation of the data.
   * For custom formats, pass a format option.
   */
  asText: (format?: OutputFormat) => string;
}

/**
 * One-shot context optimization via the v3 IR pipeline.
 *
 * Encodes data into canonical IR, materializes to model-specific tokens,
 * and calculates savings vs raw JSON.
 *
 * @example
 * ```ts
 * import { quick } from '@contex/engine';
 *
 * const result = quick(myData, 'gpt-4o');
 * console.log(result.tens.hash);         // TENS Hash
 * console.log(result.tokens);            // number[] for direct injection
 * console.log(result.savings.percent);   // e.g. 42
 * ```
 */
export function quick(
  data: Record<string, unknown>[],
  model: string,
  options: QuickOptions = {},
): QuickResult {
  if (!Array.isArray(data) || data.length === 0) {
    // Handle empty case... (omitted for brevity, can implement if needed or just throw)
    const tens = Tens.encode([]);
    return {
      tens,
      tokens: [],
      tokenCount: 0,
      rows: 0,
      totalRows: 0,
      encoding: 'o200k_base',
      jsonTokens: 0,
      model,
      savings: {
        tokensSaved: 0,
        percent: 0,
        costPerCall: 0,
        jsonCostPerCall: 0,
        costSavedPerCall: 0,
      },
      asText: () => '',
    };
  }

  const modelSpec = MODEL_REGISTRY[model];
  if (!modelSpec) {
    throw new Error(
      `Unknown model: "${model}". Available: ${Object.keys(MODEL_REGISTRY).slice(0, 5).join(', ')}... (${Object.keys(MODEL_REGISTRY).length} total)`,
    );
  }

  const encoding = modelSpec.encoding;
  const tokenizer = new TokenizerManager(encoding);

  try {
    // Step 1: Encode to canonical IR & Create Tens Object
    // Tens.encode handles encodeIR internally.
    const tens = Tens.encode(data);
    const ir = tens.fullIR; // If we need IR for materializer manually

    // Step 2: Materialize to model-specific tokens
    // We use the tens object's materialize mechanism implicitly via Materializer for now to keep logic similar
    // But let's use the explicit Materializer for control
    const materializer = new Materializer();
    const materialized = materializer.materialize(ir, model, {
      maxTokens: options.maxTokens,
    });

    // Step 3: JSON baseline for comparison
    const jsonText = JSON.stringify(data);
    const jsonTokens = tokenizer.countTokens(jsonText, encoding);

    // Step 4: Calculate savings
    const tokensSaved = jsonTokens - materialized.tokenCount;
    const percent = jsonTokens > 0 ? Math.round((tokensSaved / jsonTokens) * 100) : 0;
    const costPerCall = (materialized.tokenCount / 1_000_000) * modelSpec.inputPricePer1M;
    const jsonCostPerCall = (jsonTokens / 1_000_000) * modelSpec.inputPricePer1M;

    return {
      tens,
      tokens: materialized.tokens,
      tokenCount: materialized.tokenCount,
      rows: data.length,
      totalRows: data.length,
      encoding,
      jsonTokens,
      model,
      savings: {
        tokensSaved,
        percent,
        costPerCall,
        jsonCostPerCall,
        costSavedPerCall: jsonCostPerCall - costPerCall,
      },
      asText: (format?: OutputFormat) => {
        if (format) {
          return formatOutput(data, format);
        }
        // Default: Contex Compact format (matches what tokens were materialized from)
        return formatOutput(data, 'contex');
      },
    };
  } finally {
    tokenizer.dispose();
  }
}

/**
 * Analyze cost savings across multiple models without generating output.
 * Useful for the savings report and cost calculator.
 */
export function analyzeSavings(
  data: Record<string, unknown>[],
  models?: string[],
): {
  model: string;
  modelSpec: ModelSpec;
  jsonTokens: number;
  irTokens: number;
  savingsPercent: number;
  costPerCall: number;
  jsonCostPerCall: number;
}[] {
  if (!Array.isArray(data) || data.length === 0) return [];

  const targetModels = models ?? ['gpt-4o', 'claude-3-5-sonnet', 'gemini-2-5-flash'];
  const results: ReturnType<typeof analyzeSavings> = [];

  // Encode IR once (model-agnostic)
  const ir = encodeIR(data);

  for (const modelId of targetModels) {
    const modelSpec = MODEL_REGISTRY[modelId];
    if (!modelSpec) continue;

    const tokenizer = new TokenizerManager(modelSpec.encoding);
    try {
      // JSON baseline
      const jsonText = JSON.stringify(data);
      const jsonTokens = tokenizer.countTokens(jsonText, modelSpec.encoding);

      // IR-based materialization
      const materializer = new Materializer();
      const materialized = materializer.materialize(ir, modelId);
      const irTokens = materialized.tokenCount;

      const savingsPercent =
        jsonTokens > 0 ? Math.round(((jsonTokens - irTokens) / jsonTokens) * 100) : 0;
      const costPerCall = (irTokens / 1_000_000) * modelSpec.inputPricePer1M;
      const jsonCostPerCall = (jsonTokens / 1_000_000) * modelSpec.inputPricePer1M;

      results.push({
        model: modelId,
        modelSpec,
        jsonTokens,
        irTokens,
        savingsPercent,
        costPerCall,
        jsonCostPerCall,
      });
    } finally {
      tokenizer.dispose();
    }
  }

  return results;
}
