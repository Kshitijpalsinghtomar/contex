import type { OutputFormat } from '@contex-llm/core';
import { MODEL_REGISTRY } from './budget.js';
import type { ModelSpec } from './budget.js';

export interface SelectionOptions {
  model: string;
  data: Record<string, unknown>[];
  maxTokens?: number;
}

export interface SelectionResult {
  format: OutputFormat;
  reason: string;
  providerNote?: string;
  /** Estimated savings vs JSON (0-1 fraction) based on data characteristics */
  estimatedSavings?: number;
}

/**
 * Heuristics to choose the best format for a given model and dataset.
 *
 * Decision tree:
 * 1. Tiny data (<5 rows) → JSON (overhead not worth it)
 * 2. Highly sparse data (>80% null/empty) → JSON (sparse tabular formats regress)
 * 3. Narrow context window + large data → Contex (maximize token budget)
 * 4. Deeply nested data (depth > 2) → Contex (flattens with dot-notation)
 * 5. Model lacks json_mode capability → Contex (structured text is cleaner)
 * 6. Default → Contex Compact (dictionary compression, tab-separated)
 *
 * Provider-aware notes are attached for model-specific guidance.
 */
export function selectBestFormat(options: SelectionOptions): SelectionResult {
  const { model: modelId, data } = options;
  const model: ModelSpec | undefined = MODEL_REGISTRY[modelId];

  // 1. Small data? Just use JSON.
  if (data.length < 5) {
    return { format: 'json', reason: 'Small dataset (<5 rows), JSON is safest.', estimatedSavings: 0 };
  }

  // 2. Provider & capability awareness
  const provider = model?.provider ?? '';
  const capabilities = model?.capabilities ?? [];
  const contextWindow = model?.contextWindow ?? 128000;

  const providerNotes: Record<string, string> = {
    anthropic: 'Claude models handle structured text well; Contex Compact format is optimal. Claude excels at parsing tab-separated data.',
    openai: 'GPT models parse tab-separated formats efficiently; Contex Compact is recommended. Use JSON mode only when structured output parsing is needed.',
    google: 'Gemini models work well with compact structured text; Contex Compact is optimal. Long-context models benefit most from compression.',
    meta: 'Llama models handle tab-separated text efficiently; Contex Compact reduces prompt size for open-weight deployment.',
  };
  const providerNote = providerNotes[provider] ?? undefined;

  // 3. Data shape analysis
  const sample = data[0] || {};
  const keys = Object.keys(sample);
  const fieldCount = keys.length;

  const measureDepth = (obj: unknown): number => {
    if (typeof obj !== 'object' || obj === null) return 0;
    return 1 + Math.max(0, ...Object.values(obj as Record<string, unknown>).map(measureDepth));
  };
  const depth = measureDepth(sample);
  const isDeep = depth > 2;

  // 4. Sparsity analysis — if >80% of values are null/undefined/empty, tabular formats regress
  const sampleSize = Math.min(data.length, 50);
  let totalCells = 0;
  let emptyCells = 0;
  let stringCells = 0;
  let numericCells = 0;
  for (let i = 0; i < sampleSize; i++) {
    const row = data[i];
    for (const k of keys) {
      totalCells++;
      const v = row[k];
      if (v === null || v === undefined || v === '') emptyCells++;
      else if (typeof v === 'string') stringCells++;
      else if (typeof v === 'number') numericCells++;
    }
  }
  const sparsityRatio = totalCells > 0 ? emptyCells / totalCells : 0;

  if (sparsityRatio > 0.8) {
    return {
      format: 'json',
      reason: `Highly sparse data (${Math.round(sparsityRatio * 100)}% empty), JSON avoids tabular overhead on sparse datasets.`,
      providerNote,
      estimatedSavings: 0.05,
    };
  }

  // 5. Estimate savings based on data characteristics
  let estimatedSavings = 0.35; // baseline for contex compact
  if (isDeep) estimatedSavings += 0.15; // flattening saves more on deep objects
  if (fieldCount > 10) estimatedSavings += 0.05; // wide schema = more header savings
  if (data.length > 20) estimatedSavings += 0.05; // more rows = more repetition = more dict savings
  if (stringCells > numericCells) estimatedSavings += 0.05; // string-heavy data benefits from dict compression
  estimatedSavings = Math.min(estimatedSavings, 0.95); // cap at 95%

  // 6. Context window pressure — if data is large relative to context window, compression matters more
  const roughTokenEstimate = JSON.stringify(data).length / 4; // rough chars-to-tokens
  const windowPressure = roughTokenEstimate / contextWindow;

  if (windowPressure > 0.3) {
    return {
      format: 'contex',
      reason: `Data uses ~${Math.round(windowPressure * 100)}% of ${contextWindow.toLocaleString()}-token context window. Contex Compact maximizes available budget.`,
      providerNote,
      estimatedSavings,
    };
  }

  // 7. Decision tree
  if (isDeep) {
    return {
      format: 'contex',
      reason: 'Deeply nested data, Contex Compact flattens with dot-notation and dictionary compression.',
      providerNote,
      estimatedSavings,
    };
  }

  // Flat/tabular data — Contex Compact wins
  return {
    format: 'contex',
    reason: 'Contex Compact: dictionary-compressed, tab-separated, minimal structural overhead.',
    providerNote,
    estimatedSavings,
  };
}
