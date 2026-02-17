// ============================================================================
// @contex/core — Token Memory
// ============================================================================
//
// Persistent storage for Canonical IR files with content-hash deduplication.
//
// Storage layout (v2):
//   .contex/
//     ir/
//       {hash}/
//         ir.bin               # Binary IR blob
//         meta.json            # Schema, versions, canonicalized data
//     cache/
//       {hash}/
//         {modelId}.{encoding}.{tokenizerVersion}/
//           tokens.bin          # Int32Array binary token cache
//           meta.json           # Token count, fingerprint, timestamps
//
// Key properties:
//   - Content-addressed: same data → same hash → same directory → automatic dedup
//   - Versioned IR: irVersion + canonicalizationVersion tracked for reproducibility
//   - Fingerprinted cache: tokenizer drift detected via probe-string fingerprint
//   - Binary tokens: Int32Array for compact, fast storage (4× smaller than JSON)
//   - Lazy materialization: tokens generated per-model on demand, then cached
//   - Portable: .contex/ directory can be committed, shared, or deployed
// ============================================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeIR } from './ir_encoder.js';
import {
  type Materializer,
  TOKENIZER_VERSION,
  createMaterializer,
  resolveEncoding,
} from './materialize.js';
import type { MaterializedTokens, TensIR, TensSchema, TokenizerEncoding } from './types.js';
import { CacheMissReason, getGlobalDiagnostics, type CacheDiagnostics } from './cache_metrics.js';

/** Metadata stored alongside each IR blob */
export interface IRMeta {
  /** SHA-256 content hash */
  hash: string;
  /** Schemas used in this IR */
  schemas: TensSchema[];
  /** Number of data rows */
  rowCount: number;
  /** Size of the IR binary in bytes */
  irByteSize: number;
  /** ISO timestamp of when this IR was stored */
  storedAt: string;
  /** IR format version */
  irVersion: string;
  /** Canonicalization algorithm version */
  canonicalizationVersion: string;
}

/** Result of a store operation */
export interface StoreResult {
  /** The content hash of the stored IR */
  hash: string;
  /** Whether this was a new store (true) or already existed (false = dedup hit) */
  isNew: boolean;
  /** Size of the IR binary in bytes */
  irByteSize: number;
}

/** Summary of a stored IR for listing/inspection */
export interface IRSummary {
  hash: string;
  rowCount: number;
  irByteSize: number;
  storedAt: string;
  irVersion: string;
  canonicalizationVersion: string;
  /** Model IDs that have cached materializations */
  cachedModels: string[];
}

/** Metadata stored alongside cached tokens */
interface CacheMeta {
  modelId: string;
  encoding: TokenizerEncoding;
  tokenCount: number;
  irHash: string;
  tokenizerVersion: string;
  tokenizerFingerprint: string;
  cachedAt: string;
}

/**
 * Token Memory — Persistent IR storage with content-hash deduplication.
 *
 * Manages a `.contex/` directory containing:
 * - `ir/{hash}/` — Canonical IR blobs (`ir.bin`) and metadata (`meta.json`)
 * - `cache/{hash}/{model}.{enc}.{ver}/` — Binary token caches with fingerprints
 *
 * @example
 * ```ts
 * const memory = new TokenMemory('.contex');
 * const result = memory.store(myData);
 * console.log(result.hash);          // content-addressed hash
 * console.log(result.isNew);         // false if already stored (dedup!)
 *
 * const tokens = memory.materializeAndCache(result.hash, 'gpt-4o');
 * console.log(tokens.tokenCount);    // cached as binary for next time
 * ```
 */
export class TokenMemory {
  private irDir: string;
  private cacheDir: string;
  private materializer: Materializer;

  constructor(baseDir = '.contex') {
    this.irDir = join(baseDir, 'ir');
    this.cacheDir = join(baseDir, 'cache');
    this.materializer = createMaterializer();

    // Ensure root directories exist
    mkdirSync(this.irDir, { recursive: true });
    mkdirSync(this.cacheDir, { recursive: true });
  }

  // ---- Store / Load ----

  /**
   * Encode data and store the IR to disk.
   *
   * If an IR with the same content hash already exists, the write is
   * skipped (content-addressed deduplication).
   *
   * @param data - Array of data objects to encode and store
   * @returns StoreResult with hash and dedup status
   */
  store(data: object[]): StoreResult {
    const tensIR = encodeIR(data);
    return this.storeIR(tensIR);
  }

  /**
   * Store a pre-encoded TensIR to disk.
   *
   * @param tensIR - Already-encoded canonical IR
   * @returns StoreResult with hash and dedup status
   */
  storeIR(tensIR: TensIR): StoreResult {
    const hash = tensIR.hash;

    // Dedup: skip if already stored
    if (this.has(hash)) {
      return {
        hash,
        isNew: false,
        irByteSize: tensIR.ir.byteLength,
      };
    }

    // Create IR directory: ir/{hash}/
    const irHashDir = this.irHashDir(hash);
    mkdirSync(irHashDir, { recursive: true });

    // Write IR binary
    writeFileSync(join(irHashDir, 'ir.bin'), tensIR.ir);

    // Write metadata + canonicalized data (needed for materialization)
    const meta: IRMeta & { data: Record<string, unknown>[] } = {
      hash,
      schemas: tensIR.schema,
      rowCount: tensIR.data.length,
      irByteSize: tensIR.ir.byteLength,
      storedAt: new Date().toISOString(),
      irVersion: tensIR.irVersion,
      canonicalizationVersion: tensIR.canonicalizationVersion,
      data: tensIR.data,
    };
    writeFileSync(join(irHashDir, 'meta.json'), JSON.stringify(meta), 'utf-8');

    return {
      hash,
      isNew: true,
      irByteSize: tensIR.ir.byteLength,
    };
  }

  /**
   * Load a stored IR by its content hash.
   *
   * @param hash - SHA-256 content hash
   * @returns TensIR reconstructed from disk
   * @throws If the hash is not found
   */
  load(hash: string): TensIR {
    if (!this.has(hash)) {
      throw new Error(`IR not found: ${hash}`);
    }

    const irHashDir = this.irHashDir(hash);
    const ir = new Uint8Array(readFileSync(join(irHashDir, 'ir.bin')));
    const metaRaw = JSON.parse(readFileSync(join(irHashDir, 'meta.json'), 'utf-8'));

    return {
      ir,
      schema: metaRaw.schemas,
      hash: metaRaw.hash,
      data: metaRaw.data,
      irVersion: metaRaw.irVersion ?? '1.0',
      canonicalizationVersion: metaRaw.canonicalizationVersion ?? '1.0',
    };
  }

  // ---- Materialization Cache ----

  /**
   * Materialize IR for a model and cache the result to disk as binary.
   *
   * If already cached with matching tokenizer fingerprint, returns the
   * cached result without re-materializing. If the fingerprint doesn't
   * match (tokenizer drift), re-materializes and overwrites the cache.
   *
   * @param hash - IR content hash
   * @param modelId - Target model (e.g. 'gpt-4o')
   * @param opts - Options like maxTokens
   * @returns MaterializedTokens
   */
  materializeAndCache(
    hash: string,
    modelId: string,
    opts?: { maxTokens?: number },
  ): MaterializedTokens {
    const start = performance.now();
    const encoding = resolveEncoding(modelId);
    const cacheSubDir = this.tokenCacheDir(hash, modelId, encoding);
    
    // Try to get global diagnostics (optional)
    let diagnostics: CacheDiagnostics | undefined;
    try {
      diagnostics = getGlobalDiagnostics();
    } catch {
      // Diagnostics not initialized
    }

    // Check disk cache
    const metaPath = join(cacheSubDir, 'meta.json');
    const binaryPath = join(cacheSubDir, 'tokens.bin');

    if (existsSync(metaPath) && existsSync(binaryPath)) {
      const cacheMeta: CacheMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));

      // Verify tokenizer fingerprint hasn't drifted
      const currentFingerprint = this.materializer.getFingerprint(encoding);
      if (cacheMeta.tokenizerFingerprint === currentFingerprint) {
        // Cache hit — read binary tokens
        const buffer = readFileSync(binaryPath);
        const tokens = Array.from(
          new Int32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4),
        );

        // Record hit
        if (diagnostics) {
          diagnostics.recordHit('materialize', hash, modelId, encoding, performance.now() - start, tokens.length);
        }
        
        return {
          tokens,
          modelId: cacheMeta.modelId,
          encoding: cacheMeta.encoding,
          tokenCount: cacheMeta.tokenCount,
          irHash: cacheMeta.irHash,
          tokenizerVersion: cacheMeta.tokenizerVersion,
          tokenizerFingerprint: cacheMeta.tokenizerFingerprint,
        };
      }
      
      // Fingerprint mismatch — drift detected
      if (diagnostics) {
        diagnostics.recordMiss(
          'materialize',
          hash,
          CacheMissReason.ENCODING_DRIFT,
          modelId,
          encoding,
          performance.now() - start,
          undefined,
          { 
            cachedFingerprint: cacheMeta.tokenizerFingerprint,
            currentFingerprint,
          },
        );
      }
      // Re-materialize below
    } else {
      // No cache entry exists
      if (diagnostics) {
        diagnostics.recordMiss(
          'materialize',
          hash,
          CacheMissReason.MODEL_NEVER_MATERIALIZED,
          modelId,
          encoding,
          performance.now() - start,
        );
      }
    }

    // Load IR and materialize
    const tensIR = this.load(hash);
    const result = this.materializer.materialize(tensIR, modelId, opts);

    // Write binary tokens
    mkdirSync(cacheSubDir, { recursive: true });
    const int32 = new Int32Array(result.tokens);
    writeFileSync(binaryPath, Buffer.from(int32.buffer));

    // Write cache metadata
    const cacheMeta: CacheMeta = {
      modelId: result.modelId,
      encoding: result.encoding,
      tokenCount: result.tokenCount,
      irHash: result.irHash,
      tokenizerVersion: result.tokenizerVersion,
      tokenizerFingerprint: result.tokenizerFingerprint,
      cachedAt: new Date().toISOString(),
    };
    writeFileSync(metaPath, JSON.stringify(cacheMeta), 'utf-8');

    if (
      typeof process !== 'undefined' &&
      (process.env.CONTEX_DEBUG || process.env.CONTEX_PROFILE)
    ) {
      const ms = (performance.now() - (start as number)).toFixed(2);
      console.log(`[Contex] materialize: ${ms}ms for ${modelId} (${result.tokenCount} tokens)`);
    }

    return result;
  }

  /**
   * Load cached materialized tokens from disk.
   *
   * @param hash - IR content hash
   * @param modelId - Target model
   * @returns MaterializedTokens or null if not cached
   */
  loadMaterialized(hash: string, modelId: string): MaterializedTokens | null {
    const encoding = resolveEncoding(modelId);
    const cacheSubDir = this.tokenCacheDir(hash, modelId, encoding);
    const metaPath = join(cacheSubDir, 'meta.json');
    const binaryPath = join(cacheSubDir, 'tokens.bin');

    if (!existsSync(metaPath) || !existsSync(binaryPath)) return null;

    const cacheMeta: CacheMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    const buffer = readFileSync(binaryPath);
    const tokens = Array.from(
      new Int32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4),
    );

    return {
      tokens,
      modelId: cacheMeta.modelId,
      encoding: cacheMeta.encoding,
      tokenCount: cacheMeta.tokenCount,
      irHash: cacheMeta.irHash,
      tokenizerVersion: cacheMeta.tokenizerVersion,
      tokenizerFingerprint: cacheMeta.tokenizerFingerprint,
    };
  }

  // ---- Query ----

  /**
   * Check if an IR with the given hash exists.
   */
  has(hash: string): boolean {
    const dir = this.irHashDir(hash);
    return existsSync(join(dir, 'ir.bin')) && existsSync(join(dir, 'meta.json'));
  }

  /**
   * List all stored IR hashes with summary info.
   */
  list(): IRSummary[] {
    if (!existsSync(this.irDir)) return [];

    const dirs = readdirSync(this.irDir).filter((d) => {
      const fp = join(this.irDir, d);
      return existsSync(fp) && statSync(fp).isDirectory();
    });

    return dirs
      .map((hash) => {
        const metaPath = join(this.irDir, hash, 'meta.json');
        if (!existsSync(metaPath)) return null;
        const metaRaw = JSON.parse(readFileSync(metaPath, 'utf-8'));
        const cachedModels = this.getCachedModels(hash);

        return {
          hash: metaRaw.hash,
          rowCount: metaRaw.rowCount,
          irByteSize: metaRaw.irByteSize,
          storedAt: metaRaw.storedAt,
          irVersion: metaRaw.irVersion ?? '1.0',
          canonicalizationVersion: metaRaw.canonicalizationVersion ?? '1.0',
          cachedModels,
        };
      })
      .filter(Boolean) as IRSummary[];
  }

  /**
   * Get metadata for a stored IR.
   */
  getMeta(hash: string): IRMeta | null {
    if (!this.has(hash)) return null;
    const metaRaw = JSON.parse(readFileSync(join(this.irHashDir(hash), 'meta.json'), 'utf-8'));
    return {
      hash: metaRaw.hash,
      schemas: metaRaw.schemas,
      rowCount: metaRaw.rowCount,
      irByteSize: metaRaw.irByteSize,
      storedAt: metaRaw.storedAt,
      irVersion: metaRaw.irVersion ?? '1.0',
      canonicalizationVersion: metaRaw.canonicalizationVersion ?? '1.0',
    };
  }

  /**
   * Get list of model IDs that have cached materializations for an IR.
   */
  getCachedModels(hash: string): string[] {
    const cacheHashDir = join(this.cacheDir, hash);
    if (!existsSync(cacheHashDir)) return [];

    return readdirSync(cacheHashDir)
      .filter((d) => {
        const fp = join(cacheHashDir, d);
        return statSync(fp).isDirectory() && existsSync(join(fp, 'tokens.bin'));
      })
      .map((d) => d.split('.')[0]); // Extract modelId from "modelId.encoding.version"
  }

  // ---- Cleanup ----

  /**
   * Dispose of resources (materializer).
   */
  dispose(): void {
    this.materializer.dispose();
  }

  // ---- Private helpers ----

  /** IR directory for a given hash: ir/{hash}/ */
  private irHashDir(hash: string): string {
    return join(this.irDir, hash);
  }

  /** Cache directory for a specific materialization: cache/{hash}/{model}.{encoding}.{version}/ */
  private tokenCacheDir(hash: string, modelId: string, encoding: TokenizerEncoding): string {
    return join(this.cacheDir, hash, `${modelId}.${encoding}.${TOKENIZER_VERSION}`);
  }
}
