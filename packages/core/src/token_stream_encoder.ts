// ============================================================================
// TENS Encoder (v2) — Multi-tokenizer, retains raw values for format output
// ============================================================================

import { SchemaRegistry, flattenObject, inferType } from './schema.js';
import { TokenizerManager } from './tokenizer.js';
import {
  ARRAY_LEN_BASE,
  CTRL,
  DICT_REF_BASE,
  MASK_CHUNK_BASE,
  MASK_CHUNK_BITS,
  TENS_MAGIC,
  TENS_VERSION,
} from './types.js';
import type { TensDocument, TensStats, TensType, TokenStream, TokenizerEncoding } from './types.js';

/**
 * TENS Token Stream Encoder.
 *
 * Converts structured data into a token-ID stream using real tokenizer
 * encodings. This is the bridge between structured data and LLM token space.
 *
 * Unlike `TensEncoder` (which produces a self-contained binary), this
 * encoder produces a stream of token IDs that can be:
 * - Counted for budget calculations
 * - Serialized into TENS binary format (with header + token count)
 * - Used for structural analysis (control tokens mark schema/object boundaries)
 *
 * @example
 * ```ts
 * const encoder = new TokenStreamEncoder('o200k_base');
 * const stats = encoder.getStats(data);
 * console.log(`TENS uses ${stats.totalTokenCount} tokens vs ${stats.jsonByteSize} JSON bytes`);
 * encoder.dispose();
 * ```
 */
export class TokenStreamEncoder {
  private tokenizer: TokenizerManager;
  private schema: SchemaRegistry;

  constructor(defaultEncoding: TokenizerEncoding = 'cl100k_base') {
    this.tokenizer = new TokenizerManager(defaultEncoding);
    this.schema = new SchemaRegistry();
  }

  /**
   * Encode data into TENS binary format (header + token stream as uint32le).
   *
   * @param data - Array of uniform objects
   * @param encoding - Optional tokenizer encoding override
   * @returns TENS v2 binary (magic + version + encoding + token count + tokens)
   */
  encode(data: Record<string, unknown>[], encoding?: TokenizerEncoding): Uint8Array {
    const doc = this.toDocument(data, encoding);
    return this.documentToBinary(doc);
  }

  /**
   * Encode data into a raw token ID stream (no binary header).
   *
   * @param data - Array of uniform objects
   * @param encoding - Optional tokenizer encoding override
   * @returns Array of token IDs including CTRL markers
   */
  encodeToTokenStream(data: Record<string, unknown>[], encoding?: TokenizerEncoding): TokenStream {
    const doc = this.toDocument(data, encoding);
    return this.documentToTokenStream(doc);
  }

  /**
   * Build a TensDocument (in-memory representation) from data.
   * Registers schemas, tokenizes values, and retains raw values for format output.
   */
  toDocument(data: Record<string, unknown>[], encoding?: TokenizerEncoding): TensDocument {
    // 1. Flatten all rows first
    const flatRows = data.map((obj) => flattenObject(obj));

    // 2. Identify all unique keys to decide on unification
    const allKeys = new Set<string>();
    for (const row of flatRows) {
      for (const key of Object.keys(row)) {
        allKeys.add(key);
      }
    }

    this.schema.clear();
    let rows: TensDocument['rows'];

    // 3. Schema Unification Strategy
    // If total unique fields <= 200, we unify all schemas into one superset.
    // This enables Single-Schema Mode (Positional Encoding + Presence Mask),
    // which completely eliminates per-row structural overhead (OBJ_START/END, SCHEMA_REF).
    // Missing fields become NULL_VALs, which the Presence Mask compresses to ~1 bit.
    if (allKeys.size <= 200 && allKeys.size > 0) {
      // UNIFIED MODE
      const sortedKeys = Array.from(allKeys).sort();
      // Create a dummy object with all keys to register the superset schema
      const dummy = Object.fromEntries(sortedKeys.map((k) => [k, null]));
      const unifiedSchema = this.schema.register(dummy);

      rows = flatRows.map((flat) => {
        const values: TokenStream[] = [];
        const rawValues: unknown[] = [];
        // Use the unified schema for ALL rows
        for (let i = 0; i < unifiedSchema.fields.length; i++) {
          const field = unifiedSchema.fields[i];
          // Access value or undefined (which becomes null)
          const value = flat[field];
          rawValues.push(value);
          values.push(this.tokenizeValue(value, inferType(value), encoding));
        }
        return { schemaId: unifiedSchema.id, values, rawValues };
      });
    } else {
      // MULTI-SCHEMA MODE (Fallback for extremely wide/heterogeneous data)
      rows = flatRows.map((flat) => {
        const schema = this.schema.register(flat);
        const values: TokenStream[] = [];
        const rawValues: unknown[] = [];
        for (let i = 0; i < schema.fields.length; i++) {
          const field = schema.fields[i];
          const value = flat[field];
          rawValues.push(value);
          values.push(this.tokenizeValue(value, inferType(value), encoding));
        }
        return { schemaId: schema.id, values, rawValues };
      });
    }

    // 4. Value Dictionary Optimization
    // Scan all tokenized values to find repetitive strings and replace them with single-token references.
    // Heuristic: (freq * len) > (len + freq)
    const dict = new ValueDictionary(this.tokenizer, encoding);

    // Pass 1: Count frequencies
    for (const row of rows) {
      for (let i = 0; i < row.values.length; i++) {
        const val = row.rawValues[i];
        if (typeof val === 'string') {
          dict.add(val, row.values[i]);
        }
        // Also check inside arrays?
        // Currently only top-level strings or those flattened from objects.
        // Deep nested arrays: tokenizeValue handles them.
        // Ideally we'd modify tokenizeValue to use dict, but we need dict BEFORE tokenizing?
        // Or two-pass.
        // For now, let's stick to row values (which include flattened object values).
      }
    }

    const dictionaryEntries = dict.build();

    // Pass 2: Replace values with references
    if (dictionaryEntries.length > 0) {
      for (const row of rows) {
        for (let i = 0; i < row.values.length; i++) {
          const val = row.rawValues[i];
          if (typeof val === 'string') {
            const ref = dict.getRef(val);
            if (ref !== undefined) {
              row.values[i] = [ref];
            }
          }
        }
      }
    }

    return {
      schemas: this.schema.getAll(),
      rows,
      encoding: encoding ?? 'cl100k_base',
      dictionary: dictionaryEntries,
    };
  }

  /**
   * Get encoding statistics comparing TENS vs JSON for a dataset.
   *
   * @returns Stats including schema count, token counts, and reduction percentages
   */
  getStats(data: Record<string, unknown>[], encoding?: TokenizerEncoding): TensStats {
    const doc = this.toDocument(data, encoding);
    const binary = this.documentToBinary(doc);
    const tokenStream = this.documentToTokenStream(doc);
    const jsonStr = JSON.stringify(data);
    const jsonBytes = new TextEncoder().encode(jsonStr).length;
    const jsonTokens = this.tokenizer.countJsonTokens(data, encoding);
    const uniqueTokens = new Set(tokenStream);
    const tokenReduction =
      jsonTokens > 0 ? Math.round((1 - tokenStream.length / jsonTokens) * 1000) / 10 : 0;
    const byteReduction =
      jsonBytes > 0 ? Math.round((1 - binary.length / jsonBytes) * 1000) / 10 : 0;
    return {
      schemaCount: doc.schemas.length,
      rowCount: doc.rows.length,
      uniqueTokenCount: uniqueTokens.size,
      totalTokenCount: tokenStream.length,
      byteSize: binary.length,
      jsonByteSize: jsonBytes,
      tokenReduction,
      byteReduction,
    };
  }

  /** Dispose of tokenizer resources and clear schema state. */
  dispose(): void {
    this.tokenizer.dispose();
    this.schema.clear();
  }

  private tokenizeValue(value: unknown, type: TensType, encoding?: TokenizerEncoding): TokenStream {
    if (value === null || value === undefined) return [CTRL.NULL_VAL];
    if (typeof value === 'boolean') return [value ? CTRL.BOOL_TRUE : CTRL.BOOL_FALSE];
    // Numbers and strings handled by tokenizer
    if (typeof value === 'number') return this.tokenizer.tokenize(String(value), encoding);
    if (typeof value === 'string') return this.tokenizer.tokenize(value, encoding);

    if (Array.isArray(value)) {
      // Length-prefixed array: FIXED_ARRAY + length_token + N values (separated)
      const stream: TokenStream = [CTRL.FIXED_ARRAY, ARRAY_LEN_BASE + value.length];
      for (let i = 0; i < value.length; i++) {
        const elem = value[i];
        // Flatten nested objects inside arrays too
        if (elem !== null && typeof elem === 'object' && !Array.isArray(elem)) {
          const flat = flattenObject(elem as Record<string, unknown>);
          const keys = Object.keys(flat).sort();
          for (const k of keys) {
            stream.push(...this.tokenizeValue(flat[k], inferType(flat[k]), encoding));
          }
        } else {
          stream.push(...this.tokenizeValue(elem, inferType(elem), encoding));
        }
        if (i < value.length - 1) stream.push(CTRL.SEPARATOR); // Separator between array elements
      }
      return stream;
    }

    // Objects should be flattened before reaching here. Safety fallback.
    if (typeof value === 'object') return this.tokenizer.tokenize(JSON.stringify(value), encoding);
    return this.tokenizer.tokenize(String(value), encoding);
  }

  private documentToTokenStream(doc: TensDocument): TokenStream {
    const stream: TokenStream = [];
    const isSingleSchema = doc.schemas.length === 1;

    // Emit dictionary definitions
    if (doc.dictionary) {
      for (const { id, value } of doc.dictionary) {
        stream.push(CTRL.DICT_DEF);
        // Tokenize ID (as string to ensure handled by tokenizer)
        stream.push(...this.tokenizer.tokenize(String(id), doc.encoding));
        stream.push(CTRL.SEPARATOR); // Separator between ID and Value
        stream.push(...this.tokenizer.tokenize(value, doc.encoding));
        stream.push(CTRL.SEPARATOR); // Separator after Value (entry end)
      }
    }

    // Emit schema definitions (field names with separators)
    for (const schema of doc.schemas) {
      stream.push(CTRL.SCHEMA_DEF);
      for (const field of schema.fields) {
        stream.push(...this.tokenizer.tokenize(field, doc.encoding));
        stream.push(CTRL.SEPARATOR);
      }
    }

    if (isSingleSchema) {
      // Optimized single-schema layout: positional encoding + presence mask
      const fieldCount = doc.schemas[0].fields.length;
      const maskChunkCount = Math.ceil(fieldCount / MASK_CHUNK_BITS);

      // Emit explicit ROW_BREAK to separate Schema Defs from Data
      stream.push(CTRL.ROW_BREAK);

      for (let r = 0; r < doc.rows.length; r++) {
        if (r > 0) stream.push(CTRL.ROW_BREAK);
        const row = doc.rows[r];

        // Check if any field is null
        const hasNulls = row.values.some((v) => v.length === 1 && v[0] === CTRL.NULL_VAL);

        if (hasNulls) {
          // Emit PRESENCE_MASK + chunked bitfield + only non-null values
          stream.push(CTRL.PRESENCE_MASK);

          // Build and emit mask chunks (16 bits each, LSB = first field in chunk)
          for (let chunk = 0; chunk < maskChunkCount; chunk++) {
            let bits = 0;
            for (let b = 0; b < MASK_CHUNK_BITS; b++) {
              const fieldIdx = chunk * MASK_CHUNK_BITS + b;
              if (fieldIdx < fieldCount) {
                const isPresent = !(
                  row.values[fieldIdx].length === 1 && row.values[fieldIdx][0] === CTRL.NULL_VAL
                );
                if (isPresent) bits |= 1 << b;
              }
            }
            stream.push(MASK_CHUNK_BASE + bits);
          }

          // Emit only non-null values (positionally consumed via mask)
          let emittedCount = 0;
          const presentCount = row.values.filter(
            (v) => !(v.length === 1 && v[0] === CTRL.NULL_VAL),
          ).length;

          for (let i = 0; i < row.values.length; i++) {
            if (!(row.values[i].length === 1 && row.values[i][0] === CTRL.NULL_VAL)) {
              stream.push(...row.values[i]);
              emittedCount++;
              if (emittedCount < presentCount) stream.push(CTRL.SEPARATOR); // Separator between masked values
            }
          }
        } else {
          // All fields present — pure positional with separators
          for (let i = 0; i < row.values.length; i++) {
            stream.push(...row.values[i]);
            if (i < row.values.length - 1) stream.push(CTRL.SEPARATOR); // Separator between positional values
          }
        }
      }
    } else {
      // Multi-schema layout: retains full CTRL markers for safety
      for (const row of doc.rows) {
        stream.push(CTRL.SCHEMA_REF);
        stream.push(row.schemaId);
        stream.push(CTRL.OBJ_START);
        for (let i = 0; i < row.values.length; i++) {
          stream.push(...row.values[i]);
          if (i < row.values.length - 1) stream.push(CTRL.SEPARATOR);
        }
        stream.push(CTRL.OBJ_END);
      }
    }
    return stream;
  }

  private documentToBinary(doc: TensDocument): Uint8Array {
    const tokenStream = this.documentToTokenStream(doc);
    const encodingBytes = new TextEncoder().encode(doc.encoding);
    const headerSize = 4 + 1 + 1 + encodingBytes.length + 4;
    const dataSize = tokenStream.length * 4;
    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    bytes.set(TENS_MAGIC, 0);
    view.setUint8(4, TENS_VERSION);
    view.setUint8(5, encodingBytes.length);
    bytes.set(encodingBytes, 6);
    const tokenCountOffset = 6 + encodingBytes.length;
    view.setUint32(tokenCountOffset, tokenStream.length, true);
    const tokenOffset = tokenCountOffset + 4;
    for (let i = 0; i < tokenStream.length; i++) {
      view.setUint32(tokenOffset + i * 4, tokenStream[i], true);
    }
    return bytes;
  }
}

/**
 * Helper to build a value dictionary for compression.
 */
class ValueDictionary {
  private counts = new Map<string, number>();
  private tokens = new Map<string, TokenStream>();
  private ids = new Map<string, number>();
  private tokenizer: TokenizerManager;
  private encoding?: TokenizerEncoding;

  constructor(tokenizer: TokenizerManager, encoding?: TokenizerEncoding) {
    this.tokenizer = tokenizer;
    this.encoding = encoding;
  }

  add(value: string, stream: TokenStream) {
    const count = this.counts.get(value) || 0;
    if (count === 0) this.tokens.set(value, stream);
    this.counts.set(value, count + 1);
  }

  build(): { id: number; value: string }[] {
    const eligible: { val: string; count: number }[] = [];
    for (const [val, count] of this.counts) {
      const stream = this.tokens.get(val)!;
      const len = stream.length;
      // Cost heuristic: (freq * len) > (len + freq)
      // Save if total tokens used normally is greater than total tokens used with dictionary
      if (count * len > len + count) {
        eligible.push({ val, count });
      }
    }

    // Sort by frequency descending
    eligible.sort((a, b) => b.count - a.count);

    const result: { id: number; value: string }[] = [];
    for (let i = 0; i < eligible.length; i++) {
      const { val } = eligible[i];
      this.ids.set(val, i);
      result.push({ id: i, value: val });
    }
    return result;
  }

  getRef(value: string): number | undefined {
    const id = this.ids.get(value);
    return id !== undefined ? DICT_REF_BASE + id : undefined;
  }
}
