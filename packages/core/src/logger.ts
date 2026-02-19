// ============================================================================
// @contex-llm/core — Logging & Observability
// ============================================================================

import process from 'node:process';

/**
 * Log levels for Contex.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry structure.
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Callback for log events (used by middleware to hook into logging).
 */
export type LogCallback = (entry: LogEntry) => void;

/**
 * Global log callback registry.
 */
const callbacks: Set<LogCallback> = new Set();

/**
 * Current log level (controlled by CONTEX_DEBUG env var).
 */
let currentLevel: LogLevel = 'info';

/**
 * Initialize log level from environment.
 */
function initLevel(): void {
  const debug = process.env.CONTEX_DEBUG;
  if (debug === '1' || debug === 'true') {
    currentLevel = 'debug';
  } else if (debug === 'warn') {
    currentLevel = 'warn';
  } else if (debug === 'error') {
    currentLevel = 'error';
  } else {
    currentLevel = 'info';
  }
}

// Initialize on module load
initLevel();

/**
 * Check if a log level should be logged.
 */
function shouldLog(level: LogLevel): boolean {
  const levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };
  return levels[level] >= levels[currentLevel];
}

/**
 * Create a log entry and emit to callbacks.
 */
function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    data,
  };

  // Console output (structured for easy parsing)
  const prefix = '[Contex]';
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  const msg = `${prefix} ${message}${dataStr}`;

  switch (level) {
    case 'debug':
      console.debug(msg);
      break;
    case 'info':
      console.info(msg);
      break;
    case 'warn':
      console.warn(msg);
      break;
    case 'error':
      console.error(msg);
      break;
  }

  // Emit to callbacks
  for (const cb of callbacks) {
    try {
      cb(entry);
    } catch (e) {
      console.error('[Contex] Log callback error:', e);
    }
  }
}

/**
 * Debug-level logging (most verbose).
 * Only logs when CONTEX_DEBUG=1 is set.
 */
export function debug(message: string, data?: Record<string, unknown>): void {
  log('debug', message, data);
}

/**
 * Info-level logging (normal operation).
 */
export function info(message: string, data?: Record<string, unknown>): void {
  log('info', message, data);
}

/**
 * Warning-level logging (something unexpected but handled).
 */
export function warn(message: string, data?: Record<string, unknown>): void {
  log('warn', message, data);
}

/**
 * Error-level logging (something failed).
 */
export function error(message: string, data?: Record<string, unknown>): void {
  log('error', message, data);
}

// ---------------------------------------------------------------------------
// Performance Timing
// ---------------------------------------------------------------------------

/**
 * Performance timer for measuring operation duration.
 */
export class Timer {
  private startTime: number;
  private label: string;

  constructor(label: string) {
    this.label = label;
    this.startTime = performance.now();
  }

  /**
   * End the timer and log the result.
   */
  end(): number {
    const duration = performance.now() - this.startTime;
    debug(`${this.label}: ${duration.toFixed(2)}ms`, { durationMs: duration });
    return duration;
  }

  /**
   * End with custom data.
   */
  endWith(data: Record<string, unknown>): number {
    const duration = performance.now() - this.startTime;
    debug(`${this.label}: ${duration.toFixed(2)}ms`, { ...data, durationMs: duration });
    return duration;
  }
}

/**
 * Create a timer for measuring duration.
 */
export function timer(label: string): Timer {
  return new Timer(label);
}

// ---------------------------------------------------------------------------
// Event Callbacks
// ---------------------------------------------------------------------------

/**
 * Register a callback for log events.
 * Useful for middleware to track metrics.
 */
export function onLog(callback: LogCallback): () => void {
  callbacks.add(callback);
  return () => callbacks.delete(callback);
}

// ---------------------------------------------------------------------------
// Specific Log Events
// ---------------------------------------------------------------------------

/**
 * Log encoding performance.
 */
export function logEncode(dataLength: number, durationMs: number, hash: string): void {
  debug(`encodeIR: ${durationMs.toFixed(2)}ms for ${dataLength} rows`, {
    rows: dataLength,
    durationMs,
    hash: hash?.slice(0, 8),
  });
}

/**
 * Log materialization performance.
 */
export function logMaterialize(
  modelId: string,
  durationMs: number,
  tokenCount: number,
  cached: boolean,
): void {
  const level = cached ? 'info' : 'debug';
  log(level, `materialize: ${durationMs.toFixed(2)}ms for ${modelId} (${tokenCount} tokens)`, {
    model: modelId,
    durationMs,
    tokens: tokenCount,
    cached,
  });
}

/**
 * Log cache hit/miss.
 */
export function logCacheHit(hash: string, modelId: string): void {
  info(`cache HIT for ${hash.slice(0, 8)} (${modelId})`, {
    hash: hash.slice(0, 8),
    model: modelId,
  });
}

/**
 * Log cache miss.
 */
export function logCacheMiss(hash: string, modelId: string): void {
  debug(`cache MISS for ${hash.slice(0, 8)} (${modelId})`, {
    hash: hash.slice(0, 8),
    model: modelId,
  });
}

/**
 * Log injection details.
 */
export function logInject(collection: string, tokenCount: number): void {
  info(`Injected ${tokenCount} tokens for ${collection}`, {
    collection,
    tokens: tokenCount,
  });
}

/**
 * Log token savings.
 */
export function logSavings(
  modelId: string,
  originalTokens: number,
  optimizedTokens: number,
  savingsPercent: number,
): void {
  info(
    `Token savings for ${modelId}: ${savingsPercent}% (${originalTokens} → ${optimizedTokens})`,
    {
      model: modelId,
      originalTokens,
      optimizedTokens,
      savingsPercent,
    },
  );
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Set the log level programmatically.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Get the current log level.
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnabled(): boolean {
  return currentLevel === 'debug';
}
