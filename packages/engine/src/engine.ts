// ============================================================================
// @contex/engine — Contex Context Packing Engine
// ============================================================================
//
// The main entry point for the Contex pipeline. Provides:
//   - Multi-format data packing and retrieval (JSON/CSV/TOON/Markdown/TENS)
//   - PQL (Prompt Query Language) for querying
//   - Token budget engine (fits maximal data into LLM context windows)
//   - Prefix-cache-aware output (maximizes vLLM KV cache reuse)
//   - TENS encoding for structural deduplication and canonical hashing
// ============================================================================

import {
  type FormatAnalysis,
  type OutputFormat,
  type TensStats,
  TokenCache,
  type TokenStream,
  TokenStreamDecoder,
  TokenStreamEncoder,
  type TokenizerEncoding,
  TokenizerManager,
  analyzeFormats,
  formatOutput,
} from '@contex/core';

import { type BudgetRequest, type BudgetResult, calculateBudget } from './budget.js';
import { formatPrefixAware } from './prefix.js';
import { applyFilter, applyLimit, parsePql } from './query.js';
import { ContextStorage } from './storage.js';

export interface QueryResult {
  data: Record<string, unknown>[];
  format: OutputFormat;
  output: string;
  count: number;
}

export interface ContextWindowOptions {
  encoding?: TokenizerEncoding;
  maxTokens?: number;
  limit?: number;
  filter?: string;
  format?: OutputFormat;
}

/**
 * Contex: LLM-aware context packing engine.
 *
 * Transforms structured data into the most token-efficient and
 * inference-optimized prompt representation possible.
 *
 * Design philosophy:
 * - NOT a database. An intelligent context packing middleware.
 * - Multi-format output: JSON/TOON/Markdown/CSV/TENS as needed.
 * - Multi-tokenizer: works with GPT-4, GPT-4o, Claude, Llama, etc.
 * - Context-window-aware: fits maximal information into limited tokens.
 */
export class Contex {
  private storage: ContextStorage;
  private tokenEncoder: TokenStreamEncoder;
  private decoder: TokenStreamDecoder;
  private tokenizer: TokenizerManager;
  private cache: TokenCache;

  constructor(defaultEncoding: TokenizerEncoding = 'cl100k_base', dataDir?: string) {
    this.storage = new ContextStorage(dataDir);
    this.tokenEncoder = new TokenStreamEncoder(defaultEncoding);
    this.decoder = new TokenStreamDecoder();
    this.tokenizer = new TokenizerManager(defaultEncoding);
    this.cache = new TokenCache();
  }

  /**
   * Insert data into a collection.
   */
  insert(collection: string, data: Record<string, unknown>[]): void {
    this.storage.write(collection, data);
    this.cache.invalidate(collection);
  }

  /**
   * Query using PQL and return data in the requested format.
   */
  query(pql: string): QueryResult {
    const parsed = parsePql(pql);
    let data = this.storage.read(parsed.collection);

    if (parsed.where) {
      data = applyFilter(data, parsed.where);
    }
    if (parsed.limit) {
      data = applyLimit(data, parsed.limit);
    }

    const format = parsed.format ?? 'json';
    let output: string;

    if (format === 'tens') {
      // TENS v2 Binary output (represented as base64 or string for now to match interface)
      const binary = this.tokenEncoder.encode(data);
      // We'll return a string representation for the QueryResult interface
      // In a real app we might return the raw buffer
      output = `[TENS v2 Binary: ${binary.length} bytes]`;
    } else {
      output = formatOutput(data, format);
    }

    return { data, format, output, count: data.length };
  }

  /**
   * Get data formatted for LLM context window injection.
   * This is the main API — choose the format that uses fewest tokens.
   */
  contextWindow(
    collection: string,
    options: ContextWindowOptions = {},
  ): string | TokenStream | Uint8Array {
    let data = this.storage.read(collection);

    if (options.filter) {
      const pql = parsePql(`GET ${collection} WHERE ${options.filter}`);
      data = applyFilter(data, pql.where);
    }

    if (options.limit) {
      data = applyLimit(data, options.limit);
    }

    // TENS v2 Binary
    if (options.format === 'tens') {
      return this.tokenEncoder.encode(data);
    }

    // Raw token stream — useful for token-level analysis or direct injection
    if (options.format === 'tokens') {
      let tokens = this.tokenEncoder.encodeToTokenStream(data, options.encoding);
      if (options.maxTokens && tokens.length > options.maxTokens) {
        tokens = tokens.slice(0, options.maxTokens);
      }
      return tokens;
    }

    // Otherwise, return formatted string
    const format = options.format ?? 'toon';
    return formatOutput(data, format);
  }

  /**
   * Analyze all output formats for a collection — which one is most
   * token-efficient for a given LLM?
   */
  analyzeFormats(
    collection: string,
    encoding?: TokenizerEncoding,
  ): (FormatAnalysis & { tokenCount: number })[] {
    const data = this.storage.read(collection);
    const analyses = analyzeFormats(data);

    return analyses.map((analysis) => ({
      ...analysis,
      tokenCount: this.tokenizer.countTokens(analysis.output, encoding),
    }));
  }

  /**
   * Get TENS encoding stats for a collection.
   */
  stats(collection: string, encoding?: TokenizerEncoding): TensStats {
    const data = this.storage.read(collection);
    return this.tokenEncoder.getStats(data, encoding);
  }

  /**
   * RAG-Optimized Retrieval:
   * 1. Filters data (via PQL or raw filter)
   * 2. Calculates exactly how many rows fit in the target model's context
   * 3. Returns optimally formatted text (prefix-cache-aware if requested)
   */
  getOptimizedContext(
    collection: string,
    query: {
      filter?: string;
      model: string;
      systemPrompt?: number;
      userPrompt?: number;
      reserve?: number;
      sortBy?: string;
    },
  ): { output: string; debug: BudgetResult; usedRows: number } {
    // 1. Get filtered data
    let data = this.storage.read(collection);
    if (query.filter) {
      const pql = parsePql(`GET ${collection} WHERE ${query.filter}`);
      data = applyFilter(data, pql.where);
    }

    // 2. Calculate Budget
    const budget = calculateBudget(
      data,
      {
        model: query.model,
        systemPromptTokens: query.systemPrompt,
        userPromptTokens: query.userPrompt,
        responseReserve: query.reserve,
        formats: ['toon', 'csv', 'markdown', 'json'],
      },
      this.tokenizer,
    );

    // 3. optimize: Slice data to fit maxRows
    const fittingData = data.slice(0, budget.maxRows);

    // 4. Format (Defaulting to recommended format, but adding stable sort for prefix caching)
    // We strictly use formatPrefixAware to ensure vLLM cache hits
    const output = formatPrefixAware(fittingData, {
      format: budget.recommendedFormat,
      sortBy: query.sortBy ?? 'id',
    });

    return {
      output,
      debug: budget,
      usedRows: fittingData.length,
    };
  }

  listCollections(): string[] {
    return this.storage.listCollections();
  }

  drop(collection: string): boolean {
    this.cache.invalidate(collection);
    return this.storage.drop(collection);
  }

  dispose(): void {
    this.tokenEncoder.dispose();
    this.decoder.dispose();
    this.tokenizer.dispose();
  }
}
