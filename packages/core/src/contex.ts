import { TensTextEncoder } from './tens_text.js';
import type { TokenizerEncoding } from './types.js';

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
}

/**
 * Compiles structured data into optimized Contex (TENS) format.
 * 
 * This is the main entry point for the Contex SDK.
 * 
 * @param data - The structured data to compile (Array of objects)
 * @param options - Composition options
 * @returns The optimized prompt string ready for LLM injection
 * 
 * @example
 * ```typescript
 * import { compile } from '@contex/core';
 * 
 * const data = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
 * const prompt = compile(data, { model: 'gpt-4o' });
 * ```
 */
export function compile(data: any[], options: CompileOptions = {}): string {
    const encoding = resolveEncoding(options.model);
    const encoder = new TensTextEncoder(encoding);
    return encoder.encode(data);
}

/**
 * Maps model names to tokenizer encodings.
 */
function resolveEncoding(model?: string): TokenizerEncoding {
    if (!model) return 'o200k_base'; // Default to latest

    const m = model.toLowerCase();

    // Omni models
    if (m.includes('gpt-4o') || m.includes('omni')) {
        return 'o200k_base';
    }

    // GPT-4 / 3.5
    if (m.includes('gpt-4') || m.includes('gpt-3.5') || m.includes('turbo')) {
        return 'cl100k_base';
    }

    // Gemini (using o200k as best approximation for text-based structural opt)
    // Note: Tensor-based models might use different tokenizers, but for TENS-Text
    // we just need a reasonable base for dictionary keys.
    if (m.includes('gemini')) {
        return 'o200k_base';
    }

    // Direct encoding names
    if (m === 'o200k_base' || m === 'cl100k_base' || m === 'p50k_base' || m === 'r50k_base') {
        return m as TokenizerEncoding;
    }

    // Fallback
    return 'o200k_base';
}
