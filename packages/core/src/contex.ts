import { formatOutput } from './formatters.js';
import type { OutputFormat } from './types.js';

/**
 * Options for compiling data with Contex.
 */
export interface CompileOptions {
  /**
   * The target model or tokenizer encoding.
   * Contex will automatically map common model names to their tokenizer.
   *
   * Supported models:
   * - 'gpt-4o', 'gpt-4o-mini', 'omni' → 'o200k_base'
   * - 'gpt-4', 'gpt-3.5', 'turbo' → 'cl100k_base'
   * - 'gemini', 'gemini-1.5', 'gemini-2.5' → 'o200k_base' (approximate for text)
   *
   * Default: 'gpt-4o' ('o200k_base')
   */
  model?: string;

  /**
   * Output format (default: 'contex' — the most token-efficient format).
   * Use 'tens-text' for legacy compatibility.
   */
  format?: OutputFormat;
}

/**
 * Compiles structured data into optimized Contex Compact format.
 *
 * This is the main entry point for the Contex SDK.
 * Uses the Contex Compact format by default — the most token-efficient
 * encoding with dictionary compression, field name compression, deep
 * flattening, boolean/null abbreviation, and sparse mode support.
 *
 * @param data - The structured data to compile (Array of objects)
 * @param options - Compilation options (model, format)
 * @returns The optimized prompt string ready for LLM injection
 *
 * @example
 * ```typescript
 * import { compile } from '@contex-llm/core';
 *
 * const data = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
 * const prompt = compile(data, { model: 'gpt-4o' });
 * // → "id\tname\n1\tAlice\n2\tBob"  (Contex Compact format)
 * ```
 */
export function compile(data: Record<string, unknown>[], options: CompileOptions = {}): string {
  const format = options.format ?? 'contex';
  return formatOutput(data, format);
}
