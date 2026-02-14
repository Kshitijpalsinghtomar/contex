// ============================================================================
// @contex/core — Canonical IR Encoder
// ============================================================================
//
// Encodes structured data into a model-agnostic Canonical IR (TensIR).
//
// Pipeline:
//   1. Canonicalize data (sorted keys, NFKC strings, canonical numbers)
//   2. Binary encode with TensEncoder (deterministic TENS v2 binary)
//   3. Compute SHA-256 content hash
//   4. Return { ir, schema, hash }
//
// Key guarantee: same semantic data → same IR bytes → same hash. Always.
// ============================================================================

import { canonicalize } from './canonical.js';
import { TensEncoder } from './encoder.js';
import { SchemaRegistry, flattenObject, inferType } from './schema.js';
import { computeStructuralHash } from './tens/hashing.js';
import type { TensIR, TensSchema } from './types.js';

// ---- Version constants ----
// Bump these when the corresponding algorithm changes.
// This ensures old IRs can be identified and re-encoded if needed.

/** IR binary format version */
export const IR_VERSION = '1.0';
/** Canonicalization algorithm version */
export const CANONICALIZATION_VERSION = '1.0';

/**
 * Encode structured data into a Canonical IR.
 *
 * This is the primary entry point for the v3 encoding pipeline.
 * Produces a model-agnostic binary representation that is:
 * - **Deterministic**: same data = same bytes = same hash, always
 * - **Model-agnostic**: no tokenizer dependency
 * - **Content-addressed**: hash serves as a stable cache key
 * - **Versioned**: irVersion + canonicalizationVersion for reproducibility
 *
 * @param data - Array of data objects to encode
 * @returns TensIR containing the binary, schemas, and content hash
 *
 * @example
 * ```ts
 * const ir = encodeIR([{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]);
 * console.log(ir.hash); // stable SHA-256 hex string
 * console.log(ir.irVersion); // "1.0"
 * ```
 */
export function encodeIR(data: object[]): TensIR {
  const start = performance.now();

  // 1. Canonicalize: normalize all values to canonical form
  const canonicalized = canonicalize(data);

  // 2. Binary encode: produce deterministic TENS v2 binary
  const encoder = new TensEncoder();
  const ir = encoder.encode(canonicalized);

  // 3. Hash: compute content-addressable SHA-256
  const hash = computeStructuralHash(ir);

  // 4. Extract schemas from the canonicalized data
  const schemas = extractSchemas(canonicalized);

  const end = performance.now();
  if (typeof process !== 'undefined' && (process.env.CONTEX_DEBUG || process.env.CONTEX_PROFILE)) {
    console.log(`[Contex] encodeIR: ${(end - start).toFixed(2)}ms for ${data.length} rows`);
  }

  return {
    ir,
    schema: schemas,
    hash,
    data: canonicalized,
    irVersion: IR_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
  };
}

/**
 * Extract schemas from canonicalized data.
 *
 * Uses SchemaRegistry to deduplicate object shapes and produce
 * the schema definitions used in this IR.
 */
function extractSchemas(data: Record<string, unknown>[]): TensSchema[] {
  const registry = new SchemaRegistry();

  for (const row of data) {
    // Flatten nested objects to match how TensEncoder processes them
    const flat = flattenObject(row);
    registry.register(flat);
  }

  return registry.getAll();
}
