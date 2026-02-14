// ============================================================================
// @contex/core — Public API
// ============================================================================

// Core classes
export { TokenStreamEncoder } from './token_stream_encoder.js';
export { TokenStreamDecoder } from './decoder.js';

// High-level API
export { compile } from './contex.js';
export type { CompileOptions } from './contex.js';

export * from './tens/hashing.js';
export { TokenizerManager } from './tokenizer.js';
export { SchemaRegistry, inferType, flattenObject } from './schema.js';

// Output formatters
export { formatOutput, analyzeFormats } from './formatters.js';

// TENS Protocol Object
export { Tens } from './tens.js';

// TENS-Text: Human-readable TENS format (Deprecated for user-facing, internal use only)
/** @deprecated TENS-Text is deprecated as a user-facing format. Use Tens.toString() for canonical text. */
export { TensTextEncoder, TensTextDecoder } from './tens_text.js';
/** @deprecated */
export type { TensTextSchema, TensTextRow, TensTextDocument } from './tens_text.js';
export type { FormatAnalysis } from './formatters.js';

// Validation
export { validateInput, TensValidationError } from './tens/validate.js';

// Errors
export {
  ContexError,
  TensEncodeError,
  TensDecodeError,
  PqlParseError,
  CollectionNotFoundError,
  BudgetError,
} from './errors.js';

// Dictionary
export { StringTable } from './tens/dictionary.js';

// Token Cache
export { TokenCache } from './token_cache.js';
export type { CachedEntry } from './token_cache.js';

// Pre-Tokenized Binary Blocks
export {
  createPreTokenizedBlock,
  readPreTokenizedBlock,
  getFieldTokens,
} from './pretokenized.js';
export type { FieldTokenIndex, PreTokenizedBlock } from './pretokenized.js';

// Canonical IR (v3)
export {
  canonicalize,
  canonicalizeValue,
  canonicalizeString,
  canonicalizeNumber,
} from './canonical.js';
export { encodeIR, IR_VERSION, CANONICALIZATION_VERSION } from './ir_encoder.js';
export {
  materialize,
  createMaterializer,
  Materializer,
  resolveEncoding,
  registerModelEncoding,
  TOKENIZER_VERSION,
} from './materialize.js';
export type { MaterializeOptions } from './materialize.js';
export { TokenMemory } from './memory.js';
export type { IRMeta, StoreResult, IRSummary } from './memory.js';
export {
  compose,
  composeFromHashes,
  createComposer,
  Composer,
  registerModelContextWindow,
} from './compose.js';
export type {
  TokenBlock,
  TextBlock,
  IRBlock,
  TokensBlock,
  ComposeRequest,
  ComposeFromHashesRequest,
  ComposeResult,
  BlockResult,
} from './compose.js';

// Types
export type {
  TokenId,
  TokenStream,
  TokenizerEncoding,
  TensSchema,
  TensRow,
  TensDocument,
  TensStats,
  TensType,
  OutputFormat,
  ServeOptions,
  TensIR,
  MaterializedTokens,
} from './types.js';

export {
  CTRL,
  TENS_MAGIC,
  TENS_VERSION,
  BLOCK_SIZE,
  MASK_CHUNK_BITS,
  MASK_CHUNK_BASE,
  ARRAY_LEN_BASE,
  DICT_REF_BASE,
} from './types.js';
