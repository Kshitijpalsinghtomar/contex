// ============================================================================
// @contex/core — Type Definitions & TENS Constants
// ============================================================================
//
// Central type definitions for the Contex pipeline.
// All TENS binary format constants, control tokens, and shared interfaces
// are defined here to ensure consistency across encoder/decoder/stream.
// ============================================================================

/** A single token ID produced by a tokenizer. */
export type TokenId = number;

/** An array of token IDs representing a tokenized sequence. */
export type TokenStream = TokenId[];

/**
 * Supported tokenizer encodings.
 * Maps to specific LLM families:
 * - `cl100k_base` — GPT-4, GPT-3.5-Turbo
 * - `o200k_base`  — GPT-4o, GPT-4o-mini
 * - `p50k_base`   — GPT-3, Codex (older)
 * - `r50k_base`   — GPT-3 (earliest)
 */
export type TokenizerEncoding = 'cl100k_base' | 'p50k_base' | 'r50k_base' | 'o200k_base';

// ---- TENS Binary Format Constants ----

/** Magic bytes: ASCII "TENS" (0x54 0x45 0x4E 0x53) */
export const TENS_MAGIC = new Uint8Array([0x54, 0x45, 0x4e, 0x53]);

/** Current TENS binary format version. */
export const TENS_VERSION = 2;

/** Storage block size for the Contex engine pager. */
export const BLOCK_SIZE = 4096;

/**
 * TENS Control Tokens for the token-stream encoder.
 *
 * These are synthetic token IDs used as structural markers in the
 * token stream. They are set well above any real tokenizer vocabulary
 * (max ~200K for o200k_base) to avoid collisions.
 *
 * Used by `TokenStreamEncoder` to delimit schemas, objects, arrays,
 * and special values (null, boolean) within the token stream.
 */
export enum CTRL {
  /** Null value marker */
  NULL_VAL = 200000,
  /** Boolean true marker */
  BOOL_TRUE = 200001,
  /** Boolean false marker */
  BOOL_FALSE = 200002,
  /** Array start delimiter */
  ARR_START = 200003,
  /** Array end delimiter */
  ARR_END = 200004,
  /** Object start delimiter */
  OBJ_START = 200005,
  /** Object end delimiter */
  OBJ_END = 200006,
  /** Schema definition start — followed by field name tokens */
  SCHEMA_DEF = 200007,
  /** Schema reference — followed by schema ID */
  SCHEMA_REF = 200008,
  /** Field/element separator */
  SEPARATOR = 200009,
  /** Document boundary start */
  DOC_START = 200010,
  /** Document boundary end */
  DOC_END = 200011,
  /** Row break delimiter — lightweight separator between rows in single-schema docs */
  ROW_BREAK = 200012,
  /** Presence mask — signals that ceil(fieldCount/MASK_CHUNK_BITS) mask chunks follow */
  PRESENCE_MASK = 200013,
  /** Fixed-length array — followed by 1 length token, then N element values (no separators) */
  FIXED_ARRAY = 200014,
  /** Dictionary definition marker — followed by ID + value */
  DICT_DEF = 200015,
}

// ---- Presence Mask Encoding ----

/** Number of bits per mask chunk token. Schemas ≤16 fields = 1 chunk, ≤32 = 2, etc. */
export const MASK_CHUNK_BITS = 16;
/** Base value for mask chunk tokens: mask_token = MASK_CHUNK_BASE + 16-bit value (0-65535). */
export const MASK_CHUNK_BASE = 300000;
/** Base value for array length tokens: len_token = ARRAY_LEN_BASE + length. */
export const ARRAY_LEN_BASE = 400000;
/** Base value for dictionary reference tokens: ref_token = DICT_REF_BASE + dict_id (0-99999). */
export const DICT_REF_BASE = 500000;

// ---- Data Types ----

/** TENS-supported value types. */
export type TensType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'undefined';

/**
 * Schema definition: a unique object shape identified by sorted field names.
 * Schemas are deduplicated — identical shapes share the same ID.
 */
export interface TensSchema {
  /** Unique schema ID (auto-incremented) */
  id: number;
  /** Sorted field names */
  fields: string[];
  /** Type of each field (parallel to `fields`) */
  fieldTypes: TensType[];
}

/** A single row of data with a reference to its schema. */
export interface TensRow {
  /** ID of the schema this row conforms to */
  schemaId: number;
  /** Tokenized values for each field (parallel to schema fields) */
  values: TokenStream[];
  /** Raw (untokenized) values for format output */
  rawValues: unknown[];
}

/**
 * A complete TENS document: schemas + rows + encoding metadata.
 * This is the in-memory representation before binary serialization.
 */
export interface TensDocument {
  /** All unique schemas used in this document */
  schemas: TensSchema[];
  /** All data rows */
  rows: TensRow[];
  /** Tokenizer encoding used for token IDs */
  encoding: TokenizerEncoding;
  /** Dictionary of repetitive string values for compression */
  dictionary?: { id: number; value: string }[];
}

/** Statistics about a TENS encoding operation. */
export interface TensStats {
  /** Number of unique schemas detected */
  schemaCount: number;
  /** Number of data rows */
  rowCount: number;
  /** Number of unique token IDs in the stream */
  uniqueTokenCount: number;
  /** Total token count in the stream */
  totalTokenCount: number;
  /** Size of the TENS binary output in bytes */
  byteSize: number;
  /** Size of the equivalent JSON output in bytes */
  jsonByteSize: number;
  /** Token reduction vs JSON (percentage, e.g. 23.5 = 23.5% fewer tokens) */
  tokenReduction: number;
  /** Byte reduction vs JSON (percentage) */
  byteReduction: number;
}

/** Supported output formats for `formatOutput()`. */
export type OutputFormat = 'json' | 'csv' | 'markdown' | 'toon' | 'tens' | 'tens-text' | 'tokens' | 'contex';

/** Server configuration options. */
export interface ServeOptions {
  port: number;
  host: string;
}

// ---- Canonical IR Types (v3) ----

/**
 * Canonical IR — model-agnostic binary representation of structured data.
 *
 * This is the primary storage format. It contains no tokenizer-specific
 * information and can be materialized to any model's token array on demand.
 *
 * Guarantee: same semantic data → same ir bytes → same hash. Always.
 */
export interface TensIR {
  /** Model-agnostic TENS v2 binary (from TensEncoder) */
  ir: Uint8Array;
  /** Schemas used in this IR (field names, types) */
  schema: TensSchema[];
  /** SHA-256 content hash of the IR bytes (hex string) */
  hash: string;
  /** Canonicalized source data (used by materializer for tokenization) */
  data: Record<string, unknown>[];
  /** IR format version (for forward compatibility) */
  irVersion: string;
  /** Canonicalization algorithm version (for reproducibility) */
  canonicalizationVersion: string;
}

/**
 * Materialized token array for a specific model.
 *
 * Produced by materializing a Canonical IR for a target model's tokenizer.
 * Cached by (irHash, modelId, tokenizerFingerprint) to avoid redundant tokenization
 * and detect silent tokenizer drift.
 */
export interface MaterializedTokens {
  /** Model-specific token IDs */
  tokens: number[];
  /** Target model identifier (e.g. 'gpt-4o') */
  modelId: string;
  /** Tokenizer encoding used (e.g. 'o200k_base') */
  encoding: TokenizerEncoding;
  /** Number of tokens (equals tokens.length) */
  tokenCount: number;
  /** Hash of the source IR (for cache keying) */
  irHash: string;
  /** Tokenizer library version identifier */
  tokenizerVersion: string;
  /** Hash of tokenizer output on canonical probe string (drift detection) */
  tokenizerFingerprint: string;
}
