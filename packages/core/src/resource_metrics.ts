// ============================================================================
// @contex-llm/core — Resource Metrics & Client-Side Compilation Profiler
// ============================================================================
//
// Tracks CPU time, memory usage, throughput, and resource efficiency during
// every stage of the Contex pipeline: canonicalize → encode → hash → materialize.
//
// Two modes:
//   1. Inline profiling — wrap any function with `profileSync()` / `profileAsync()`
//   2. Pipeline profiling — use `PipelineProfiler` to track multi-stage pipelines
//
// All metrics are serializable to JSON for CI artifacts, dashboards, and reports.
// ============================================================================

/** A single captured metric from a profiled operation. */
export interface ResourceSnapshot {
  /** Operation label (e.g. "canonicalize", "encode", "hash") */
  label: string;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** CPU user-mode time in microseconds (Node.js only, 0 in browser) */
  cpuUserUs: number;
  /** CPU system-mode time in microseconds (Node.js only, 0 in browser) */
  cpuSystemUs: number;
  /** Heap memory used at start (bytes) */
  heapUsedStart: number;
  /** Heap memory used at end (bytes) */
  heapUsedEnd: number;
  /** Heap memory delta (bytes, positive = allocated) */
  heapDelta: number;
  /** Input size in bytes (if applicable) */
  inputBytes: number;
  /** Output size in bytes (if applicable) */
  outputBytes: number;
  /** Throughput: input bytes per second */
  throughputBytesPerSec: number;
  /** Rows processed (if applicable) */
  rowCount: number;
  /** Rows per second */
  rowsPerSec: number;
  /** Timestamp (ISO string) */
  timestamp: string;
}

/** Aggregate resource report across an entire pipeline run. */
export interface PipelineReport {
  /** All stage snapshots in execution order */
  stages: ResourceSnapshot[];
  /** Total wall-clock time across all stages (ms) */
  totalDurationMs: number;
  /** Total CPU user time (us) */
  totalCpuUserUs: number;
  /** Total CPU system time (us) */
  totalCpuSystemUs: number;
  /** Peak heap delta across stages (bytes) */
  peakHeapDelta: number;
  /** Input bytes for first stage */
  inputBytes: number;
  /** Output bytes for last stage */
  outputBytes: number;
  /** Overall compression ratio (output / input) */
  compressionRatio: number;
  /** Overall throughput (input bytes / total time) */
  overallThroughputBytesPerSec: number;
  /** Resource efficiency score (0–100) */
  efficiencyScore: number;
  /** Human-readable efficiency grade */
  efficiencyGrade: 'excellent' | 'good' | 'fair' | 'poor';
  /** Timestamp */
  timestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Safe access to process.cpuUsage (Node.js only). */
function getCpuUsage(): { user: number; system: number } {
  if (typeof process !== 'undefined' && typeof process.cpuUsage === 'function') {
    return process.cpuUsage();
  }
  return { user: 0, system: 0 };
}

/** Safe access to process.memoryUsage (Node.js only). */
function getHeapUsed(): number {
  if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
    return process.memoryUsage().heapUsed;
  }
  // Browser fallback: performance.memory (Chrome only)
  if (typeof performance !== 'undefined' && (performance as unknown as Record<string, unknown>).memory) {
    return ((performance as unknown as Record<string, unknown>).memory as { usedJSHeapSize: number }).usedJSHeapSize;
  }
  return 0;
}

function byteSize(val: unknown): number {
  if (val instanceof Uint8Array) return val.byteLength;
  if (typeof val === 'string') return new TextEncoder().encode(val).length;
  if (Array.isArray(val)) return new TextEncoder().encode(JSON.stringify(val)).length;
  if (val && typeof val === 'object') return new TextEncoder().encode(JSON.stringify(val)).length;
  return 0;
}

// ── Inline Profiling ────────────────────────────────────────────────────────

/**
 * Profile a synchronous function and return its result + resource snapshot.
 *
 * @param label - Operation name for the snapshot
 * @param fn - The function to profile
 * @param opts - Optional size hints
 * @returns `{ result, snapshot }` — the original return value + metrics
 *
 * @example
 * ```ts
 * const { result, snapshot } = profileSync('encode', () => encoder.encode(data), {
 *   inputBytes: JSON.stringify(data).length,
 *   rowCount: data.length,
 * });
 * console.log(snapshot.durationMs, snapshot.throughputBytesPerSec);
 * ```
 */
export function profileSync<T>(
  label: string,
  fn: () => T,
  opts: { inputBytes?: number; rowCount?: number } = {},
): { result: T; snapshot: ResourceSnapshot } {
  const cpuStart = getCpuUsage();
  const heapStart = getHeapUsed();
  const wallStart = performance.now();

  const result = fn();

  const wallEnd = performance.now();
  const heapEnd = getHeapUsed();
  const cpuEnd = getCpuUsage();

  const durationMs = wallEnd - wallStart;
  const inputBytes = opts.inputBytes ?? byteSize(result);
  const outputBytes = byteSize(result);
  const rowCount = opts.rowCount ?? 0;

  const snapshot: ResourceSnapshot = {
    label,
    durationMs,
    cpuUserUs: cpuEnd.user - cpuStart.user,
    cpuSystemUs: cpuEnd.system - cpuStart.system,
    heapUsedStart: heapStart,
    heapUsedEnd: heapEnd,
    heapDelta: heapEnd - heapStart,
    inputBytes,
    outputBytes,
    throughputBytesPerSec: durationMs > 0 ? (inputBytes / durationMs) * 1000 : 0,
    rowCount,
    rowsPerSec: durationMs > 0 ? (rowCount / durationMs) * 1000 : 0,
    timestamp: new Date().toISOString(),
  };

  return { result, snapshot };
}

/**
 * Profile an async function and return its result + resource snapshot.
 */
export async function profileAsync<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { inputBytes?: number; rowCount?: number } = {},
): Promise<{ result: T; snapshot: ResourceSnapshot }> {
  const cpuStart = getCpuUsage();
  const heapStart = getHeapUsed();
  const wallStart = performance.now();

  const result = await fn();

  const wallEnd = performance.now();
  const heapEnd = getHeapUsed();
  const cpuEnd = getCpuUsage();

  const durationMs = wallEnd - wallStart;
  const inputBytes = opts.inputBytes ?? byteSize(result);
  const outputBytes = byteSize(result);
  const rowCount = opts.rowCount ?? 0;

  const snapshot: ResourceSnapshot = {
    label,
    durationMs,
    cpuUserUs: cpuEnd.user - cpuStart.user,
    cpuSystemUs: cpuEnd.system - cpuStart.system,
    heapUsedStart: heapStart,
    heapUsedEnd: heapEnd,
    heapDelta: heapEnd - heapStart,
    inputBytes,
    outputBytes,
    throughputBytesPerSec: durationMs > 0 ? (inputBytes / durationMs) * 1000 : 0,
    rowCount,
    rowsPerSec: durationMs > 0 ? (rowCount / durationMs) * 1000 : 0,
    timestamp: new Date().toISOString(),
  };

  return { result, snapshot };
}

// ── Pipeline Profiler ───────────────────────────────────────────────────────

/**
 * Multi-stage pipeline profiler.
 *
 * Tracks resource usage across canonicalize → encode → hash → materialize
 * and produces a summary report with efficiency scoring.
 *
 * @example
 * ```ts
 * const profiler = new PipelineProfiler();
 *
 * const canonical = profiler.stage('canonicalize', () => canonicalize(data), {
 *   inputBytes: JSON.stringify(data).length,
 *   rowCount: data.length,
 * });
 *
 * const binary = profiler.stage('encode', () => encoder.encode(canonical));
 * const hash = profiler.stage('hash', () => computeHash(binary));
 *
 * const report = profiler.report();
 * console.log(report.efficiencyScore, report.efficiencyGrade);
 * ```
 */
export class PipelineProfiler {
  private stages: ResourceSnapshot[] = [];

  /**
   * Profile a synchronous pipeline stage.
   */
  stage<T>(label: string, fn: () => T, opts: { inputBytes?: number; rowCount?: number } = {}): T {
    const { result, snapshot } = profileSync(label, fn, opts);
    this.stages.push(snapshot);
    return result;
  }

  /**
   * Profile an async pipeline stage.
   */
  async stageAsync<T>(
    label: string,
    fn: () => Promise<T>,
    opts: { inputBytes?: number; rowCount?: number } = {},
  ): Promise<T> {
    const { result, snapshot } = await profileAsync(label, fn, opts);
    this.stages.push(snapshot);
    return result;
  }

  /**
   * Generate the final resource report.
   */
  report(): PipelineReport {
    const totalDurationMs = this.stages.reduce((s, st) => s + st.durationMs, 0);
    const totalCpuUserUs = this.stages.reduce((s, st) => s + st.cpuUserUs, 0);
    const totalCpuSystemUs = this.stages.reduce((s, st) => s + st.cpuSystemUs, 0);
    const peakHeapDelta = Math.max(0, ...this.stages.map((s) => s.heapDelta));

    const inputBytes = this.stages.length > 0 ? this.stages[0].inputBytes : 0;
    const outputBytes = this.stages.length > 0 ? this.stages[this.stages.length - 1].outputBytes : 0;
    const compressionRatio = inputBytes > 0 ? outputBytes / inputBytes : 1;

    const overallThroughputBytesPerSec =
      totalDurationMs > 0 ? (inputBytes / totalDurationMs) * 1000 : 0;

    // Efficiency scoring:
    //   - 30% throughput (> 10 MB/s = 30pts)
    //   - 30% compression (< 0.4 ratio = 30pts)
    //   - 20% CPU efficiency (< 100ms total = 20pts)
    //   - 20% memory efficiency (< 10MB heap delta = 20pts)
    let score = 0;

    // Throughput score (0–30)
    const mbPerSec = overallThroughputBytesPerSec / (1024 * 1024);
    score += Math.min(30, (mbPerSec / 10) * 30);

    // Compression score (0–30)
    score += Math.min(30, ((1 - compressionRatio) / 0.6) * 30);

    // CPU score (0–20)
    score += Math.min(20, totalDurationMs < 1 ? 20 : (100 / totalDurationMs) * 20);

    // Memory score (0–20)
    const heapDeltaMB = peakHeapDelta / (1024 * 1024);
    score += Math.min(20, heapDeltaMB < 0.1 ? 20 : (10 / heapDeltaMB) * 20);

    score = Math.max(0, Math.min(100, Math.round(score)));

    let efficiencyGrade: PipelineReport['efficiencyGrade'];
    if (score >= 85) efficiencyGrade = 'excellent';
    else if (score >= 65) efficiencyGrade = 'good';
    else if (score >= 40) efficiencyGrade = 'fair';
    else efficiencyGrade = 'poor';

    return {
      stages: [...this.stages],
      totalDurationMs,
      totalCpuUserUs,
      totalCpuSystemUs,
      peakHeapDelta,
      inputBytes,
      outputBytes,
      compressionRatio,
      overallThroughputBytesPerSec,
      efficiencyScore: score,
      efficiencyGrade,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reset the profiler for a new pipeline run.
   */
  reset() {
    this.stages = [];
  }
}

// ── Formatting Helpers (for CLI display) ────────────────────────────────────

/** Options for format functions to control Unicode/ASCII output. */
export interface FormatOptions {
  /** If true, use pure ASCII characters instead of Unicode box-drawing/emoji. */
  ascii?: boolean;
}

/**
 * Format a ResourceSnapshot as human-readable text lines.
 */
export function formatSnapshot(s: ResourceSnapshot, opts: FormatOptions = {}): string[] {
  const lines: string[] = [];
  const up = opts.ascii ? '^' : '\u2191';
  const down = opts.ascii ? 'v' : '\u2193';
  lines.push(`  ${s.label}`);
  lines.push(`    Duration:   ${s.durationMs.toFixed(2)} ms`);
  if (s.cpuUserUs > 0) {
    lines.push(`    CPU User:   ${(s.cpuUserUs / 1000).toFixed(2)} ms`);
    lines.push(`    CPU System: ${(s.cpuSystemUs / 1000).toFixed(2)} ms`);
  }
  if (s.heapDelta !== 0) {
    lines.push(`    Heap delta:  ${formatByteSize(Math.abs(s.heapDelta))} ${s.heapDelta >= 0 ? up : down}`);
  }
  if (s.inputBytes > 0) {
    lines.push(`    Input:      ${formatByteSize(s.inputBytes)}`);
  }
  if (s.outputBytes > 0) {
    lines.push(`    Output:     ${formatByteSize(s.outputBytes)}`);
  }
  if (s.throughputBytesPerSec > 0) {
    lines.push(`    Throughput: ${formatByteSize(s.throughputBytesPerSec)}/s`);
  }
  if (s.rowCount > 0) {
    lines.push(`    Rows:       ${s.rowCount} (${Math.round(s.rowsPerSec)}/s)`);
  }
  return lines;
}

/**
 * Format a PipelineReport as a beautiful table.
 * Pass `{ ascii: true }` for safe rendering on non-Unicode terminals.
 */
export function formatPipelineReport(report: PipelineReport, opts: FormatOptions = {}): string {
  const a = !!opts.ascii;
  const H  = a ? '-' : '\u2500'; // horizontal
  const V  = a ? '|' : '\u2502'; // vertical
  const TL = a ? '+' : '\u250c'; // top-left
  const TR = a ? '+' : '\u2510'; // top-right
  const ML = a ? '+' : '\u251c'; // mid-left
  const MR = a ? '+' : '\u2524'; // mid-right
  const BL = a ? '+' : '\u2514'; // bottom-left
  const BR = a ? '+' : '\u2518'; // bottom-right

  const gradeA: Record<string, string> = a
    ? { excellent: '[A+]', good: '[A]', fair: '[B]', poor: '[C]' }
    : { excellent: '\ud83d\udfe2', good: '\ud83d\udd35', fair: '\ud83d\udfe1', poor: '\ud83d\udd34' };

  const lines: string[] = [];
  const w = 64;
  const border = H.repeat(w);

  lines.push(`${TL}${border}${TR}`);
  lines.push(`${V}${'  Contex Pipeline Resource Report'.padEnd(w)}${V}`);
  lines.push(`${ML}${border}${MR}`);

  for (const stage of report.stages) {
    const stLines = formatSnapshot(stage, opts);
    for (const l of stLines) {
      lines.push(`${V}${l.padEnd(w)}${V}`);
    }
    lines.push(`${ML}${border}${MR}`);
  }

  // Summary
  const subLine = a ? '--------' : '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500';
  lines.push(`${V}${'  Summary'.padEnd(w)}${V}`);
  lines.push(`${V}${`  ${subLine}`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Total Duration:  ${report.totalDurationMs.toFixed(2)} ms`.padEnd(w)}${V}`);
  if (report.totalCpuUserUs > 0) {
    lines.push(`${V}${`  Total CPU User:  ${(report.totalCpuUserUs / 1000).toFixed(2)} ms`.padEnd(w)}${V}`);
    lines.push(`${V}${`  Total CPU Sys:   ${(report.totalCpuSystemUs / 1000).toFixed(2)} ms`.padEnd(w)}${V}`);
  }
  lines.push(`${V}${`  Peak Heap delta:  ${formatByteSize(report.peakHeapDelta)}`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Input:           ${formatByteSize(report.inputBytes)}`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Output:          ${formatByteSize(report.outputBytes)}`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Compression:     ${(report.compressionRatio * 100).toFixed(1)}%`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Throughput:      ${formatByteSize(report.overallThroughputBytesPerSec)}/s`.padEnd(w)}${V}`);
  lines.push(`${V}${`  Efficiency:      ${report.efficiencyScore}/100 (${report.efficiencyGrade.toUpperCase()})`.padEnd(w)}${V}`);

  const gradeIcon = gradeA[report.efficiencyGrade] ?? gradeA.poor;
  lines.push(`${V}${`  Grade:           ${gradeIcon} ${report.efficiencyGrade.toUpperCase()}`.padEnd(w)}${V}`);
  lines.push(`${BL}${border}${BR}`);

  return lines.join('\n');
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
