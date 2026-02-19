import { Tens, type TensIR, TokenMemory, encodeIR, formatOutput, getGlobalDiagnostics, CacheMissReason } from '@contex-llm/core';
import type { ContexMiddlewareOptions, InjectionInfo } from './types.js';

// ============================================================================
// @contex-llm/middleware v3 — Shared Core
// ============================================================================
// Provides the shared IR pipeline logic used by all SDK wrappers.
// Data → encodeIR → TokenMemory.store → materialize → canonical JSON text
// ============================================================================

const PLACEHOLDER_REGEX = /\{\{CONTEX:([^}]+)\}\}/g;

/**
 * Shared context manager for all SDK wrappers.
 * Handles IR encoding, storage, materialization, and canonical text generation.
 */
export class ContexContext {
  private memory: TokenMemory;
  private collections: Map<string, string> = new Map(); // name → IR hash
  private irCache: Map<string, TensIR | Tens> = new Map();
  private textCache: Map<string, string> = new Map(); // "hash:model" → canonical text
  private onInject?: (info: InjectionInfo) => void;
  private onError?: (error: Error, collection: string) => void;

  constructor(options: ContexMiddlewareOptions = {}) {
    this.memory = new TokenMemory(options.storeDir ?? '.contex');
    this.onInject = options.onInject;
    this.onError = options.onError;

    // Register data collections
    if (options.data) {
      for (const [name, data] of Object.entries(options.data)) {
        this.registerData(name, data);
      }
    }

    // Register pre-stored hashes
    if (options.hashes) {
      for (const [name, hash] of Object.entries(options.hashes)) {
        this.collections.set(name, hash);
      }
    }
  }

  /**
   * Register a data collection. Encodes to IR and stores in TokenMemory.
   * Returns the IR hash.
   */
  registerData(name: string, data: Record<string, unknown>[] | Tens): string {
    if (data instanceof Tens) {
      // Already encoded Tens object
      this.collections.set(name, data.hash);
      this.irCache.set(data.hash, data);
      // Optionally store to disk if not already done?
      // For now, we assume in-memory usage is fine or memory.store() is called elsewhere.
      // But if we want persistence across reloads, we should store it.
      this.memory.storeIR(data.fullIR); // Store the full IR (bytes + meta)
      return data.hash;
    }

    const ir = encodeIR(data);
    const result = this.memory.store(data);
    this.collections.set(name, result.hash);
    this.irCache.set(result.hash, ir);
    return result.hash;
  }

  /**
   * Check if any text contains CONTEX placeholders.
   */
  hasPlaceholders(text: string): boolean {
    return text.includes('{{CONTEX:');
  }

  /**
   * Replace all {{CONTEX:collection}} placeholders in a string with
   * canonical JSON text from the IR pipeline.
   */
  replacePlaceholders(text: string, model: string): string {
    return text.replace(PLACEHOLDER_REGEX, (match, collection) => {
      try {
        return this.injectCollection(collection, model);
      } catch (error) {
        if (this.onError) {
          this.onError(error as Error, collection);
        } else {
          console.warn(
            `[contex-middleware] Failed to inject "${collection}": ${(error as Error).message}`,
          );
        }
        return match;
      }
    });
  }

  /**
   * Get the canonical JSON text for a collection, materialized for a specific model.
   */
  private injectCollection(collection: string, model: string): string {
    const hash = this.collections.get(collection);
    if (!hash) {
      throw new Error(`Collection "${collection}" not registered. Use data or hashes option.`);
    }

    // Try to get global diagnostics (optional)
    let diagnostics;
    try {
      diagnostics = getGlobalDiagnostics();
    } catch {
      diagnostics = null;
    }

    // Check text cache
    const cacheKey = `${hash}:${model}`;
    const cachedText = this.textCache.get(cacheKey);
    if (cachedText !== undefined) {
      // Record text cache hit
      if (diagnostics) {
        diagnostics.recordHit('text', hash, model);
      }
      
      // Fire callback with cache hit
      if (this.onInject) {
        const materialized = this.memory.materializeAndCache(hash, model);
        this.onInject({
          collection,
          model,
          encoding: materialized.encoding,
          irHash: hash,
          tokenCount: materialized.tokenCount,
          cacheHit: true,
        });
      }
      return cachedText;
    }

    // Record text cache miss
    if (diagnostics) {
      diagnostics.recordMiss('text', hash, CacheMissReason.TEXT_CACHE_MISSED, model);
    }

    // Materialize → get token count, then generate canonical JSON text
    const materialized = this.memory.materializeAndCache(hash, model);

    // Load the IR to get canonical data for text injection
    let canonicalText: string;
    const cachedItem = this.irCache.get(hash);

    if (cachedItem instanceof Tens) {
      canonicalText = cachedItem.toString();
    } else if (cachedItem) {
      // TensIR — use Contex Compact format for optimal token efficiency
      canonicalText = formatOutput(cachedItem.data, 'contex');
    } else {
      // Not in cache, load from memory
      const ir = this.memory.load(hash);
      canonicalText = formatOutput(ir.data, 'contex');
    }

    // Cache the text
    this.textCache.set(cacheKey, canonicalText);

    // Fire callback
    if (this.onInject) {
      this.onInject({
        collection,
        model,
        encoding: materialized.encoding,
        irHash: hash,
        tokenCount: materialized.tokenCount,
        cacheHit: false,
      });
    }

    return canonicalText;
  }

  /**
   * Get the token count for a collection materialized for a model.
   */
  getTokenCount(collection: string, model: string): number {
    const hash = this.collections.get(collection);
    if (!hash) return 0;
    const materialized = this.memory.materializeAndCache(hash, model);
    return materialized.tokenCount;
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this.memory.dispose();
    this.irCache.clear();
    this.textCache.clear();
    this.collections.clear();
  }
}

/**
 * Check if a message content string or content array contains placeholders.
 */
export function messageHasPlaceholder(content: unknown): boolean {
  if (typeof content === 'string') {
    return content.includes('{{CONTEX:');
  }
  if (Array.isArray(content)) {
    const hasTextPlaceholder = (value: unknown): boolean => {
      if (typeof value === 'string') {
        return value.includes('{{CONTEX:');
      }
      if (typeof value !== 'object' || value === null) {
        return false;
      }
      const part = value as { text?: unknown; type?: unknown };
      if (typeof part.text === 'string' && part.text.includes('{{CONTEX:')) {
        return true;
      }
      return (
        part.type === 'text' && typeof part.text === 'string' && part.text.includes('{{CONTEX:')
      );
    };
    return content.some((part) => hasTextPlaceholder(part));
  }
  return false;
}

export { PLACEHOLDER_REGEX };
