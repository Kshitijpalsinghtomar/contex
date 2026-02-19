// ============================================================================
// @contex-llm/core — Cache Metrics & Miss-Reason Taxonomy
// ============================================================================
//
// Tracks cache access patterns and miss reasons for observability and debugging.
// Supports the Dynamic Gate requirement: "cache miss reasons are captured and attributable"
//
// Miss-Reason Taxonomy:
//   IR Level:       IR_NOT_STORED, IR_HASH_MISMATCH
//   Materialization: MODEL_NEVER_MATERIALIZED, ENCODING_DRIFT, TOKENIZER_VERSION_CHANGE, MAX_TOKENS_CHANGED
//   Token Level:    TOKEN_CACHE_EXPIRED, TOKEN_CACHE_MISSED
//   Text Level:     TEXT_CACHE_MISSED
//   System:         DISK_IO_ERROR, CORRUPTED_CACHE
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TokenizerEncoding } from './types.js';

/**
 * Enumeration of all possible cache miss reasons.
 * Each reason is attributable and actionable.
 */
export enum CacheMissReason {
  // IR Level
  /** IR was never stored/encoded */
  IR_NOT_STORED = 'IR_NOT_STORED',
  /** Data changed, hash differs from previous */
  IR_HASH_MISMATCH = 'IR_HASH_MISMATCH',

  // Materialization Level
  /** First request for this model, never materialized before */
  MODEL_NEVER_MATERIALIZED = 'MODEL_NEVER_MATERIALIZED',
  /** Tokenizer fingerprint changed (drift detected) */
  ENCODING_DRIFT = 'ENCODING_DRIFT',
  /** Tokenizer library version changed */
  TOKENIZER_VERSION_CHANGE = 'TOKENIZER_VERSION_CHANGE',
  /** Different maxTokens budget than previous */
  MAX_TOKENS_CHANGED = 'MAX_TOKENS_CHANGED',

  // Token Level (in-memory)
  /** Cache entry evicted due to LRU limit */
  TOKEN_CACHE_EXPIRED = 'TOKEN_CACHE_EXPIRED',
  /** Key not present in cache */
  TOKEN_CACHE_MISSED = 'TOKEN_CACHE_MISSED',

  // Text Level
  /** Text not in cache */
  TEXT_CACHE_MISSED = 'TEXT_CACHE_MISSED',

  // System Level
  /** Disk read/write failure */
  DISK_IO_ERROR = 'DISK_IO_ERROR',
  /** Cache file corrupted or checksum mismatch */
  CORRUPTED_CACHE = 'CORRUPTED_CACHE',

  // Positive cases (not misses)
  /** Cache hit */
  HIT = 'HIT',
}

/** Operation types for cache access */
export type CacheOperation = 'materialize' | 'tokenize' | 'text' | 'ir_store';

/** Record of a single cache access */
export interface CacheAccessRecord {
  /** Unique identifier for this access */
  id: string;
  /** Timestamp of access */
  timestamp: string;
  /** Operation type */
  operation: CacheOperation;
  /** IR hash or collection name */
  key: string;
  /** Model ID (if applicable) */
  modelId?: string;
  /** Encoding used (if applicable) */
  encoding?: TokenizerEncoding;
  /** Whether it was a hit or miss */
  hit: boolean;
  /** Reason if miss, or HIT if hit */
  reason: CacheMissReason;
  /** Latency in milliseconds */
  latencyMs: number;
  /** Token count (if materialized) */
  tokenCount?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Aggregate telemetry data */
export interface CacheTelemetry {
  /** Total number of cache accesses */
  totalRequests: number;
  /** Number of hits */
  hits: number;
  /** Number of misses */
  misses: number;
  /** Hit rate as percentage */
  hitRate: number;
  /** Breakdown of misses by reason */
  missesByReason: Partial<Record<CacheMissReason, number>>;
  /** Latency percentiles */
  latencyPercentiles: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  /** Operations breakdown */
  operations: Partial<Record<CacheOperation, { hits: number; misses: number }>>;
  /** First access timestamp */
  since: string;
}

/** Options for CacheDiagnostics */
export interface CacheDiagnosticsOptions {
  /** Maximum number of records to keep in memory (default: 10000) */
  maxRecords?: number;
  /** Whether to persist records to disk (default: false) */
  persistToDisk?: boolean;
  /** Directory for persisted records (default: '.contex/diagnostics') */
  persistDir?: string;
}

/**
 * Cache Diagnostics — tracks cache access patterns and miss reasons.
 *
 * Provides:
 * - Detailed access logging with miss reasons
 * - Aggregate telemetry (hit rate, latency percentiles)
 * - Integration points for Materializer, TokenMemory, ContexContext
 *
 * @example
 * ```ts
 * const diagnostics = new CacheDiagnostics();
 *
 * // Record a cache access
 * diagnostics.record({
 *   operation: 'materialize',
 *   key: 'abc123',
 *   modelId: 'gpt-4o',
 *   hit: false,
 *   reason: CacheMissReason.MODEL_NEVER_MATERIALIZED,
 *   latencyMs: 150,
 * });
 *
 * // Get telemetry
 * const telemetry = diagnostics.getTelemetry();
 * console.log(`Hit rate: ${telemetry.hitRate}%`);
 * ```
 */
export class CacheDiagnostics {
  private records: CacheAccessRecord[] = [];
  private maxRecords: number;
  private persistToDisk: boolean;
  private persistDir: string;
  private recordCounter = 0;

  constructor(options: CacheDiagnosticsOptions = {}) {
    this.maxRecords = options.maxRecords ?? 10000;
    this.persistToDisk = options.persistToDisk ?? false;
    this.persistDir = options.persistDir ?? '.contex/diagnostics';
  }

  /**
   * Record a cache access.
   */
  record(
    params: Omit<CacheAccessRecord, 'id' | 'timestamp'> & { latencyMs: number },
  ): CacheAccessRecord {
    const record: CacheAccessRecord = {
      id: `ctx_${Date.now()}_${++this.recordCounter}`,
      timestamp: new Date().toISOString(),
      ...params,
    };

    this.records.push(record);

    // Evict oldest if over limit
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }

    // TODO: Persist to disk if enabled

    return record;
  }

  /**
   * Record a cache hit (shorthand).
   */
  recordHit(
    operation: CacheOperation,
    key: string,
    modelId?: string,
    encoding?: TokenizerEncoding,
    latencyMs?: number,
    tokenCount?: number,
  ): CacheAccessRecord {
    return this.record({
      operation,
      key,
      modelId,
      encoding,
      hit: true,
      reason: CacheMissReason.HIT,
      latencyMs: latencyMs ?? 0,
      tokenCount,
    });
  }

  /**
   * Record a cache miss (shorthand).
   */
  recordMiss(
    operation: CacheOperation,
    key: string,
    reason: CacheMissReason,
    modelId?: string,
    encoding?: TokenizerEncoding,
    latencyMs?: number,
    tokenCount?: number,
    metadata?: Record<string, unknown>,
  ): CacheAccessRecord {
    return this.record({
      operation,
      key,
      modelId,
      encoding,
      hit: false,
      reason,
      latencyMs: latencyMs ?? 0,
      tokenCount,
      metadata,
    });
  }

  /**
   * Get aggregate telemetry.
   */
  getTelemetry(): CacheTelemetry {
    const records = this.records;
    const total = records.length;

    if (total === 0) {
      return {
        totalRequests: 0,
        hits: 0,
        misses: 0,
        hitRate: 0,
        missesByReason: {},
        latencyPercentiles: { p50: 0, p95: 0, p99: 0, avg: 0 },
        operations: {},
        since: new Date().toISOString(),
      };
    }

    const hits = records.filter((r) => r.hit).length;
    const misses = total - hits;

    // Count misses by reason
    const missesByReason: Partial<Record<CacheMissReason, number>> = {};
    for (const record of records) {
      if (!record.hit) {
        missesByReason[record.reason] = (missesByReason[record.reason] ?? 0) + 1;
      }
    }

    // Calculate latency percentiles
    const latencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);
    const avg = latencies.reduce((a, b) => a + b, 0) / total;

    const percentile = (p: number): number => {
      const idx = Math.floor(total * p);
      return latencies[Math.min(idx, total - 1)];
    };

    // Operations breakdown
    const operations: CacheTelemetry['operations'] = {};
    for (const record of records) {
      if (!operations[record.operation]) {
        operations[record.operation] = { hits: 0, misses: 0 };
      }
      if (record.hit) {
        operations[record.operation]!.hits++;
      } else {
        operations[record.operation]!.misses++;
      }
    }

    const firstRecord = records.reduce((oldest, r) =>
      r.timestamp < oldest.timestamp ? r : oldest,
    );

    return {
      totalRequests: total,
      hits,
      misses,
      hitRate: (hits / total) * 100,
      missesByReason,
      latencyPercentiles: {
        p50: percentile(0.5),
        p95: percentile(0.95),
        p99: percentile(0.99),
        avg,
      },
      operations,
      since: firstRecord.timestamp,
    };
  }

  /**
   * Get records filtered by criteria.
   */
  getRecords(filter?: {
    operation?: CacheOperation;
    hit?: boolean;
    reason?: CacheMissReason;
    since?: Date;
    key?: string;
  }): CacheAccessRecord[] {
    return this.records.filter((record) => {
      if (filter?.operation && record.operation !== filter.operation) return false;
      if (filter?.hit !== undefined && record.hit !== filter.hit) return false;
      if (filter?.reason && record.reason !== filter.reason) return false;
      if (filter?.key && record.key !== filter.key) return false;
      if (filter?.since && new Date(record.timestamp) < filter.since) return false;
      return true;
    });
  }

  /**
   * Clear all records.
   */
  clear(): void {
    this.records = [];
  }

  /**
   * Get record count.
   */
  get size(): number {
    return this.records.length;
  }

  /**
   * Export records as JSON.
   */
  export(): CacheAccessRecord[] {
    return [...this.records];
  }

  /**
   * Persist records to disk.
   * Writes to a JSON file in the configured persist directory.
   */
  persist(): void {
    if (!this.persistToDisk) return;

    try {
      const dir = this.persistDir;
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = `${dir}/cache-diagnostics-${timestamp}.json`;

      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        recordCount: this.records.length,
        records: this.records,
      };

      writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (error) {
      console.warn('[CacheDiagnostics] Failed to persist records to disk:', error);
    }
  }

  /**
   * Load persisted records from disk.
   * Loads all JSON files from the persist directory.
   */
  loadPersisted(): CacheAccessRecord[] {
    if (!this.persistToDisk || !existsSync(this.persistDir)) {
      return [];
    }

    const loaded: CacheAccessRecord[] = [];

    try {
      const files = require('node:fs').readdirSync(this.persistDir);
      const jsonFiles = files.filter((f: string) => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const filePath = `${this.persistDir}/${file}`;
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);

        if (parsed.records && Array.isArray(parsed.records)) {
          loaded.push(...parsed.records);
        }
      }
    } catch (error) {
      console.warn('[CacheDiagnostics] Failed to load persisted records:', error);
    }

    return loaded;
  }

  /**
   * Get historical telemetry from persisted records.
   * Combines in-memory and persisted records for longitudinal analysis.
   */
  getHistoricalTelemetry(): CacheTelemetry {
    const persisted = this.loadPersisted();
    const allRecords = [...this.records, ...persisted];

    if (allRecords.length === 0) {
      return {
        totalRequests: 0,
        hits: 0,
        misses: 0,
        hitRate: 0,
        missesByReason: {},
        latencyPercentiles: { p50: 0, p95: 0, p99: 0, avg: 0 },
        operations: {},
        since: new Date().toISOString(),
      };
    }

    const hits = allRecords.filter((r) => r.hit).length;
    const misses = allRecords.length - hits;

    // Count misses by reason
    const missesByReason: Partial<Record<CacheMissReason, number>> = {};
    for (const record of allRecords) {
      if (!record.hit) {
        missesByReason[record.reason] = (missesByReason[record.reason] ?? 0) + 1;
      }
    }

    // Calculate latency percentiles
    const latencies = allRecords.map((r) => r.latencyMs).sort((a, b) => a - b);
    const total = allRecords.length;
    const avg = latencies.reduce((a, b) => a + b, 0) / total;

    const percentile = (p: number): number => {
      const idx = Math.floor(total * p);
      return latencies[Math.min(idx, total - 1)];
    };

    // Operations breakdown
    const operations: CacheTelemetry['operations'] = {};
    for (const record of allRecords) {
      if (!operations[record.operation]) {
        operations[record.operation] = { hits: 0, misses: 0 };
      }
      if (record.hit) {
        operations[record.operation]!.hits++;
      } else {
        operations[record.operation]!.misses++;
      }
    }

    const firstRecord = allRecords.reduce((oldest, r) =>
      r.timestamp < oldest.timestamp ? r : oldest,
    );

    return {
      totalRequests: total,
      hits,
      misses,
      hitRate: (hits / total) * 100,
      missesByReason,
      latencyPercentiles: {
        p50: percentile(0.5),
        p95: percentile(0.95),
        p99: percentile(0.99),
        avg,
      },
      operations,
      since: firstRecord.timestamp,
    };
  }

  /**
   * Get the persist directory path.
   */
  getPersistDir(): string {
    return this.persistDir;
  }

  /**
   * Check if persistence is enabled.
   */
  isPersistEnabled(): boolean {
    return this.persistToDisk;
  }
}

// ============================================================================
// Global singleton for easy access across the codebase
// ============================================================================

let globalDiagnostics: CacheDiagnostics | null = null;

/**
 * Get or create the global CacheDiagnostics instance.
 */
export function getGlobalDiagnostics(): CacheDiagnostics {
  if (!globalDiagnostics) {
    globalDiagnostics = new CacheDiagnostics();
  }
  return globalDiagnostics;
}

/**
 * Set a custom global diagnostics instance.
 */
export function setGlobalDiagnostics(diagnostics: CacheDiagnostics): void {
  globalDiagnostics = diagnostics;
}
