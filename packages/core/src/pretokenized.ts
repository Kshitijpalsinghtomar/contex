// ============================================================================
// @contex/core — Pre-Tokenized Binary Blocks
// ============================================================================
//
// Stores data with pre-computed token IDs for a target model encoding.
// Consumers can read token IDs directly without re-tokenizing.
//
// Binary Format:
//   [4 bytes] Magic: "PTOK"
//   [1 byte]  Version: 1
//   [1 byte]  Encoding ID: 0=cl100k_base, 1=o200k_base, 2=p50k_base, 3=r50k_base
//   [4 bytes] Field count (uint32 LE)
//   [4 bytes] Total token count (uint32 LE)
//   -- Field Index (repeated field_count times):
//     [4 bytes] Field name length (uint32 LE)
//     [N bytes] Field name (UTF-8)
//     [4 bytes] Token start offset (uint32 LE)
//     [4 bytes] Token count for this field (uint32 LE)
//   -- Token Data:
//     [4 bytes × total_tokens] Token IDs (uint32 LE)
//
// ============================================================================

import type { TokenizerManager } from './tokenizer.js';
import type { TokenStream, TokenizerEncoding } from './types.js';

// ── Constants ───────────────────────────────────────────────────────────────

const PTOK_MAGIC = new Uint8Array([0x50, 0x54, 0x4f, 0x4b]); // "PTOK"
const PTOK_VERSION = 1;

const ENCODING_MAP: Record<TokenizerEncoding, number> = {
  cl100k_base: 0,
  o200k_base: 1,
  p50k_base: 2,
  r50k_base: 3,
};

const ENCODING_REVERSE: Record<number, TokenizerEncoding> = {
  0: 'cl100k_base',
  1: 'o200k_base',
  2: 'p50k_base',
  3: 'r50k_base',
};

// ── Types ───────────────────────────────────────────────────────────────────

/** A single field's token position within the block. */
export interface FieldTokenIndex {
  /** Field name */
  fieldName: string;
  /** Start position in the token array */
  startOffset: number;
  /** Number of tokens for this field */
  tokenCount: number;
}

/** Result of reading a pre-tokenized block. */
export interface PreTokenizedBlock {
  /** Target tokenizer encoding */
  encoding: TokenizerEncoding;
  /** All token IDs in the block */
  tokens: TokenStream;
  /** Index mapping fields to their token ranges */
  fieldIndex: FieldTokenIndex[];
  /** Total number of tokens */
  totalTokens: number;
}

// ── Encoder ─────────────────────────────────────────────────────────────────

/**
 * Create a pre-tokenized binary block from structured data.
 *
 * Each field value is tokenized once and the token IDs are stored directly
 * in the binary output. The field index enables random access to any field's
 * tokens without scanning the entire block.
 *
 * @param data - Array of objects to pre-tokenize
 * @param encoding - Target tokenizer encoding
 * @param tokenizer - TokenizerManager instance
 * @returns Binary block containing pre-computed token IDs
 *
 * @example
 * ```ts
 * const block = createPreTokenizedBlock(
 *   [{ name: 'Alice', role: 'admin' }],
 *   'o200k_base',
 *   new TokenizerManager()
 * );
 * // block is a Uint8Array with all token IDs pre-computed
 * ```
 */
export function createPreTokenizedBlock(
  data: Record<string, unknown>[],
  encoding: TokenizerEncoding,
  tokenizer: TokenizerManager,
): Uint8Array {
  if (data.length === 0) {
    // Empty block: header only
    const buf = new Uint8Array(14);
    const view = new DataView(buf.buffer);
    buf.set(PTOK_MAGIC, 0);
    buf[4] = PTOK_VERSION;
    buf[5] = ENCODING_MAP[encoding];
    view.setUint32(6, 0, true); // field count
    view.setUint32(10, 0, true); // total tokens
    return buf;
  }

  // Collect all fields across all rows
  const allKeys = new Set<string>();
  for (const row of data) {
    for (const key of Object.keys(row)) {
      allKeys.add(key);
    }
  }
  const fields = Array.from(allKeys).sort();

  // Tokenize each field across all rows (concatenated)
  const fieldTokens: Map<string, TokenStream> = new Map();

  for (const field of fields) {
    const tokens: number[] = [];
    for (const row of data) {
      const val = row[field];
      const text =
        val === null || val === undefined
          ? ''
          : typeof val === 'object'
            ? JSON.stringify(val)
            : String(val);
      if (text.length > 0) {
        const fieldToks = tokenizer.tokenize(text, encoding);
        tokens.push(...fieldToks);
      }
    }
    fieldTokens.set(field, tokens);
  }

  // Calculate total tokens and build field index
  let totalTokens = 0;
  const fieldIndex: FieldTokenIndex[] = [];
  const textEncoder = new TextEncoder();

  for (const field of fields) {
    const toks = fieldTokens.get(field)!;
    fieldIndex.push({
      fieldName: field,
      startOffset: totalTokens,
      tokenCount: toks.length,
    });
    totalTokens += toks.length;
  }

  // Calculate buffer size
  let fieldIndexSize = 0;
  for (const fi of fieldIndex) {
    const nameBytes = textEncoder.encode(fi.fieldName);
    fieldIndexSize += 4 + nameBytes.length + 4 + 4; // nameLen + name + start + count
  }

  const headerSize = 4 + 1 + 1 + 4 + 4; // magic + ver + enc + fieldCount + totalTokens
  const tokenDataSize = totalTokens * 4;
  const totalSize = headerSize + fieldIndexSize + tokenDataSize;

  // Write buffer
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let offset = 0;

  // Header
  buf.set(PTOK_MAGIC, offset);
  offset += 4;
  buf[offset++] = PTOK_VERSION;
  buf[offset++] = ENCODING_MAP[encoding];
  view.setUint32(offset, fields.length, true);
  offset += 4;
  view.setUint32(offset, totalTokens, true);
  offset += 4;

  // Field Index
  for (const fi of fieldIndex) {
    const nameBytes = textEncoder.encode(fi.fieldName);
    view.setUint32(offset, nameBytes.length, true);
    offset += 4;
    buf.set(nameBytes, offset);
    offset += nameBytes.length;
    view.setUint32(offset, fi.startOffset, true);
    offset += 4;
    view.setUint32(offset, fi.tokenCount, true);
    offset += 4;
  }

  // Token Data — all fields concatenated
  for (const field of fields) {
    const toks = fieldTokens.get(field)!;
    for (const tok of toks) {
      view.setUint32(offset, tok, true);
      offset += 4;
    }
  }

  return buf;
}

// ── Decoder ─────────────────────────────────────────────────────────────────

/**
 * Read a pre-tokenized binary block without any tokenizer invocation.
 *
 * Zero-cost deserialization: token IDs are read directly from the binary.
 * No tokenizer needed — the block is self-describing.
 *
 * @param buffer - Pre-tokenized block binary
 * @returns Decoded block with tokens, field index, and metadata
 */
export function readPreTokenizedBlock(buffer: Uint8Array): PreTokenizedBlock {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const textDecoder = new TextDecoder();
  let offset = 0;

  // Validate magic
  for (let i = 0; i < 4; i++) {
    if (buffer[offset + i] !== PTOK_MAGIC[i]) {
      throw new Error('Invalid pre-tokenized block: bad magic');
    }
  }
  offset += 4;

  // Version
  const version = buffer[offset++];
  if (version !== PTOK_VERSION) {
    throw new Error(`Unsupported pre-tokenized block version: ${version}`);
  }

  // Encoding
  const encodingId = buffer[offset++];
  const encoding = ENCODING_REVERSE[encodingId];
  if (!encoding) {
    throw new Error(`Unknown encoding ID: ${encodingId}`);
  }

  // Field count & total tokens
  const fieldCount = view.getUint32(offset, true);
  offset += 4;
  const totalTokens = view.getUint32(offset, true);
  offset += 4;

  // Field Index
  const fieldIndex: FieldTokenIndex[] = [];
  for (let i = 0; i < fieldCount; i++) {
    const nameLen = view.getUint32(offset, true);
    offset += 4;
    const fieldName = textDecoder.decode(buffer.slice(offset, offset + nameLen));
    offset += nameLen;
    const startOffset = view.getUint32(offset, true);
    offset += 4;
    const tokenCount = view.getUint32(offset, true);
    offset += 4;
    fieldIndex.push({ fieldName, startOffset, tokenCount });
  }

  // Token Data
  const tokens: number[] = new Array(totalTokens);
  for (let i = 0; i < totalTokens; i++) {
    tokens[i] = view.getUint32(offset, true);
    offset += 4;
  }

  return { encoding, tokens, fieldIndex, totalTokens };
}

/**
 * Get tokens for a specific field from a pre-tokenized block.
 * Enables random access to individual field data.
 *
 * @param block - Decoded pre-tokenized block
 * @param fieldName - Name of the field to retrieve
 * @returns Token IDs for the specified field, or undefined if not found
 */
export function getFieldTokens(
  block: PreTokenizedBlock,
  fieldName: string,
): TokenStream | undefined {
  const field = block.fieldIndex.find((f) => f.fieldName === fieldName);
  if (!field) return undefined;
  return block.tokens.slice(field.startOffset, field.startOffset + field.tokenCount);
}
