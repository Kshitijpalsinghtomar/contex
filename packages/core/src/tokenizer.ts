// ============================================================================
// @contex/core — Multi-Tokenizer Manager
// ============================================================================
//
// Manages multiple tokenizer instances (one per encoding) with LRU caching.
// Supports all major LLM tokenizer encodings:
//   - cl100k_base  (GPT-4, GPT-3.5-Turbo)
//   - o200k_base   (GPT-4o, GPT-4o-mini)
//   - p50k_base    (GPT-3, Codex)
//   - r50k_base    (GPT-3 earliest)
//
// Each encoding gets its own TokenizerInstance with a per-string LRU cache
// to avoid re-tokenizing the same strings repeatedly.
// ============================================================================

import { getEncoding } from 'js-tiktoken';
import type { TokenStream, TokenizerEncoding } from './types.js';

const DEFAULT_MAX_CACHE_SIZE = 10_000;

/**
 * Bounded LRU cache for token lookups.
 * Evicts the least-recently-used entry when full.
 */
class LRUCache<K, V> {
  private map = new Map<K, V>();
  private readonly maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      this.misses++;
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, value);
    this.hits++;
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
    this.map.set(key, value);
  }

  getStats() {
    return {
      size: this.map.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRatio:
        this.hits + this.misses === 0
          ? 0
          : Math.round((this.hits / (this.hits + this.misses)) * 1000) / 10,
    };
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * Single tokenizer instance for one encoding.
 * Wraps js-tiktoken with an LRU cache.
 */
class TokenizerInstance {
  private encoder: ReturnType<typeof getEncoding>;
  private cache: LRUCache<string, TokenStream>;
  readonly encoding: TokenizerEncoding;

  constructor(encoding: TokenizerEncoding, maxCacheSize: number) {
    this.encoding = encoding;
    this.encoder = getEncoding(encoding as any);
    this.cache = new LRUCache(maxCacheSize);
  }

  /** Tokenize text into token IDs (cached). */
  tokenize(text: string): TokenStream {
    const cached = this.cache.get(text);
    if (cached) return cached;
    const tokens = Array.from(this.encoder.encode(text));
    this.cache.set(text, tokens);
    return tokens;
  }

  /** Convert token IDs back to text. */
  detokenize(tokens: TokenStream): string {
    return this.encoder.decode(tokens);
  }

  /** Count tokens in text (uses tokenize cache). */
  countTokens(text: string): number {
    return this.tokenize(text).length;
  }

  getStats() {
    return this.cache.getStats();
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Multi-encoding tokenizer manager.
 *
 * Lazily creates tokenizer instances per encoding. Each instance has
 * its own LRU cache for string→token lookups.
 *
 * @example
 * ```ts
 * const tm = new TokenizerManager('o200k_base');
 * const count = tm.countTokens('Hello world');        // Uses o200k_base
 * const gpt4 = tm.countTokens('Hello world', 'cl100k_base'); // Uses cl100k_base
 * tm.dispose(); // Clean up all instances
 * ```
 */
export class TokenizerManager {
  private instances = new Map<string, TokenizerInstance>();
  private defaultEncoding: TokenizerEncoding;
  private maxCacheSize: number;

  constructor(
    defaultEncoding: TokenizerEncoding = 'cl100k_base',
    options?: { maxCacheSize?: number },
  ) {
    this.defaultEncoding = defaultEncoding;
    this.maxCacheSize = options?.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
  }

  private getInstance(encoding?: TokenizerEncoding): TokenizerInstance {
    const enc = encoding ?? this.defaultEncoding;
    let instance = this.instances.get(enc);
    if (!instance) {
      instance = new TokenizerInstance(enc, this.maxCacheSize);
      this.instances.set(enc, instance);
    }
    return instance;
  }

  /** Tokenize text into an array of token IDs. */
  tokenize(text: string, encoding?: TokenizerEncoding): TokenStream {
    return this.getInstance(encoding).tokenize(text);
  }

  /** Convert token IDs back to text. */
  detokenize(tokens: TokenStream, encoding?: TokenizerEncoding): string {
    return this.getInstance(encoding).detokenize(tokens);
  }

  /** Count the number of tokens in text. */
  countTokens(text: string, encoding?: TokenizerEncoding): number {
    return this.getInstance(encoding).countTokens(text);
  }

  /** Count tokens for a JSON-serialized value. */
  countJsonTokens(data: unknown, encoding?: TokenizerEncoding): number {
    return this.countTokens(JSON.stringify(data), encoding);
  }

  /** Get cache statistics for all active tokenizer instances. */
  get stats(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [enc, instance] of this.instances) {
      result[enc] = instance.getStats();
    }
    return result;
  }

  /** Dispose of all tokenizer instances and clear caches. */
  dispose(): void {
    for (const instance of this.instances.values()) {
      instance.clearCache();
    }
    this.instances.clear();
  }
}
