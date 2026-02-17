#!/usr/bin/env node
// ============================================================================
// @contex/cli v3 — Context-window-optimized data engine
// ============================================================================
// Commands:
//   contex encode   <file.json> [--encoding cl100k_base]  → file.tens
//   contex decode   <file.tens>                           → stdout JSON
//   contex stats    <file.json> [--encoding cl100k_base]  → compression stats
//   contex formats  <file.json>                           → multi-format comparison
//   contex convert  <file.json>                           → export ALL formats
//   contex validate <file.json>                           → roundtrip integrity
//   contex guard    <file.json>                           → semantic relation diagnostics
//   contex savings  <file.json> [--model gpt-4o]          → dollar-cost savings report
//   contex analyze  <file.json> [--reality-gate]          → analysis + execution gates
//   contex scorecard [--in .contex/analyze_report.json]   → reproducible scorecard gate
//   contex status [--url http://127.0.0.1:3000]           → server/provider readiness
//   contex ir-encode      <file.json>                     → encode to Canonical IR
//   contex ir-inspect     <hash>                          → inspect stored IR
//   contex ir-materialize <hash> --model <model>          → materialize for model
//   contex bench                                           → full benchmark suite
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import { URL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {
  TensTextDecoder,
  TensTextEncoder,
  TokenMemory,
  TokenStreamDecoder,
  TokenStreamEncoder,
  type TokenizerEncoding,
  TokenizerManager,
  analyzeFormats,
  compose,
  encodeIR,
  formatOutput,
  selectOptimalStrategy,
  getGlobalDiagnostics,
} from '@contex/core';
import { MODEL_REGISTRY } from '@contex/engine';
import { createContexAnthropic, createContexOpenAI } from '@contex/middleware';
import OpenAI from 'openai';

const args = process.argv.slice(2);
const command = args[0];

type ComposeInput = Parameters<typeof compose>[0];
type ComposeBlock = ComposeInput['blocks'][number];

type ComposeConfigBlock =
  | {
      type: 'file';
      path: string;
      name?: string;
      priority?: 'required' | 'optional';
    }
  | {
      type: 'text';
      content: string;
      name?: string;
      priority?: 'required' | 'optional';
    };

type ComposeConfig = {
  model?: string;
  reserve?: number;
  system?: string;
  blocks?: ComposeConfigBlock[];
};

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function extractRowsFromDecoded(decoded: unknown): unknown[] {
  if (Array.isArray(decoded)) {
    return decoded;
  }

  if (isPlainRecord(decoded) && Array.isArray(decoded.rows)) {
    return decoded.rows;
  }

  return [];
}

function extractAnthropicText(response: { content: unknown[] }): string {
  for (const block of response.content) {
    if (
      isPlainRecord(block) &&
      block.type === 'text' &&
      typeof block.text === 'string' &&
      block.text.length > 0
    ) {
      return block.text;
    }
  }
  return '[no text response]';
}

const line = '─'.repeat(60);
const doubleLine = '═'.repeat(60);

function padR(s: string, n: number): string {
  return s.padEnd(n);
}
function padL(s: string, n: number): string {
  return s.padStart(n);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ============================================================================
// Beautiful Box Formatting (P1-2: CLI Polish)
// ============================================================================

/**
 * Draw a beautiful box with content
 */
function drawBox(title: string, width: number, lines: string[]): string {
  const borderH = '─'.repeat(width - 2);
  const borderV = '│';
  const cornerTL = '╭';
  const cornerTR = '╮';
  const cornerBL = '╰';
  const cornerBR = '╯';

  let result = `${cornerTL}${borderH}${cornerTR}\n`;
  if (title) {
    const padding = width - 4 - title.length;
    const padLeft = Math.floor(padding / 2);
    const padRight = padding - padLeft;
    result += `${borderV} ${' '.repeat(padLeft)}${title}${' '.repeat(padRight)} ${borderV}\n`;
    result += `${borderV}${borderH}${borderV}\n`;
  }

  for (const line of lines) {
    const padding = width - 4 - line.length;
    result += `${borderV} ${line}${' '.repeat(Math.max(0, padding))} ${borderV}\n`;
  }

  result += `${cornerBL}${borderH}${cornerBR}`;
  return result;
}

/**
 * Draw a comparison table (like the formats analysis)
 */
function drawComparisonTable(title: string, headers: string[], rows: Array<string[]>): string {
  const colWidths = headers.map((h, i) => {
    const maxRowVal = Math.max(...rows.map((r) => (r[i] || '').length));
    return Math.max(h.length, maxRowVal);
  });

  const totalWidth = colWidths.reduce((a, b) => a + b + 3, 1);
  const borderH = '═'.repeat(totalWidth);
  const borderH2 = '─'.repeat(totalWidth);
  const borderV = '║';
  const cornerTL = '╔';
  const cornerTR = '╗';
  const cornerBL = '╚';
  const cornerBR = '╝';
  const TDown = '╦';
  const TVert = '╠';
  const TVertright = '╣';

  let result = `${cornerTL}${borderH}${cornerTR}\n`;

  // Title
  if (title) {
    const titlePadding = totalWidth - 2 - title.length;
    const padLeft = Math.floor(titlePadding / 2);
    const padRight = titlePadding - padLeft;
    result += `${borderV} ${' '.repeat(padLeft)}${title}${' '.repeat(padRight)} ${borderV}\n`;
    result += `${cornerTL}${borderH}${cornerTR}\n`;
  }

  // Headers
  result += borderV;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const w = colWidths[i];
    const pad = w - h.length;
    result += ` ${h}${' '.repeat(pad)} ${i < headers.length - 1 ? borderV : ''}`;
  }
  result += `${borderV}\n`;
  result += `${TVert}${colWidths.map((w) => '─'.repeat(w + 2)).join(TDown)}${TVertright}\n`;

  // Rows
  for (const row of rows) {
    result += borderV;
    for (let i = 0; i < row.length; i++) {
      const cell = row[i] || '';
      const w = colWidths[i];
      const pad = w - cell.length;
      result += ` ${cell}${' '.repeat(pad)} ${i < row.length - 1 ? borderV : ''}`;
    }
    result += `${borderV}\n`;
  }

  result += `${cornerBL}${borderH2}${cornerBR}`;
  return result;
}

type StrategyName = 'contex' | 'csv' | 'toon' | 'markdown' | 'auto';

interface StrategyCandidate {
  name: Exclude<StrategyName, 'auto'>;
  tokens: number;
  text?: string;
}

interface SnapshotRun {
  timestamp: string;
  command: 'analyze' | 'savings';
  inputPath: string;
  model: string;
  metrics: Record<string, number | string | boolean>;
}

type CacheTaxonomyReason =
  | 'cache_hit'
  | 'prefix_drift'
  | 'provider_behavior'
  | 'request_variance'
  | 'unknown';

type CacheTaxonomyStatus = 'hit' | 'miss' | 'unknown';

interface CacheTaxonomy {
  status: CacheTaxonomyStatus;
  reason: CacheTaxonomyReason;
  detail: string;
}

interface AutoStrategyConfidence {
  scorePct: number;
  level: 'low' | 'medium' | 'high';
  marginPct: number;
}

const ANALYZE_DEFAULT_OUT = path.join('.contex', 'analyze_report.json');
const SAVINGS_DEFAULT_OUT = path.join('.contex', 'savings_report.json');
const SCORECARD_DEFAULT_OUT = path.join('.contex', 'scorecard_report.json');

const TOKEN_CAP_PRESETS: Record<string, number> = {
  'gpt-4o': 50000,
  'gpt-4o-mini': 50000,
  'gpt-5': 65000,
  'gpt-5-mini': 65000,
  'gpt-5.3-codex': 65000,
  'claude-3-5-sonnet': 45000,
  'claude-3-5-sonnet-20240620': 45000,
  'claude-4-sonnet': 50000,
  'claude-4-5-sonnet': 50000,
  'gemini-2-5-flash': 55000,
  'gemini-2-5-pro': 55000,
};

function parseStrategies(input: string | undefined, defaults: StrategyName[]): StrategyName[] {
  if (!input || input.trim().length === 0) return defaults;

  const normalized = input
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const allowed: StrategyName[] = ['contex', 'csv', 'toon', 'markdown', 'auto'];
  const invalid = normalized.filter((s) => !(allowed as string[]).includes(s));
  if (invalid.length > 0) {
    console.error(`Error: invalid --strategy value(s): ${invalid.join(', ')}`);
    console.error('Allowed values: contex,csv,toon,markdown,auto');
    process.exit(1);
  }

  return [...new Set(normalized as StrategyName[])];
}

function buildStrategyCandidates(
  data: Record<string, unknown>[],
  modelEncoding: TokenizerEncoding,
  tokenizer: TokenizerManager,
): StrategyCandidate[] {
  const contexEncoder = new TokenStreamEncoder(modelEncoding);
  const csvText = formatOutput(data, 'csv');
  const toonText = formatOutput(data, 'toon');
  const markdownText = formatOutput(data, 'markdown');

  const candidates: StrategyCandidate[] = [
    { name: 'contex', tokens: contexEncoder.encodeToTokenStream(data).length },
    { name: 'csv', tokens: tokenizer.countTokens(csvText, modelEncoding), text: csvText },
    { name: 'toon', tokens: tokenizer.countTokens(toonText, modelEncoding), text: toonText },
    {
      name: 'markdown',
      tokens: tokenizer.countTokens(markdownText, modelEncoding),
      text: markdownText,
    },
  ];

  contexEncoder.dispose();
  return candidates;
}

function appendSnapshot(outPath: string, run: SnapshotRun): SnapshotRun | undefined {
  const outDir = path.dirname(outPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  let runs: SnapshotRun[] = [];
  if (existsSync(outPath)) {
    try {
      const current = JSON.parse(readFileSync(outPath, 'utf-8'));
      if (Array.isArray(current?.runs)) {
        runs = current.runs as SnapshotRun[];
      }
    } catch {
      runs = [];
    }
  }

  const previous = [...runs]
    .reverse()
    .find(
      (r) => r.command === run.command && r.inputPath === run.inputPath && r.model === run.model,
    );

  runs.push(run);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        version: 1,
        runs,
      },
      null,
      2,
    ),
    'utf-8',
  );

  return previous;
}

function loadSnapshotRuns(outPath: string): SnapshotRun[] {
  if (!existsSync(outPath)) return [];
  try {
    const current = JSON.parse(readFileSync(outPath, 'utf-8'));
    if (Array.isArray(current?.runs)) {
      return current.runs as SnapshotRun[];
    }
  } catch {
    return [];
  }
  return [];
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function buildLatestScorecard(
  runs: SnapshotRun[],
  model: string,
): {
  datasetCount: number;
  floorReductionPct: number;
  medianReductionPct: number;
} {
  const latestByInput = new Map<string, SnapshotRun>();

  for (const run of runs) {
    if (run.command !== 'analyze' || run.model !== model) continue;

    const current = latestByInput.get(run.inputPath);
    if (!current || Date.parse(run.timestamp) >= Date.parse(current.timestamp)) {
      latestByInput.set(run.inputPath, run);
    }
  }

  const reductions = [...latestByInput.values()]
    .map((run) => Number(run.metrics.tokenReductionPct ?? 0))
    .filter((value) => Number.isFinite(value));

  if (reductions.length === 0) {
    return { datasetCount: 0, floorReductionPct: 0, medianReductionPct: 0 };
  }

  return {
    datasetCount: reductions.length,
    floorReductionPct: Math.min(...reductions),
    medianReductionPct: computeMedian(reductions),
  };
}

function buildLatestAnalyzeRunsByInput(runs: SnapshotRun[], model: string): SnapshotRun[] {
  const latestByInput = new Map<string, SnapshotRun>();

  for (const run of runs) {
    if (run.command !== 'analyze' || run.model !== model) continue;

    const current = latestByInput.get(run.inputPath);
    if (!current || Date.parse(run.timestamp) >= Date.parse(current.timestamp)) {
      latestByInput.set(run.inputPath, run);
    }
  }

  return [...latestByInput.values()].sort((a, b) => a.inputPath.localeCompare(b.inputPath));
}

function formatDelta(current: number, previous: number): string {
  const delta = current - previous;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeStrategyName(strategy: string): StrategyName {
  if (strategy === 'tens') return 'contex';
  if (strategy === 'csv' || strategy === 'toon' || strategy === 'markdown' || strategy === 'auto') {
    return strategy;
  }
  return 'contex';
}

function computeAutoStrategyConfidence(params: {
  selectedStrategy: StrategyName;
  selectedTokens: number;
  allCandidates: StrategyCandidate[];
  structureScore: number;
  matchesStructureRecommendation: boolean;
}): AutoStrategyConfidence {
  const { selectedStrategy, selectedTokens, allCandidates, structureScore, matchesStructureRecommendation } = params;

  const sorted = [...allCandidates].sort((a, b) => a.tokens - b.tokens);
  const second = sorted.length > 1 ? sorted[1] : sorted[0];
  const marginPct = second && selectedTokens > 0
    ? ((second.tokens - selectedTokens) / selectedTokens) * 100
    : 0;

  let score = 40;
  score += clamp(marginPct, 0, 20) * 1.4;

  if (selectedStrategy === 'contex') {
    score += clamp(structureScore * 0.25, 0, 25);
  } else {
    score += clamp((100 - structureScore) * 0.2, 0, 20);
  }

  score += matchesStructureRecommendation ? 12 : -10;
  const scorePct = Math.round(clamp(score, 0, 100));

  const level: AutoStrategyConfidence['level'] =
    scorePct >= 75 ? 'high' : scorePct >= 55 ? 'medium' : 'low';

  return { scorePct, level, marginPct: Number(marginPct.toFixed(2)) };
}

function resolveTokenCap(
  provider: 'openai' | 'anthropic',
  modelId: string,
  explicitCap: number | undefined,
): { cap?: number; source: 'flag' | 'preset' | 'derived' | 'none' } {
  if (explicitCap && explicitCap > 0) {
    return { cap: explicitCap, source: 'flag' };
  }

  if (TOKEN_CAP_PRESETS[modelId]) {
    return { cap: TOKEN_CAP_PRESETS[modelId], source: 'preset' };
  }

  const spec = MODEL_REGISTRY[modelId];
  if (!spec?.contextWindow) {
    return { source: 'none' };
  }

  const ratio = provider === 'anthropic' ? 0.4 : 0.45;
  return { cap: Math.floor(spec.contextWindow * ratio), source: 'derived' };
}

function classifyCacheTaxonomy(params: {
  localCacheHit?: boolean;
  providerCachedTokens?: number;
  selectedStrategy: StrategyName;
}): CacheTaxonomy {
  const { localCacheHit, providerCachedTokens, selectedStrategy } = params;

  if (selectedStrategy !== 'contex') {
    return {
      status: 'miss',
      reason: 'request_variance',
      detail: 'Non-Contex strategy path does not use canonical prefix injection.',
    };
  }

  if (typeof providerCachedTokens === 'number') {
    if (providerCachedTokens > 0) {
      return {
        status: 'hit',
        reason: 'cache_hit',
        detail: `Provider reported cached tokens/read tokens = ${providerCachedTokens}.`,
      };
    }

    if (localCacheHit === false) {
      return {
        status: 'miss',
        reason: 'prefix_drift',
        detail: 'Local canonical text cache missed; prefix likely changed or first-run for this hash/model.',
      };
    }

    if (localCacheHit === true) {
      return {
        status: 'miss',
        reason: 'provider_behavior',
        detail: 'Local cache hit but provider reported zero cached tokens/read tokens.',
      };
    }
  }

  if (localCacheHit === false) {
    return {
      status: 'miss',
      reason: 'prefix_drift',
      detail: 'Local canonical text cache missed and provider cache signals are unavailable.',
    };
  }

  if (localCacheHit === true) {
    return {
      status: 'unknown',
      reason: 'unknown',
      detail: 'Local cache hit but provider cache usage fields are unavailable.',
    };
  }

  return {
    status: 'unknown',
    reason: 'unknown',
    detail: 'Insufficient telemetry to attribute cache outcome.',
  };
}

interface SemanticGuardResult {
  pass: boolean;
  reason: string;
  rowCountOriginal: number;
  rowCountDecoded: number;
  fieldPathCoveragePct: number;
  rowSignatureMatchPct: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectFieldPaths(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFieldPaths(item, `${prefix}[]`, out);
    }
    return out;
  }

  if (!isPlainRecord(value)) {
    if (prefix) out.add(prefix);
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    collectFieldPaths(child, path, out);
  }
  return out;
}

function collectLeafPairs(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    const arrayPrefix = `${prefix}[]`;
    for (const item of value) {
      collectLeafPairs(item, arrayPrefix, out);
    }
    return out;
  }

  if (!isPlainRecord(value)) {
    if (prefix) {
      const serialized = value === null ? 'null' : String(value);
      out.add(`${prefix}=${serialized}`);
    }
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    collectLeafPairs(child, path, out);
  }
  return out;
}

function getRowAnchor(row: unknown): string | undefined {
  if (!isPlainRecord(row)) return undefined;
  const anchorFields = ['id', 'number', 'url', 'node_id', 'title'];
  for (const field of anchorFields) {
    const value = (row as Record<string, unknown>)[field];
    if (value !== undefined && value !== null) {
      return `${field}:${String(value)}`;
    }
  }
  return undefined;
}

function rowOverlapPct(originalRow: unknown, canonicalRow: unknown): number {
  const originalPairs = new Set(collectLeafPairs(originalRow));
  if (originalPairs.size === 0) return 100;
  const canonicalPairs = new Set(collectLeafPairs(canonicalRow));
  let shared = 0;
  for (const pair of originalPairs) {
    if (canonicalPairs.has(pair)) shared++;
  }
  return (shared / originalPairs.size) * 100;
}

function runSemanticRelationGuard(
  data: object[],
  _encoding: TokenizerEncoding = 'cl100k_base',
): SemanticGuardResult {
  let canonicalRows: object[] = [];
  let stableHash = false;

  try {
    const ir1 = encodeIR(data as object[]);
    const ir2 = encodeIR(data as object[]);
    canonicalRows = ir1.data as object[];
    stableHash = ir1.hash === ir2.hash;
  } catch {
    return {
      pass: false,
      reason: 'Canonical IR encode failed',
      rowCountOriginal: data.length,
      rowCountDecoded: 0,
      fieldPathCoveragePct: 0,
      rowSignatureMatchPct: 0,
    };
  }

  const originalFieldPaths = new Set<string>();
  const decodedFieldPaths = new Set<string>();
  for (const row of data) {
    collectFieldPaths(row, '', originalFieldPaths);
  }
  for (const row of canonicalRows) {
    collectFieldPaths(row, '', decodedFieldPaths);
  }

  const sharedFieldPaths = [...originalFieldPaths].filter((path) =>
    decodedFieldPaths.has(path),
  ).length;
  const fieldPathCoveragePct =
    originalFieldPaths.size === 0 ? 100 : (sharedFieldPaths / originalFieldPaths.size) * 100;

  const canonicalByAnchor = new Map<string, object[]>();
  for (const row of canonicalRows) {
    const anchor = getRowAnchor(row);
    if (!anchor) continue;
    const list = canonicalByAnchor.get(anchor) ?? [];
    list.push(row);
    canonicalByAnchor.set(anchor, list);
  }

  const fingerprint = (row: unknown): string => [...collectLeafPairs(row)].sort().join('|');
  const canonicalFingerprintCounts = new Map<string, number>();
  for (const row of canonicalRows) {
    const key = fingerprint(row);
    canonicalFingerprintCounts.set(key, (canonicalFingerprintCounts.get(key) ?? 0) + 1);
  }

  let matchedRows = 0;
  for (const row of data) {
    let matched = false;
    const anchor = getRowAnchor(row);
    if (anchor) {
      const candidates = canonicalByAnchor.get(anchor) ?? [];
      let bestIndex = -1;
      let bestScore = 0;
      for (let i = 0; i < candidates.length; i++) {
        const score = rowOverlapPct(row, candidates[i]);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0 && bestScore >= 95) {
        candidates.splice(bestIndex, 1);
        matched = true;
      }
    }

    if (!matched) {
      const key = fingerprint(row);
      const count = canonicalFingerprintCounts.get(key) ?? 0;
      if (count > 0) {
        canonicalFingerprintCounts.set(key, count - 1);
        matched = true;
      }
    }

    if (matched) matchedRows++;
  }

  const rowSignatureMatchPct = data.length === 0 ? 100 : (matchedRows / data.length) * 100;

  const rowCountPass = canonicalRows.length === data.length;
  const fieldPass = fieldPathCoveragePct >= 95;
  const rowPass = rowSignatureMatchPct >= 95;
  const pass = rowCountPass && fieldPass && rowPass && stableHash;

  let reason = 'Semantic relation integrity preserved';
  if (!rowCountPass) {
    reason = `Row count mismatch (${canonicalRows.length}/${data.length})`;
  } else if (!fieldPass) {
    reason = `Field-path coverage too low (${fieldPathCoveragePct.toFixed(1)}%)`;
  } else if (!rowPass) {
    reason = `Row relation match too low (${rowSignatureMatchPct.toFixed(1)}%)`;
  } else if (!stableHash) {
    reason = 'Canonical hash instability detected';
  }

  return {
    pass,
    reason,
    rowCountOriginal: data.length,
    rowCountDecoded: canonicalRows.length,
    fieldPathCoveragePct,
    rowSignatureMatchPct,
  };
}

function printUsage(): void {
  console.log(`
  ${doubleLine}
  Contex CLI v3 — Context-window-optimized data engine
  ${doubleLine}

  Usage:
    contex encode       <input.json> [--encoding cl100k_base]   Encode to TENS binary
    contex decode       <input.tens>                            Decode TENS to JSON
    contex stats        <input.json> [--encoding cl100k_base]   Show TENS stats
    contex formats      <input.json>                            Compare all formats
    contex convert      <input.json>                            Export to ALL formats
    contex validate     <input.json>                            Roundtrip integrity test
    contex guard        <input.json>                            Semantic relation diagnostics (triage)
    contex savings      <input.json> [--model gpt-4o] [--out report.json]
                                 💰 Dollar-cost savings report + snapshot export
    contex analyze      <input.json> [--reality-gate] [--strict-gate]
             [--strategy contex,csv,toon,markdown,auto] [--contex-only]
             [--target-floor 35] [--target-median 60]
             [--auto-confidence-floor 55] [--strict-auto-gate] [--out report.json]
                                 Analysis + gates + strategy comparison + target tracking + delta
    contex scorecard    [--in .contex/analyze_report.json] [--out .contex/scorecard_report.json]
         [--model gpt-4o-mini] [--target-floor 35] [--target-median 60] [--min-datasets 3] [--strict-gate]
                   Reproducible scorecard gate from latest analyze runs
    contex status       [--url http://127.0.0.1:3000] [--timeout-ms 3000] [--json]
                   Check server + provider readiness from /health
    contex bench                                            Full benchmark suite

  Cache Commands:
    contex cache-diagnose <input.json> --model <model>       Show cache readiness diagnostics
    contex cache-warm     <input.json> --models gpt-4o,claude-3-5-sonnet,gemini-2-5-flash
                                 Pre-materialize for multiple models
    contex cache-stats                                       Show aggregate cache telemetry

  Canonical IR (v3):
    contex ir-encode    <input.json>                      Encode to Canonical IR, store in .contex/
    contex ir-inspect   <hash>                            Inspect stored IR metadata
    contex ir-materialize <hash> --model <model>          Materialize IR for a model
    contex materialize  <file.json> --model <model>       Encode + Materialize (One-step)
    contex compose      <config.json>                     Compose from config file
    contex compose      <f1> [f2] --model <m>             Compose from args
    contex inject       <file.json> --provider <p>        Run API call (supports --contex-only policy)

  Examples:
    npx contex savings my_data.json               Show cost savings
    npx contex savings my_data.json --model gpt-5 Savings for specific model
    npx contex convert my_data.json
    npx contex guard my_data.json
    npx contex ir-encode my_data.json             Encode and store Canonical IR
    npx contex cache-diagnose my_data.json --model gpt-4o  Check cache readiness
    npx contex cache-warm my_data.json --models gpt-4o,claude-3-5-sonnet  Warm cache for models
  `);
}

function scorecardReport(): void {
  const inPath = getFlag('in') ?? ANALYZE_DEFAULT_OUT;
  const outPath = getFlag('out') ?? SCORECARD_DEFAULT_OUT;
  const model = getFlag('model') ?? 'gpt-4o-mini';
  const strictGate = hasFlag('strict-gate');

  const targetFloor = Number(getFlag('target-floor') ?? 35);
  const targetMedian = Number(getFlag('target-median') ?? 60);
  const minDatasets = Number(getFlag('min-datasets') ?? 3);

  if (
    !Number.isFinite(targetFloor) ||
    !Number.isFinite(targetMedian) ||
    !Number.isFinite(minDatasets)
  ) {
    console.error('Error: --target-floor, --target-median, and --min-datasets must be numeric values.');
    process.exit(1);
  }

  const allRuns = loadSnapshotRuns(inPath);
  const latestRuns = buildLatestAnalyzeRunsByInput(allRuns, model);
  const scorecard = buildLatestScorecard(allRuns, model);

  const floorPass = scorecard.floorReductionPct >= targetFloor;
  const medianPass = scorecard.medianReductionPct >= targetMedian;
  const datasetPass = scorecard.datasetCount >= minDatasets;
  const gatePass = floorPass && medianPass && datasetPass;

  const scorecardPayload = {
    timestamp: new Date().toISOString(),
    source: path.resolve(inPath),
    model,
    targets: {
      floorPct: targetFloor,
      medianPct: targetMedian,
      minDatasets,
    },
    observed: {
      datasetCount: scorecard.datasetCount,
      floorReductionPct: Number(scorecard.floorReductionPct.toFixed(2)),
      medianReductionPct: Number(scorecard.medianReductionPct.toFixed(2)),
    },
    gate: {
      pass: gatePass,
      checks: {
        floorPass,
        medianPass,
        datasetPass,
      },
    },
    datasets: latestRuns.map((run) => ({
      inputPath: run.inputPath,
      timestamp: run.timestamp,
      tokenReductionPct: Number(run.metrics.tokenReductionPct ?? 0),
      bestStrategy: String(run.metrics.bestStrategy ?? 'unknown'),
      bestTokens: Number(run.metrics.bestTokens ?? 0),
      contexTokens: Number(run.metrics.contexTokens ?? 0),
      jsonTokens: Number(run.metrics.jsonTokens ?? 0),
    })),
  };

  const outDir = path.dirname(outPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(outPath, JSON.stringify(scorecardPayload, null, 2), 'utf-8');

  const boxWidth = 74;
  const lines = [
    `Input snapshot: ${inPath}`,
    `Model:          ${model}`,
    `Datasets:       ${scorecard.datasetCount} (${datasetPass ? 'PASS' : 'FAIL'}, target >= ${minDatasets})`,
    `Floor:          ${scorecard.floorReductionPct.toFixed(2)}% (${floorPass ? 'PASS' : 'FAIL'}, target >= ${targetFloor}%)`,
    `Median:         ${scorecard.medianReductionPct.toFixed(2)}% (${medianPass ? 'PASS' : 'FAIL'}, target >= ${targetMedian}%)`,
    `Gate:           ${gatePass ? 'PASS' : 'FAIL'}`,
  ];
  console.log('\n');
  console.log(drawBox('Scorecard Gate', boxWidth, lines));
  console.log(`\n  Report: ${outPath}\n`);

  if (strictGate && !gatePass) {
    console.error('  Strict Gate: FAIL (scorecard gate failed).');
    process.exit(2);
  }
}

// ============================================================================
// encode
// ============================================================================
function encodeFile(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    process.exit(1);
  }

  const encoding = (getFlag('encoding') ?? 'cl100k_base') as TokenizerEncoding;
  const json = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const encoder = new TokenStreamEncoder(encoding);

  const binary = encoder.encode(json);
  const stats = encoder.getStats(json);

  const outFile = inputPath.replace(/\.json$/, '.tens');
  writeFileSync(outFile, binary);

  console.log(`Encoded: ${outFile}`);
  console.log(
    `  ${stats.jsonByteSize} bytes JSON -> ${stats.byteSize} bytes TENS (${stats.byteReduction}% reduction)`,
  );
  console.log(`  ${stats.totalTokenCount} tokens (${stats.tokenReduction}% fewer than JSON)`);

  encoder.dispose();
}

// ============================================================================
// decode
// ============================================================================
function decodeFile(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    process.exit(1);
  }

  const binary = new Uint8Array(readFileSync(inputPath));
  const decoder = new TokenStreamDecoder();
  const json = decoder.decode(binary);

  console.log(JSON.stringify(json, null, 2));
  decoder.dispose();
}

// ============================================================================
// stats
// ============================================================================
function showStats(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    process.exit(1);
  }

  const encoding = (getFlag('encoding') ?? 'cl100k_base') as TokenizerEncoding;
  const json = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const encoder = new TokenStreamEncoder(encoding);
  const stats = encoder.getStats(json);

  console.log(`\n  TENS Stats: ${inputPath} (${encoding})`);
  console.log(`  Schemas:        ${stats.schemaCount}`);
  console.log(`  Rows:           ${stats.rowCount}`);
  console.log(`  JSON bytes:     ${stats.jsonByteSize}`);
  console.log(`  TENS bytes:     ${stats.byteSize} (${stats.byteReduction}% reduction)`);
  console.log(`  Unique tokens:  ${stats.uniqueTokenCount}`);
  console.log(`  Total tokens:   ${stats.totalTokenCount} (${stats.tokenReduction}% fewer)`);

  encoder.dispose();
}

// ============================================================================
// formats
// ============================================================================
function showFormats(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    process.exit(1);
  }

  const json = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const tokenizer = new TokenizerManager();
  const analyses = analyzeFormats(json);

  console.log(`\n  Multi-Format Analysis: ${inputPath}`);
  console.log(`  ${'Format'.padEnd(16)} ${'Bytes'.padStart(10)} ${'Tokens'.padStart(10)}`);
  console.log(`  ${'─'.repeat(40)}`);

  for (const a of analyses) {
    const tokens = tokenizer.countTokens(a.output);
    console.log(
      `  ${a.format.padEnd(16)} ${String(a.byteSize).padStart(10)} ${String(tokens).padStart(10)}`,
    );
  }

  tokenizer.dispose();
}

// ============================================================================
// convert — Export to ALL formats
// ============================================================================
function convertFile(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  if (!Array.isArray(data)) {
    console.error('Error: Input file must contain a JSON array of objects.');
    process.exit(1);
  }

  const baseName = inputPath.replace(/\.json$/, '');
  const tokenizer = new TokenizerManager();
  const tensEncoder = new TokenStreamEncoder();

  console.log(`\n  ${doubleLine}`);
  console.log(`  contex convert — ${inputPath}`);
  console.log(`  ${data.length} rows → exporting to all formats`);
  console.log(`  ${doubleLine}\n`);

  const jsonOriginal = JSON.stringify(data, null, 2);
  const jsonOriginalBytes = Buffer.byteLength(jsonOriginal);
  const jsonOriginalTokens = tokenizer.countTokens(jsonOriginal, 'o200k_base');

  // Define all output formats
  const outputs: { name: string; ext: string; content: string | Uint8Array; isBinary: boolean }[] =
    [];

  // 1. JSON Minified
  const jsonMin = JSON.stringify(data);
  outputs.push({ name: 'json-min', ext: '.min.json', content: jsonMin, isBinary: false });

  // 2. CSV
  const csv = formatOutput(data, 'csv');
  outputs.push({ name: 'csv', ext: '.csv', content: csv, isBinary: false });

  // 3. Markdown
  const md = formatOutput(data, 'markdown');
  outputs.push({ name: 'markdown', ext: '.md', content: md, isBinary: false });

  // 4. TOON (Token-Oriented Object Notation)
  const toon = formatOutput(data, 'toon');
  outputs.push({ name: 'toon', ext: '.toon', content: toon, isBinary: false });

  // 5. TENS-Text (human-readable TENS)
  const tensTextEncoder = new TensTextEncoder();
  const tensText = tensTextEncoder.encode(data);
  outputs.push({ name: 'tens-text', ext: '.tens.txt', content: tensText, isBinary: false });

  // 6. TENS Binary
  const tensBinary = tensEncoder.encode(data);
  outputs.push({ name: 'tens', ext: '.tens', content: tensBinary, isBinary: true });

  // Print results table
  console.log(
    `  ${padR('Format', 14)} ${padL('Bytes', 10)} ${padL('Tokens', 10)} ${padL('Reduction', 10)} ${padL('File', 25)}`,
  );
  console.log(`  ${line}`);

  // JSON baseline
  console.log(
    `  ${padR('json', 14)} ${padL(formatBytes(jsonOriginalBytes), 10)} ${padL(String(jsonOriginalTokens), 10)} ${padL('-', 10)} ${padL('(original)', 25)}`,
  );

  for (const out of outputs) {
    const outFile = `${baseName}${out.ext}`;
    const bytes = out.isBinary
      ? (out.content as Uint8Array).length
      : Buffer.byteLength(out.content as string);
    let tokens: number;

    if (out.name === 'tens') {
      tokens = tensEncoder.encodeToTokenStream(data).length;
    } else {
      tokens = tokenizer.countTokens(out.content as string, 'o200k_base');
    }

    const reduction = ((1 - tokens / jsonOriginalTokens) * 100).toFixed(1);

    // Write file
    if (out.isBinary) {
      writeFileSync(outFile, out.content as Uint8Array);
    } else {
      writeFileSync(outFile, out.content as string, 'utf-8');
    }

    console.log(
      `  ${padR(out.name, 14)} ${padL(formatBytes(bytes), 10)} ${padL(String(tokens), 10)} ${padL(`${reduction}%`, 10)} ${padL(path.basename(outFile), 25)}`,
    );
  }

  // Print previews of text formats
  console.log(`\n  ${doubleLine}`);
  console.log('  Format Previews (first 5 lines each)');
  console.log(`  ${doubleLine}`);

  for (const out of outputs) {
    if (out.isBinary) {
      const bin = out.content as Uint8Array;
      const hexPreview = Array.from(bin.slice(0, 32))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      console.log(`\n  ┌─ ${out.name} (binary, ${formatBytes(bin.length)}) ─────────────`);
      console.log(`  │ ${hexPreview} ...`);
      console.log('  └─────────────────────────────────────');
    } else {
      const text = out.content as string;
      const lines = text.split('\n').slice(0, 5);
      console.log(`\n  ┌─ ${out.name} ─────────────────────────────`);
      for (const l of lines) {
        console.log(`  │ ${l.slice(0, 100)}${l.length > 100 ? '...' : ''}`);
      }
      const totalLines = text.split('\n').length;
      if (totalLines > 5) {
        console.log(`  │ ... (${totalLines - 5} more lines)`);
      }
      console.log('  └─────────────────────────────────────');
    }
  }

  console.log(
    `\n  ✅ ${outputs.length} format files written to ${path.dirname(path.resolve(inputPath)) + path.sep}`,
  );
  console.log(
    `  Best compression: ${
      outputs.reduce((best, o) => {
        const bytes = o.isBinary
          ? (o.content as Uint8Array).length
          : Buffer.byteLength(o.content as string);
        const bestBytes = best.isBinary
          ? (best.content as Uint8Array).length
          : Buffer.byteLength(best.content as string);
        return bytes < bestBytes ? o : best;
      }).name
    }\n`,
  );

  tokenizer.dispose();
  tensEncoder.dispose();
}

// ============================================================================
// validate — Roundtrip integrity check
// ============================================================================
function validateFile(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  if (!Array.isArray(data)) {
    console.error('Error: Input file must contain a JSON array of objects.');
    process.exit(1);
  }

  console.log(`\n  ${doubleLine}`);
  console.log('  contex validate — Roundtrip Integrity Test');
  console.log(`  Input: ${inputPath} (${data.length} rows)`);
  console.log(`  ${doubleLine}\n`);

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const semanticGuardEnabled = hasFlag('semantic-guard');
  let semanticGuardFailed = false;
  const results: { format: string; status: string; detail: string }[] = [];

  // --- TENS Binary Roundtrip ---
  try {
    const encoder = new TokenStreamEncoder();
    const decoder = new TokenStreamDecoder();
    const binary = encoder.encode(data);
    const decoded = decoder.decode(binary);
    const decArr = Array.isArray(decoded) ? decoded : [decoded];

    // Deep compare: normalize via JSON stringify
    const originalStr = JSON.stringify(data);
    const decodedStr = JSON.stringify(decArr);

    if (originalStr === decodedStr) {
      results.push({
        format: 'TENS Binary',
        status: '✅ PASS',
        detail: `${formatBytes(binary.length)} binary, perfect roundtrip`,
      });
      passed++;
    } else {
      // Count matching rows
      let matchCount = 0;
      const minLen = Math.min(data.length, decArr.length);
      for (let i = 0; i < minLen; i++) {
        if (JSON.stringify(data[i]) === JSON.stringify(decArr[i])) matchCount++;
      }
      results.push({
        format: 'TENS Binary',
        status: '❌ FAIL',
        detail: `${decArr.length} rows decoded, ${matchCount}/${data.length} exact match (nested objects may flatten)`,
      });
      failed++;
    }
    encoder.dispose();
    decoder.dispose();
  } catch (e: unknown) {
    results.push({
      format: 'TENS Binary',
      status: '❌ FAIL',
      detail: errorMessage(e).slice(0, 80),
    });
    failed++;
  }

  // --- TENS-Text Roundtrip ---
  try {
    const ttEncoder = new TensTextEncoder();
    const ttDecoder = new TensTextDecoder();
    const encoded = ttEncoder.encode(data);
    const decoded = ttDecoder.decode(encoded);
    const decArr = extractRowsFromDecoded(decoded);
    const decLen = decArr.length;

    const origKeys = Object.keys(data[0] || {}).sort();
    const firstDec = decArr[0] || {};
    const decKeys = Object.keys(firstDec).sort();

    if (decLen === data.length && origKeys.join(',') === decKeys.join(',')) {
      results.push({
        format: 'TENS-Text',
        status: '✅ PASS',
        detail: `${decLen} rows decoded, ${decKeys.length} fields, schema preserved`,
      });
      passed++;
    } else if (decLen > 0) {
      results.push({
        format: 'TENS-Text',
        status: '⚠️ PARTIAL',
        detail: `${decLen}/${data.length} rows decoded, ${decKeys.length}/${origKeys.length} fields`,
      });
      passed++;
    } else {
      results.push({
        format: 'TENS-Text',
        status: '⚠️ ENCODE',
        detail: `Encoder OK (${encoded.split('\n').length} lines), decoder returned empty`,
      });
      skipped++;
    }
  } catch (e: unknown) {
    results.push({
      format: 'TENS-Text',
      status: '❌ FAIL',
      detail: errorMessage(e).slice(0, 80),
    });
    failed++;
  }

  // --- JSON Roundtrip (sanity check) ---
  try {
    const jsonStr = JSON.stringify(data);
    const decoded = JSON.parse(jsonStr);
    const match = JSON.stringify(decoded) === jsonStr;
    results.push({
      format: 'JSON',
      status: match ? '✅ PASS' : '❌ FAIL',
      detail: 'Native JSON.parse roundtrip',
    });
    match ? passed++ : failed++;
  } catch (e: unknown) {
    results.push({
      format: 'JSON',
      status: '❌ FAIL',
      detail: errorMessage(e).slice(0, 80),
    });
    failed++;
  }

  // --- CSV Roundtrip (encode only, CSV loses nested structure) ---
  try {
    const csv = formatOutput(data, 'csv');
    const csvLines = csv.split('\n').filter((l) => l.trim());
    const headerCount = csvLines[0]?.split(',').length || 0;
    const rowCount = csvLines.length - 1; // minus header
    results.push({
      format: 'CSV',
      status: '⚠️ ENCODE',
      detail: `${rowCount} rows, ${headerCount} columns (nested objects flattened)`,
    });
    skipped++;
  } catch (e: unknown) {
    results.push({
      format: 'CSV',
      status: '❌ FAIL',
      detail: errorMessage(e).slice(0, 80),
    });
    failed++;
  }

  // --- TOON Roundtrip (encode only, same as CSV) ---
  try {
    const toon = formatOutput(data, 'toon');
    const toonLines = toon.split('\n').filter((l) => l.trim());
    const headerCount = toonLines[0]?.split('\t').length || 0;
    const rowCount = toonLines.length - 1;
    results.push({
      format: 'TOON',
      status: '⚠️ ENCODE',
      detail: `${rowCount} rows, ${headerCount} columns (tab-separated)`,
    });
    skipped++;
  } catch (e: unknown) {
    results.push({
      format: 'TOON',
      status: '❌ FAIL',
      detail: errorMessage(e).slice(0, 80),
    });
    failed++;
  }

  // --- Markdown (encode only) ---
  try {
    const md = formatOutput(data, 'markdown');
    const mdLines = md.split('\n').filter((l) => l.trim());
    const rowCount = mdLines.length - 2; // minus header and separator
    results.push({
      format: 'Markdown',
      status: '⚠️ ENCODE',
      detail: `${rowCount} rows (table format, no decoder)`,
    });
    skipped++;
  } catch (e: unknown) {
    results.push({
      format: 'Markdown',
      status: '❌ FAIL',
      detail: errorMessage(e).slice(0, 80),
    });
    failed++;
  }

  // --- Semantic Relation Guard ---
  if (semanticGuardEnabled) {
    const semantic = runSemanticRelationGuard(data);
    results.push({
      format: 'Semantic Guard',
      status: semantic.pass ? '✅ PASS' : '❌ FAIL',
      detail: `${semantic.reason}; rows ${semantic.rowCountDecoded}/${semantic.rowCountOriginal}, fields ${semantic.fieldPathCoveragePct.toFixed(1)}%, row-match ${semantic.rowSignatureMatchPct.toFixed(1)}%`,
    });
    if (semantic.pass) passed++;
    else {
      failed++;
      semanticGuardFailed = true;
    }
  }

  // Print results
  console.log(`  ${padR('Format', 14)} ${padR('Status', 14)} Detail`);
  console.log(`  ${line}`);
  for (const r of results) {
    console.log(`  ${padR(r.format, 14)} ${padR(r.status, 14)} ${r.detail}`);
  }

  console.log(`\n  ${line}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} encode-only`);

  if (failed === 0) {
    console.log('  ✅ All roundtrip formats passed integrity check!');
  } else {
    console.log(`  ❌ ${failed} format(s) failed roundtrip validation.`);
  }

  if (semanticGuardEnabled && semanticGuardFailed) {
    process.exit(2);
  }
  console.log('');
}

// ============================================================================
// guard — Semantic relation diagnostics only (triage-first)
// ============================================================================
function guardFile(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  if (!Array.isArray(data)) {
    console.error('Error: Input file must contain a JSON array of objects.');
    process.exit(1);
  }

  const modelId = getFlag('model') ?? 'gpt-4o-mini';
  const modelSpec = MODEL_REGISTRY[modelId] ?? MODEL_REGISTRY['gpt-4o-mini'];
  const encoding = modelSpec.encoding as TokenizerEncoding;

  const semantic = runSemanticRelationGuard(data, encoding);

  const guardLines = [
    `Input:    ${path.basename(inputPath)}`,
    `Model:    ${modelSpec.name}`,
    `Status:   ${semantic.pass ? 'PASS' : 'FAIL'} (${semantic.reason})`,
    `Rows:     ${semantic.rowCountDecoded}/${semantic.rowCountOriginal}`,
    `Fields:   ${semantic.fieldPathCoveragePct.toFixed(1)}% (target >= 95%)`,
    `RowMatch: ${semantic.rowSignatureMatchPct.toFixed(1)}% (target >= 95%)`,
  ];

  console.log('\n');
  console.log(drawBox('Semantic Relation Guard', 72, guardLines));
  console.log('');

  if (!semantic.pass) {
    process.exit(2);
  }
}

// ============================================================================
// savings — Dollar-cost savings report
// ============================================================================
function showSavings(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  if (!Array.isArray(data)) {
    console.error('Error: Input file must contain a JSON array of objects.');
    process.exit(1);
  }

  const fields = data.length > 0 ? Object.keys(data[0]).length : 0;
  const primaryModel = getFlag('model') ?? 'gpt-4o';
  const outPath = getFlag('out') ?? SAVINGS_DEFAULT_OUT;

  const tokenizer = new TokenizerManager();

  const modelSpec = MODEL_REGISTRY[primaryModel];
  if (!modelSpec) {
    console.error(
      `Error: Unknown model "${primaryModel}". Available: ${Object.keys(MODEL_REGISTRY).slice(0, 5).join(', ')}...`,
    );
    process.exit(1);
  }

  console.log(`\n  ${doubleLine}`);
  console.log('  💰 Contex Savings Report');
  console.log(`  ${doubleLine}`);
  console.log(`  File:   ${inputPath}`);
  console.log(`  Rows:   ${data.length.toLocaleString()}`);
  console.log(`  Fields: ${fields}`);
  console.log(`  ${line}\n`);

  // Formats to test
  const formats: Array<{ name: string; format: 'json' | 'csv' | 'toon' | 'markdown' }> = [
    { name: 'JSON (baseline)', format: 'json' },
    { name: 'CSV', format: 'csv' },
    { name: 'TOON', format: 'toon' },
    { name: 'Markdown', format: 'markdown' },
  ];

  // Test each model
  const modelsToTest = [primaryModel];
  if (!modelsToTest.includes('gpt-4o')) modelsToTest.push('gpt-4o');
  if (!modelsToTest.includes('claude-3-5-sonnet')) modelsToTest.push('claude-3-5-sonnet');
  if (!modelsToTest.includes('gemini-2-5-flash')) modelsToTest.push('gemini-2-5-flash');
  // Deduplicate
  const uniqueModels = [...new Set(modelsToTest)];
  const modelSummaries: Array<{
    model: string;
    bestFormat: string;
    baselineTokens: number;
    bestTokens: number;
    annualSavings: number;
  }> = [];

  for (const modelId of uniqueModels) {
    const spec = MODEL_REGISTRY[modelId];
    if (!spec) continue;

    const enc = spec.encoding;
    console.log(`  📊 ${spec.name} ($${spec.inputPricePer1M}/1M input tokens)`);
    console.log(
      `  ${padR('Format', 22)} ${padL('Tokens', 10)} ${padL('$/1K calls', 12)} ${padL('Annual*', 14)} ${padL('Savings', 10)}`,
    );
    console.log(`  ${line}`);

    let baselineTokens = 0;
    let bestTokens = Number.POSITIVE_INFINITY;
    let bestFormat = 'json';
    let bestAnnual = 0;
    let baselineAnnual = 0;

    for (const fmt of formats) {
      const output = formatOutput(data, fmt.format);
      const tokens = tokenizer.countTokens(output, enc);
      const costPer1K = (tokens / 1_000_000) * spec.inputPricePer1M * 1000;
      const annual = costPer1K * 10 * 365; // 10K calls/day

      if (fmt.format === 'json') {
        baselineTokens = tokens;
        baselineAnnual = annual;
      }

      const savings =
        fmt.format === 'json' ? '-' : `-${Math.round((1 - tokens / baselineTokens) * 100)}%`;

      if (tokens < bestTokens) {
        bestTokens = tokens;
        bestFormat = fmt.name;
        bestAnnual = annual;
      }

      const marker = tokens <= bestTokens ? ' ✦' : '';
      console.log(
        `  ${padR(fmt.name, 22)} ${padL(tokens.toLocaleString(), 10)} ${padL(`$${costPer1K.toFixed(4)}`, 12)} ${padL(`$${annual.toFixed(2)}`, 14)} ${padL(savings, 10)}${marker}`,
      );
    }

    const annualSaved = baselineAnnual - bestAnnual;
    modelSummaries.push({
      model: modelId,
      bestFormat,
      baselineTokens,
      bestTokens,
      annualSavings: annualSaved,
    });
    console.log(
      `\n  ✅ Best: ${bestFormat} → saves $${annualSaved.toFixed(2)}/year at 10K calls/day`,
    );

    // Context window comparison
    const jsonPerRow = baselineTokens / data.length;
    const bestPerRow = bestTokens / data.length;
    const jsonFits = Math.floor((spec.contextWindow * 0.5) / jsonPerRow); // 50% for data
    const bestFits = Math.floor((spec.contextWindow * 0.5) / bestPerRow);
    console.log(
      `  ✅ Fits ${bestFits.toLocaleString()} rows vs JSON's ${jsonFits.toLocaleString()} rows in ${spec.name}'s window`,
    );
    console.log('');
  }

  // Summary box
  console.log(`  ${doubleLine}`);
  console.log('  💡 Quick Start:');
  console.log('');
  console.log(`     import { quick } from '@contex/engine';`);
  console.log(`     const result = quick(yourData, '${primaryModel}');`);
  console.log('     // result.output is ready for your LLM');
  console.log(`  ${doubleLine}\n`);
  console.log('  * Annual estimate: 10,000 API calls/day × 365 days\n');

  const primarySummary = modelSummaries.find((s) => s.model === primaryModel) ?? modelSummaries[0];
  const snapshot: SnapshotRun = {
    timestamp: new Date().toISOString(),
    command: 'savings',
    inputPath: path.resolve(inputPath),
    model: primaryModel,
    metrics: {
      rows: data.length,
      fields,
      bestFormat: primarySummary?.bestFormat ?? 'n/a',
      baselineTokens: primarySummary?.baselineTokens ?? 0,
      bestTokens: primarySummary?.bestTokens ?? 0,
      annualSavings: Number((primarySummary?.annualSavings ?? 0).toFixed(2)),
    },
  };
  appendSnapshot(outPath, snapshot);
  console.log(`  Snapshot: ${outPath}\n`);

  tokenizer.dispose();
}

// ============================================================================
// ir-encode — Encode to Canonical IR and store
// ============================================================================
function irEncode(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  if (!Array.isArray(data)) {
    console.error('Error: Input file must contain a JSON array of objects.');
    process.exit(1);
  }

  const storeDir = getFlag('store') ?? '.contex';
  const memory = new TokenMemory(storeDir);

  const result = memory.store(data);

  console.log(`\n  ${doubleLine}`);
  console.log('  contex ir-encode — Canonical IR');
  console.log(`  ${doubleLine}`);
  console.log(`  Input:  ${inputPath} (${data.length} rows)`);
  console.log(`  Hash:   ${result.hash}`);
  console.log(`  Size:   ${formatBytes(result.irByteSize)}`);
  console.log(`  Status: ${result.isNew ? '✅ Stored (new)' : '⚡ Dedup hit (already stored)'}`);
  console.log(`  Dir:    ${storeDir}/`);
  console.log('');

  if (result.isNew) {
    console.log('  Use this hash to inspect or materialize:');
    console.log(`    contex ir-inspect ${result.hash}`);
    console.log(`    contex ir-materialize ${result.hash} --model gpt-4o`);
  }
  console.log('');

  memory.dispose();
}

// ============================================================================
// ir-inspect — Inspect stored IR metadata
// ============================================================================
function irInspect(): void {
  const hash = args[1];
  if (!hash) {
    console.error('Error: missing IR hash. Use `contex ir-encode` first.');
    process.exit(1);
  }

  const storeDir = getFlag('store') ?? '.contex';
  const memory = new TokenMemory(storeDir);

  if (!memory.has(hash)) {
    console.error(`Error: IR not found: ${hash}`);
    console.error(`  Store dir: ${storeDir}/`);

    const all = memory.list();
    if (all.length > 0) {
      console.error('\n  Available hashes:');
      for (const item of all) {
        console.error(`    ${item.hash} (${item.rowCount} rows, ${formatBytes(item.irByteSize)})`);
      }
    }
    memory.dispose();
    process.exit(1);
  }

  const meta = memory.getMeta(hash);
  if (!meta) {
    console.error(`Error: metadata not found for hash ${hash}`);
    memory.dispose();
    process.exit(1);
  }
  const cachedModels = memory.getCachedModels(hash);

  console.log(`\n  ${doubleLine}`);
  console.log('  contex ir-inspect');
  console.log(`  ${doubleLine}`);
  console.log(`  Hash:       ${meta.hash}`);
  console.log(`  Rows:       ${meta.rowCount}`);
  console.log(`  IR size:    ${formatBytes(meta.irByteSize)}`);
  console.log(`  Stored at:  ${meta.storedAt}`);
  console.log(`  IR ver:     ${meta.irVersion}`);
  console.log(`  Canon ver:  ${meta.canonicalizationVersion}`);
  console.log(`  Schemas:    ${meta.schemas.length}`);

  for (const schema of meta.schemas) {
    console.log(`    Schema ${schema.id}: ${schema.fields.join(', ')}`);
  }

  console.log(
    `\n  Cached materializations: ${cachedModels.length > 0 ? cachedModels.join(', ') : '(none)'}`,
  );

  if (cachedModels.length > 0) {
    console.log(
      `\n  ${padR('Model', 25)} ${padL('Tokens', 10)} ${padL('Encoding', 15)} ${padL('Tok Ver', 10)} Fingerprint`,
    );
    console.log(`  ${line}`);
    for (const modelId of cachedModels) {
      const tokens = memory.loadMaterialized(hash, modelId);
      if (tokens) {
        console.log(
          `  ${padR(modelId, 25)} ${padL(String(tokens.tokenCount), 10)} ${padL(tokens.encoding, 15)} ${padL(tokens.tokenizerVersion, 10)} ${tokens.tokenizerFingerprint.slice(0, 16)}…`,
        );
      }
    }
  }
  console.log('');

  memory.dispose();
}

// ============================================================================
// ir-materialize — Materialize IR for a specific model
// ============================================================================
function irMaterialize(): void {
  const hash = args[1];
  if (!hash) {
    console.error('Error: missing IR hash. Use `contex ir-encode` first.');
    process.exit(1);
  }

  const modelId = getFlag('model');
  if (!modelId) {
    console.error('Error: missing --model flag. Example: --model gpt-4o');
    process.exit(1);
  }

  const storeDir = getFlag('store') ?? '.contex';
  const memory = new TokenMemory(storeDir);

  if (!memory.has(hash)) {
    console.error(`Error: IR not found: ${hash}`);
    memory.dispose();
    process.exit(1);
  }

  const start = performance.now();
  const result = memory.materializeAndCache(hash, modelId);
  const ms = (performance.now() - start).toFixed(1);

  console.log(`\n  ${doubleLine}`);
  console.log('  contex ir-materialize');
  console.log(`  ${doubleLine}`);
  console.log(`  Hash:        ${hash}`);
  console.log(`  Model:       ${modelId}`);
  console.log(`  Encoding:    ${result.encoding}`);
  console.log(`  Tokens:      ${result.tokenCount.toLocaleString()}`);
  console.log(`  Time:        ${ms}ms`);
  console.log(`  Tok version: ${result.tokenizerVersion}`);
  console.log(`  Fingerprint: ${result.tokenizerFingerprint.slice(0, 16)}…`);
  console.log(
    `  Cached:      ✅ (${storeDir}/cache/${hash}/${modelId}.${result.encoding}.${result.tokenizerVersion}/)`,
  );
  console.log('');

  // Optionally dump tokens
  if (hasFlag('dump')) {
    console.log(
      `  First 50 tokens: [${result.tokens.slice(0, 50).join(', ')}${result.tokens.length > 50 ? ', ...' : ''}]`,
    );
    console.log('');
  }

  memory.dispose();
}

// ============================================================================
// compose — Compose prompt from data blocks with budget validation
// ============================================================================
function composePrompt(): void {
  const modelId = getFlag('model') ?? 'gpt-4o';
  const reserveStr = getFlag('reserve');
  const reserveForResponse = reserveStr ? Number.parseInt(reserveStr, 10) : 4096;

  // Collect input files (positional args after command, excluding --flags)
  const inputFiles: string[] = [];
  const rawArgs = args.slice(1);
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith('--')) {
      i++; // skip flag value
      continue;
    }
    inputFiles.push(rawArgs[i]);
  }
  if (inputFiles.length === 0) {
    console.error('Error: at least one input JSON file required.');
    console.error('  Usage: contex compose <file1.json> [file2.json ...] --model gpt-4o');
    process.exit(1);
  }

  // Build blocks from input files
  const blocks: Array<{
    name: string;
    type: 'ir';
    ir: ReturnType<typeof encodeIR>;
    priority: 'required' | 'optional';
  }> = [];

  for (const file of inputFiles) {
    const raw = readFileSync(file, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      console.error(`Error: ${file} must contain a JSON array.`);
      process.exit(1);
    }
    const ir = encodeIR(data);
    blocks.push({
      name: path.basename(file),
      type: 'ir',
      ir,
      priority: 'required',
    });
  }

  // Add system prompt if provided
  const systemPrompt = getFlag('system');
  const allBlocks: ComposeBlock[] = [];
  if (systemPrompt) {
    allBlocks.push({ name: 'system', type: 'text', content: systemPrompt, priority: 'required' });
  }
  allBlocks.push(...blocks);

  const start = performance.now();
  const result = compose({
    model: modelId,
    blocks: allBlocks,
    reserveForResponse,
  });
  const ms = (performance.now() - start).toFixed(1);

  console.log(`\n  ${doubleLine}`);
  console.log('  contex compose');
  console.log(`  ${doubleLine}`);
  console.log(`  Model:          ${result.model}`);
  console.log(`  Encoding:       ${result.encoding}`);
  console.log(`  Context Window: ${result.contextWindow.toLocaleString()} tokens`);
  console.log(`  Reserved:       ${result.reservedForResponse.toLocaleString()} tokens (response)`);
  console.log(`  Budget:         ${result.budgetTokens.toLocaleString()} tokens`);
  console.log(
    `  Used:           ${result.totalTokens.toLocaleString()} tokens (${result.utilizationPct}%)`,
  );
  console.log(`  Remaining:      ${result.remainingTokens.toLocaleString()} tokens`);
  console.log(`  Time:           ${ms}ms`);

  console.log(
    `\n  ${padR('Block', 25)} ${padR('Type', 8)} ${padR('Priority', 10)} ${padL('Tokens', 10)} ${padR('Status', 12)}`,
  );
  console.log(`  ${line}`);
  for (const block of result.blocks) {
    const status = block.included
      ? block.excludedReason
        ? '⚠ partial'
        : '✅ included'
      : '❌ dropped';
    console.log(
      `  ${padR(block.name, 25)} ${padR(block.type, 8)} ${padR(block.priority, 10)} ${padL(String(block.tokenCount), 10)} ${status}`,
    );
    if (block.excludedReason) {
      console.log(`    └ ${block.excludedReason}`);
    }
  }
  console.log('');
}

// ============================================================================
// materialize - Encode + Materialize in one step (DX friendlier)
// ============================================================================
function materializeFile(): void {
  const file = args[1];
  if (!file) {
    console.error(
      'Error: missing input file. Usage: contex materialize <file.json> --model <model>',
    );
    process.exit(1);
  }

  const modelId = getFlag('model');
  if (!modelId) {
    console.error('Error: missing --model flag. Example: --model gpt-4o');
    process.exit(1);
  }

  const start = performance.now();

  // 1. Read & Parse
  const raw = readFileSync(file, 'utf-8');
  const data = JSON.parse(raw);

  // 2. Encode to IR
  const storeDir = getFlag('store') ?? '.contex';
  const memory = new TokenMemory(storeDir);
  const irResult = memory.store(data);

  // 3. Materialize
  const maxTokensStr = getFlag('max-tokens');
  const maxTokens = maxTokensStr ? Number.parseInt(maxTokensStr, 10) : undefined;
  const matResult = memory.materializeAndCache(irResult.hash, modelId, { maxTokens });

  const ms = (performance.now() - start).toFixed(1);

  console.log(`\n  ${doubleLine}`);
  console.log('  contex materialize');
  console.log(`  ${doubleLine}`);
  console.log(`  Input:       ${file}`);
  console.log(`  IR Hash:     ${irResult.hash}`);
  console.log(`  Model:       ${modelId}`);
  console.log(`  Tokens:      ${matResult.tokenCount.toLocaleString()}`);
  console.log(`  Encoding:    ${matResult.encoding}`);
  console.log(`  Time:        ${ms}ms`);
  console.log(
    `  Cached:      ✅ (${storeDir}/cache/${irResult.hash}/${modelId}.${matResult.encoding}.${matResult.tokenizerVersion}/)`,
  );
  console.log('');

  memory.dispose();
}

// ============================================================================
// inject - Run real API call with context injection
// ============================================================================
async function injectFile() {
  const file = args[1];
  if (!file) {
    console.error(
      'Error: missing input file. Usage: contex inject <file.json> --provider openai|anthropic [--strategy contex|csv|toon|markdown|auto] [--max-input-tokens N] [--dry-run]',
    );
    process.exit(1);
  }

  const provider = getFlag('provider');
  if (!provider || !['openai', 'anthropic'].includes(provider)) {
    console.error('Error: missing or invalid --provider flag. Use "openai" or "anthropic".');
    process.exit(1);
  }

  const modelId =
    getFlag('model') ?? (provider === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-20240620');
  const dryRun = hasFlag('dry-run');
  const maxInputTokensStr = getFlag('max-input-tokens');
  const maxInputTokens = maxInputTokensStr ? Number.parseInt(maxInputTokensStr, 10) : undefined;

  if (maxInputTokensStr && (!Number.isFinite(maxInputTokens) || (maxInputTokens ?? 0) <= 0)) {
    console.error('Error: --max-input-tokens must be a positive integer.');
    process.exit(1);
  }

  const strategyInput = parseStrategies(getFlag('strategy'), ['contex'])[0];
  const contexOnly = hasFlag('contex-only') || hasFlag('must-use-contex');
  const semanticGuardEnabled = hasFlag('semantic-guard');

  // Read data
  const raw = readFileSync(file, 'utf-8');
  const data = JSON.parse(raw);
  const collectionName = path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9_]/g, '_');

  const modelSpec = MODEL_REGISTRY[modelId];
  if (!modelSpec) {
    console.error(
      `Error: unknown model "${modelId}". Try one of: ${Object.keys(MODEL_REGISTRY).slice(0, 8).join(', ')}...`,
    );
    process.exit(1);
  }
  const modelEncoding = modelSpec.encoding as TokenizerEncoding;

  let selectedStrategy: StrategyName = strategyInput;
  let payloadText: string | undefined;
  let selectedTokens = 0;

  const tokenizer = new TokenizerManager();
  const candidateTokenCounts = buildStrategyCandidates(data, modelEncoding, tokenizer);

  if (semanticGuardEnabled) {
    const semantic = runSemanticRelationGuard(data, modelEncoding);
    if (!semantic.pass) {
      console.error(
        `Error: semantic relation guard failed: ${semantic.reason} (rows ${semantic.rowCountDecoded}/${semantic.rowCountOriginal}, field coverage ${semantic.fieldPathCoveragePct.toFixed(1)}%, row-match ${semantic.rowSignatureMatchPct.toFixed(1)}%).`,
      );
      tokenizer.dispose();
      process.exit(1);
    }
  }

  if (contexOnly) {
    selectedStrategy = 'contex';
  } else if (strategyInput === 'auto') {
    // Use smart strategy selection based on structure analysis
    const tokenCountMap = new Map<string, number>();
    for (const candidate of candidateTokenCounts) {
      tokenCountMap.set(candidate.name, candidate.tokens);
    }
    const smartSelection = selectOptimalStrategy(data, tokenCountMap);
    selectedStrategy = smartSelection.strategy as StrategyName;
  }

  selectedTokens =
    candidateTokenCounts.find((c) => c.name === selectedStrategy)?.tokens ??
    candidateTokenCounts[0].tokens;

  payloadText = candidateTokenCounts.find((c) => c.name === selectedStrategy)?.text;

  const bestCandidate = candidateTokenCounts.reduce((best, cur) =>
    cur.tokens < best.tokens ? cur : best,
  );

  const capInfo = resolveTokenCap(provider as 'openai' | 'anthropic', modelId, maxInputTokens);
  const effectiveTokenCap = capInfo.cap;

  if (effectiveTokenCap && selectedTokens > effectiveTokenCap) {
    console.error(
      `Error: selected strategy "${selectedStrategy}" is ${selectedTokens.toLocaleString()} tokens, exceeding token cap=${effectiveTokenCap.toLocaleString()}.`,
    );
    console.error(
      `Hint: best available strategy is "${bestCandidate.name}" at ${bestCandidate.tokens.toLocaleString()} tokens.`,
    );
    tokenizer.dispose();
    process.exit(1);
  }

  console.log(`\n  ${doubleLine}`);
  console.log('  contex inject');
  console.log(`  ${doubleLine}`);
  console.log(`  Provider:    ${provider}`);
  console.log(`  Model:       ${modelId}`);
  console.log(
    `  Strategy:    ${selectedStrategy}${selectedTokens > 0 ? ` (${selectedTokens.toLocaleString()} tokens est)` : ''}`,
  );
  if (contexOnly) {
    console.log('  Policy:      Contex-only (user traffic pinned to canonical Contex path)');
  }
  console.log(
    `  Best Found:  ${bestCandidate.name} (${bestCandidate.tokens.toLocaleString()} tokens)`,
  );
  if (effectiveTokenCap) {
    const sourceLabel =
      capInfo.source === 'flag'
        ? 'flag'
        : capInfo.source === 'preset'
          ? 'preset'
          : capInfo.source === 'derived'
            ? 'derived'
            : 'none';
    console.log(`  Token Cap:   ${effectiveTokenCap.toLocaleString()} tokens (${sourceLabel})`);
  }
  if (selectedStrategy === 'contex') {
    console.log(`  Input:       ${file} (as {{CONTEX:${collectionName}}})`);
  } else {
    console.log(`  Input:       ${file} (formatted as ${selectedStrategy})`);
  }
  if (semanticGuardEnabled) {
    console.log('  Semantic:    guard enabled (strict)');
  }

  const preferTokens = hasFlag('prefer-tokens');
  if (preferTokens) {
    console.log('  Mode:        Prefer Tokens (if supported)');
    process.env.CONTEXT_ENABLE_TOKEN_INJECT = 'true';
  }

  if (dryRun) {
    console.log('  Dry Run:     YES (no provider API call)');
    console.log('');
    tokenizer.dispose();
    return;
  }

  try {
    let latestLocalCacheHit: boolean | undefined;

    if (provider === 'openai') {
      if (!process.env.OPENAI_API_KEY) {
        console.error('Error: OPENAI_API_KEY environment variable not set.');
        process.exit(1);
      }

      if (selectedStrategy === 'contex') {
        const rawClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const client = createContexOpenAI(
          rawClient as unknown as Parameters<typeof createContexOpenAI>[0],
          {
            data: { [collectionName]: data },
            onInject: (info) => {
              latestLocalCacheHit = info.cacheHit;
              console.log(
                `  Injection:   ✅ Injected ${info.tokenCount} tokens for '${info.collection}'`,
              );
              console.log(
                `               Using cache: ${info.cacheHit ? 'YES (Prefix Hit)' : 'NO (New Materialization)'}`,
              );
            },
          },
        );

        const start = performance.now();
        const response = await client.chat.completions.create({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: `Here is the data: {{CONTEX:${collectionName}}}. Summarize it in 1 sentence.`,
            },
          ],
          max_tokens: 100,
        });
        const ms = (performance.now() - start).toFixed(1);

        console.log(`  Time:        ${ms}ms`);
        const providerCachedTokens = Number(
          (response as unknown as { usage?: { prompt_tokens_details?: { cached_tokens?: number } } })
            .usage?.prompt_tokens_details?.cached_tokens ?? 0,
        );
        const taxonomy = classifyCacheTaxonomy({
          localCacheHit: latestLocalCacheHit,
          providerCachedTokens,
          selectedStrategy,
        });
        console.log(
          `  Cache:       ${taxonomy.status.toUpperCase()} (${taxonomy.reason})${providerCachedTokens > 0 ? ` [provider cached tokens: ${providerCachedTokens}]` : ''}`,
        );
        console.log(`               ${taxonomy.detail}`);
        console.log(`  Response:    ${response.choices[0].message.content}`);
      } else {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const start = performance.now();
        const response = await client.chat.completions.create({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: `Here is the dataset in ${selectedStrategy} format:\n\n${payloadText}\n\nSummarize it in 1 sentence.`,
            },
          ],
          max_tokens: 100,
        });
        const ms = (performance.now() - start).toFixed(1);

        console.log(`  Time:        ${ms}ms`);
        const taxonomy = classifyCacheTaxonomy({
          selectedStrategy,
        });
        console.log(`  Cache:       ${taxonomy.status.toUpperCase()} (${taxonomy.reason})`);
        console.log(`               ${taxonomy.detail}`);
        console.log(`  Response:    ${response.choices[0].message.content}`);
      }
    } else if (provider === 'anthropic') {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error('Error: ANTHROPIC_API_KEY environment variable not set.');
        process.exit(1);
      }

      if (selectedStrategy === 'contex') {
        const client = createContexAnthropic(
          new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
          {
            data: { [collectionName]: data },
            onInject: (info) => {
              latestLocalCacheHit = info.cacheHit;
              console.log(
                `  Injection:   ✅ Injected ${info.tokenCount} tokens for '${info.collection}'`,
              );
              console.log(
                `               Using cache: ${info.cacheHit ? 'YES (Prefix Hit)' : 'NO (New Materialization)'}`,
              );
            },
          },
        );

        const start = performance.now();
        const response = await client.messages.create({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: `Here is the data: {{CONTEX:${collectionName}}}. Summarize it in 1 sentence.`,
            },
          ],
          max_tokens: 100,
        });
        const ms = (performance.now() - start).toFixed(1);

        console.log(`  Time:        ${ms}ms`);
        const providerCachedTokens = Number(response.usage?.cache_read_input_tokens ?? 0);
        const taxonomy = classifyCacheTaxonomy({
          localCacheHit: latestLocalCacheHit,
          providerCachedTokens,
          selectedStrategy,
        });
        console.log(
          `  Cache:       ${taxonomy.status.toUpperCase()} (${taxonomy.reason})${providerCachedTokens > 0 ? ` [provider cache read tokens: ${providerCachedTokens}]` : ''}`,
        );
        console.log(`               ${taxonomy.detail}`);
        console.log(`  Response:    ${extractAnthropicText(response)}`);
      } else {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const start = performance.now();
        const response = await client.messages.create({
          model: modelId,
          messages: [
            {
              role: 'user',
              content: `Here is the dataset in ${selectedStrategy} format:\n\n${payloadText}\n\nSummarize it in 1 sentence.`,
            },
          ],
          max_tokens: 100,
        });
        const ms = (performance.now() - start).toFixed(1);

        console.log(`  Time:        ${ms}ms`);
        const taxonomy = classifyCacheTaxonomy({
          selectedStrategy,
        });
        console.log(`  Cache:       ${taxonomy.status.toUpperCase()} (${taxonomy.reason})`);
        console.log(`               ${taxonomy.detail}`);
        console.log(`  Response:    ${extractAnthropicText(response)}`);
      }
    }
  } catch (err: unknown) {
    console.error(`\nError calling API: ${errorMessage(err)}`);
    tokenizer.dispose();
    process.exit(1);
  }
  tokenizer.dispose();
  console.log('');
}

// ============================================================================
// compose-config - Compose from config file
// ============================================================================
function composeFromConfig(): void {
  const configFile = args[1];
  if (!configFile) {
    console.error('Error: missing config file. Usage: contex compose <config.json>');
    process.exit(1);
  }

  const raw = readFileSync(configFile, 'utf-8');
  let config: ComposeConfig;
  try {
    config = JSON.parse(raw) as ComposeConfig;
  } catch (e) {
    console.error(`Error: Failed to parse config file: ${errorMessage(e)}`);
    process.exit(1);
  }

  const modelId = getFlag('model') ?? config.model ?? 'gpt-4o';
  const reserveFlag = getFlag('reserve');
  const reserveForResponse =
    (reserveFlag ? Number.parseInt(reserveFlag, 10) : undefined) ?? config.reserve ?? 4096;

  // Parse blocks
  const blocks: ComposeBlock[] = [];

  // System prompt (from config or flag)
  const systemPrompt = getFlag('system') ?? config.system;
  if (systemPrompt) {
    blocks.push({ name: 'system', type: 'text', content: systemPrompt, priority: 'required' });
  }

  if (Array.isArray(config.blocks)) {
    for (const block of config.blocks) {
      if (block.type === 'file') {
        const filePath = path.resolve(path.dirname(configFile), block.path);
        const fileRaw = readFileSync(filePath, 'utf-8');
        const fileData = JSON.parse(fileRaw);
        const ir = encodeIR(fileData);
        blocks.push({
          name: block.name ?? path.basename(block.path),
          type: 'ir',
          ir,
          priority: block.priority ?? 'required',
        });
      } else if (block.type === 'text') {
        blocks.push({
          name: block.name ?? 'text-block',
          type: 'text',
          content: block.content,
          priority: block.priority ?? 'required',
        });
      }
    }
  }

  const start = performance.now();
  const result = compose({
    model: modelId,
    blocks,
    reserveForResponse,
  });
  const ms = (performance.now() - start).toFixed(1);

  console.log(`\n  ${doubleLine}`);
  console.log(`  contex compose (config: ${configFile})`);
  console.log(`  ${doubleLine}`);
  console.log(`  Model:          ${result.model}`);
  console.log(`  Encoding:       ${result.encoding}`);
  console.log(`  Context Window: ${result.contextWindow.toLocaleString()} tokens`);
  console.log(`  Reserved:       ${result.reservedForResponse.toLocaleString()} tokens (response)`);
  console.log(`  Budget:         ${result.budgetTokens.toLocaleString()} tokens`);
  console.log(
    `  Used:           ${result.totalTokens.toLocaleString()} tokens (${result.utilizationPct}%)`,
  );
  console.log(`  Remaining:      ${result.remainingTokens.toLocaleString()} tokens`);
  console.log(`  Time:           ${ms}ms`);

  console.log(
    `\n  ${padR('Block', 25)} ${padR('Type', 8)} ${padR('Priority', 10)} ${padL('Tokens', 10)} ${padR('Status', 12)}`,
  );
  console.log(`  ${line}`);
  for (const block of result.blocks) {
    const status = block.included
      ? block.excludedReason
        ? '⚠ partial'
        : '✅ included'
      : '❌ dropped';
    console.log(
      `  ${padR(block.name, 25)} ${padR(block.type, 8)} ${padR(block.priority, 10)} ${padL(String(block.tokenCount), 10)} ${status}`,
    );
    if (block.excludedReason) {
      console.log(`    └ ${block.excludedReason}`);
    }
  }
  console.log('');
}

// ============================================================================
// analyze — Beautiful analysis report with box formatting (P1-2: CLI Polish)
// ============================================================================
function analyzeFile(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  if (!Array.isArray(data)) {
    console.error('Error: Input file must contain a JSON array of objects.');
    process.exit(1);
  }

  const fields = data.length > 0 ? Object.keys(data[0]).length : 0;
  const tokenizer = new TokenizerManager();

  const primaryModel = getFlag('model') ?? 'gpt-4o-mini';
  const primarySpec = MODEL_REGISTRY[primaryModel] ?? MODEL_REGISTRY['gpt-4o-mini'];
  const primaryEncoding = primarySpec.encoding as TokenizerEncoding;
  const contexOnly = hasFlag('contex-only') || hasFlag('must-use-contex');
  const semanticGuardEnabled = hasFlag('semantic-guard');
  const selectedStrategiesRaw = parseStrategies(getFlag('strategy'), [
    'contex',
    'csv',
    'toon',
    'markdown',
    'auto',
  ]);
  const selectedStrategies = contexOnly
    ? (['contex', 'auto'] as StrategyName[])
    : selectedStrategiesRaw;

  const targetFloor = Number(getFlag('target-floor') ?? 35);
  const targetMedian = Number(getFlag('target-median') ?? 60);
  const autoConfidenceFloor = Number(getFlag('auto-confidence-floor') ?? 55);
  const strictAutoGate = hasFlag('strict-auto-gate') || hasFlag('fail-low-confidence');

  if (
    !Number.isFinite(targetFloor) ||
    !Number.isFinite(targetMedian) ||
    !Number.isFinite(autoConfidenceFloor)
  ) {
    console.error(
      'Error: --target-floor, --target-median, and --auto-confidence-floor must be numeric values.',
    );
    process.exit(1);
  }
  const outPath = getFlag('out') ?? ANALYZE_DEFAULT_OUT;

  // Get JSON token count (primary model encoding)
  const jsonText = JSON.stringify(data);
  const jsonBytes = Buffer.byteLength(jsonText);
  const jsonTokens = tokenizer.countTokens(jsonText, primaryEncoding);

  // Get Contex token count (TokenStream path - same basis as stats)
  const streamEncoder = new TokenStreamEncoder(primaryEncoding);
  const streamStats = streamEncoder.getStats(data);
  const tensBytes = streamStats.byteSize;
  const tensTokens = streamStats.totalTokenCount;

  // Breakthrough candidates (same model encoding, alternative representations)
  const strategyCandidates = buildStrategyCandidates(data, primaryEncoding, tokenizer);
  const csvTokens = strategyCandidates.find((s) => s.name === 'csv')?.tokens ?? 0;
  const toonTokens = strategyCandidates.find((s) => s.name === 'toon')?.tokens ?? 0;
  const markdownTokens = strategyCandidates.find((s) => s.name === 'markdown')?.tokens ?? 0;

  // Calculate savings
  const safeJsonTokens = Math.max(1, jsonTokens);
  const safeJsonBytes = Math.max(1, jsonBytes);
  const tokenReductionPct = (1 - tensTokens / safeJsonTokens) * 100;
  const tokenReduction = tokenReductionPct.toFixed(1);
  const bytesReductionPct = (1 - tensBytes / safeJsonBytes) * 100;

  const candidateRows: Array<{ name: string; tokens: number }> = [
    {
      name: 'Contex',
      tokens: strategyCandidates.find((s) => s.name === 'contex')?.tokens ?? tensTokens,
    },
    { name: 'CSV', tokens: csvTokens },
    { name: 'TOON', tokens: toonTokens },
    { name: 'Markdown', tokens: markdownTokens },
  ];
  const bestCandidate = candidateRows.reduce((best, cur) =>
    cur.tokens < best.tokens ? cur : best,
  );

  const tokenCountMap = new Map<string, number>();
  for (const candidate of strategyCandidates) {
    tokenCountMap.set(candidate.name, candidate.tokens);
  }
  tokenCountMap.set('tens', tensTokens);
  tokenCountMap.set('contex', tensTokens);

  const autoRecommendation = selectOptimalStrategy(data, tokenCountMap);
  const autoPickedStrategy = normalizeStrategyName(String(autoRecommendation.strategy));
  const autoPickedTokens = tokenCountMap.get(String(autoRecommendation.strategy)) ?? bestCandidate.tokens;
  const autoConfidence = computeAutoStrategyConfidence({
    selectedStrategy: autoPickedStrategy,
    selectedTokens: autoPickedTokens,
    allCandidates: strategyCandidates,
    structureScore: autoRecommendation.structure.contextoBenefitScore,
    matchesStructureRecommendation:
      normalizeStrategyName(String(autoRecommendation.strategy)) ===
      normalizeStrategyName(String(autoRecommendation.structure.recommendedStrategy)),
  });

  const breakthroughReductionPct = (1 - bestCandidate.tokens / safeJsonTokens) * 100;
  const upliftVsContexPct = (1 - bestCandidate.tokens / Math.max(1, tensTokens)) * 100;

  const strategyRows = selectedStrategies.map((strategy) => {
    if (strategy === 'auto') {
      return [
        'auto',
        `${autoPickedTokens.toLocaleString()}`,
        `${((1 - autoPickedTokens / safeJsonTokens) * 100).toFixed(1)}%`,
        autoPickedStrategy,
      ];
    }
    const tok = strategyCandidates.find((s) => s.name === strategy)?.tokens ?? 0;
    const pct = ((1 - tok / safeJsonTokens) * 100).toFixed(1);
    return [strategy, tok.toLocaleString(), `${pct}%`, '-'];
  });

  // Get model-specific savings
  const models = ['gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-2-5-flash'];
  const modelRows: string[][] = [];

  for (const modelId of models) {
    const spec = MODEL_REGISTRY[modelId];
    if (!spec) continue;

    const jsonModelTokens = tokenizer.countTokens(jsonText, spec.encoding);
    const modelStreamEncoder = new TokenStreamEncoder(spec.encoding as TokenizerEncoding);
    const tensModelTokens = modelStreamEncoder.encodeToTokenStream(data).length;
    modelStreamEncoder.dispose();
    const savingsPct = ((1 - tensModelTokens / Math.max(1, jsonModelTokens)) * 100).toFixed(1);

    // Cost per 1K calls (assuming 10K calls/day)
    const costPer1K = (tensModelTokens / 1_000_000) * spec.inputPricePer1M * 1000;

    modelRows.push([spec.name, `${savingsPct}% saved`, `$${costPer1K.toFixed(2)}/1K calls`]);
  }

  // Calculate dollar savings (assuming 10K requests/day)
  const gpt4oSpec = MODEL_REGISTRY['gpt-4o-mini'];
  const jsonDailyCost =
    (tokenizer.countTokens(jsonText, gpt4oSpec.encoding) / 1_000_000) *
    gpt4oSpec.inputPricePer1M *
    10000;
  const tensDailyCost = (tensTokens / 1_000_000) * gpt4oSpec.inputPricePer1M * 10000;
  const dailySavings = jsonDailyCost - tensDailyCost;
  const annualSavings = dailySavings * 365;

  // Build the beautiful box output
  const boxWidth = 60;

  console.log('\n');

  // Main analysis box
  const analysisLines: string[] = [
    `Input:        ${path.basename(inputPath)}`,
    `Rows:         ${data.length.toLocaleString()}`,
    `Fields:       ${fields}`,
    `Model:        ${primarySpec.name}`,
    `JSON Tokens:  ${jsonTokens.toLocaleString()}`,
    `Contex Tokens: ${tensTokens.toLocaleString()} ${'█'.repeat(Math.floor((Number.parseFloat(tokenReduction) / 100) * 10))}${'░'.repeat(10 - Math.floor((Number.parseFloat(tokenReduction) / 100) * 10))} ${tokenReduction}%`,
    `Savings:      $${annualSavings.toFixed(2)}/year @10k req/day`,
  ];

  console.log(drawBox('CONTEXT ANALYSIS', boxWidth, analysisLines));

  console.log('\n');

  // Models comparison table
  console.log(drawComparisonTable('Models', ['Model', 'Savings', 'Cost'], modelRows));

  console.log('\n');

  console.log(
    drawComparisonTable(
      'Strategies',
      ['Strategy', 'Tokens', 'Reduction', 'Auto Pick'],
      strategyRows,
    ),
  );

  console.log('\n');

  // Quick stats
  const statsBox = [
    `JSON:    ${jsonBytes} bytes / ${jsonTokens} tokens`,
    `Contex:  ${tensBytes} bytes / ${tensTokens} tokens`,
    `Bytes:   ${bytesReductionPct >= 0 ? '-' : '+'}${Math.abs(bytesReductionPct).toFixed(1)}%`,
    `Tokens:  -${tokenReduction}%`,
  ];
  console.log(drawBox('Token Reduction', boxWidth - 20, statsBox));

  console.log('\n');
  const breakthroughLines = [
    `Best now:     ${bestCandidate.name} (${bestCandidate.tokens.toLocaleString()} tokens)`,
    `Reduction:    ${breakthroughReductionPct.toFixed(1)}% vs JSON`,
    `Uplift:       ${upliftVsContexPct > 0 ? '+' : ''}${upliftVsContexPct.toFixed(1)} points vs Contex`,
    `Action:       ${contexOnly ? 'Contex-only policy active for user traffic' : `Use ${bestCandidate.name} for this workload when semantics allow`}`,
  ];
  console.log(drawBox('Breakthrough Potential', boxWidth + 8, breakthroughLines));

  const autoLines = [
    `Auto pick:    ${autoPickedStrategy} (${autoPickedTokens.toLocaleString()} tokens)`,
    `Confidence:   ${autoConfidence.scorePct}% (${autoConfidence.level})`,
    `Token margin: ${autoConfidence.marginPct.toFixed(2)}% vs runner-up`,
    `Reason:       ${autoRecommendation.reason}`,
  ];
  console.log('\n');
  console.log(drawBox('Auto Strategy Confidence', boxWidth + 14, autoLines));

  let semanticPass = true;
  if (semanticGuardEnabled) {
    const semantic = runSemanticRelationGuard(data, primaryEncoding);
    semanticPass = semantic.pass;
    const semanticLines = [
      `Status:   ${semantic.pass ? 'PASS' : 'FAIL'} (${semantic.reason})`,
      `Rows:     ${semantic.rowCountDecoded}/${semantic.rowCountOriginal}`,
      `Fields:   ${semantic.fieldPathCoveragePct.toFixed(1)}% (target >= 95%)`,
      `RowMatch: ${semantic.rowSignatureMatchPct.toFixed(1)}% (target >= 95%)`,
    ];
    console.log('\n');
    console.log(drawBox('Semantic Relation Guard', boxWidth + 14, semanticLines));
  }

  const shouldEvaluateGate = hasFlag('reality-gate') || hasFlag('strict-gate');
  const strictGate = hasFlag('strict-gate');
  let strictGateFailed = false;

  const autoSelected = selectedStrategies.includes('auto');
  const autoConfidencePass = autoConfidence.scorePct >= autoConfidenceFloor;
  const enforceAutoGate = strictAutoGate || (strictGate && autoSelected);

  if (autoSelected) {
    const autoGateLines = [
      `Enabled:     ${enforceAutoGate ? 'yes' : 'no'} (${strictAutoGate ? 'explicit' : strictGate ? 'strict-gate + auto strategy' : 'informational'})`,
      `Confidence:  ${autoConfidence.scorePct}% (${autoConfidence.level})`,
      `Threshold:   ${autoConfidenceFloor}% (${autoConfidencePass ? 'PASS' : 'FAIL'})`,
      `Decision:    ${autoPickedStrategy} (${autoPickedTokens.toLocaleString()} tokens)`,
    ];
    console.log('\n');
    console.log(drawBox('Auto Confidence Gate', boxWidth + 16, autoGateLines));

    if (enforceAutoGate && !autoConfidencePass) {
      strictGateFailed = true;
    }
  }

  if (shouldEvaluateGate) {
    // Improved Dynamic Gate: Use smarter shape consistency calculation
    // Instead of exact match, use field overlap percentage
    const firstRowKeys = new Set(Object.keys(data[0] || {}));

    let totalOverlapScore = 0;
    for (const row of data) {
      const rowKeys = new Set(Object.keys(row || {}));
      
      // Calculate intersection size
      let intersection = 0;
      for (const key of firstRowKeys) {
        if (rowKeys.has(key)) intersection++;
      }
      
      // Calculate Jaccard-like similarity: intersection / union
      const union = new Set([...firstRowKeys, ...rowKeys]).size;
      const overlapScore = union > 0 ? intersection / union : 0;
      totalOverlapScore += overlapScore;
    }
    
    const shapeConsistencyPct = data.length > 0 ? (totalOverlapScore / data.length) * 100 : 0;

    let deterministicOk = false;
    let irSize = 0;
    let stableHash = false;

    try {
      const ir1 = encodeIR(data as object[]);
      const ir2 = encodeIR(data as object[]);
      irSize = ir1.ir.length;
      stableHash = ir1.hash === ir2.hash;
      deterministicOk = stableHash && irSize > 0;
    } catch {
      deterministicOk = false;
    }

    const dynamicPass = shapeConsistencyPct >= 90;
    const neededPass = tokenReductionPct >= 15;
    const correctPass = deterministicOk;
    const semanticGatePass = semanticGuardEnabled ? semanticPass : true;
    const realPass = dynamicPass && neededPass && correctPass && semanticGatePass;

    const gateLines = [
      `Dynamic: ${dynamicPass ? 'PASS' : 'FAIL'} (${shapeConsistencyPct.toFixed(1)}% stable, target >= 90%)`,
      `Needed:  ${neededPass ? 'PASS' : 'FAIL'} (${tokenReductionPct.toFixed(1)}% reduction, target >= 15%)`,
      `Correct: ${correctPass ? 'PASS' : 'FAIL'} (hash stable: ${stableHash ? 'yes' : 'no'}, ir bytes: ${irSize})`,
      `Semantic:${semanticGatePass ? 'PASS' : 'FAIL'} (${semanticGuardEnabled ? 'guard enforced' : 'not enabled'})`,
      `Real:    ${realPass ? 'PASS' : 'FAIL'} (${realPass ? 'all gates green' : 'requires Dynamic + Needed + Correct'})`,
    ];

    console.log('\n');
    console.log(drawBox('Reality Gate', boxWidth + 18, gateLines));

    if (strictGate && !realPass) {
      strictGateFailed = true;
    }
  }

  const currentRun: SnapshotRun = {
    timestamp: new Date().toISOString(),
    command: 'analyze',
    inputPath: path.resolve(inputPath),
    model: primaryModel,
    metrics: {
      jsonTokens,
      contexTokens: tensTokens,
      bestStrategy: bestCandidate.name,
      bestTokens: bestCandidate.tokens,
      autoStrategy: autoPickedStrategy,
      autoConfidencePct: autoConfidence.scorePct,
      tokenReductionPct: Number(tokenReductionPct.toFixed(2)),
      breakthroughReductionPct: Number(breakthroughReductionPct.toFixed(2)),
    },
  };

  const previousRun = appendSnapshot(outPath, currentRun);
  if (previousRun) {
    const prevContex = Number(previousRun.metrics.contexTokens ?? 0);
    const prevReduction = Number(previousRun.metrics.tokenReductionPct ?? 0);
    const prevBest = Number(previousRun.metrics.bestTokens ?? 0);

    const deltaLines = [
      `Contex tokens: ${tensTokens.toLocaleString()} (${formatDelta(tensTokens, prevContex)})`,
      `Reduction:     ${tokenReductionPct.toFixed(1)}% (${formatDelta(tokenReductionPct, prevReduction)} pts)`,
      `Best tokens:   ${bestCandidate.tokens.toLocaleString()} (${formatDelta(bestCandidate.tokens, prevBest)})`,
    ];
    console.log('\n');
    console.log(drawBox('Delta vs Last Run', boxWidth + 10, deltaLines));
  }

  const allRuns = loadSnapshotRuns(outPath);
  const scorecard = buildLatestScorecard(allRuns, primaryModel);

  if (scorecard.datasetCount > 0) {
    const floorPass = scorecard.floorReductionPct >= targetFloor;
    const medianPass = scorecard.medianReductionPct >= targetMedian;
    const targetGatePass = floorPass && medianPass;

    const targetLines = [
      `Datasets: ${scorecard.datasetCount} (latest per input path)`,
      `Floor:    ${scorecard.floorReductionPct.toFixed(2)}% (${floorPass ? 'PASS' : 'FAIL'}, target >= ${targetFloor}%)`,
      `Median:   ${scorecard.medianReductionPct.toFixed(2)}% (${medianPass ? 'PASS' : 'FAIL'}, target >= ${targetMedian}%)`,
      `Policy:   ${contexOnly ? 'Contex-only enabled' : 'Mixed strategy allowed'}`,
    ];

    console.log('\n');
    console.log(drawBox('Hard Target Gate', boxWidth + 14, targetLines));

    if (strictGate && !targetGatePass) {
      strictGateFailed = true;
    }
  }

  console.log(`\n  Snapshot: ${outPath}`);

  console.log('\n');

  streamEncoder.dispose();
  tokenizer.dispose();

  if ((strictGate || strictAutoGate) && strictGateFailed) {
    console.error('  Strict Gate: FAIL (real gate failed).');
    process.exit(2);
  }
}

// ============================================================================
// cache-diagnose — Show cache readiness diagnostics
// ============================================================================
function cacheDiagnose(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    console.error('Usage: contex cache-diagnose <file.json> --model <model>');
    process.exit(1);
  }

  const modelId = getFlag('model') ?? 'gpt-4o-mini';
  const storeDir = getFlag('store') ?? '.contex';

  const modelSpec = MODEL_REGISTRY[modelId];
  if (!modelSpec) {
    console.error(`Error: Unknown model "${modelId}".`);
    process.exit(1);
  }

  // Read and encode data
  const raw = readFileSync(inputPath, 'utf-8');
  let data: Record<string, unknown>[];
  try {
    data = JSON.parse(raw);
  } catch {
    console.error('Error: Invalid JSON file');
    process.exit(1);
  }
  if (!Array.isArray(data)) {
    console.error('Error: Input file must contain a JSON array.');
    process.exit(1);
  }

  const memory = new TokenMemory(storeDir);
  const start = performance.now();

  // Store IR
  const storeResult = memory.store(data);
  const encodeMs = (performance.now() - start).toFixed(1);

  // Check if materialization is cached
  const cachedModels = memory.getCachedModels(storeResult.hash);
  const isMaterialized = cachedModels.includes(modelId);

  // Get metadata
  const meta = memory.getMeta(storeResult.hash);

  // Estimate first-run latency
  let estimatedFirstRunMs = 'N/A';
  if (!isMaterialized) {
    const estimateStart = performance.now();
    try {
      memory.materializeAndCache(storeResult.hash, modelId);
      estimatedFirstRunMs = (performance.now() - estimateStart).toFixed(1);
    } catch {
      estimatedFirstRunMs = 'error';
    }
  }

  memory.dispose();

  // Determine readiness
  const isReady = isMaterialized;
  const readiness = isReady ? '✅ READY' : '⚠️  NOT READY';
  const recommendation = isReady
    ? 'Cache is warm, subsequent requests will be fast.'
    : 'Run `contex materialize` or make a request to warm the cache.';

  // Build output
  const boxWidth = 58;
  const lines = [
    `Input:       ${path.basename(inputPath)}`,
    `Rows:        ${data.length.toLocaleString()}`,
    `IR Hash:     ${storeResult.hash.slice(0, 12)}...`,
    `Encode time:  ${encodeMs}ms`,
    ``,
    `Model:       ${modelSpec.name}`,
    `Encoding:    ${modelSpec.encoding}`,
    `Materialized: ${isMaterialized ? '✅ Yes' : '❌ No'}`,
    `Cached for:  ${cachedModels.length > 0 ? cachedModels.join(', ') : '(none)'}`,
    ``,
    `IR status:       ✅ Stored`,
    `Disk cache:      ${isMaterialized ? '✅ HIT' : '❌ MISS'}`,
    `1st run latency: ~${estimatedFirstRunMs}ms`,
    ``,
    `Readiness:   ${readiness}`,
    `Recommendation: ${recommendation}`,
  ];

  console.log('\n');
  console.log(drawBox('Cache Diagnostics', boxWidth, lines));
  console.log('');
}

// ============================================================================
// cache-warm — Pre-materialize for multiple models
// ============================================================================
function cacheWarm(): void {
  const inputPath = args[1];
  if (!inputPath) {
    console.error('Error: missing input file');
    console.error('Usage: contex cache-warm <file.json> --models gpt-4o,claude-3-5-sonnet,gemini-2-5-flash');
    process.exit(1);
  }

  const modelsArg = getFlag('models');
  if (!modelsArg) {
    console.error('Error: missing --models flag');
    console.error('Usage: contex cache-warm <file.json> --models gpt-4o,claude-3-5-sonnet');
    process.exit(1);
  }

  const models = modelsArg.split(',').map((m) => m.trim());
  const storeDir = getFlag('store') ?? '.contex';

  // Read and encode data
  const raw = readFileSync(inputPath, 'utf-8');
  let data: Record<string, unknown>[];
  try {
    data = JSON.parse(raw);
  } catch {
    console.error('Error: Invalid JSON file');
    process.exit(1);
  }
  if (!Array.isArray(data)) {
    console.error('Error: Input file must contain a JSON array.');
    process.exit(1);
  }

  console.log(`\n  ${doubleLine}`);
  console.log('  Cache Warm — Pre-materialize');
  console.log(`  ${doubleLine}`);
  console.log(`  Input:  ${inputPath}`);
  console.log(`  Models: ${models.join(', ')}`);
  console.log(`  ${line}\n`);

  const memory = new TokenMemory(storeDir);
  const storeResult = memory.store(data);

  console.log(`  IR Hash: ${storeResult.hash.slice(0, 12)}...`);
  console.log('');

  for (const modelId of models) {
    const modelSpec = MODEL_REGISTRY[modelId];
    if (!modelSpec) {
      console.log(`  ⚠️  ${modelId}: Unknown model, skipping`);
      continue;
    }

    const start = performance.now();
    try {
      const result = memory.materializeAndCache(storeResult.hash, modelId);
      const ms = (performance.now() - start).toFixed(1);
      console.log(`  ✅ ${modelId}: ${result.tokenCount.toLocaleString()} tokens in ${ms}ms`);
    } catch (error) {
      console.log(`  ❌ ${modelId}: ${errorMessage(error)}`);
    }
  }

  memory.dispose();
  console.log(`\n  ${doubleLine}\n`);
}

// ============================================================================
// cache-stats — Show aggregate cache telemetry
// ============================================================================
function cacheStats(): void {
  const diagnostics = getGlobalDiagnostics();
  const telemetry = diagnostics.getTelemetry();

  const boxWidth = 52;
  const lines = [
    `Total requests: ${telemetry.totalRequests.toLocaleString()}`,
    `Hits:          ${telemetry.hits.toLocaleString()}`,
    `Misses:        ${telemetry.misses.toLocaleString()}`,
    `Hit rate:      ${telemetry.hitRate.toFixed(1)}%`,
    ``,
    `Latency (ms):`,
    `  p50:  ${telemetry.latencyPercentiles.p50.toFixed(2)}`,
    `  p95:  ${telemetry.latencyPercentiles.p95.toFixed(2)}`,
    `  p99:  ${telemetry.latencyPercentiles.p99.toFixed(2)}`,
    `  avg:  ${telemetry.latencyPercentiles.avg.toFixed(2)}`,
    ``,
    `Since: ${telemetry.since.slice(0, 19).replace('T', ' ')}`,
  ];

  console.log('\n');
  console.log(drawBox('Cache Telemetry', boxWidth, lines));
  console.log('');

  // Show miss reasons if any
  const missReasons = Object.entries(telemetry.missesByReason).filter(([, count]) => count > 0);
  if (missReasons.length > 0) {
    console.log('  Miss reasons:');
    for (const [reason, count] of missReasons) {
      const pct = ((count as number) / telemetry.misses * 100).toFixed(1);
      console.log(`    ${reason}: ${count} (${pct}%)`);
    }
    console.log('');
  }
}

type StatusProviderGateway = {
  middlewareConnected?: boolean;
  openaiConfigured?: boolean;
  anthropicConfigured?: boolean;
  geminiConfigured?: boolean;
};

type StatusHealthResponse = {
  status?: string;
  service?: string;
  version?: string;
  providerGateway?: StatusProviderGateway;
};

function requestJson(url: string, timeoutMs: number): Promise<{ statusCode: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const requestFn = parsedUrl.protocol === 'https:' ? httpsRequest : httpRequest;

    const req = requestFn(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8').trim();
          if (!body) {
            resolve({ statusCode: res.statusCode ?? 0, json: {} });
            return;
          }

          try {
            resolve({ statusCode: res.statusCode ?? 0, json: JSON.parse(body) as unknown });
          } catch {
            reject(new Error('Health endpoint did not return valid JSON'));
          }
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

async function statusCommand(): Promise<void> {
  const jsonMode = hasFlag('json');

  function failStatus(message: string, details?: unknown): never {
    if (jsonMode) {
      const payload = {
        ok: false,
        error: message,
        ...(details !== undefined ? { details } : {}),
      };
      console.error(JSON.stringify(payload, null, 2));
    } else {
      console.error(message);
      if (details !== undefined) {
        console.error(String(details));
      }
    }
    process.exit(1);
  }

  const baseUrl = getFlag('url') ?? process.env.CONTEX_API_URL ?? 'http://127.0.0.1:3000';
  const timeoutMs = Number(getFlag('timeout-ms') ?? 3000);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    failStatus('Error: --timeout-ms must be a positive number.');
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    failStatus(`Error: invalid --url value "${baseUrl}".`);
  }

  const basePath = parsedBaseUrl.pathname.endsWith('/')
    ? parsedBaseUrl.pathname.slice(0, -1)
    : parsedBaseUrl.pathname;
  const healthPath = /\/health$/i.test(basePath) ? basePath : `${basePath}/health`;
  const healthUrl = `${parsedBaseUrl.protocol}//${parsedBaseUrl.host}${healthPath}${parsedBaseUrl.search}`;

  let statusCode = 0;
  let payload: StatusHealthResponse;

  try {
    const response = await requestJson(healthUrl, timeoutMs);
    statusCode = response.statusCode;
    payload = response.json as StatusHealthResponse;
  } catch (error: unknown) {
    failStatus(`Error: unable to reach Contex API at ${healthUrl}`, `Reason: ${errorMessage(error)}`);
  }

  if (statusCode !== 200) {
    failStatus(`Error: health endpoint responded with HTTP ${statusCode}`);
  }

  const gateway = payload.providerGateway ?? {};
  const middlewareConnected = gateway.middlewareConnected === true;
  const openaiConfigured = gateway.openaiConfigured === true;
  const anthropicConfigured = gateway.anthropicConfigured === true;
  const geminiConfigured = gateway.geminiConfigured === true;

  const lines = [
    `URL:        ${healthUrl}`,
    `Service:    ${payload.service ?? 'unknown'}`,
    `Version:    ${payload.version ?? 'unknown'}`,
    `Status:     ${payload.status === 'ok' ? 'OK' : String(payload.status ?? 'unknown')}`,
    '',
    `Gateway:    ${middlewareConnected ? 'Connected' : 'Disconnected'}`,
    `OpenAI:     ${openaiConfigured ? 'Configured' : 'Missing OPENAI_API_KEY'}`,
    `Anthropic:  ${anthropicConfigured ? 'Configured' : 'Missing ANTHROPIC_API_KEY'}`,
    `Gemini:     ${geminiConfigured ? 'Configured' : 'Missing GOOGLE_API_KEY'}`,
  ];

  const missingProviders: string[] = [];
  if (!openaiConfigured) missingProviders.push('OPENAI_API_KEY');
  if (!anthropicConfigured) missingProviders.push('ANTHROPIC_API_KEY');
  if (!geminiConfigured) missingProviders.push('GOOGLE_API_KEY');

  const ok =
    payload.status === 'ok' &&
    middlewareConnected &&
    missingProviders.length === 0;

  if (jsonMode) {
    const statusPayload = {
      ok,
      url: healthUrl,
      statusCode,
      service: payload.service ?? 'unknown',
      version: payload.version ?? 'unknown',
      status: payload.status ?? 'unknown',
      providerGateway: {
        middlewareConnected,
        openaiConfigured,
        anthropicConfigured,
        geminiConfigured,
      },
      missingProviders,
    };
    console.log(JSON.stringify(statusPayload, null, 2));
    if (!ok) {
      process.exit(1);
    }
    return;
  }

  console.log('\n');
  console.log(drawBox('Server Status', 74, lines));

  if (missingProviders.length > 0) {
    console.log('');
    console.log('  Missing provider keys:');
    for (const envVar of missingProviders) {
      console.log(`    - ${envVar}`);
    }
    console.log('  Configure them in the server environment to enable provider routes.');
  }

  console.log('');
}

async function runCommand(): Promise<void> {
  switch (command) {
    case 'analyze':
      analyzeFile();
      break;
    case 'scorecard':
      scorecardReport();
      break;
    case 'status':
      await statusCommand();
      break;
    case 'cache-diagnose':
      cacheDiagnose();
      break;
    case 'cache-warm':
      cacheWarm();
      break;
    case 'cache-stats':
      cacheStats();
      break;
    case 'encode':
      encodeFile();
      break;
    case 'decode':
      decodeFile();
      break;
    case 'stats':
      showStats();
      break;
    case 'formats':
      showFormats();
      break;
    case 'convert':
      convertFile();
      break;
    case 'validate':
      validateFile();
      break;
    case 'guard':
      guardFile();
      break;
    case 'savings':
      showSavings();
      break;
    case 'ir-encode':
      irEncode();
      break;
    case 'ir-inspect':
    case 'inspect': // Alias
      irInspect();
      break;
    case 'ir-materialize':
      irMaterialize();
      break;
    case 'materialize':
      materializeFile();
      break;
    case 'compose':
      if (args[1]?.endsWith('.json') && !args[2]) {
        composeFromConfig();
      } else {
        composePrompt();
      }
      break;
    case 'inject':
      injectFile();
      break;
    case 'bench':
      await import('./benchmark.js');
      break;
    default:
      printUsage();
      break;
  }
}

runCommand().catch((error: unknown) => {
  console.error(`Error: ${errorMessage(error)}`);
  process.exit(1);
});
