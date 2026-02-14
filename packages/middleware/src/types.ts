import type { TokenizerEncoding } from '@contex/core';

// ============================================================================
// @contex/middleware v3 — Types
// ============================================================================

/**
 * Options for configuring the Contex middleware wrapper.
 * Data can be registered either as raw objects or pre-stored IR hashes.
 */
import type { Tens } from '@contex/core';

// ...

export interface ContexMiddlewareOptions {
  /**
   * Data collections available for placeholder injection.
   * Key = collection name used in {{CONTEX:name}} placeholders.
   * Value = array of data objects OR a pre-encoded Tens object.
   */
  data?: Record<string, Record<string, unknown>[] | Tens>;

  /**
   * Pre-stored IR hashes available for placeholder injection.
   * Key = collection name, Value = IR hash from TokenMemory.
   */
  hashes?: Record<string, string>;

  /**
   * Directory for TokenMemory storage.
   * @default '.contex'
   */
  storeDir?: string;

  /**
   * Default number of tokens to reserve for the LLM's response.
   * @default 1000
   */
  defaultReserve?: number;

  /**
   * Called after each context injection with details about what happened.
   */
  onInject?: (info: InjectionInfo) => void;

  /**
   * Called when an error occurs during context injection.
   * If not provided, errors are logged and the placeholder is left intact.
   */
  onError?: (error: Error, collection: string) => void;
}

/**
 * Information about a completed context injection, passed to the onInject callback.
 */
export interface InjectionInfo {
  /** The collection that was injected */
  collection: string;
  /** The model being used */
  model: string;
  /** The tokenizer encoding used */
  encoding: TokenizerEncoding;
  /** Content hash of the injected IR */
  irHash: string;
  /** Number of tokens in the injected context */
  tokenCount: number;
  /** Whether the result came from cache */
  cacheHit: boolean;
}
