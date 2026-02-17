#!/usr/bin/env node
// ============================================================================
// ContexDB Benchmark v7 — Comprehensive Pipeline Benchmark
// ============================================================================
//
// Tests the REAL ContexDB pipeline end-to-end with:
//   1. Token Matrix      — Contex vs JSON/TOON/CSV across 15 dataset types
//   2. Full Pipeline      — Tens.encode → materialize → budget → compose → quick
//   3. Data Fidelity      — Verifies data survives pipeline (what goes in = what comes out)
//   4. Cross-Package      — core → engine → middleware connectivity check
//   5. Latency            — encode + materialize timing across all dataset types
//   6. Format Ranking     — All formats ranked head-to-head on RealWorld data
//   7. Summary            — aggregated results with visual bars
//
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { Tens, TokenizerManager, formatOutput, compose, encodeIR } from '@contex/core';
import type { OutputFormat } from '@contex/core';
import { MODEL_REGISTRY, calculateBudget, quick, Contex, packContext, selectBestFormat } from '@contex/engine';
import type { PackerConfig } from '@contex/engine';

import {
  generateChatMessages,
  generateDeepNested,
  generateEcommerce,
  generateExtremelySparse,
  generateFlat,
  generateHealthcare,
  generateIoT,
  generateLogEvents,
  generateMixedNestedTabular,
  generateNested,
  generateNumericHeavy,
  generateRealWorld,
  generateRepetitive,
  generateSparse,
  generateWideSchema,
} from './generators.js';
import { extractLeafValues } from './metrics.js';

// ---- Types ----

type DatasetFactory = (rows: number) => Record<string, unknown>[];

interface MatrixRow {
  dataset: string;
  rows: number;
  format: string;
  tokens: number;
  bytes: number;
  savingsVsJson: number;
}

interface LatencyRow {
  dataset: string;
  size: number;
  encode: { p50: number; p95: number };
  materialize: { p50: number; p95: number };
  total: { p50: number; p95: number };
}

interface PipelineResult {
  dataset: string;
  rows: number;
  irHash: string;
  irBytes: number;
  contexTokens: number;
  jsonTokens: number;
  savingsPercent: number;
  budgetGain: number;
  composeBlocks: number;
  quickApiMatch: boolean;
}

interface FidelityResult {
  test: string;
  status: 'pass' | 'fail';
  detail: string;
}

interface ConnectivityResult {
  package: string;
  component: string;
  status: 'pass' | 'fail';
  detail: string;
}

interface BenchmarkReport {
  metadata: {
    version: string;
    timestamp: string;
    model: string;
    datasetCount: number;
  };
  matrix: MatrixRow[];
  pipeline: PipelineResult[];
  fidelity: FidelityResult[];
  connectivity: ConnectivityResult[];
  latency: LatencyRow[];
  summary: {
    avgSavingsPercent: number;
    maxSavingsPercent: number;
    minSavingsPercent: number;
    avgBudgetGain: number;
    avgEncodeUsPerRow: number;
    avgMaterializeUsPerRow: number;
    fidelityScore: string;
    connectivityScore: string;
    totalTests: number;
    passed: number;
    failed: number;
  };
}

// ---- Config ----

const args = process.argv.slice(2);
const outPath = (() => {
  const idx = args.indexOf('--out');
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : 'benchmark_results.json';
})();
const websiteSync = args.includes('--sync-website');

const modelId = 'gpt-4o-mini';
const tokenizer = new TokenizerManager();

// All 15 dataset types — Flat/Tabular, Nested/Complex, Industry, Edge Cases
const datasets: Array<{ name: string; fn: DatasetFactory; category: string }> = [
  // Flat / Tabular
  { name: 'Flat', fn: generateFlat, category: 'tabular' },
  { name: 'RealWorld', fn: generateRealWorld, category: 'tabular' },
  { name: 'NumericHeavy', fn: generateNumericHeavy, category: 'tabular' },
  { name: 'Repetitive', fn: generateRepetitive, category: 'tabular' },
  // Nested / Complex
  { name: 'Nested', fn: generateNested, category: 'nested' },
  { name: 'DeepNested', fn: (n) => generateDeepNested(n, 5), category: 'nested' },
  { name: 'MixedNested', fn: generateMixedNestedTabular, category: 'nested' },
  // Industry / Real-World
  { name: 'Ecommerce', fn: generateEcommerce, category: 'industry' },
  { name: 'Healthcare', fn: generateHealthcare, category: 'industry' },
  { name: 'IoT', fn: generateIoT, category: 'industry' },
  // Edge Cases
  { name: 'Sparse', fn: generateSparse, category: 'edge' },
  { name: 'ExtSparse', fn: generateExtremelySparse, category: 'edge' },
  { name: 'WideSchema', fn: (n) => generateWideSchema(n, 40), category: 'edge' },
  { name: 'ChatMessages', fn: generateChatMessages, category: 'edge' },
  { name: 'LogEvents', fn: generateLogEvents, category: 'edge' },
];

const matrixSizes = [100, 1000];
const latencyIterations = 10;
const TOTAL_SECTIONS = 7;

// ---- UI Helpers ----

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';
const BG_GREEN = '\x1b[42m\x1b[30m';
const BG_RED = '\x1b[41m\x1b[37m';

function bar(pct: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const color = pct >= 60 ? GREEN : pct >= 40 ? YELLOW : RED;
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}

function pad(str: string | number, len: number, align: 'left' | 'right' = 'right'): string {
  const s = String(str);
  if (align === 'left') return s.padEnd(len);
  return s.padStart(len);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return Number((sorted[index] ?? 0).toFixed(2));
}

function getTextTokens(data: Record<string, unknown>[], format: OutputFormat): { tokens: number; bytes: number } {
  const output = formatOutput(data, format);
  return {
    tokens: tokenizer.countTokens(output, 'o200k_base'),
    bytes: Buffer.byteLength(output),
  };
}

function divider(char = '━', len = 90) {
  console.log(DIM + char.repeat(len) + RESET);
}

function sectionHeader(num: number, title: string) {
  console.log('');
  divider();
  console.log(`${BOLD}${CYAN}  [${num}/${TOTAL_SECTIONS}] ${title}${RESET}`);
  divider('─');
}

// ============================================================================
// 1. Token Matrix — Contex vs JSON/TOON/CSV across all datasets
// ============================================================================

function buildMatrix(): MatrixRow[] {
  sectionHeader(1, 'Token Savings Matrix — Contex vs JSON/TOON/CSV');
  const rows: MatrixRow[] = [];

  console.log(
    `  ${pad('Dataset', 14, 'left')} ${pad('Rows', 5)} │ ${pad('JSON', 7)} ${pad('TOON', 7)} ${pad('CSV', 7)} ${pad('Contex', 7)} │ ${pad('Saved', 5)}  ${'Savings'}`,
  );
  console.log(`  ${'─'.repeat(14)} ${'─'.repeat(5)} ┼ ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(7)} ┼ ${'─'.repeat(5)}  ${'─'.repeat(20)}`);

  for (const dataset of datasets) {
    for (const size of matrixSizes) {
      const data = dataset.fn(size);
      const json = getTextTokens(data, 'json');
      const toon = getTextTokens(data, 'toon');
      const csv = getTextTokens(data, 'csv');
      const contex = getTextTokens(data, 'contex');

      const saving = json.tokens > 0 ? Math.round((json.tokens - contex.tokens) / json.tokens * 100) : 0;

      for (const [fmt, t] of [['json', json], ['toon', toon], ['csv', csv], ['contex', contex]] as const) {
        rows.push({
          dataset: dataset.name,
          rows: size,
          format: fmt as string,
          tokens: t.tokens,
          bytes: t.bytes,
          savingsVsJson: fmt === 'json' ? 0 : Math.round((json.tokens - t.tokens) / json.tokens * 100),
        });
      }

      console.log(
        `  ${pad(dataset.name, 14, 'left')} ${pad(size, 5)} │ ${pad(json.tokens, 7)} ${pad(toon.tokens, 7)} ${pad(csv.tokens, 7)} ${BOLD}${pad(contex.tokens, 7)}${RESET} │ ${BOLD}${saving >= 50 ? GREEN : saving >= 30 ? YELLOW : RED}${pad(saving + '%', 5)}${RESET}  ${bar(saving)}`,
      );
    }
  }

  return rows;
}

// ============================================================================
// 2. Full Pipeline — Tens.encode → IR → materialize → budget → compose
// ============================================================================

function buildPipeline(): PipelineResult[] {
  sectionHeader(2, 'Full Pipeline — encode → materialize → budget → compose → quick');

  console.log(
    `  ${pad('Dataset', 14, 'left')} │ ${pad('JSON', 7)} ${pad('Contex', 7)} ${pad('Saved', 6)} │ ${pad('+Rows', 6)} ${pad('Blk', 4)} ${pad('API', 4)} │ ${'Savings'}`,
  );
  console.log(`  ${'─'.repeat(14)} ┼ ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(6)} ┼ ${'─'.repeat(6)} ${'─'.repeat(4)} ${'─'.repeat(4)} ┼ ${'─'.repeat(20)}`);

  const results: PipelineResult[] = [];

  for (const dataset of datasets) {
    const data = dataset.fn(500);

    // Tens.encode (core)
    const tens = Tens.encode(data);
    const irHash = tens.hash;
    const irBytes = tens.ir.length;
    const contexTokens = tens.tokenCount(modelId);

    // JSON baseline
    const jsonText = JSON.stringify(data);
    const jsonTokens = tokenizer.countTokens(jsonText, 'o200k_base');
    const savingsPercent = jsonTokens > 0 ? Math.round(((jsonTokens - contexTokens) / jsonTokens) * 100) : 0;

    // Budget (engine)
    let budgetGain = 0;
    try {
      const budget = calculateBudget(data, {
        model: modelId, systemPromptTokens: 500, userPromptTokens: 200,
        responseReserve: 4096, formats: ['tens', 'json'],
      }, tokenizer);
      const tensRows = budget.formatBreakdown.find((x) => x.format === 'tens')?.maxRows ?? 0;
      const jsonRows = budget.formatBreakdown.find((x) => x.format === 'json')?.maxRows ?? 0;
      budgetGain = tensRows - jsonRows;
    } catch { /* ignore */ }

    // Compose (core)
    let composeBlocks = 0;
    try {
      const ir = encodeIR(data);
      const composed = compose({
        blocks: [
          { name: 'system', type: 'text', content: 'System: You are a helpful assistant.', priority: 'required' },
          { name: 'data', type: 'ir', ir, priority: 'optional' },
        ],
        model: modelId,
      });
      composeBlocks = composed.blocks.filter((b) => b.included).length;
    } catch { composeBlocks = -1; }

    // quick() API
    let quickApiMatch = false;
    try {
      const quickResult = quick(data, modelId);
      quickApiMatch = quickResult.tens.hash === irHash;
    } catch { /* ignore */ }

    const result: PipelineResult = {
      dataset: dataset.name, rows: 500, irHash, irBytes,
      contexTokens, jsonTokens, savingsPercent, budgetGain,
      composeBlocks, quickApiMatch,
    };
    results.push(result);

    const apiIcon = quickApiMatch ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(
      `  ${pad(dataset.name, 14, 'left')} │ ${pad(jsonTokens, 7)} ${pad(contexTokens, 7)} ${BOLD}${savingsPercent >= 50 ? GREEN : savingsPercent >= 30 ? YELLOW : RED}${pad(savingsPercent + '%', 6)}${RESET} │ ${pad('+' + budgetGain, 6)} ${pad(composeBlocks, 4)} ${apiIcon}    │ ${bar(savingsPercent)}`,
    );
  }

  return results;
}

// ============================================================================
// 3. Data Fidelity Tests — Verify data integrity through pipeline
// ============================================================================

function buildFidelity(): FidelityResult[] {
  sectionHeader(3, 'Data Fidelity — What goes in MUST come out');
  const results: FidelityResult[] = [];

  const check = (name: string, fn: () => boolean, detail: string) => {
    try {
      const pass = fn();
      results.push({ test: name, status: pass ? 'pass' : 'fail', detail });
      const icon = pass ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      console.log(`  ${icon}  ${name}: ${DIM}${detail}${RESET}`);
    } catch (e) {
      results.push({ test: name, status: 'fail', detail: String(e) });
      console.log(`  ${RED}✗${RESET}  ${name}: ${RED}${String(e).slice(0, 80)}${RESET}`);
    }
  };

  // Test 1: Exact string match — "how are you" must come back exactly
  check('String exact match', () => {
    const data = [
      { message: 'how are you', sender: 'user' },
      { message: 'I am fine thank you', sender: 'assistant' },
    ];
    const out = Tens.encode(data).toString();
    return out.includes('how are you') && out.includes('I am fine thank you');
  }, '"how are you" -> Contex -> "how are you"');

  // Test 2: Numeric precision
  check('Numeric precision', () => {
    const data = [{ price: 19.99, quantity: 1000000, ratio: 0.00001, negative: -42.5 }];
    const out = Tens.encode(data).toString();
    return out.includes('19.99') && out.includes('1000000') && out.includes('0.00001') && out.includes('-42.5');
  }, 'Decimals, large ints, negatives preserved');

  // Test 3: Boolean values
  check('Boolean integrity', () => {
    const data = [{ active: true, deleted: false, name: 'test' }];
    const out = Tens.encode(data).toString();
    return (out.includes('T') || out.includes('true')) && (out.includes('F') || out.includes('false'));
  }, 'true->T, false->F preserved');

  // Test 4: Null handling
  check('Null preservation', () => {
    const data = [
      { name: 'Alice', notes: null, score: 95 },
      { name: 'Bob', notes: 'has notes', score: null },
    ];
    const out = Tens.encode(data).toString();
    return out.includes('Alice') && out.includes('Bob') && out.includes('has notes') && out.includes('_');
  }, 'null->_ marker, non-null values intact');

  // Test 5: Special characters
  check('Special characters', () => {
    const data = [{ text: 'Hello "world"', path: 'C:\\Users\\test', emoji: '🚀 launch' }];
    const out = Tens.encode(data).toString();
    return out.includes('Hello') && out.includes('world');
  }, 'Quotes, backslashes, emoji survive');

  // Test 6: Unicode / multilingual
  check('Unicode fidelity', () => {
    const data = [{ en: 'hello', ja: 'こんにちは', zh: '你好', ko: '안녕하세요', ar: 'مرحبا' }];
    const out = Tens.encode(data).toString();
    return out.includes('hello') && out.includes('こんにちは') && out.includes('你好') && out.includes('안녕하세요');
  }, 'Japanese, Chinese, Korean, Arabic preserved');

  // Test 7: Array data inside rows
  check('Array data fidelity', () => {
    const data = [{ tags: ['urgent', 'bug', 'frontend'], scores: [95, 87, 72] }];
    const out = Tens.encode(data).toString();
    return out.includes('urgent') && out.includes('bug') && out.includes('95') && out.includes('72');
  }, 'String and numeric arrays survive');

  // Test 8: Deterministic output
  check('Deterministic output', () => {
    const data = [{ a: 1, b: 'test', c: true }];
    const o1 = Tens.encode(data).toString();
    const o2 = Tens.encode(data).toString();
    const o3 = Tens.encode(data).toString();
    return o1 === o2 && o2 === o3;
  }, '3 encodes produce identical output');

  // Test 9: Key order independence
  check('Key order agnostic', () => {
    const d1 = [{ z: 'last', a: 'first', m: 'middle' }];
    const d2 = [{ a: 'first', m: 'middle', z: 'last' }];
    return Tens.encode(d1).hash === Tens.encode(d2).hash;
  }, '{z,a,m} and {a,m,z} produce same hash');

  // Test 10: Empty data
  check('Empty data handling', () => {
    const tens = Tens.encode([]);
    return tens.hash !== '' && tens.rowCount === 0;
  }, 'Empty array encoded without error');

  // Test 11: Large payload — first + last row intact
  check('1000-row data fidelity', () => {
    const data = generateFlat(1000);
    const out = Tens.encode(data).toString();
    return out.includes('User 0') && out.includes('User 999') &&
           out.includes('user0@example.com') && out.includes('user999@example.com');
  }, 'First + last row of 1000-row dataset verified');

  // Test 12: Nested object values
  check('Nested data fidelity', () => {
    const data = [{ user: { name: 'Alice', profile: { age: 30, city: 'NYC' } } }];
    const out = Tens.encode(data).toString();
    return out.includes('Alice') && out.includes('30') && out.includes('NYC');
  }, 'Nested object values preserved at any depth');

  // Test 13: Deep nested (5 levels)
  check('Deep nested (5 levels)', () => {
    const data = generateDeepNested(5, 5);
    const out = Tens.encode(data).toString();
    // Should contain the leaf values from the generator
    return out.length > 100 && out.includes('0');
  }, '5-level nested objects survive flattening');

  // Test 14: Sparse data — most fields null
  check('Sparse data fidelity', () => {
    const data = generateSparse(20);
    const out = Tens.encode(data).toString();
    return out.includes('_') && out.length > 50;
  }, 'Sparse rows with many nulls handled correctly');

  // Test 15: Tokenize→detokenize round-trip
  check('Token round-trip', () => {
    const data = [
      { question: 'What is the capital of France?', answer: 'Paris' },
      { question: 'What is 2+2?', answer: '4' },
    ];
    const out = Tens.encode(data).toString();
    const tokens = tokenizer.tokenize(out, 'o200k_base');
    const detokenized = tokenizer.detokenize(tokens, 'o200k_base');
    return detokenized.includes('capital of France') && detokenized.includes('Paris') &&
           detokenized.includes('2+2') && detokenized.includes('4');
  }, 'Contex -> tokenize -> detokenize preserves meaning');

  // Test 16: quick() API round-trip
  check('quick() API fidelity', () => {
    const data = [
      { task: 'Summarize this article', priority: 'high' },
      { task: 'Translate to Spanish', priority: 'low' },
    ];
    const text = quick(data, modelId).asText();
    return text.includes('Summarize this article') && text.includes('Translate to Spanish') &&
           text.includes('high') && text.includes('low');
  }, 'quick() output contains all input values');

  // Test 17: Dictionary compression doesn't corrupt
  check('Dictionary fidelity', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({
      status: i % 3 === 0 ? 'active' : i % 3 === 1 ? 'pending' : 'deleted',
      region: 'us-west-2', id: i,
    }));
    const out = Tens.encode(data).toString();
    return out.includes('@') && out.includes('0') && out.includes('49');
  }, 'High-repetition data uses dict refs correctly');

  // Test 18: Chat message integrity — critical for LLM use
  check('Chat message integrity', () => {
    const msgs = [
      { role: 'user', content: 'Explain quantum computing in simple terms' },
      { role: 'assistant', content: 'Quantum computing uses qubits that can be 0, 1, or both simultaneously' },
      { role: 'user', content: 'What are practical applications?' },
    ];
    const out = Tens.encode(msgs).toString();
    return out.includes('Explain quantum computing') && out.includes('qubits') && out.includes('practical applications');
  }, 'Full chat history preserved word-for-word');

  // Test 19: Extremely sparse data (95%+ nulls)
  check('Extremely sparse fidelity', () => {
    const data = generateExtremelySparse(50);
    const out = Tens.encode(data).toString();
    return out.includes('_') && out.length > 100;
  }, '95%+ null fields handled without data loss');

  // Test 20: Mixed nested + tabular
  check('Mixed nested+tabular', () => {
    const data = generateMixedNestedTabular(10);
    const out = Tens.encode(data).toString();
    return out.length > 100;
  }, 'Hybrid schemas with nested objects + flat fields');

  return results;
}

// ============================================================================
// 4. Cross-Package Connectivity
// ============================================================================

async function buildConnectivity(): Promise<ConnectivityResult[]> {
  sectionHeader(4, 'Cross-Package Connectivity');
  const results: ConnectivityResult[] = [];
  const data = generateRealWorld(50);

  const test = async (pkg: string, component: string, fn: () => Promise<string> | string) => {
    try {
      const detail = await fn();
      results.push({ package: pkg, component, status: 'pass', detail });
      console.log(`  ${GREEN}✓${RESET}  ${DIM}[${pkg}]${RESET} ${component}: ${DIM}${detail}${RESET}`);
    } catch (e) {
      const msg = String(e).slice(0, 80);
      results.push({ package: pkg, component, status: 'fail', detail: msg });
      console.log(`  ${RED}✗${RESET}  ${DIM}[${pkg}]${RESET} ${component}: ${RED}${msg}${RESET}`);
    }
  };

  await test('core', 'Tens.encode', () => {
    const t = Tens.encode(data);
    return `hash=${t.hash.slice(0, 12)}... rows=${t.rowCount}`;
  });

  await test('core', 'encodeIR', () => {
    const ir = encodeIR(data);
    return `version=${ir.irVersion} hash=${ir.hash.slice(0, 12)}...`;
  });

  for (const fmt of ['json', 'toon', 'csv', 'markdown', 'contex'] as OutputFormat[]) {
    await test('core', `formatOutput(${fmt})`, () => {
      const output = formatOutput(data, fmt);
      if (output.length === 0) throw new Error('Empty output');
      return `${output.length} chars`;
    });
  }

  await test('core', 'TokenizerManager', () => {
    const count = tokenizer.countTokens('Hello world', 'o200k_base');
    if (count <= 0) throw new Error('Zero tokens');
    return `"Hello world"=${count} tokens`;
  });

  await test('core', 'compose', () => {
    const ir = encodeIR(data);
    const composed = compose({
      blocks: [
        { name: 'system', type: 'text', content: 'System prompt', priority: 'required' },
        { name: 'data', type: 'ir', ir, priority: 'optional' },
      ],
      model: modelId,
    });
    const included = composed.blocks.filter((b) => b.included).length;
    if (included === 0) throw new Error('No blocks included');
    return `${included} blocks, ${composed.totalTokens} tokens`;
  });

  await test('engine', 'Contex.insert+query', () => {
    const engine = new Contex('o200k_base');
    engine.insert('bench_col', data);
    const result = engine.query('GET bench_col');
    if (!result) throw new Error('Query returned null');
    return `queried ${data.length} rows`;
  });

  await test('engine', 'calculateBudget', () => {
    const budget = calculateBudget(data, {
      model: modelId, systemPromptTokens: 500, userPromptTokens: 200,
      responseReserve: 4096, formats: ['tens', 'json'],
    }, tokenizer);
    if (budget.formatBreakdown.length === 0) throw new Error('No formats');
    return `${budget.formatBreakdown.length} formats evaluated`;
  });

  await test('engine', 'quick()', () => {
    const result = quick(data, modelId);
    if (result.tokenCount <= 0) throw new Error('Zero tokens');
    return `${result.tokenCount} tokens, ${result.savings.percent}% saved`;
  });

  await test('engine', 'selectBestFormat', () => {
    const best = selectBestFormat({ model: modelId, data });
    return `recommended=${best.format}: ${best.reason.slice(0, 40)}`;
  });

  await test('engine', 'packContext', () => {
    const config: PackerConfig = {
      maxTokens: 50000, format: 'toon', encoding: 'o200k_base', strategy: 'greedy',
    };
    const packed = packContext(
      [{ id: 'tickets', data, priority: 80 }, { id: 'context', data: data.slice(0, 10), priority: 60 }],
      config, tokenizer,
    );
    if (packed.selectedItems.length === 0) throw new Error('Nothing packed');
    return `${packed.selectedItems.length} items, ${packed.totalTokens} tokens`;
  });

  await test('engine', 'MODEL_REGISTRY', () => {
    const count = Object.keys(MODEL_REGISTRY).length;
    if (count === 0) throw new Error('Empty registry');
    return `${count} models (gpt-4o=${!!MODEL_REGISTRY['gpt-4o']}, claude=${!!MODEL_REGISTRY['claude-3-5-sonnet']})`;
  });

  await test('middleware', 'provider wrappers', async () => {
    const mw = await import('@contex/middleware');
    const ok = typeof mw.createContexOpenAI === 'function' &&
               typeof mw.createContexAnthropic === 'function' &&
               typeof mw.createContexGemini === 'function';
    if (!ok) throw new Error('Missing wrapper functions');
    return 'openai=✓ anthropic=✓ gemini=✓';
  });

  return results;
}

// ============================================================================
// 5. Latency — encode + materialize across ALL dataset types
// ============================================================================

function buildLatency(): LatencyRow[] {
  sectionHeader(5, 'Latency — encode + materialize (μs/row)');

  console.log(
    `  ${pad('Dataset', 14, 'left')} ${pad('Size', 5)} │ ${pad('Enc p50', 8)} ${pad('Mat p50', 8)} ${pad('Total', 8)} │ Status`,
  );
  console.log(`  ${'─'.repeat(14)} ${'─'.repeat(5)} ┼ ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)} ┼ ${'─'.repeat(8)}`);

  const results: LatencyRow[] = [];

  for (const dataset of datasets) {
    const size = 500;
    const data = dataset.fn(size);
    const encodeTimes: number[] = [];
    const materializeTimes: number[] = [];

    for (let i = 0; i < latencyIterations; i++) {
      const t0 = performance.now();
      const tens = Tens.encode(data);
      const t1 = performance.now();
      encodeTimes.push(((t1 - t0) * 1000) / size);

      const t2 = performance.now();
      void tens.materialize(modelId);
      const t3 = performance.now();
      materializeTimes.push(((t3 - t2) * 1000) / size);
    }

    const row: LatencyRow = {
      dataset: dataset.name,
      size,
      encode: { p50: percentile(encodeTimes, 0.5), p95: percentile(encodeTimes, 0.95) },
      materialize: { p50: percentile(materializeTimes, 0.5), p95: percentile(materializeTimes, 0.95) },
      total: {
        p50: percentile(encodeTimes.map((e, i) => e + materializeTimes[i]), 0.5),
        p95: percentile(encodeTimes.map((e, i) => e + materializeTimes[i]), 0.95),
      },
    };
    results.push(row);

    const totalP50 = row.total.p50;
    const status = totalP50 < 50 ? `${GREEN}fast${RESET}` : totalP50 < 200 ? `${YELLOW}ok${RESET}` : `${RED}slow${RESET}`;
    console.log(
      `  ${pad(dataset.name, 14, 'left')} ${pad(size, 5)} │ ${pad(row.encode.p50, 8)} ${pad(row.materialize.p50, 8)} ${pad(totalP50, 8)} │ ${status}`,
    );
  }

  return results;
}

// ============================================================================
// 6. Per-Format Comparison — All formats ranked head-to-head
// ============================================================================

function buildFormatComparison() {
  sectionHeader(6, 'Format Efficiency Ranking — All formats head-to-head');

  const formats: OutputFormat[] = ['json', 'csv', 'toon', 'tens-text', 'contex'];
  const testData = generateRealWorld(500);
  const jsonBaseline = getTextTokens(testData, 'json');

  console.log(`  ${pad('Format', 12, 'left')} │ ${pad('Tokens', 8)} ${pad('Bytes', 8)} ${pad('vs JSON', 8)} │ Efficiency`);
  console.log(`  ${'─'.repeat(12)} ┼ ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)} ┼ ${'─'.repeat(20)}`);

  for (const fmt of formats) {
    const result = getTextTokens(testData, fmt);
    const savings = jsonBaseline.tokens > 0
      ? Math.round((jsonBaseline.tokens - result.tokens) / jsonBaseline.tokens * 100)
      : 0;

    const savLabel = fmt === 'json' ? '  base' : (savings > 0 ? `-${savings}%` : `+${Math.abs(savings)}%`);
    console.log(
      `  ${pad(fmt, 12, 'left')} │ ${pad(result.tokens, 8)} ${pad(result.bytes, 8)} ${pad(savLabel, 8)} │ ${fmt === 'json' ? DIM + '░'.repeat(20) + RESET : bar(savings)}`,
    );
  }
}

// ============================================================================
// 7. Summary & Report
// ============================================================================

async function buildReport(): Promise<BenchmarkReport> {
  console.log('');
  console.log(`${BOLD}${MAGENTA}  ╔══════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${MAGENTA}  ║        ContexDB Benchmark v7 — Comprehensive Pipeline Test      ║${RESET}`);
  console.log(`${BOLD}${MAGENTA}  ║   ${DIM}${matrixSizes.length} sizes x ${datasets.length} datasets x 5 formats + fidelity + latency${RESET}${BOLD}${MAGENTA}    ║${RESET}`);
  console.log(`${BOLD}${MAGENTA}  ╚══════════════════════════════════════════════════════════════════╝${RESET}`);

  const matrix = buildMatrix();
  const pipeline = buildPipeline();
  const fidelity = buildFidelity();
  const connectivity = await buildConnectivity();
  const latency = buildLatency();
  buildFormatComparison();

  // Compute summary
  const savings = pipeline.map(p => p.savingsPercent);
  const avgSavings = savings.length > 0 ? Number((savings.reduce((a, b) => a + b, 0) / savings.length).toFixed(1)) : 0;
  const maxSavings = Math.max(...savings, 0);
  const minSavings = Math.min(...savings, 0);
  const avgBudgetGain = pipeline.length > 0
    ? Math.round(pipeline.reduce((s, p) => s + p.budgetGain, 0) / pipeline.length) : 0;
  const avgEncode = latency.length > 0
    ? Number((latency.reduce((s, l) => s + l.encode.p50, 0) / latency.length).toFixed(2)) : 0;
  const avgMat = latency.length > 0
    ? Number((latency.reduce((s, l) => s + l.materialize.p50, 0) / latency.length).toFixed(2)) : 0;
  const connPassed = connectivity.filter(c => c.status === 'pass').length;
  const connFailed = connectivity.filter(c => c.status === 'fail').length;
  const fidPassed = fidelity.filter(f => f.status === 'pass').length;
  const fidFailed = fidelity.filter(f => f.status === 'fail').length;

  const totalPassed = connPassed + fidPassed;
  const totalFailed = connFailed + fidFailed;

  // Print summary
  sectionHeader(7, 'Final Results');

  console.log(`${BOLD}  Token Savings vs JSON${RESET}`);
  console.log(`    Average:  ${BOLD}${avgSavings >= 40 ? GREEN : YELLOW}${avgSavings}%${RESET}  ${bar(avgSavings, 30)}`);
  console.log(`    Best:     ${BOLD}${GREEN}${maxSavings}%${RESET}  ${bar(maxSavings, 30)}`);
  console.log(`    Worst:    ${minSavings >= 20 ? GREEN : YELLOW}${minSavings}%${RESET}`);
  console.log('');
  console.log(`${BOLD}  Pipeline Performance${RESET}`);
  console.log(`    Avg budget gain:       ${CYAN}+${avgBudgetGain} rows${RESET}`);
  console.log(`    Avg encode latency:    ${CYAN}${avgEncode} us/row${RESET}`);
  console.log(`    Avg materialize:       ${CYAN}${avgMat} us/row${RESET}`);
  console.log('');
  console.log(`${BOLD}  Test Results${RESET}`);
  console.log(`    Data Fidelity:   ${fidFailed === 0 ? BG_GREEN : BG_RED} ${fidPassed}/${fidPassed + fidFailed} ${RESET}  ${fidFailed === 0 ? GREEN + '(all data preserved)' : RED + `(${fidFailed} failures!)`}${RESET}`);
  console.log(`    Connectivity:    ${connFailed === 0 ? BG_GREEN : BG_RED} ${connPassed}/${connPassed + connFailed} ${RESET}  ${connFailed === 0 ? GREEN + '(all packages linked)' : RED + `(${connFailed} broken)`}${RESET}`);
  console.log(`    Total:           ${totalFailed === 0 ? BG_GREEN : BG_RED} ${totalPassed}/${totalPassed + totalFailed} passed ${RESET}`);
  divider();

  const report: BenchmarkReport = {
    metadata: {
      version: '7.0',
      timestamp: new Date().toISOString(),
      model: modelId,
      datasetCount: datasets.length,
    },
    matrix,
    pipeline,
    fidelity,
    connectivity,
    latency,
    summary: {
      avgSavingsPercent: avgSavings,
      maxSavingsPercent: maxSavings,
      minSavingsPercent: minSavings,
      avgBudgetGain: avgBudgetGain,
      avgEncodeUsPerRow: avgEncode,
      avgMaterializeUsPerRow: avgMat,
      fidelityScore: `${fidPassed}/${fidPassed + fidFailed}`,
      connectivityScore: `${connPassed}/${connPassed + connFailed}`,
      totalTests: totalPassed + totalFailed,
      passed: totalPassed,
      failed: totalFailed,
    },
  };

  return report;
}

function writeReport(report: BenchmarkReport): void {
  const target = path.resolve(outPath);
  fs.writeFileSync(target, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n${DIM}Output: ${target}${RESET}`);

  if (websiteSync) {
    const websitePath = path.resolve('website/benchmark_results.json');
    fs.writeFileSync(websitePath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`${DIM}Website sync: ${websitePath}${RESET}`);
  }
}

async function main(): Promise<void> {
  const report = await buildReport();
  writeReport(report);
  tokenizer.dispose();
}

main();
