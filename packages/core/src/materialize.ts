import { logCacheHit, logCacheMiss, logMaterialize, timer } from './logger.js';
import { formatOutput } from './formatters.js';
import { TokenizerManager } from './tokenizer.js';
import type { MaterializedTokens, TensIR, TokenizerEncoding } from './types.js';
import { CacheMissReason, getGlobalDiagnostics, type CacheDiagnostics } from './cache_metrics.js';

// ---- Model → Encoding Registry ----
// Maps model IDs to their tokenizer encoding.
// This is a lightweight version of the engine's MODEL_REGISTRY,
// containing only what the materializer needs.

const MODEL_ENCODINGS: Record<string, TokenizerEncoding> = {
  // OpenAI — o200k_base
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  'gpt-4.1': 'o200k_base',
  'gpt-4.1-mini': 'o200k_base',
  'gpt-4.1-nano': 'o200k_base',
  'gpt-5': 'o200k_base',
  'gpt-5-mini': 'o200k_base',
  'gpt-5-nano': 'o200k_base',
  'gpt-5.2': 'o200k_base',
  'gpt-5.3-codex': 'o200k_base',
  'o3-mini': 'o200k_base',
  'o4-mini': 'o200k_base',

  // OpenAI — cl100k_base (older)
  'gpt-4': 'cl100k_base',
  'gpt-4-turbo': 'cl100k_base',
  'gpt-3.5-turbo': 'cl100k_base',

  // Anthropic — cl100k_base (approximation)
  'claude-3-5-sonnet': 'cl100k_base',
  'claude-3-7-sonnet': 'cl100k_base',
  'claude-4-sonnet': 'cl100k_base',
  'claude-4-5-sonnet': 'cl100k_base',
  'claude-opus-4-5': 'cl100k_base',
  'claude-3-5-haiku': 'cl100k_base',
  'claude-haiku-4-5': 'cl100k_base',

  // Google — cl100k_base (approximation)
  'gemini-2-0-flash': 'cl100k_base',
  'gemini-2-5-flash': 'cl100k_base',
  'gemini-2-5-flash-lite': 'cl100k_base',
  'gemini-2-5-pro': 'cl100k_base',

  // Meta — cl100k_base (approximation)
  'llama-4-maverick': 'cl100k_base',
  'llama-4-scout': 'cl100k_base',

  // Others — cl100k_base (default approximation)
  'deepseek-v3-2': 'cl100k_base',
  'deepseek-r1': 'cl100k_base',
  'grok-3': 'cl100k_base',
  'grok-4-fast': 'cl100k_base',
  'mistral-large': 'cl100k_base',
  'mistral-small': 'cl100k_base',
  'cohere-command-r-plus': 'cl100k_base',
  'qwen-2-5-72b': 'cl100k_base',
  'amazon-nova-pro': 'cl100k_base',
};

/**
 * Resolve a model ID to its tokenizer encoding.
 *
 * @param modelId - Model identifier (e.g. 'gpt-4o', 'claude-3-5-sonnet')
 * @returns The tokenizer encoding for this model
 * @throws If the model ID is not recognized
 */
export function resolveEncoding(modelId: string): TokenizerEncoding {
  const encoding = MODEL_ENCODINGS[modelId];
  if (!encoding) {
    throw new Error(
      `Unknown model: "${modelId}". ` + `Available: ${Object.keys(MODEL_ENCODINGS).join(', ')}`,
    );
  }
  return encoding;
}

/**
 * Register a custom model → encoding mapping.
 *
 * @param modelId - Model identifier
 * @param encoding - Tokenizer encoding to use
 */
export function registerModelEncoding(modelId: string, encoding: TokenizerEncoding): void {
  MODEL_ENCODINGS[modelId] = encoding;
}

import { computeStructuralHash } from './tens/hashing.js';

// ---- Tokenizer Versioning ----

/** Tokenizer library version — bump when js-tiktoken is updated */
export const TOKENIZER_VERSION = 'v1';

/** Format version — bump when the materialization text format changes */
export const FORMAT_VERSION = 'contex-v1';

/** Canonical probe string for fingerprint computation */
const FINGERPRINT_PROBE = 'The quick brown fox jumps over 42 lazy dogs.';

// Cached fingerprints per encoding (compute once per process)
const fingerprintCache = new Map<string, string>();

/**
 * Compute a fingerprint for a tokenizer encoding.
 *
 * Tokenizes a canonical probe string and hashes the result.
 * If the tokenizer silently changes behavior, this hash will differ,
 * detecting drift that could corrupt cached materializations.
 *
 * @param tokenizer - TokenizerManager instance
 * @param encoding - Tokenizer encoding
 * @returns SHA-256 hex fingerprint
 */
function computeTokenizerFingerprint(
  tokenizer: TokenizerManager,
  encoding: TokenizerEncoding,
): string {
  const cached = fingerprintCache.get(encoding);
  if (cached) return cached;

  const probeTokens = tokenizer.tokenize(FINGERPRINT_PROBE, encoding);
  const buffer = new Int32Array(probeTokens).buffer;
  // Include FORMAT_VERSION in fingerprint so cache invalidates when format changes
  const combined = new Uint8Array([
    ...new Uint8Array(buffer),
    ...new TextEncoder().encode(FORMAT_VERSION),
  ]);
  const fingerprint = computeStructuralHash(combined);
  fingerprintCache.set(encoding, fingerprint);
  return fingerprint;
}

// ---- Materializer ----

/** Options for creating a materializer instance. */
export interface MaterializerOptions {
  /** Maximum number of cached materializations (default: 1000) */
  maxCacheSize?: number;
}

/** Options for a single materialize call. */
export interface MaterializeOptions {
  /** Maximum tokens to produce (truncates result) */
  maxTokens?: number;
}

/**
 * Materialize a Canonical IR into model-specific token arrays.
 *
 * This converts the canonical IR's data into a JSON text representation
 * and tokenizes it with the target model's tokenizer. The IR's `data` field
 * contains the canonicalized source data, ensuring deterministic tokenization.
 *
 * Results are cached: repeated calls with the same IR hash + model ID
 * return the cached result without re-tokenizing.
 *
 * @param tensIR - The canonical IR to materialize
 * @param modelId - Target model (e.g. 'gpt-4o', 'claude-3-5-sonnet')
 * @param opts - Optional: { maxTokens } to truncate result
 * @returns MaterializedTokens containing the model-specific token array
 *
 * @example
 * ```ts
 * const ir = encodeIR([{ name: 'Alice', age: 30 }]);
 * const tokens = materialize(ir, 'gpt-4o');
 * console.log(tokens.tokenCount); // number of tokens for this model
 *
 * // Budget-aware:
 * const capped = materialize(ir, 'gpt-4o', { maxTokens: 500 });
 * console.log(capped.tokenCount); // <= 500
 * ```
 */
export function materialize(
  tensIR: TensIR,
  modelId: string,
  opts?: MaterializeOptions,
): MaterializedTokens {
  return defaultMaterializer.materialize(tensIR, modelId, opts);
}

/**
 * Create a new materializer instance with its own cache and tokenizer.
 *
 * Use this when you need isolated caching (e.g. per-request in a server)
 * or custom configuration.
 *
 * @param options - Configuration options
 * @returns A Materializer instance
 */
export function createMaterializer(options?: MaterializerOptions): Materializer {
  return new Materializer(options);
}

/**
 * Materializer: converts Canonical IR → model-specific token arrays.
 *
 * Each instance has its own tokenizer manager and materialization cache.
 * Includes tokenizer drift detection via probe-string fingerprinting.
 */
export class Materializer {
  private tokenizer: TokenizerManager;
  private cache = new Map<string, MaterializedTokens>();
  private maxCacheSize: number;

  constructor(options?: MaterializerOptions) {
    this.maxCacheSize = options?.maxCacheSize ?? 1000;
    this.tokenizer = new TokenizerManager('cl100k_base');
  }

  /**
   * Materialize IR into model-specific tokens.
   *
   * @param tensIR - Canonical IR to materialize
   * @param modelId - Target model identifier
   * @param opts - Optional: { maxTokens } to truncate result
   */
  materialize(tensIR: TensIR, modelId: string, opts?: MaterializeOptions): MaterializedTokens {
    const t = timer(`materialize:${modelId}`);
    const cacheKey = `${tensIR.hash}:${modelId}`;
    const encoding = resolveEncoding(modelId);
    let diagnostics: CacheDiagnostics | undefined;
    
    // Try to get global diagnostics (optional - don't fail if not available)
    try {
      diagnostics = getGlobalDiagnostics();
    } catch {
      // Diagnostics not initialized, skip
    }

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      // Apply maxTokens to cached result if needed
      if (opts?.maxTokens && cached.tokenCount > opts.maxTokens) {
        const truncated = {
          ...cached,
          tokens: cached.tokens.slice(0, opts.maxTokens),
          tokenCount: opts.maxTokens,
        };
        // Record hit with MAX_TOKENS_CHANGED reason
        if (diagnostics) {
          diagnostics.recordMiss(
            'materialize',
            tensIR.hash,
            CacheMissReason.MAX_TOKENS_CHANGED,
            modelId,
            encoding,
            t.end(),
            truncated.tokenCount,
            { originalTokenCount: cached.tokenCount },
          );
        }
        return truncated;
      }
      
      // Record hit
      if (diagnostics) {
        diagnostics.recordHit('materialize', tensIR.hash, modelId, encoding, t.end(), cached.tokenCount);
      }
      logCacheHit(tensIR.hash, modelId);
      logMaterialize(modelId, t.end(), cached.tokenCount, true);
      return cached;
    }

    // Record miss
    if (diagnostics) {
      diagnostics.recordMiss(
        'materialize',
        tensIR.hash,
        CacheMissReason.TOKEN_CACHE_MISSED,
        modelId,
        encoding,
        t.end(),
      );
    }
    logCacheMiss(tensIR.hash, modelId);

    // Compute tokenizer fingerprint (drift detection)
    const fingerprint = computeTokenizerFingerprint(this.tokenizer, encoding);

    // Format data using Contex Compact format (dictionary-compressed, tab-separated)
    // This is the core optimization: instead of JSON.stringify which wastes tokens
    // on structural overhead ({, }, "key":, commas), we use a format that puts
    // schema once in a header and values in tab-separated rows with dictionary
    // compression for repeated strings.
    const optimizedText = formatOutput(
      tensIR.data as Record<string, unknown>[],
      'contex',
    );

    // Tokenize with the target model's encoding
    let tokens = this.tokenizer.tokenize(optimizedText, encoding);

    // Apply maxTokens budget cap
    if (opts?.maxTokens && tokens.length > opts.maxTokens) {
      tokens = tokens.slice(0, opts.maxTokens);
    }

    const result: MaterializedTokens = {
      tokens,
      modelId,
      encoding,
      tokenCount: tokens.length,
      irHash: tensIR.hash,
      tokenizerVersion: TOKENIZER_VERSION,
      tokenizerFingerprint: fingerprint,
    };

    // Cache the full result (without maxTokens truncation for reuse)
    if (!opts?.maxTokens) {
      if (this.cache.size >= this.maxCacheSize) {
        // Evict oldest entries (first 25%)
        const evictCount = Math.floor(this.maxCacheSize / 4);
        const keys = this.cache.keys();
        for (let i = 0; i < evictCount; i++) {
          const key = keys.next().value;
          if (key) this.cache.delete(key);
        }
      }
      this.cache.set(cacheKey, result);
    }

    logMaterialize(modelId, t.end(), result.tokenCount, false);
    return result;
  }

  /**
   * Get the tokenizer fingerprint for an encoding.
   * Useful for cache key construction in TokenMemory.
   */
  getFingerprint(encoding: TokenizerEncoding): string {
    return computeTokenizerFingerprint(this.tokenizer, encoding);
  }

  /**
   * Clear the materialization cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Dispose of the materializer, releasing all resources.
   */
  dispose(): void {
    this.cache.clear();
    this.tokenizer.dispose();
  }
}

// Default singleton materializer for the simple `materialize()` API
const defaultMaterializer = new Materializer();
