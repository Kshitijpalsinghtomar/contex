import type { OutputFormat, TokenizerEncoding } from '@contex/core';
import { MODEL_REGISTRY } from './budget.js';

export interface SelectionOptions {
  model: string;
  data: Record<string, unknown>[];
  maxTokens?: number;
}

export interface SelectionResult {
  format: OutputFormat;
  reason: string;
}

/**
 * Heuristics to choose the best format for a given model and dataset.
 */
export function selectBestFormat(options: SelectionOptions): SelectionResult {
  const { model: modelId, data } = options;
  const model = MODEL_REGISTRY[modelId];

  // 1. Small data? Just use JSON.
  // overhead of fancy formats isn't worth it for < 5 items usually,
  // and models understand JSON best.
  if (data.length < 5) {
    return { format: 'json', reason: 'Small dataset (<5 rows), JSON is safest.' };
  }

  // 2. Provider-aware selection using registry data
  const provider = model?.provider ?? '';
  const isClaude = provider === 'anthropic';
  const isGpt = provider === 'openai';
  const isGemini = provider === 'google';

  // 3. Data shape analysis
  // Check for nesting depth and field count (heuristic)
  const sample = data[0] || {};
  const measureDepth = (obj: any): number => {
    if (typeof obj !== 'object' || obj === null) return 0;
    return 1 + Math.max(0, ...Object.values(obj).map(measureDepth));
  };
  const depth = measureDepth(sample);
  const isDeep = depth > 2;

  // Decision Tree

  if (isDeep) {
    // Nested data is bad for CSV.
    // JSON or TOON are best.
    if (isGpt)
      return {
        format: 'toon',
        reason: 'Deeply nested data, GPT models excel with TOON structure.',
      };
    if (isGemini)
      return { format: 'json', reason: 'Deeply nested data, Gemini models handle JSON well.' };
    return { format: 'json', reason: 'Deeply nested data, JSON is robust for general models.' };
  }

  // Tabular / Flat data
  if (isClaude) {
    return { format: 'toon', reason: 'Claude models work well with structured TOON format.' };
  }

  if (isGpt) {
    return { format: 'csv', reason: 'Flat data, CSV is most token-efficient for GPT models.' };
  }

  if (isGemini) {
    return { format: 'csv', reason: 'Flat data, CSV is most token-efficient for Gemini models.' };
  }

  // Default fallback
  return { format: 'toon', reason: 'Balanced default format.' };
}
