import { encodeIR } from './ir_encoder.js';
import { formatOutput } from './formatters.js';
import { TokenMemory } from './memory.js';
import type { MaterializedTokens, TensIR, TensSchema, TokenizerEncoding } from './types.js';

/**
 * The TENS (Token Encoded Structured Data) Protocol Object.
 *
 * This is the **primary API entry point** for Contex. It represents a dataset
 * that has been encoded into the canonical TENS binary format.
 *
 * ## Why use Tens?
 *
 * - **Immutable**: Represents a specific version of data
 * - **Deterministic**: Same data → Same Hash → 100% cache hit rate
 * - **Portable**: Can be injected into any LLM context
 * - **Efficient**: Reduces token volume by 40-90% before tokenization
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Tens } from '@contex-llm/core';
 *
 * // Encode once
 * const tens = Tens.encode(myData);
 *
 * // Use in multiple ways
 * const tokens = tens.materialize('gpt-4o');  // Get token IDs
 * const text = tens.toString();                // Get canonical JSON
 * const hash = tens.hash;                      // Get content hash
 * ```
 *
 * ## With Persistent Storage
 *
 * ```typescript
 * import { Tens, TokenMemory } from '@contex-llm/core';
 *
 * const memory = new TokenMemory('./.contex');
 * const tens = Tens.encode(myData, { memory });
 *
 * // Later, load from hash
 * const loaded = Tens.loadFromHash(tens.hash, memory);
 * ```
 */
export class Tens {
  /** Canonical IR bytes (TENS binary format) */
  public readonly ir: Uint8Array;

  /** SHA-256 content hash - use for caching and deduplication */
  public readonly hash: string;

  /** Schemas used in this dataset for type information */
  public readonly schema: TensSchema[];

  /** Internal full IR object (includes data for materialization/text) */
  private readonly _fullIR: TensIR;
  private memory: TokenMemory | null = null;

  /**
   * Access the full IR object (including metadata and canonical data).
   * Useful for storage, debugging, or advanced use cases.
   */
  public get fullIR(): TensIR {
    return this._fullIR;
  }

  /**
   * Number of data rows in this Tens object.
   */
  public get rowCount(): number {
    return this._fullIR.data.length;
  }

  private constructor(ir: TensIR, memory?: TokenMemory) {
    this._fullIR = ir;
    this.ir = ir.ir;
    this.hash = ir.hash;
    this.schema = ir.schema;
    this.memory = memory || null;
  }

  /**
   * Create a Tens object from raw structured data.
   *
   * This is the main entry point for encoding data with Contex.
   * The encoding is deterministic - same data always produces the same hash.
   *
   * @param data - Array of data objects to encode
   * @param options - Optional configuration
   * @param options.memory - TokenMemory instance for persistent storage
   * @returns Tens object with the encoded data
   *
   * @example
   * ```typescript
   * // Simple usage
   * const tens = Tens.encode([{ name: 'Alice', age: 30 }]);
   *
   * // With persistent storage
   * const memory = new TokenMemory('./.contex');
   * const tens = Tens.encode(myData, { memory });
   * console.log(tens.hash); // 'abc123...'
   * ```
   */
  static encode(data: Record<string, unknown>[], options?: { memory?: TokenMemory }): Tens {
    if (!Array.isArray(data)) {
      throw new Error('Tens.encode() requires an array of objects');
    }

    // Step 1: Encode to Canonical IR (this is synchronous and fast)
    const ir = encodeIR(data);

    // Step 2: Store if memory provided
    if (options?.memory) {
      options.memory.storeIR(ir);
    }

    return new Tens(ir, options?.memory);
  }

  /**
   * Load a Tens object from stored IR by its hash.
   *
   * Use this to retrieve previously encoded data from persistent storage.
   *
   * @param hash - SHA-256 content hash of the IR
   * @param memory - TokenMemory instance (defaults to new TokenMemory('.contex'))
   * @returns Tens object reconstructed from storage
   *
   * @example
   * ```typescript
   * const memory = new TokenMemory('./.contex');
   * const tens = Tens.loadFromHash('abc123def456', memory);
   * ```
   */
  static loadFromHash(hash: string, memory?: TokenMemory): Tens {
    const mem = memory || new TokenMemory();
    const ir = mem.load(hash);
    return new Tens(ir, mem);
  }

  /**
   * Convert to Contex Compact Format for API Injection.
   *
   * Returns the token-optimized Contex format: tab-separated values with
   * dictionary compression. This format matches what the materializer
   * tokenizes, ensuring accurate token counts.
   *
   * For raw JSON output, use `toJSON()` instead.
   *
   * @returns The optimized string representation to send to the LLM
   *
   * @example
   * ```typescript
   * const text = tens.toString();
   * // Send to OpenAI:
   * await openai.chat.completions.create({
   *   messages: [{ role: 'user', content: text }]
   * });
   * ```
   */
  toString(): string {
    return formatOutput(this._fullIR.data, 'contex');
  }

  /**
   * Convert to canonical JSON representation.
   *
   * This returns the traditional JSON serialization of the data.
   * For token-optimized output, use `toString()` instead.
   *
   * @returns Canonical JSON string
   */
  toJSON(): string {
    return JSON.stringify(this._fullIR.data);
  }

  /**
   * Materialize tokens for a specific model.
   *
   * This derives the token array from the IR, using cache if available.
   * The result is model-specific because different models use different tokenizers.
   *
   * Results are automatically cached - subsequent calls with the same
   * tens.hash + modelId will be instant cache hits.
   *
   * @param modelId - The target model ID (e.g., 'gpt-4o', 'claude-3-5-sonnet', 'gemini-2-5-flash')
   * @param opts - Optional configuration
   * @param opts.maxTokens - Maximum number of tokens to return (truncates result)
   * @returns Int32Array of token IDs
   *
   * @example
   * ```typescript
   * // Get all tokens
   * const tokens = tens.materialize('gpt-4o');
   * console.log(tokens.length); // e.g., 1234
   *
   * // Limit to budget
   * const capped = tens.materialize('gpt-4o', { maxTokens: 500 });
   * console.log(capped.length); // 500
   * ```
   */
  materialize(modelId: string, opts?: { maxTokens?: number }): Int32Array {
    // Use provided memory or create a temporary one for this operation
    // (Note: temporary memory default uses .contex dir, so it persists)
    const mem = this.memory || new TokenMemory();

    // Ensure the IR is stored so we can cache against its hash
    // (store is idem-potent/deduplicated)
    mem.storeIR(this._fullIR);

    const result = mem.materializeAndCache(this.hash, modelId, opts);

    let tokens = result.tokens;
    if (opts?.maxTokens && tokens.length > opts.maxTokens) {
      tokens = tokens.slice(0, opts.maxTokens);
    }

    return new Int32Array(tokens);
  }

  /**
   * Materialize tokens with full metadata.
   *
   * Like `materialize()` but returns additional information about
   * the materialization including token count, encoding used, etc.
   *
   * @param modelId - The target model ID
   * @param opts - Optional configuration
   * @param opts.maxTokens - Maximum number of tokens to return
   * @returns MaterializedTokens with tokens and metadata
   *
   * @example
   * ```typescript
   * const result = tens.materializeFull('gpt-4o');
   * console.log(result.tokenCount);
   * console.log(result.encoding);
   * console.log(result.tokenizerFingerprint);
   * ```
   */
  materializeFull(modelId: string, opts?: { maxTokens?: number }): MaterializedTokens {
    const mem = this.memory || new TokenMemory();
    mem.storeIR(this._fullIR);

    const result = mem.materializeAndCache(this.hash, modelId, opts);

    if (opts?.maxTokens && result.tokenCount > opts.maxTokens) {
      return {
        ...result,
        tokens: result.tokens.slice(0, opts.maxTokens),
        tokenCount: opts.maxTokens,
      };
    }

    return result;
  }

  /**
   * Check if this Tens object has cached tokens for a specific model.
   *
   * @param modelId - The target model ID
   * @returns true if tokens are cached
   *
   * @example
   * ```typescript
   * if (tens.hasCache('gpt-4o')) {
   *   const tokens = tens.materialize('gpt-4o'); // Instant
   * }
   * ```
   */
  hasCache(modelId: string): boolean {
    const mem = this.memory || new TokenMemory();
    const cachedModels = mem.getCachedModels(this.hash);
    // Check if the modelId or a prefix matches any cached model
    return cachedModels.some(
      (cached) =>
        modelId.startsWith(cached) || cached.startsWith(modelId.split('-').slice(0, 2).join('-')),
    );
  }

  /**
   * Get the token count for a specific model without materializing.
   *
   * This is faster than materializing the full token array when you
   * only need the count for budget calculations.
   *
   * @param modelId - The target model ID
   * @returns Number of tokens
   *
   * @example
   * ```typescript
   * const count = tens.tokenCount('gpt-4o');
   * console.log(`Will use ${count} tokens`);
   * ```
   */
  tokenCount(modelId: string): number {
    const result = this.materializeFull(modelId);
    return result.tokenCount;
  }

  /**
   * Get the token array for a specific tokenizer encoding.
   *
   * This is useful when you need direct access to the token IDs
   * for budgeting, caching, or future token injection readiness.
   *
   * Unlike materialize() which takes a model ID, this takes a tokenizer
   * encoding directly (e.g., 'o200k_base', 'cl100k_base').
   *
   * @param encoding - The tokenizer encoding (e.g., 'o200k_base', 'cl100k_base')
   * @param opts - Optional configuration
   * @param opts.maxTokens - Maximum number of tokens to return
   * @returns Int32Array of token IDs
   *
   * @example
   * ```typescript
   * // Get tokens for a specific encoding
   * const tokens = tens.getTokenArray('o200k_base');
   * console.log(tokens.length); // e.g., 1234
   *
   * // For budgeting
   * const count = tens.getTokenCount('o200k_base');
   * console.log(`Will use ${count} tokens`);
   * ```
   */
  getTokenArray(encoding: TokenizerEncoding, opts?: { maxTokens?: number }): Int32Array {
    const mem = this.memory || new TokenMemory();
    mem.storeIR(this._fullIR);

    // We need to use a model ID that maps to this encoding
    // Since we don't have a direct model, we construct a fake one or use the encoding directly
    // The materialize function expects a modelId, but we can use the encoding
    // For now, we'll use a workaround: find a model that uses this encoding
    const modelId = this.getModelForEncoding(encoding);
    const result = mem.materializeAndCache(this.hash, modelId, opts);

    let tokens = result.tokens;
    if (opts?.maxTokens && tokens.length > opts.maxTokens) {
      tokens = tokens.slice(0, opts.maxTokens);
    }

    return new Int32Array(tokens);
  }

  /**
   * Get the token count for a specific tokenizer encoding.
   *
   * Faster than getTokenArray() when you only need the count.
   *
   * @param encoding - The tokenizer encoding
   * @returns Number of tokens
   *
   * @example
   * ```typescript
   * const count = tens.getTokenCount('o200k_base');
   * console.log(`Will use ${count} tokens`);
   * ```
   */
  getTokenCount(encoding: TokenizerEncoding): number {
    const tokens = this.getTokenArray(encoding);
    return tokens.length;
  }

  /**
   * Helper to find a model ID that uses the given encoding.
   * This is a workaround since materialize expects a model ID.
   */
  private getModelForEncoding(encoding: TokenizerEncoding): string {
    // Map common encodings to known models
    const encodingToModel: Record<TokenizerEncoding, string> = {
      o200k_base: 'gpt-4o',
      cl100k_base: 'gpt-4',
      p50k_base: 'gpt-3',
      r50k_base: 'gpt-3',
    };
    return encodingToModel[encoding] || 'gpt-4o';
  }

  /**
   * Serialize this Tens object for storage or transmission.
   *
   * Returns an object containing the IR bytes and metadata that can be
   * used to reconstruct the Tens object later.
   *
   * @returns Serializable representation
   *
   * @example
   * ```typescript
   * const serialized = tens.serialize();
   * // Store to file/database
   * fs.writeFileSync('data.contex', JSON.stringify(serialized));
   * ```
   */
  serialize(): { ir: string; hash: string; schema: TensSchema[]; data: Record<string, unknown>[] } {
    return {
      ir: Buffer.from(this.ir).toString('base64'),
      hash: this.hash,
      schema: this.schema,
      data: this._fullIR.data,
    };
  }

  /**
   * Deserialize a serialized Tens object.
   *
   * @param data - Serialized data from serialize()
   * @param memory - Optional TokenMemory for caching
   * @returns Reconstructed Tens object
   *
   * @example
   * ```typescript
   * const loaded = Tens.deserialize(JSON.parse(fs.readFileSync('data.contex')));
   * ```
   */
  static deserialize(
    data: { ir: string; hash: string; schema: TensSchema[]; data: Record<string, unknown>[] },
    memory?: TokenMemory,
  ): Tens {
    const ir: TensIR = {
      ir: new Uint8Array(Buffer.from(data.ir, 'base64')),
      hash: data.hash,
      schema: data.schema,
      data: data.data,
      irVersion: '3.0',
      canonicalizationVersion: '1.0',
    };
    return new Tens(ir, memory);
  }
}
