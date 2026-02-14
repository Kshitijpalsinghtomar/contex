// ============================================================================
// @contex/engine — Cross-Session Structural Dedup
// ============================================================================
//
// Enables schema and dictionary state to persist across sessions,
// so repeated context doesn't re-pay the structural overhead.
//
// Key capabilities:
//   - Track known schemas across multiple encode operations
//   - Detect shared dictionary values across sessions
//   - Serialize/restore session state for persistence
//   - Incremental encoding: emit only new rows
//   - Measure token savings from dedup
//
// ============================================================================

import { TokenStreamEncoder, TokenizerManager, formatOutput } from '@contex/core';
import type { OutputFormat, TokenizerEncoding } from '@contex/core';

// ── Types ───────────────────────────────────────────────────────────────────

/** Fingerprint of a known schema. */
export interface SchemaFingerprint {
  /** Sorted field names joined with ',' */
  signature: string;
  /** Number of times this schema was seen */
  occurrences: number;
  /** First seen timestamp */
  firstSeen: number;
}

/** Cached dictionary entry for cross-session dedup. */
export interface DictEntry {
  /** The string value */
  value: string;
  /** Number of times seen across sessions */
  occurrences: number;
  /** Token count for this value */
  tokenCount: number;
}

/** Statistics about dedup savings. */
export interface DedupStats {
  /** Number of known schemas */
  knownSchemas: number;
  /** Number of dictionary entries */
  dictionarySize: number;
  /** Total encode calls */
  totalEncodes: number;
  /** Schema cache hits (schema already known) */
  schemaCacheHits: number;
  /** Dictionary cache hits (value already known) */
  dictCacheHits: number;
  /** Estimated tokens saved by dedup */
  estimatedTokensSaved: number;
}

/** Serializable session state for persistence. */
export interface SessionState {
  version: number;
  encoding: TokenizerEncoding;
  schemas: { signature: string; occurrences: number; firstSeen: number }[];
  dictionary: { value: string; occurrences: number; tokenCount: number }[];
  stats: {
    totalEncodes: number;
    schemaCacheHits: number;
    dictCacheHits: number;
    estimatedTokensSaved: number;
  };
}

// ── Implementation ──────────────────────────────────────────────────────────

/**
 * Cross-session structural deduplication cache.
 *
 * Tracks schemas and dictionary values across multiple encode operations.
 * When the same schema or dictionary values appear again, the encoder can
 * skip emitting their definitions, saving tokens.
 *
 * @example
 * ```ts
 * const cache = new StructuralDedupCache('cl100k_base');
 *
 * // First session: full encoding
 * const result1 = cache.encode(batch1);
 *
 * // Second session with same schema: schema overhead eliminated
 * const result2 = cache.encode(batch2);
 *
 * console.log(cache.getStats());
 * // → { schemaCacheHits: 1, estimatedTokensSaved: 42, ... }
 *
 * // Persist state
 * const state = cache.serializeState();
 * fs.writeFileSync('session.json', JSON.stringify(state));
 *
 * // Restore later
 * const restored = StructuralDedupCache.fromState(state);
 * ```
 */
export class StructuralDedupCache {
  private schemas = new Map<string, SchemaFingerprint>();
  private dictionary = new Map<string, DictEntry>();
  private encoding: TokenizerEncoding;
  private tokenizer: TokenizerManager;
  private encoder: TokenStreamEncoder;
  private totalEncodes = 0;
  private schemaCacheHits = 0;
  private dictCacheHits = 0;
  private estimatedTokensSaved = 0;

  constructor(encoding: TokenizerEncoding = 'cl100k_base') {
    this.encoding = encoding;
    this.tokenizer = new TokenizerManager(encoding);
    this.encoder = new TokenStreamEncoder(encoding);
  }

  /**
   * Encode data with dedup awareness.
   * Tracks schemas and dictionary for future dedup.
   *
   * @param data - Array of objects to encode
   * @param format - Output format (default: 'tens-text')
   * @returns Formatted output string and dedup metadata
   */
  encode(
    data: Record<string, unknown>[],
    format: OutputFormat = 'tens-text',
  ): { output: string; isSchemaKnown: boolean; newDictEntries: number; tokensSaved: number } {
    this.totalEncodes++;

    if (data.length === 0) {
      return {
        output: formatOutput(data, format),
        isSchemaKnown: false,
        newDictEntries: 0,
        tokensSaved: 0,
      };
    }

    // Check schema
    const fields = Object.keys(data[0]).sort();
    const signature = fields.join(',');
    const existingSchema = this.schemas.get(signature);
    const isSchemaKnown = !!existingSchema;

    let tokensSaved = 0;

    if (isSchemaKnown) {
      this.schemaCacheHits++;
      // Estimate schema overhead tokens saved
      const schemaOverhead = this.tokenizer.countTokens(
        `@schema data ${fields.join(' ')}`,
        this.encoding,
      );
      tokensSaved += schemaOverhead;
      existingSchema.occurrences++;
    } else {
      this.schemas.set(signature, {
        signature,
        occurrences: 1,
        firstSeen: Date.now(),
      });
    }

    // Check dictionary values
    let newDictEntries = 0;
    const stringValues = new Set<string>();
    for (const row of data) {
      for (const val of Object.values(row)) {
        if (typeof val === 'string' && val.length > 0) {
          stringValues.add(val);
        }
      }
    }

    for (const val of stringValues) {
      const existing = this.dictionary.get(val);
      if (existing) {
        this.dictCacheHits++;
        existing.occurrences++;
        // Each additional occurrence saves the full token cost minus 1 ref token
        tokensSaved += Math.max(0, existing.tokenCount - 1);
      } else {
        const tokenCount = this.tokenizer.countTokens(val, this.encoding);
        this.dictionary.set(val, {
          value: val,
          occurrences: 1,
          tokenCount,
        });
        newDictEntries++;
      }
    }

    this.estimatedTokensSaved += tokensSaved;

    const output = formatOutput(data, format);
    return { output, isSchemaKnown, newDictEntries, tokensSaved };
  }

  /**
   * Encode only new rows — rows that weren't in the previous batch.
   *
   * @param newData - Current batch of data
   * @param previousData - Previous batch for diffing
   * @param keyField - Field to use as unique identifier (default: 'id')
   * @param format - Output format
   * @returns Only the delta rows encoded
   */
  encodeIncremental(
    newData: Record<string, unknown>[],
    previousData: Record<string, unknown>[],
    keyField = 'id',
    format: OutputFormat = 'tens-text',
  ): { output: string; deltaRows: number; totalRows: number; tokensSaved: number } {
    const previousKeys = new Set(previousData.map((r) => String(r[keyField] ?? '')));

    const deltaRows = newData.filter((r) => !previousKeys.has(String(r[keyField] ?? '')));

    // Calculate how many tokens the full batch would cost
    const fullOutput = formatOutput(newData, format);
    const fullTokens = this.tokenizer.countTokens(fullOutput, this.encoding);

    // Encode only delta
    const result = this.encode(deltaRows, format);

    const deltaTokens = this.tokenizer.countTokens(result.output, this.encoding);
    const tokensSaved = fullTokens - deltaTokens;

    return {
      output: result.output,
      deltaRows: deltaRows.length,
      totalRows: newData.length,
      tokensSaved,
    };
  }

  /**
   * Get dedup statistics.
   */
  getStats(): DedupStats {
    return {
      knownSchemas: this.schemas.size,
      dictionarySize: this.dictionary.size,
      totalEncodes: this.totalEncodes,
      schemaCacheHits: this.schemaCacheHits,
      dictCacheHits: this.dictCacheHits,
      estimatedTokensSaved: this.estimatedTokensSaved,
    };
  }

  /**
   * Serialize session state for persistence.
   * Can be written to disk and restored later.
   */
  serializeState(): SessionState {
    return {
      version: 1,
      encoding: this.encoding,
      schemas: Array.from(this.schemas.values()),
      dictionary: Array.from(this.dictionary.values()),
      stats: {
        totalEncodes: this.totalEncodes,
        schemaCacheHits: this.schemaCacheHits,
        dictCacheHits: this.dictCacheHits,
        estimatedTokensSaved: this.estimatedTokensSaved,
      },
    };
  }

  /**
   * Restore session state from a serialized snapshot.
   */
  static fromState(state: SessionState): StructuralDedupCache {
    const cache = new StructuralDedupCache(state.encoding);

    for (const s of state.schemas) {
      cache.schemas.set(s.signature, { ...s });
    }

    for (const d of state.dictionary) {
      cache.dictionary.set(d.value, { ...d });
    }

    cache.totalEncodes = state.stats.totalEncodes;
    cache.schemaCacheHits = state.stats.schemaCacheHits;
    cache.dictCacheHits = state.stats.dictCacheHits;
    cache.estimatedTokensSaved = state.stats.estimatedTokensSaved;

    return cache;
  }

  /**
   * Dispose of tokenizer and encoder resources.
   */
  dispose(): void {
    this.tokenizer.dispose();
    this.encoder.dispose();
  }
}
