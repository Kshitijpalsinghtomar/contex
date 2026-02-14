#!/usr/bin/env node
// ============================================================================
// Contex Research Benchmark Suite v3.0
// ============================================================================
// Deterministic · Isolated · Comprehensive · TENS-First
//
//  Run: npx tsx packages/cli/src/benchmark.ts
// ============================================================================

import fs from 'fs';
import {
  TokenStreamDecoder,
  TokenStreamEncoder,
  TokenizerManager,
  formatOutput,
} from '@contex/core';
import {
  MODEL_REGISTRY,
  analyzePrefixReuse,
  calculateBudget,
  formatPrefixAware,
} from '@contex/engine';
import {
  generateApiResponses,
  generateChatMessages,
  generateContentCMS,
  generateDeepNested,
  generateEcommerce,
  generateExtremelySparse,
  generateFinancial,
  generateFlat,
  generateGeoData,
  generateHealthcare,
  generateInventory,
  generateIoT,
  generateLogEvents,
  generateLongText,
  generateMixedNestedTabular,
  generateMultiLingual,
  generateNested,
  generateNumericHeavy,
  generateRealWorld,
  generateRepetitive,
  generateShortStrings,
  generateSparse,
  generateUserActivity,
  generateWideSchema,
  seededRandom,
} from './generators.js';
import {
  extractLeafValues,
  measureEntropyCorrelation,
  measureMarginalCost,
  measureSchemaWidthSensitivity,
  measureStructuralOverhead,
  measureTokenizerSpread,
} from './metrics.js';
import { type MutationType, runPrefixSimulation } from './prefix_simulation.js';
import { analyzeRepetition } from './repetition_analysis.js';
import * as transcoders from './transcoders.js';
import { disposeTensEncoder } from './transcoders.js';
import type { SupportedFormat } from './transcoders.js';

// --- Shared Resources ---
const tokenizer = new TokenizerManager();
const tensEncoder = new TokenStreamEncoder();

// --- Constants ---
const SEED = 42;
const padR = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);
const dollar = (n: number) => `$${n.toFixed(2)}`;
const line = '═'.repeat(72);
const thinLine = '─'.repeat(72);

function printHeader(title: string) {
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

// --- Matrix Configuration ---
const SIZES = [1, 10, 100, 500, 1000, 5000];
const DATASETS = [
  // --- Original datasets ---
  { name: 'Flat', fn: (n: number) => generateFlat(n, SEED) },
  { name: 'Nested', fn: (n: number) => generateNested(n, SEED) },
  { name: 'Sparse', fn: (n: number) => generateSparse(n, SEED) },
  { name: 'Repetitive', fn: (n: number) => generateRepetitive(n, SEED) },
  { name: 'LongText', fn: (n: number) => generateLongText(n, SEED) },
  { name: 'RealWorld', fn: (n: number) => generateRealWorld(n, SEED) },
  { name: 'WideSchema', fn: (n: number) => generateWideSchema(n, 40, SEED) },
  { name: 'DeepNested', fn: (n: number) => generateDeepNested(n, 5, SEED) },
  { name: 'MixedNested', fn: (n: number) => generateMixedNestedTabular(n, SEED) },
  { name: 'ExtremelySparse', fn: (n: number) => generateExtremelySparse(n, SEED) },
  { name: 'ShortStrings', fn: (n: number) => generateShortStrings(n, SEED) },
  { name: 'NumericHeavy', fn: (n: number) => generateNumericHeavy(n, SEED) },
  // --- Industry-specific datasets ---
  { name: 'Ecommerce', fn: (n: number) => generateEcommerce(n, SEED) },
  { name: 'Healthcare', fn: (n: number) => generateHealthcare(n, SEED) },
  { name: 'IoT', fn: (n: number) => generateIoT(n, SEED) },
  { name: 'Financial', fn: (n: number) => generateFinancial(n, SEED) },
  { name: 'LogEvents', fn: (n: number) => generateLogEvents(n, SEED) },
  { name: 'UserActivity', fn: (n: number) => generateUserActivity(n, SEED) },
  { name: 'ChatMessages', fn: (n: number) => generateChatMessages(n, SEED) },
  { name: 'ApiResponses', fn: (n: number) => generateApiResponses(n, SEED) },
  { name: 'GeoData', fn: (n: number) => generateGeoData(n, SEED) },
  { name: 'Inventory', fn: (n: number) => generateInventory(n, SEED) },
  { name: 'ContentCMS', fn: (n: number) => generateContentCMS(n, SEED) },
  { name: 'MultiLingual', fn: (n: number) => generateMultiLingual(n, SEED) },
];

const FORMATS: SupportedFormat[] = [
  'json',
  'json-min',
  'json-pretty',
  'yaml',
  'xml',
  'ndjson',
  'csv',
  'markdown',
  'toon',
  'tens',
  'tens-text',
];

const KEY_FORMATS: SupportedFormat[] = ['json', 'json-min', 'toon', 'csv', 'tens', 'tens-text'];

interface MatrixResult {
  dataset: string;
  rows: number;
  format: string;
  tokens: number;
  bytes: number;
  costGpt4o: number;
  structuralOverhead: number;
  density: number;
  entropy: number;
  stringReuse: number;
  tokenRepetition: number;
  marginalTokensPerRow: number;
}

// ============================================================================
// 1. Research-Grade Matrix
// ============================================================================
async function benchmarkMatrix() {
  printHeader('BENCHMARK 1: Comprehensive Matrix (12 Datasets x 6 Sizes x 10 Formats)');
  console.log('Generating data points for scaling analysis...');

  const results: MatrixResult[] = [];

  const history: Record<string, { size: number; tokens: number } | undefined> = {};

  for (const ds of DATASETS) {
    console.log(`\n  Dataset: ${ds.name}`);
    for (const size of SIZES) {
      process.stdout.write(`    Size: ${size} rows... `);
      let data: any[];
      try {
        data = ds.fn(size);
      } catch {
        process.stdout.write('Skip (generation error)\n');
        continue;
      }

      const repetition = analyzeRepetition(data, tokenizer);

      // Value tokens: only leaf values, no keys or structure
      const allValues = extractLeafValues(data).join(' ');
      const valueTokens = tokenizer.countTokens(allValues, 'o200k_base');

      for (const fmt of FORMATS) {
        try {
          let tokens = 0;
          let bytes = 0;
          if (fmt === 'tens') {
            const bin = tensEncoder.encode(data); // Returns Uint8Array
            const stream = tensEncoder.encodeToTokenStream(data); // Returns TokenStream
            tokens = stream.length;
            bytes = bin.length;
          } else {
            const output = transcoders.transcode(data, fmt);
            tokens = tokenizer.countTokens(output as string, 'o200k_base');
            bytes = Buffer.byteLength(output as string);
          }

          const structuralTokens = Math.max(0, tokens - valueTokens);
          const cost = (tokens / 1_000_000) * MODEL_REGISTRY['gpt-4o'].inputPricePer1M;

          // Marginal Cost
          const historyKey = `${ds.name}:${fmt}`;
          let marginalCost = 0;
          const prev = history[historyKey];
          if (prev) {
            const deltaTokens = tokens - prev.tokens;
            const deltaRows = size - prev.size;
            if (deltaRows > 0) marginalCost = deltaTokens / deltaRows;
          }
          history[historyKey] = { size, tokens };

          results.push({
            dataset: ds.name,
            rows: size,
            format: fmt,
            tokens,
            bytes,
            costGpt4o: cost,
            structuralOverhead:
              tokens > 0 ? Math.round((structuralTokens / tokens) * 10000) / 10000 : 0,
            density: valueTokens / MODEL_REGISTRY['gpt-4o'].contextWindow,
            entropy: repetition.entropy,
            stringReuse: repetition.stringReuseRatio,
            tokenRepetition: repetition.tokenRepetitionFrequency,
            marginalTokensPerRow: Math.round(marginalCost * 100) / 100,
          });
        } catch {}
      }
      process.stdout.write('Done.\n');
    }
  }
  return results;
}

// ============================================================================
// 2. Marginal Cost Slope (Isolated)
// ============================================================================
function benchmarkMarginalCost() {
  printHeader('BENCHMARK 2: Marginal Cost Slope (Delta Tokens Per Row)');
  console.log('  Measuring how expensive adding 1 more row is per format...\n');

  const results: any[] = [];

  const testDatasets = [
    { name: 'Flat', fn: (n: number) => generateFlat(n, SEED) },
    { name: 'RealWorld', fn: (n: number) => generateRealWorld(n, SEED) },
    { name: 'WideSchema', fn: (n: number) => generateWideSchema(n, 40, SEED) },
    { name: 'NumericHeavy', fn: (n: number) => generateNumericHeavy(n, SEED) },
  ];

  for (const ds of testDatasets) {
    const entries = measureMarginalCost(ds.name, ds.fn, KEY_FORMATS, tokenizer, tensEncoder);
    results.push(...entries);

    console.log(`  ${ds.name}:`);
    for (const e of entries) {
      console.log(
        `    ${padR(e.format, 12)} ${padR(e.interval, 12)} Δ=${padL(String(e.deltaTokensPerRow), 8)} tok/row`,
      );
    }
  }

  return results;
}

// ============================================================================
// 3. Structural Overhead (Isolated)
// ============================================================================
function benchmarkStructuralOverhead() {
  printHeader('BENCHMARK 3: Structural vs Value Token Separation');
  console.log('  Measuring what % of tokens are structural overhead...\n');

  const rowCount = 500;

  const testDatasets = [
    { name: 'Flat', data: generateFlat(rowCount, SEED) },
    { name: 'RealWorld', data: generateRealWorld(rowCount, SEED) },
    { name: 'DeepNested', data: generateDeepNested(rowCount, 5, SEED) },
    { name: 'WideSchema', data: generateWideSchema(rowCount, 40, SEED) },
    { name: 'ExtremelySparse', data: generateExtremelySparse(rowCount, SEED) },
  ];

  const results: any[] = [];

  for (const ds of testDatasets) {
    const entries = measureStructuralOverhead(
      ds.name,
      ds.data,
      KEY_FORMATS,
      tokenizer,
      tensEncoder,
    );
    results.push(...entries);

    console.log(`  ${ds.name} (${rowCount} rows):`);
    console.log(
      `    ${padR('Format', 12)} ${padL('Total', 8)} ${padL('Value', 8)} ${padL('Struct', 8)} ${padL('Overhead%', 10)}`,
    );
    console.log(`    ${thinLine.slice(0, 50)}`);
    for (const e of entries) {
      console.log(
        `    ${padR(e.format, 12)} ${padL(String(e.totalTokens), 8)} ${padL(String(e.valueTokens), 8)} ${padL(String(e.structuralTokens), 8)} ${padL((e.overheadRatio * 100).toFixed(1) + '%', 10)}`,
      );
    }
    console.log('');
  }

  tokenizer.dispose();
  tensEncoder.dispose();
  return results;
}

// ============================================================================
// 4. Context Fitting
// ============================================================================
function benchmarkFitContext() {
  printHeader('BENCHMARK 4: Context Fitting (Customer Support Scenario)');
  console.log(`
  Scenario: Customer support LLM.
  System prompt: 800 tokens | User prompt: 200 tokens | Response Reserve: 4096 tokens
  Question: How many tickets fit in the remaining context?
    `);

  const data = generateRealWorld(10_000, SEED);
  const models = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5.2',
    'gpt-5.3-codex',
    'o3-mini',
    'o4-mini',
    'claude-3-5-sonnet',
    'claude-3-7-sonnet',
    'claude-4-sonnet',
    'claude-4-5-sonnet',
    'claude-4-6-opus',
    'claude-opus-4-5',
    'claude-3-5-haiku',
    'claude-haiku-4-5',
    'gemini-2-0-flash',
    'gemini-2-5-flash',
    'gemini-2-5-flash-lite',
    'gemini-2-5-pro',
    'gemini-3-flash',
    'llama-4-maverick',
    'llama-4-scout',
    'deepseek-v3-2',
    'deepseek-r1',
    'grok-3',
    'grok-4-fast',
    'mistral-large',
    'mistral-small',
    'cohere-command-r-plus',
    'qwen-2-5-72b',
    'amazon-nova-pro',
  ];
  const results = [];

  console.log(
    `  ${padR('Model', 20)} ${padL('Window', 10)} ${padL('TENS Rows', 10)} ${padL('TOON Rows', 10)} ${padL('JSON Rows', 10)} ${padL('Gain', 8)}`,
  );
  console.log(`  ${thinLine}`);

  for (const modelId of models) {
    const model = MODEL_REGISTRY[modelId];
    if (!model) continue;

    const budget = calculateBudget(
      data,
      {
        model: modelId,
        systemPromptTokens: 800,
        userPromptTokens: 200,
        responseReserve: 4096,
        formats: ['tens', 'toon', 'json'],
      },
      tokenizer,
    );

    const tensRows = budget.formatBreakdown.find((f) => f.format === 'tens')?.maxRows || 0;
    const toonRows = budget.formatBreakdown.find((f) => f.format === 'toon')?.maxRows || 0;
    const jsonRows = budget.formatBreakdown.find((f) => f.format === 'json')?.maxRows || 0;
    const gain = tensRows - jsonRows;

    console.log(
      `  ${padR(model.name, 20)} ${padL(model.contextWindow / 1000 + 'k', 10)} ${padL(String(tensRows), 10)} ${padL(String(toonRows), 10)} ${padL(String(jsonRows), 10)} ${padL('+' + gain, 8)}`,
    );

    results.push({
      model: model.name,
      modelId,
      windowSize: model.contextWindow,
      tensRows,
      toonRows,
      jsonRows,
      gain: toonRows - jsonRows,
      tensGain: gain,
    });
  }
  return results;
}

// ============================================================================
// 5. Annual Cost Savings
// ============================================================================
function benchmarkCostSavings() {
  printHeader('BENCHMARK 5: Annual Cost Savings Projection');
  console.log(`
  Scenario: 500 tickets per request, 1 Million requests/month.
  Model: GPT-4o Input Pricing ($2.50 / 1M tokens).
    `);

  const data = generateRealWorld(500, SEED);
  const price = MODEL_REGISTRY['gpt-4o'].inputPricePer1M / 1_000_000;

  const json = transcoders.transcode(data, 'json') as string;
  const toon = transcoders.transcode(data, 'toon') as string;
  const csv = transcoders.transcode(data, 'csv') as string;
  const tensText = transcoders.transcode(data, 'tens-text') as string;

  const tJson = tokenizer.countTokens(json, 'o200k_base');
  const tToon = tokenizer.countTokens(toon, 'o200k_base');
  const tCsv = tokenizer.countTokens(csv, 'o200k_base');
  const tTens = tensEncoder.encodeToTokenStream(data).length;
  const tTensText = tokenizer.countTokens(tensText, 'o200k_base');

  const costJson = tJson * price * 1_000_000 * 12;
  const costToon = tToon * price * 1_000_000 * 12;
  const costCsv = tCsv * price * 1_000_000 * 12;
  const costTens = tTens * price * 1_000_000 * 12;
  const costTensText = tTensText * price * 1_000_000 * 12;

  console.log(
    `  ${padR('Format', 12)} ${padL('Tokens/Req', 12)} ${padL('Annual Cost', 16)} ${padL('Savings', 16)}`,
  );
  console.log(`  ${thinLine}`);
  console.log(
    `  ${padR('JSON', 12)} ${padL(String(tJson), 12)} ${padL(dollar(costJson), 16)} ${padL('-', 16)}`,
  );
  console.log(
    `  ${padR('TOON', 12)} ${padL(String(tToon), 12)} ${padL(dollar(costToon), 16)} ${padL(dollar(costJson - costToon), 16)}`,
  );
  console.log(
    `  ${padR('CSV', 12)} ${padL(String(tCsv), 12)} ${padL(dollar(costCsv), 16)} ${padL(dollar(costJson - costCsv), 16)}`,
  );
  console.log(
    `  ${padR('TENS', 12)} ${padL(String(tTens), 12)} ${padL(dollar(costTens), 16)} ${padL(dollar(costJson - costTens), 16)}`,
  );
  console.log(
    `  ${padR('TENS-Text', 12)} ${padL(String(tTensText), 12)} ${padL(dollar(costTensText), 16)} ${padL(dollar(costJson - costTensText), 16)}`,
  );

  return [
    { format: 'JSON', tokens: tJson, annualCost: costJson, savings: 0 },
    { format: 'TOON', tokens: tToon, annualCost: costToon, savings: costJson - costToon },
    { format: 'CSV', tokens: tCsv, annualCost: costCsv, savings: costJson - costCsv },
    { format: 'TENS', tokens: tTens, annualCost: costTens, savings: costJson - costTens },
    {
      format: 'TENS-Text',
      tokens: tTensText,
      annualCost: costTensText,
      savings: costJson - costTensText,
    },
  ];
}

// ============================================================================
// 6. Determinism Guarantee
// ============================================================================
function benchmarkDeterminism() {
  printHeader('BENCHMARK 6: Deterministic Output Guarantee');
  const data1 = [{ id: 1, role: 'admin', name: 'Alice' }];
  const data2 = [{ name: 'Alice', id: 1, role: 'admin' }];

  const formats: SupportedFormat[] = ['json', 'json-min', 'toon', 'csv', 'tens', 'tens-text'];
  const results = [];

  for (const fmt of formats) {
    const out1 = transcoders.transcode(data1, fmt);
    const out2 = transcoders.transcode(data2, fmt);
    const match = String(out1) === String(out2);
    console.log(
      `  ${fmt.padEnd(12)}: ${match ? '✅ Deterministic' : '❌ Failed (Order Dependent)'}`,
    );
    results.push({ format: fmt, deterministic: match });
  }
  return results;
}

// ============================================================================
// 7. Prefix Cache Simulation (All Mutation Types)
// ============================================================================
function benchmarkPrefixCache() {
  printHeader('BENCHMARK 7: Prefix Cache System (All Mutation Types)');
  console.log(`
  Scenario: Real-world data mutations.
  Question: How much prefix is preserved when data changes?
    `);

  const baseData = generateRealWorld(100, SEED);

  const scenarios: { name: string; mutation: MutationType; count: number }[] = [
    { name: 'Append 20%', mutation: 'append', count: 20 },
    { name: 'Prepend 10%', mutation: 'prepend', count: 10 },
    { name: 'Insert Middle', mutation: 'insert', count: 10 },
    { name: 'Update Middle', mutation: 'update_middle', count: 5 },
    { name: 'Delete First 10', mutation: 'delete_first', count: 10 },
    { name: 'Shuffle Tail 20%', mutation: 'shuffle_tail', count: 0 },
    { name: 'Single Field Change', mutation: 'single_field_change', count: 1 },
  ];

  console.log(
    `  ${padR('Mutation', 22)} ${padL('Naive Overlap', 14)} ${padL('Smart Overlap', 14)} ${padL('Gain', 10)}`,
  );
  console.log(`  ${thinLine}`);

  const results: Record<string, any> = {};

  for (const s of scenarios) {
    const sim = runPrefixSimulation(baseData, s.mutation, s.count, tokenizer, SEED);

    // Calculate percentages
    const naiveBase = tokenizer.countTokens(formatOutput(baseData, 'toon'), 'o200k_base');
    const naivePct = naiveBase > 0 ? Math.round((sim.naiveOverlap / naiveBase) * 100) : 0;

    const smartBase = tokenizer.countTokens(
      formatPrefixAware(baseData, { format: 'toon', sortBy: 'id' }),
      'o200k_base',
    );
    const smartPct = smartBase > 0 ? Math.round((sim.awareOverlap / smartBase) * 100) : 0;

    console.log(
      `  ${padR(s.name, 22)} ${padL(naivePct + '%', 14)} ${padL(smartPct + '%', 14)} ${padL('+' + (smartPct - naivePct) + '%', 10)}`,
    );

    results[s.name] = {
      naive: { overlap: sim.naiveOverlap, pct: naivePct },
      smart: { overlap: sim.awareOverlap, pct: smartPct },
      gain: smartPct - naivePct,
    };
  }

  return results;
}

// ============================================================================
// 8. TENS Performance
// ============================================================================
function benchmarkTensPerformance() {
  printHeader('BENCHMARK 8: TENS System Performance (Speed & Size)');
  console.log(`
  Scenario: Encoding/Decoding 10,000 Real-World Tickets.
  Measures: Throughput (ops/sec) and Size Efficiency.
    `);

  const count = 10_000;
  const data = generateRealWorld(count, SEED);
  const tensEncoder = new TokenStreamEncoder();
  const tensDecoder = new TokenStreamDecoder();

  // Warmup
  tensEncoder.encode(data.slice(0, 100));

  const startEnc = performance.now();
  const binary = tensEncoder.encode(data);
  const endEnc = performance.now();
  const encTime = (endEnc - startEnc) / 1000;
  const encOps = count / encTime;
  const encMB = binary.length / 1024 / 1024;
  const encThroughput = encMB / encTime;

  const startDec = performance.now();
  tensDecoder.decode(binary);
  const endDec = performance.now();
  const decTime = (endDec - startDec) / 1000;
  const decOps = count / decTime;
  const decThroughput = encMB / decTime;

  const jsonStr = JSON.stringify(data);
  const jsonSize = Buffer.byteLength(jsonStr);
  const tensSize = binary.length;
  const reduction = (1 - tensSize / jsonSize) * 100;

  console.log(`  ${padR('Metric', 20)} ${padL('Value', 15)} ${padL('Unit', 10)}`);
  console.log(`  ${thinLine}`);
  console.log(
    `  ${padR('Encoding Speed', 20)} ${padL(encOps.toFixed(0), 15)} ${padL('ops/sec', 10)}`,
  );
  console.log(
    `  ${padR('Encoding Throughput', 20)} ${padL(encThroughput.toFixed(2), 15)} ${padL('MB/s', 10)}`,
  );
  console.log(
    `  ${padR('Decoding Speed', 20)} ${padL(decOps.toFixed(0), 15)} ${padL('ops/sec', 10)}`,
  );
  console.log(
    `  ${padR('Decoding Throughput', 20)} ${padL(decThroughput.toFixed(2), 15)} ${padL('MB/s', 10)}`,
  );
  console.log(`  ${thinLine}`);
  console.log(
    `  ${padR('Original JSON', 20)} ${padL((jsonSize / 1024 / 1024).toFixed(2), 15)} ${padL('MB', 10)}`,
  );
  console.log(
    `  ${padR('TENS Binary', 20)} ${padL((tensSize / 1024 / 1024).toFixed(2), 15)} ${padL('MB', 10)}`,
  );
  console.log(`  ${padR('Reduction', 20)} ${padL(reduction.toFixed(1), 15)} ${padL('%', 10)}`);

  tensDecoder.dispose();

  return {
    encodingSpeed: Math.round(encOps),
    encodingThroughput: Math.round(encThroughput * 100) / 100,
    decodingSpeed: Math.round(decOps),
    decodingThroughput: Math.round(decThroughput * 100) / 100,
    jsonSize,
    tensSize,
    reduction: Math.round(reduction * 10) / 10,
  };
}

// ============================================================================
// 9. Schema Width Sensitivity
// ============================================================================
function benchmarkSchemaWidth() {
  printHeader('BENCHMARK 9: Schema Width Sensitivity');
  console.log('  How do formats scale as column count increases?\n');

  const columnCounts = [10, 20, 40, 80];
  const rowCount = 100;
  const results: any[] = [];

  console.log(
    `  ${padR('Format', 12)} ${padL('10 cols', 10)} ${padL('20 cols', 10)} ${padL('40 cols', 10)} ${padL('80 cols', 10)}`,
  );
  console.log(`  ${thinLine.slice(0, 55)}`);

  // Build results per format
  const formatResults: Record<string, Record<number, number>> = {};

  for (const cols of columnCounts) {
    const data = generateWideSchema(rowCount, cols, SEED);
    for (const fmt of KEY_FORMATS) {
      let tokens: number;
      let bytes: number;
      if (fmt === 'tens') {
        const stream = tensEncoder.encodeToTokenStream(data);
        const bin = tensEncoder.encode(data);
        tokens = stream.length;
        bytes = bin.length;
      } else {
        const output = transcoders.transcode(data, fmt);
        tokens = tokenizer.countTokens(output as string, 'o200k_base');
        bytes = Buffer.byteLength(output as string);
      }

      if (!formatResults[fmt]) formatResults[fmt] = {};
      formatResults[fmt][cols] = tokens;

      results.push({
        format: fmt,
        columns: cols,
        tokens,
        bytes,
        tokensPerColumn: Math.round(tokens / cols),
      });
    }
  }

  for (const fmt of KEY_FORMATS) {
    const r = formatResults[fmt] || {};
    console.log(
      `  ${padR(fmt, 12)} ${padL(String(r[10] || 0), 10)} ${padL(String(r[20] || 0), 10)} ${padL(String(r[40] || 0), 10)} ${padL(String(r[80] || 0), 10)}`,
    );
  }

  tokenizer.dispose();
  tensEncoder.dispose();
  return results;
}

// ============================================================================
// 10. Tokenizer Spread
// ============================================================================
function benchmarkTokenizerSpread() {
  printHeader('BENCHMARK 10: Tokenizer Spread (Multi-Encoding Comparison)');
  console.log('  How do different tokenizers affect format efficiency?\n');

  const data = generateRealWorld(500, SEED);
  const textFormats: SupportedFormat[] = ['json', 'json-min', 'toon', 'csv'];
  const results = measureTokenizerSpread('RealWorld', data, textFormats, tokenizer);

  // Add TENS with its native token stream encoding
  const tensTokens = tensEncoder.encodeToTokenStream(data).length;
  results.push({
    format: 'tens',
    encoding: 'tens-native',
    dataset: 'RealWorld',
    tokens: tensTokens,
  });

  // Group by format for printing
  const byFormat: Record<string, Record<string, number>> = {};
  for (const r of results) {
    if (!byFormat[r.format]) byFormat[r.format] = {};
    byFormat[r.format][r.encoding] = r.tokens;
  }

  const encodings = ['cl100k_base', 'o200k_base', 'p50k_base', 'r50k_base', 'tens-native'];
  console.log(`  ${padR('Format', 12)} ${encodings.map((e) => padL(e, 14)).join(' ')}`);
  console.log(`  ${thinLine}`);

  for (const fmt of [...textFormats, 'tens' as SupportedFormat]) {
    const row = byFormat[fmt] || {};
    console.log(
      `  ${padR(fmt, 12)} ${encodings.map((e) => padL(String(row[e] || '-'), 14)).join(' ')}`,
    );
  }

  return results;
}

// ============================================================================
// 11. Entropy / Repetition Correlation
// ============================================================================
function benchmarkEntropyCorrelation() {
  printHeader('BENCHMARK 11: Entropy / Repetition Correlation');
  console.log('  Which format benefits most from repetitive data?\n');

  const results: any[] = [];

  const testDatasets = [
    { name: 'Repetitive', data: generateRepetitive(500, SEED) },
    { name: 'Flat', data: generateFlat(500, SEED) },
    { name: 'RealWorld', data: generateRealWorld(500, SEED) },
    { name: 'ShortStrings', data: generateShortStrings(500, SEED) },
    { name: 'NumericHeavy', data: generateNumericHeavy(500, SEED) },
  ];

  for (const ds of testDatasets) {
    const repetition = analyzeRepetition(ds.data, tokenizer);
    const entries = measureEntropyCorrelation(
      ds.name,
      ds.data,
      KEY_FORMATS,
      tokenizer,
      tensEncoder,
      repetition,
    );
    results.push(...entries);

    console.log(
      `  ${ds.name} (entropy: ${repetition.entropy.toFixed(2)}, reuse: ${(repetition.stringReuseRatio * 100).toFixed(0)}%):`,
    );
    for (const e of entries) {
      console.log(
        `    ${padR(e.format, 12)} ${padL(String(e.tokens), 8)} tokens  (${(e.tokensVsJson * 100).toFixed(0)}% of JSON)`,
      );
    }
    console.log('');
  }

  tokenizer.dispose();
  tensEncoder.dispose();
  return results;
}

// ============================================================================
// 12. Latency Profiling (p50 / p95 / p99)
// ============================================================================
function benchmarkLatency() {
  printHeader('BENCHMARK 12: Latency Profiling (p50 / p95 / p99)');
  console.log(`
  Measures encode/decode latency in microseconds per row.
  Tests across multiple dataset sizes and formats.
    `);

  const tensDecoder = new TokenStreamDecoder();
  const results: any[] = [];
  const sizes = [100, 1000, 10000];
  const iterations = 50;

  const testDatasets = [
    { name: 'RealWorld', fn: (n: number) => generateRealWorld(n, SEED) },
    { name: 'Ecommerce', fn: (n: number) => generateEcommerce(n, SEED) },
    { name: 'IoT', fn: (n: number) => generateIoT(n, SEED) },
    { name: 'Financial', fn: (n: number) => generateFinancial(n, SEED) },
  ];

  console.log(
    `  ${padR('Dataset', 14)} ${padR('Size', 8)} ${padL('p50 μs', 10)} ${padL('p95 μs', 10)} ${padL('p99 μs', 10)} ${padL('Dec p50', 10)}`,
  );
  console.log(`  ${thinLine}`);

  for (const ds of testDatasets) {
    for (const size of sizes) {
      const data = ds.fn(size);
      const encTimes: number[] = [];
      const decTimes: number[] = [];

      // Warmup
      tensEncoder.encode(data.slice(0, 10));

      for (let i = 0; i < iterations; i++) {
        const startEnc = performance.now();
        const binary = tensEncoder.encode(data);
        const endEnc = performance.now();
        encTimes.push(((endEnc - startEnc) * 1000) / size); // μs per row

        const startDec = performance.now();
        tensDecoder.decode(binary);
        const endDec = performance.now();
        decTimes.push(((endDec - startDec) * 1000) / size);
      }

      encTimes.sort((a, b) => a - b);
      decTimes.sort((a, b) => a - b);

      const p50 = encTimes[Math.floor(encTimes.length * 0.5)];
      const p95 = encTimes[Math.floor(encTimes.length * 0.95)];
      const p99 = encTimes[Math.floor(encTimes.length * 0.99)];
      const decP50 = decTimes[Math.floor(decTimes.length * 0.5)];

      console.log(
        `  ${padR(ds.name, 14)} ${padR(String(size), 8)} ${padL(p50.toFixed(1), 10)} ${padL(p95.toFixed(1), 10)} ${padL(p99.toFixed(1), 10)} ${padL(decP50.toFixed(1), 10)}`,
      );

      results.push({
        dataset: ds.name,
        size,
        encode: { p50: +p50.toFixed(2), p95: +p95.toFixed(2), p99: +p99.toFixed(2) },
        decode: { p50: +decP50.toFixed(2) },
      });
    }
  }

  return results;
}

// ============================================================================
// 13. Memory Pressure
// ============================================================================
function benchmarkMemory() {
  printHeader('BENCHMARK 13: Memory Pressure (Peak Heap Usage)');
  console.log(`
  Measures peak heap usage during encoding of large datasets.
    `);

  const results: any[] = [];
  const sizes = [1000, 5000, 10000, 50000];

  const testDatasets = [
    { name: 'RealWorld', fn: (n: number) => generateRealWorld(n, SEED) },
    { name: 'Ecommerce', fn: (n: number) => generateEcommerce(n, SEED) },
    { name: 'Healthcare', fn: (n: number) => generateHealthcare(n, SEED) },
  ];

  console.log(
    `  ${padR('Dataset', 14)} ${padR('Rows', 8)} ${padL('Heap Before', 12)} ${padL('Heap After', 12)} ${padL('Delta MB', 10)} ${padL('Binary MB', 10)}`,
  );
  console.log(`  ${thinLine}`);

  for (const ds of testDatasets) {
    for (const size of sizes) {
      // Force GC if available
      if (global.gc) global.gc();

      const heapBefore = process.memoryUsage().heapUsed;
      const data = ds.fn(size);
      const encoder = new TokenStreamEncoder();
      const binary = encoder.encode(data);
      const heapAfter = process.memoryUsage().heapUsed;

      const deltaMB = (heapAfter - heapBefore) / 1024 / 1024;
      const binaryMB = binary.length / 1024 / 1024;

      console.log(
        `  ${padR(ds.name, 14)} ${padR(String(size), 8)} ${padL((heapBefore / 1024 / 1024).toFixed(1) + 'MB', 12)} ${padL((heapAfter / 1024 / 1024).toFixed(1) + 'MB', 12)} ${padL(deltaMB.toFixed(1) + 'MB', 10)} ${padL(binaryMB.toFixed(2) + 'MB', 10)}`,
      );

      results.push({
        dataset: ds.name,
        rows: size,
        heapBefore: Math.round(heapBefore / 1024),
        heapAfter: Math.round(heapAfter / 1024),
        deltaKB: Math.round((heapAfter - heapBefore) / 1024),
        binaryKB: Math.round(binary.length / 1024),
      });
    }
  }

  return results;
}

// ============================================================================
// 14. Scalability Curves (Token Count vs Row Count)
// ============================================================================
function benchmarkScalability() {
  printHeader('BENCHMARK 14: Scalability Curves');
  console.log('  Token growth rate per format as row count increases.\n');

  const tokenizer = new TokenizerManager();
  const tensEncoder = new TokenStreamEncoder();
  const scaleSizes = [10, 50, 100, 500, 1000, 2000, 5000];
  const results: any[] = [];

  const testDatasets = [
    { name: 'Flat', fn: (n: number) => generateFlat(n, SEED) },
    { name: 'RealWorld', fn: (n: number) => generateRealWorld(n, SEED) },
    { name: 'Ecommerce', fn: (n: number) => generateEcommerce(n, SEED) },
    { name: 'IoT', fn: (n: number) => generateIoT(n, SEED) },
    { name: 'ChatMessages', fn: (n: number) => generateChatMessages(n, SEED) },
  ];

  for (const ds of testDatasets) {
    console.log(`  ${ds.name}:`);
    console.log(`    ${padR('Rows', 8)} ${KEY_FORMATS.map((f) => padL(f, 10)).join(' ')}`);
    console.log(`    ${thinLine.slice(0, 60)}`);

    for (const size of scaleSizes) {
      let data: any[];
      try {
        data = ds.fn(size);
      } catch {
        continue;
      }

      const row: string[] = [padR(String(size), 8)];
      for (const fmt of KEY_FORMATS) {
        try {
          let tokens: number;
          if (fmt === 'tens') {
            tokens = tensEncoder.encodeToTokenStream(data).length;
          } else {
            const output = transcoders.transcode(data, fmt);
            tokens = tokenizer.countTokens(output as string, 'o200k_base');
          }
          row.push(padL(String(tokens), 10));
          results.push({ dataset: ds.name, rows: size, format: fmt, tokens });
        } catch {
          row.push(padL('-', 10));
        }
      }
      console.log(`    ${row.join(' ')}`);
    }
    console.log('');
  }

  tokenizer.dispose();
  tensEncoder.dispose();
  return results;
}

// ============================================================================
// 15. Multi-Model Cost Matrix
// ============================================================================
function benchmarkMultiModelCost() {
  printHeader('BENCHMARK 15: Multi-Model Cost Matrix');
  console.log(`
  Annual cost projection: 21 models x 5 formats x 5 datasets.
  Scenario: 500 rows per request, 1M requests/month.
    `);

  const tokenizer = new TokenizerManager();
  const results: any[] = [];
  const requestsPerMonth = 1_000_000;

  const testDatasets = [
    { name: 'RealWorld', data: generateRealWorld(500, SEED) },
    { name: 'Ecommerce', data: generateEcommerce(500, SEED) },
    { name: 'IoT', data: generateIoT(500, SEED) },
    { name: 'Healthcare', data: generateHealthcare(500, SEED) },
    { name: 'Financial', data: generateFinancial(500, SEED) },
  ];

  const costFormats: SupportedFormat[] = ['json', 'json-min', 'toon', 'csv', 'tens'];
  const modelIds = Object.keys(MODEL_REGISTRY);

  // Print compact summary: best format per model per dataset
  console.log(`  ${padR('Model', 22)} ${testDatasets.map((d) => padL(d.name, 12)).join(' ')}`);
  console.log(`  ${thinLine}`);

  for (const modelId of modelIds) {
    const model = MODEL_REGISTRY[modelId];
    if (!model) continue;

    const bestFormats: string[] = [];

    for (const ds of testDatasets) {
      let bestFmt = 'json';
      let bestCost = Number.POSITIVE_INFINITY;

      for (const fmt of costFormats) {
        try {
          let tokens: number;
          if (fmt === 'tens') {
            tokens = tensEncoder.encodeToTokenStream(ds.data).length;
          } else {
            const output = transcoders.transcode(ds.data, fmt) as string;
            tokens = tokenizer.countTokens(output, model.encoding as any);
          }

          const annualCost = (tokens / 1_000_000) * model.inputPricePer1M * requestsPerMonth * 12;

          results.push({
            model: model.name,
            modelId,
            dataset: ds.name,
            format: fmt,
            tokens,
            annualCost: Math.round(annualCost),
          });

          if (annualCost < bestCost) {
            bestCost = annualCost;
            bestFmt = fmt;
          }
        } catch {}
      }

      bestFormats.push(padL(bestFmt, 12));
    }

    console.log(`  ${padR(model.name, 22)} ${bestFormats.join(' ')}`);
  }

  tokenizer.dispose();

  // Print cost savings summary for GPT-4o
  const gpt4oResults = results.filter((r) => r.modelId === 'gpt-4o');
  if (gpt4oResults.length > 0) {
    console.log(`\n  GPT-4o Annual Cost Breakdown (1M req/month):`);
    console.log(
      `  ${padR('Dataset', 14)} ${costFormats.map((f) => padL(f, 12)).join(' ')} ${padL('Savings', 12)}`,
    );
    console.log(`  ${thinLine}`);

    for (const ds of testDatasets) {
      const dsResults = gpt4oResults.filter((r) => r.dataset === ds.name);
      const jsonCost = dsResults.find((r) => r.format === 'json')?.annualCost || 0;
      const bestResult = dsResults.reduce(
        (best, r) => (r.annualCost < best.annualCost ? r : best),
        dsResults[0],
      );
      const row = costFormats.map((fmt) => {
        const r = dsResults.find((x) => x.format === fmt);
        return padL(r ? dollar(r.annualCost) : '-', 12);
      });
      console.log(
        `  ${padR(ds.name, 14)} ${row.join(' ')} ${padL(dollar(jsonCost - bestResult.annualCost), 12)}`,
      );
    }
  }

  return results;
}

// ============================================================================
// 16. User-Provided Data Benchmark
// ============================================================================
async function benchmarkUserFile(filePath: string) {
  printHeader(`BENCHMARK 16: User File Analysis (${filePath})`);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    let data;
    try {
      data = JSON.parse(content);
    } catch (e) {
      console.error('Error: Failed to parse JSON file.');
      return;
    }

    if (!Array.isArray(data)) {
      console.error('Error: Input file must contain a JSON array of objects.');
      return;
    }

    const count = data.length;
    console.log(`  Loaded ${count} rows from ${filePath}\n`);

    const formats: SupportedFormat[] = [
      'json',
      'json-min',
      'toon',
      'csv',
      'markdown',
      'tens',
      'tens-text',
    ];

    // 1. Size & Tokens
    console.log(
      `  ${padR('Format', 12)} ${padL('Tokens', 10)} ${padL('Bytes', 10)} ${padL('Cost (1k)', 12)} ${padL('Reduction', 10)}`,
    );
    console.log(`  ${thinLine}`);

    let jsonTokens = 0;

    for (const fmt of formats) {
      let tokens = 0;
      let bytes = 0;

      try {
        if (fmt === 'tens') {
          const bin = tensEncoder.encode(data);
          const stream = tensEncoder.encodeToTokenStream(data);
          tokens = stream.length;
          bytes = bin.length;
        } else {
          const output = transcoders.transcode(data, fmt);
          tokens = tokenizer.countTokens(output as string, 'o200k_base');
          bytes = Buffer.byteLength(output as string);
        }

        if (fmt === 'json') jsonTokens = tokens;

        const cost = (tokens / 1_000_000) * MODEL_REGISTRY['gpt-4o'].inputPricePer1M;
        const reduction = jsonTokens > 0 ? (1 - tokens / jsonTokens) * 100 : 0;
        const reductionStr = fmt === 'json' ? '-' : `${reduction.toFixed(1)}%`;

        console.log(
          `  ${padR(fmt, 12)} ${padL(String(tokens), 10)} ${padL(String(bytes), 10)} ${padL(dollar(cost), 12)} ${padL(reductionStr, 10)}`,
        );
      } catch (e) {
        console.log(
          `  ${padR(fmt, 12)} ${padL('-', 10)} ${padL('-', 10)} ${padL('-', 12)} ${padL('Error', 10)}`,
        );
      }
    }

    // 2. Context Fitting (Standard Scenario)
    console.log('\n  Context Fitting (GPT-4o, 800 sys + 4096 res):');
    try {
      const budget = calculateBudget(
        data,
        {
          model: 'gpt-4o',
          systemPromptTokens: 800,
          userPromptTokens: 200,
          responseReserve: 4096,
          formats: ['tens', 'toon', 'json', 'csv'],
        },
        tokenizer,
      );

      for (const f of budget.formatBreakdown) {
        console.log(`    ${padR(f.format, 10)}: Fits ${padL(String(f.maxRows), 6)} rows per batch`);
      }
    } catch (e) {
      console.error('  Error calculating budget fit.');
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Error processing file: ${err.message}`);
    } else {
      console.error('An unknown error occurred during file processing.');
    }
  }
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  const fileArgIndex = args.indexOf('--input');

  if (fileArgIndex !== -1 && args[fileArgIndex + 1]) {
    await benchmarkUserFile(args[fileArgIndex + 1]);
    tokenizer.dispose();
    tensEncoder.dispose();
    return;
  }

  console.log('\n' + '='.repeat(72));
  console.log('  contex INDUSTRIAL BENCHMARK SUITE v4.0');
  console.log('  Deterministic · Isolated · Comprehensive · TENS-First');
  console.log(`  24 Datasets · 21 Models · 10 Formats · Seed: ${SEED}`);
  console.log('='.repeat(72) + '\n');

  const matrix = await benchmarkMatrix();
  const marginalCost = benchmarkMarginalCost();
  const structuralOverhead = benchmarkStructuralOverhead();
  const context = benchmarkFitContext();
  const cost = benchmarkCostSavings();
  const determinism = benchmarkDeterminism();
  const prefix = benchmarkPrefixCache();
  const tens = benchmarkTensPerformance();
  const schemaWidth = benchmarkSchemaWidth();
  const tokenizerSpread = benchmarkTokenizerSpread();
  const entropyCorrelation = benchmarkEntropyCorrelation();
  const latency = benchmarkLatency();
  const memory = benchmarkMemory();
  const scalability = benchmarkScalability();
  const multiModelCost = benchmarkMultiModelCost();

  const fullReport = {
    metadata: {
      version: '4.0',
      timestamp: new Date().toISOString(),
      seed: SEED,
      datasets: DATASETS.map((d) => d.name),
      formats: FORMATS,
      sizes: SIZES,
      modelCount: Object.keys(MODEL_REGISTRY).length,
    },
    matrix,
    marginalCost,
    structuralOverhead,
    context,
    cost,
    determinism,
    prefix,
    tens,
    schemaWidth,
    tokenizerSpread,
    entropyCorrelation,
    latency,
    memory,
    scalability,
    multiModelCost,
  };

  fs.writeFileSync('benchmark_results.json', JSON.stringify(fullReport, null, 2));

  // Clean up
  disposeTensEncoder();

  console.log('\n' + '='.repeat(72));
  console.log('  All 15 benchmarks complete.');
  console.log(`  24 datasets · 21 models · 10 formats`);
  console.log('  Results saved: benchmark_results.json');
  console.log('  Generate report: npx tsx packages/cli/src/generate_report.ts');
  console.log('='.repeat(72) + '\n');
}

main().catch(console.error);
