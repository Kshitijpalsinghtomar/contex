// ============================================================================
// @contex/core — In-Memory Token Cache
// ============================================================================
//
// Optional caching layer for format + tokenize results. Avoids re-formatting
// and re-tokenizing the same data when contextWindow() or analyzeFormats()
// is called multiple times with the same collection/options.
//
// Design:
//   - Key = hash(collection + format + encoding + row count)
//   - Invalidates on insert/update (caller must call invalidate())
//   - In-memory only — no persistent storage overhead
//   - LRU eviction at configurable max entries (default 64)
// ============================================================================

import type { OutputFormat, TokenizerEncoding } from './types.js';

/** Cached result for a format + tokenize operation. */
export interface CachedEntry {
  /** The formatted output string */
  output: string;
  /** Token count for this output */
  tokenCount: number;
  /** Timestamp of when this entry was created */
  createdAt: number;
}

/**
 * In-memory LRU cache for formatted output + token counts.
 *
 * Keyed by a composite of collection name, format, encoding, and row count.
 * Automatically evicts least-recently-used entries when capacity is reached.
 *
 * @example
 * ```ts
 * const cache = new TokenCache(64);
 *
 * // Try cache first
 * const cached = cache.get('users', 'toon', 'o200k_base', 100);
 * if (cached) return cached;
 *
 * // Cache miss — format + tokenize, then cache
 * const output = formatOutput(data, 'toon');
 * const tokenCount = tokenizer.countTokens(output, 'o200k_base');
 * cache.set('users', 'toon', 'o200k_base', 100, output, tokenCount);
 * ```
 */
export class TokenCache {
  private cache = new Map<string, CachedEntry>();
  private maxEntries: number;

  constructor(maxEntries = 64) {
    this.maxEntries = maxEntries;
  }

  /** Build a cache key from the composite parameters. */
  private key(
    collection: string,
    format: OutputFormat,
    encoding: TokenizerEncoding,
    rowCount: number,
  ): string {
    return `${collection}:${format}:${encoding}:${rowCount}`;
  }

  /**
   * Get a cached entry, or null if not found.
   * Moves the entry to the end (most-recently-used) on hit.
   */
  get(
    collection: string,
    format: OutputFormat,
    encoding: TokenizerEncoding,
    rowCount: number,
  ): CachedEntry | null {
    const k = this.key(collection, format, encoding, rowCount);
    const entry = this.cache.get(k);
    if (!entry) return null;

    // Move to end (LRU refresh) — Map preserves insertion order
    this.cache.delete(k);
    this.cache.set(k, entry);
    return entry;
  }

  /**
   * Cache a format + token count result.
   * Evicts the least-recently-used entry if at capacity.
   */
  set(
    collection: string,
    format: OutputFormat,
    encoding: TokenizerEncoding,
    rowCount: number,
    output: string,
    tokenCount: number,
  ): void {
    const k = this.key(collection, format, encoding, rowCount);

    // If already present, delete first to refresh position
    if (this.cache.has(k)) {
      this.cache.delete(k);
    }

    // Evict oldest if at capacity
    while (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(k, {
      output,
      tokenCount,
      createdAt: Date.now(),
    });
  }

  /**
   * Invalidate all cached entries for a collection.
   * Call this after insert, update, or drop.
   */
  invalidate(collection: string): void {
    const prefix = `${collection}:`;
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith(prefix)) {
        this.cache.delete(k);
      }
    }
  }

  /** Clear the entire cache. */
  clear(): void {
    this.cache.clear();
  }

  /** Number of entries currently cached. */
  get size(): number {
    return this.cache.size;
  }
}
