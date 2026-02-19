import fs from 'node:fs';
import path from 'node:path';
import { TensTextEncoder } from '@contex-llm/core';
import OpenAI from 'openai';
import { encoding_for_model } from 'tiktoken';
import { generateRealWorld } from '../generators.js';
import 'dotenv/config';

// --- Configuration ---
const MODEL = 'gpt-4o-mini';
const TRIALS = 3;

// Consumer Pricing (Feb 2026)
const PRICE_MINI = 0.15; // $0.15 / 1M input tokens
const PRICE_STANDARD = 2.5; // $2.50 / 1M input tokens (GPT-4o)

type DatasetRow = Record<string, unknown>;
type BenchResult = { latency: number; tokens: number };

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown };
  return candidate.status === 429;
}

async function runBenchmark() {
  console.log('Starting Real OpenAI API Benchmark...');
  console.log('=======================================');

  const apiKey = process.env.OPENAI_API_KEY;
  const isDryRun = !apiKey || process.argv.includes('--dry-run');

  if (!apiKey && !isDryRun) {
    console.error('Error: OPENAI_API_KEY environment variable is not set.');
    console.error('To run without API key (token checks only), use: --dry-run');
    process.exit(1);
  }

  const openai = apiKey ? new OpenAI({ apiKey }) : null;

  // --- Load Data ---
  let dataset: DatasetRow[];
  let datasetName = 'RealWorld (Generated)';

  const possiblePaths = [
    path.resolve(process.cwd(), 'dummy.json'),
    path.resolve(process.cwd(), '../../dummy.json'),
    path.resolve(process.cwd(), '../../../dummy.json'),
  ];

  const customPath = possiblePaths.find((p) => fs.existsSync(p));

  if (customPath) {
    console.log(`Found custom dataset: ${customPath}`);
    try {
      const content = fs.readFileSync(customPath, 'utf-8');
      dataset = JSON.parse(content);
      datasetName = 'dummy.json (Custom)';
      console.log(`Loaded ${dataset.length} records.`);

      if (dataset.length > 500) {
        console.log('Limiting to first 500 records for benchmark speed...');
        dataset = dataset.slice(0, 500);
      }
    } catch (e) {
      console.error('Failed to parse dummy.json, falling back to generator.');
      dataset = generateRealWorld(100);
    }
  } else {
    console.log('No dummy.json found, using generated RealWorld data.');
    dataset = generateRealWorld(100);
  }

  // --- Prepare Payloads ---
  console.log('Preparing payloads...');

  // 1. JSON (Pretty)
  const jsonPretty = JSON.stringify(dataset, null, 2);

  // 2. JSON (Minified)
  const jsonMin = JSON.stringify(dataset);

  // 3. TENS
  const tensEncoder = new TensTextEncoder('o200k_base');
  const tensPayload = tensEncoder.encode(dataset);

  // --- Token Verification (Local) ---
  console.log('Verifying token counts locally with tiktoken...');
  const enc = encoding_for_model(MODEL as Parameters<typeof encoding_for_model>[0]);
  const tPretty = enc.encode(jsonPretty).length;
  const tMin = enc.encode(jsonMin).length;
  const tTens = enc.encode(tensPayload).length;
  enc.free();

  console.log(`JSON Pretty Tokens: ${tPretty}`);
  console.log(`JSON Minified Tokens: ${tMin}`);
  console.log(`TENS Tokens:        ${tTens}`);
  console.log(`Reduction vs Min:   ${((1 - tTens / tMin) * 100).toFixed(1)}%`);
  console.log('---------------------------------------');

  // --- API Benchmark ---
  if (isDryRun || !openai) {
    console.log(
      '\n[Dry Run] Skipping properties that require OpenAI API (Latency, Real Cost Verification).',
    );
    console.log('To run full benchmark, set OPENAI_API_KEY and run without --dry-run.');

    // Mock results for dry run
    const resPretty = { latency: 0, tokens: tPretty };
    const resMin = { latency: 0, tokens: tMin };
    const resTens = { latency: 0, tokens: tTens };

    printReport(datasetName, dataset.length, resPretty, resMin, resTens);
    return;
  }

  const client = openai;

  console.log(`Sending requests to OpenAI (${MODEL})...`);
  console.log(
    'Note: Using first 10 records for latency testing to avoid Rate Limits, while projecting costs for full dataset.',
  );

  // Create smaller payloads for latency testing
  const latencySubset = dataset.slice(0, 10);
  const latJsonPretty = JSON.stringify(latencySubset, null, 2);
  const latJsonMin = JSON.stringify(latencySubset);
  const latTens = tensEncoder.encode(latencySubset);

  async function benchmarkRequest(name: string, content: string) {
    const start = performance.now();
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: content }],
        max_tokens: 1,
        stream: false,
      });
      const end = performance.now();

      // Log the Request ID for proof
      if (response.id) {
        process.stdout.write(` (ID: ${response.id.slice(-6)}) `);
      }

      return {
        latency: end - start,
        usage: response.usage,
        success: true,
      };
    } catch (error: unknown) {
      if (isRateLimitError(error)) {
        console.warn(
          `\n  [Rate Limit] 429 Hit during ${name}. Skipping remaining trials for this format.`,
        );
        return { latency: 0, usage: null, success: false };
      }
      throw error;
    }
  }

  // Benchmark Loop
  async function runTrials(label: string, payload: string) {
    console.log(`Testing ${label}...`);
    let totalLatency = 0;
    let validTrials = 0;

    for (let i = 0; i < TRIALS; i++) {
      process.stdout.write(`  Trial ${i + 1}/${TRIALS}... `);
      const res = await benchmarkRequest(label, payload);

      if (!res.success) break;

      totalLatency += res.latency;
      validTrials++;
      process.stdout.write(`${res.latency.toFixed(0)}ms\n`);
    }

    return {
      latency: validTrials > 0 ? totalLatency / validTrials : 0,
      // Return tokens from FULL dataset (calculated locally) for the report
      tokens: label.includes('Pretty') ? tPretty : label.includes('TENS') ? tTens : tMin,
    };
  }

  const resPretty = await runTrials('JSON (Pretty)', latJsonPretty);
  const resMin = await runTrials('JSON (Min)', latJsonMin);
  const resTens = await runTrials('TENS', latTens);

  // Patch the token counts back to the FULL dataset numbers for the report
  resPretty.tokens = tPretty;
  resMin.tokens = tMin;
  resTens.tokens = tTens;

  printReport(datasetName, dataset.length, resPretty, resMin, resTens);
}

function printReport(
  datasetName: string,
  count: number,
  resPretty: BenchResult,
  resMin: BenchResult,
  resTens: BenchResult,
) {
  // --- Results & Projection ---
  function calcCost(tokens: number, pricePer1M: number) {
    return (tokens / 1_000_000) * pricePer1M;
  }

  console.log('\n================================================================================');
  console.log(`FINAL BENCHMARK REPORT: ${datasetName} (${count} records)`);
  console.log('================================================================================');

  const pad = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);

  console.log(
    `${pad('Metric', 20)} ${padL('JSON Pretty', 15)} ${padL('JSON Min', 15)} ${padL('TENS', 15)} ${padL('Improvement', 15)}`,
  );
  console.log(
    `${pad('', 20)} ${padL('', 15).replace(/ /g, '-')} ${padL('', 15).replace(/ /g, '-')} ${padL('', 15).replace(/ /g, '-')} ${padL('', 15).replace(/ /g, '-')}`,
  );

  // Tokens
  const pctTokens = `${((1 - resTens.tokens / resMin.tokens) * 100).toFixed(1)}%`;
  console.log(
    `${pad('Tokens', 20)} ${padL(resPretty.tokens.toString(), 15)} ${padL(resMin.tokens.toString(), 15)} ${padL(resTens.tokens.toString(), 15)} ${padL(pctTokens, 15)}`,
  );

  // Latency
  if (resMin.latency > 0) {
    const timeSpeedup = `${(resMin.latency / resTens.latency).toFixed(1)}x`;
    console.log(
      `${pad('Latency (ms)', 20)} ${padL(resPretty.latency.toFixed(0), 15)} ${padL(resMin.latency.toFixed(0), 15)} ${padL(resTens.latency.toFixed(0), 15)} ${padL(timeSpeedup, 15)}`,
    );
  } else {
    console.log(
      `${pad('Latency (ms)', 20)} ${padL('N/A', 15)} ${padL('N/A', 15)} ${padL('N/A', 15)} ${padL('N/A', 15)}`,
    );
  }

  console.log('--------------------------------------------------------------------------------');
  console.log('COST PROJECTIONS (Per 1M Requests)');

  // Cost Standard
  const costStdPretty = calcCost(resPretty.tokens, PRICE_STANDARD) * 1_000_000;
  const costStdMin = calcCost(resMin.tokens, PRICE_STANDARD) * 1_000_000;
  const costStdTens = calcCost(resTens.tokens, PRICE_STANDARD) * 1_000_000;
  const saveStd = costStdMin - costStdTens;

  console.log(
    `${pad('GPT-4o Cost', 20)} ${padL(`$${costStdPretty.toFixed(0)}`, 15)} ${padL(`$${costStdMin.toFixed(0)}`, 15)} ${padL(`$${costStdTens.toFixed(0)}`, 15)} ${padL(`SAVE $${saveStd.toFixed(0)}`, 15)}`,
  );

  // Cost Mini
  const costMiniPretty = calcCost(resPretty.tokens, PRICE_MINI) * 1_000_000;
  const costMiniMin = calcCost(resMin.tokens, PRICE_MINI) * 1_000_000;
  const costMiniTens = calcCost(resTens.tokens, PRICE_MINI) * 1_000_000;
  const saveMini = costMiniMin - costMiniTens;
  console.log(
    `${pad('GPT-4o-Mini Cost', 20)} ${padL(`$${costMiniPretty.toFixed(0)}`, 15)} ${padL(`$${costMiniMin.toFixed(0)}`, 15)} ${padL(`$${costMiniTens.toFixed(0)}`, 15)} ${padL(`SAVE $${saveMini.toFixed(0)}`, 15)}`,
  );

  console.log('================================================================================');
}

runBenchmark().catch(console.error);
