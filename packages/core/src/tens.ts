import { encodeIR } from './ir_encoder.js';
import { TokenMemory } from './memory.js';
import type { TensIR, TensSchema } from './types.js';

/**
 * The TENS (Token Encoded Structured Data) Protocol Object.
 * Represents a dataset that has been encoded into the canonical TENS binary format.
 *
 * This object is:
 * 1. Immutable: Represents a specific version of data.
 * 2. Deterministic: Same data -> Same Hash.
 * 3. Portable: Can be injected into any LLM context.
 */
export class Tens {
  /** Canonical IR bytes (TENS v2 binary) */
  public readonly ir: Uint8Array;
  /** SHA-256 content hash */
  public readonly hash: string;
  /** Schemas used in this dataset */
  public readonly schema: TensSchema[];

  /** Internal full IR object (includes data for materialization/text) */
  private readonly _fullIR: TensIR;
  private memory: TokenMemory | null = null;

  /**
   * Access the full IR object (including metadata and canonical data).
   * Useful for storage and debugging.
   */
  public get fullIR(): TensIR {
    return this._fullIR;
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
   * Encodes the data into the Canonical IR format.
   *
   * @param data - Array of data objects to encode
   * @param options - Encoding options (optional)
   */
  static encode(data: any[], options?: { memory?: TokenMemory }): Tens {
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
   * @param hash - SHA-256 content hash of the IR
   * @param memory - TokenMemory instance (defaults to new TokenMemory('.contex'))
   */
  static loadFromHash(hash: string, memory?: TokenMemory): Tens {
    const mem = memory || new TokenMemory();
    const ir = mem.load(hash);
    return new Tens(ir, mem);
  }

  /**
   * Convert to Canonical Text for API Injection.
   * This text is guaranteed to be deterministic and cache-aligned.
   *
   * Current implementation uses JSON.stringify of the canonicalized data,
   * adhering to the "Text First" principle.
   *
   * @returns The string representation to send to the LLM.
   */
  toString(): string {
    return JSON.stringify(this._fullIR.data);
  }

  /**
   * Materialize tokens for a specific model.
   * This derives the token array from the IR, using cache if available.
   *
   * @param modelId - The target model ID (e.g., 'gpt-4o')
   * @param opts - Options like maxTokens
   * @returns Int32Array of token IDs
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
}
