import fs from 'node:fs';
import path from 'node:path';
import { TensTextEncoder } from '@contex-llm/core';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateRealWorld } from '../generators.js';
import 'dotenv/config';

// --- Configuration ---
const MODEL_NAME = 'gemini-2.5-flash';
const TRIALS = 3;

// Consumer Pricing (Feb 2026 - Approximate for 2.5 Flash)
const PRICE_FLASH = 0.075; // Approx $0.075 / 1M input
const PRICE_PRO = 3.5; // Approx $3.50 / 1M input (Pro tier)

type DatasetRow = Record<string, unknown>;
type BenchResult = { latency: number; tokens: number };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; message?: unknown };
  return candidate.status === 429 || String(candidate.message ?? '').includes('429');
}

async function runBenchmark() {
  console.log('Starting Real Google Gemini Benchmark...');
  console.log('=========================================');

  const apiKey = process.env.GOOGLE_API_KEY;
  const isDryRun = !apiKey || process.argv.includes('--dry-run');

  if (!apiKey && !isDryRun) {
    console.error('Error: GOOGLE_API_KEY environment variable is not set.');
    console.error('To run without API key (token checks only), use: --dry-run');
    process.exit(1);
  }

  const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
  const model = genAI ? genAI.getGenerativeModel({ model: MODEL_NAME }) : null;

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

  const jsonPretty = JSON.stringify(dataset, null, 2);
  const jsonMin = JSON.stringify(dataset);
  const tensEncoder = new TensTextEncoder('o200k_base');
  const tensPayload = tensEncoder.encode(dataset);

  // --- Token Verification (Using Gemini SDK) ---
  console.log('Verifying token counts with Gemini SDK...');

  let tPretty = 0;
  let tMin = 0;
  let tTens = 0;

  if (model) {
    try {
      const rPretty = await model.countTokens(jsonPretty);
      const rMin = await model.countTokens(jsonMin);

      // Note: countTokens for raw text/binary might differ slightly depending on SDK's handling
      // TENS is typically binary strings but Gemini SDK expects text unless configured.
      // We pass it as text here for comparable tokenization logic.
      const rTens = await model.countTokens(tensPayload);

      tPretty = rPretty.totalTokens;
      tMin = rMin.totalTokens;
      tTens = rTens.totalTokens;
    } catch (error: unknown) {
      console.error('Failed to count tokens via API:', getErrorMessage(error));
      // Fallback estimation for dry run logic if API fails even with key?
      // Usually we just show 0 to indicate error.
    }
  } else {
    console.log('[Dry Run] Estimating tokens (requires API Key for exact count)');
    // Crude estimation for dry run
    tPretty = Math.ceil(jsonPretty.length / 3.5);
    tMin = Math.ceil(jsonMin.length / 3.5);
    tTens = Math.ceil(tensPayload.length / 3.5);
  }

  if (tPretty > 0) {
    console.log(`JSON Pretty Tokens: ${tPretty}`);
    console.log(`JSON Minified Tokens: ${tMin}`);
    console.log(`TENS Tokens:        ${tTens}`);
    if (tMin > 0) {
      console.log(`Reduction vs Min:   ${((1 - tTens / tMin) * 100).toFixed(1)}%`);
    }
  }
  console.log('---------------------------------------');

  // --- API Benchmark ---
  if (isDryRun || !model) {
    console.log('\n[Dry Run] Skipping API latency tests.');
    const resPretty = { latency: 0, tokens: tPretty };
    const resMin = { latency: 0, tokens: tMin };
    const resTens = { latency: 0, tokens: tTens };
    printReport(datasetName, dataset.length, resPretty, resMin, resTens);
    return;
  }

  const activeModel = model;

  console.log(`Sending requests to Gemini (${MODEL_NAME})...`);
  console.log('Note: Using first 10 records for latency testing.');

  // Create smaller payloads for latency testing
  const latencySubset = dataset.slice(0, 10);
  const latTens = tensEncoder.encode(latencySubset);

  async function benchmarkRequest(name: string, content: string) {
    const start = performance.now();
    try {
      const result = await activeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: content }] }],
        generationConfig: { maxOutputTokens: 1 },
      });
      await result.response;
      const end = performance.now();

      // Log Request ID if available? Not standard in response object easily

      return {
        latency: end - start,
        usage: result.response.usageMetadata,
        success: true,
      };
    } catch (error: unknown) {
      if (isRateLimitError(error)) {
        console.warn(`\n  [Rate Limit] 429 Hit during ${name}.`);
        return { latency: 0, usage: null, success: false };
      }
      console.error('\nAPI Error:', getErrorMessage(error));
      return { latency: 0, usage: null, success: false };
    }
  }

  async function runTrials(label: string, payload: string) {
    console.log(`Testing ${label}...`);
    let totalLatency = 0;
    let validTrials = 0;

    for (let i = 0; i < TRIALS; i++) {
      process.stdout.write(`  Trial ${i + 1}/${TRIALS}... `);
      const res = await benchmarkRequest(label, payload);

      if (!res.success) {
        process.stdout.write('Failed\n');
        break;
      }

      totalLatency += res.latency;
      validTrials++;
      process.stdout.write(`${res.latency.toFixed(0)}ms\n`);
    }

    return {
      latency: validTrials > 0 ? totalLatency / validTrials : 0,
      tokens: label.includes('Pretty') ? tPretty : label.includes('TENS') ? tTens : tMin,
    };
  }

  const resPretty = await runTrials('JSON (Pretty)', JSON.stringify(latencySubset, null, 2));
  const resMin = await runTrials('JSON (Min)', JSON.stringify(latencySubset));
  const resTens = await runTrials('TENS', latTens);

  // Patch tokens back to full dataset
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
  function calcCost(tokens: number, pricePer1M: number) {
    return (tokens / 1_000_000) * pricePer1M;
  }

  console.log('\n================================================================================');
  console.log(`FINAL GEMINI BENCHMARK REPORT: ${datasetName} (${count} records)`);
  console.log('================================================================================');

  const pad = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);

  console.log(
    `${pad('Metric', 20)} ${padL('JSON Pretty', 15)} ${padL('JSON Min', 15)} ${padL('TENS', 15)} ${padL('Improvement', 15)}`,
  );
  console.log(
    `${pad('', 20)} ${padL('', 15).replace(/ /g, '-')} ${padL('', 15).replace(/ /g, '-')} ${padL('', 15).replace(/ /g, '-')} ${padL('', 15).replace(/ /g, '-')}`,
  );

  const pctTokens =
    resMin.tokens > 0 ? `${((1 - resTens.tokens / resMin.tokens) * 100).toFixed(1)}%` : 'N/A';
  console.log(
    `${pad('Tokens', 20)} ${padL(resPretty.tokens.toString(), 15)} ${padL(resMin.tokens.toString(), 15)} ${padL(resTens.tokens.toString(), 15)} ${padL(pctTokens, 15)}`,
  );

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

  const costProPretty = calcCost(resPretty.tokens, PRICE_PRO) * 1_000_000;
  const costProMin = calcCost(resMin.tokens, PRICE_PRO) * 1_000_000;
  const costProTens = calcCost(resTens.tokens, PRICE_PRO) * 1_000_000;
  const savePro = costProMin - costProTens;

  console.log(
    `${pad('Gemini 1.5 Pro', 20)} ${padL(`$${costProPretty.toFixed(0)}`, 15)} ${padL(`$${costProMin.toFixed(0)}`, 15)} ${padL(`$${costProTens.toFixed(0)}`, 15)} ${padL(`SAVE $${savePro.toFixed(0)}`, 15)}`,
  );

  const costFlashPretty = calcCost(resPretty.tokens, PRICE_FLASH) * 1_000_000;
  const costFlashMin = calcCost(resMin.tokens, PRICE_FLASH) * 1_000_000;
  const costFlashTens = calcCost(resTens.tokens, PRICE_FLASH) * 1_000_000;
  const saveFlash = costFlashMin - costFlashTens;
  console.log(
    `${pad('Gemini 1.5 Flash', 20)} ${padL(`$${costFlashPretty.toFixed(0)}`, 15)} ${padL(`$${costFlashMin.toFixed(0)}`, 15)} ${padL(`$${costFlashTens.toFixed(0)}`, 15)} ${padL(`SAVE $${saveFlash.toFixed(0)}`, 15)}`,
  );

  console.log('================================================================================');
}

runBenchmark().catch(console.error);
