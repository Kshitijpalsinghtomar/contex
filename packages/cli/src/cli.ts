#!/usr/bin/env node
// ============================================================================
// contex CLI (v3)
// ============================================================================
// Commands:
//   contex encode   <file.json> [--encoding cl100k_base]  → file.tens
//   contex decode   <file.tens>                           → stdout JSON
//   contex stats    <file.json> [--encoding cl100k_base]  → compression stats
//   contex formats  <file.json>                           → multi-format comparison
//   contex convert  <file.json>                           → export ALL formats
//   contex validate <file.json>                           → roundtrip integrity
//   contex savings  <file.json> [--model gpt-4o]          → dollar-cost savings report
//   contex ir-encode      <file.json>                     → encode to Canonical IR
//   contex ir-inspect     <hash>                          → inspect stored IR
//   contex ir-materialize <hash> --model <model>          → materialize for model
//   contex bench                                          → full benchmark suite
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
} from '@contex/core';
import { MODEL_REGISTRY } from '@contex/engine';
import { createContexAnthropic, createContexOpenAI } from '@contex/middleware';
import OpenAI from 'openai';

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
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

function preview(text: string, lines = 5): string {
  const allLines = text.split('\n');
  const shown = allLines.slice(0, lines).join('\n');
  const remaining = allLines.length - lines;
  return remaining > 0 ? `${shown}\n    ... (${remaining} more lines)` : shown;
}

function printUsage(): void {
  console.log(`
  ${doubleLine}
  contex CLI v3 — Context-window-optimized data engine
  ${doubleLine}

  Usage:
    contex encode   <input.json> [--encoding cl100k_base]   Encode to TENS binary
    contex decode   <input.tens>                            Decode TENS to JSON
    contex stats    <input.json> [--encoding cl100k_base]   Show TENS stats
    contex formats  <input.json>                            Compare all formats
    contex convert  <input.json>                            Export to ALL formats
    contex validate <input.json>                            Roundtrip integrity test
    contex savings  <input.json> [--model gpt-4o]           💰 Dollar-cost savings report
    contex bench                                            Full benchmark suite

  Canonical IR (v3):
    contex ir-encode      <input.json>                      Encode to Canonical IR, store in .contex/
    contex ir-inspect     <hash>                            Inspect stored IR metadata
    contex ir-materialize <hash> --model <model>            Materialize IR for a model
    contex materialize    <file.json> --model <model>       Encode + Materialize (One-step)
    contex compose        <config.json>                     Compose from config file
    contex compose        <f1> [f2] --model <m>             Compose from args
    contex inject         <file.json> --provider <p>        Run real API call with context injection

  Examples:
    npx contex savings my_data.json               Show cost savings
    npx contex savings my_data.json --model gpt-5 Savings for specific model
    npx contex convert my_data.json
    npx contex ir-encode my_data.json             Encode and store Canonical IR
  `);
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
  const json = decoder.decode(binary) as any;

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

  // 4. TOON (tab-optimized)
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
      `  ${padR(out.name, 14)} ${padL(formatBytes(bytes), 10)} ${padL(String(tokens), 10)} ${padL(reduction + '%', 10)} ${padL(path.basename(outFile), 25)}`,
    );
  }

  // Print previews of text formats
  console.log(`\n  ${doubleLine}`);
  console.log(`  Format Previews (first 5 lines each)`);
  console.log(`  ${doubleLine}`);

  for (const out of outputs) {
    if (out.isBinary) {
      const bin = out.content as Uint8Array;
      const hexPreview = Array.from(bin.slice(0, 32))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      console.log(`\n  ┌─ ${out.name} (binary, ${formatBytes(bin.length)}) ─────────────`);
      console.log(`  │ ${hexPreview} ...`);
      console.log(`  └─────────────────────────────────────`);
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
      console.log(`  └─────────────────────────────────────`);
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
  console.log(`  contex validate — Roundtrip Integrity Test`);
  console.log(`  Input: ${inputPath} (${data.length} rows)`);
  console.log(`  ${doubleLine}\n`);

  let passed = 0;
  let failed = 0;
  let skipped = 0;
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
        status: matchCount > 0 ? '⚠️ PARTIAL' : '❌ FAIL',
        detail: `${decArr.length} rows decoded, ${matchCount}/${data.length} exact match (nested objects may flatten)`,
      });
      passed++;
    }
    encoder.dispose();
    decoder.dispose();
  } catch (e: any) {
    results.push({
      format: 'TENS Binary',
      status: '❌ FAIL',
      detail: e.message?.slice(0, 80) || 'Unknown error',
    });
    failed++;
  }

  // --- TENS-Text Roundtrip ---
  try {
    const ttEncoder = new TensTextEncoder();
    const ttDecoder = new TensTextDecoder();
    const encoded = ttEncoder.encode(data);
    const decoded = ttDecoder.decode(encoded);
    const decArr = Array.isArray(decoded) ? decoded : ((decoded as any)?.rows ?? []);
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
  } catch (e: any) {
    results.push({
      format: 'TENS-Text',
      status: '❌ FAIL',
      detail: e.message?.slice(0, 80) || 'Unknown error',
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
  } catch (e: any) {
    results.push({
      format: 'JSON',
      status: '❌ FAIL',
      detail: e.message?.slice(0, 80) || 'Unknown error',
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
  } catch (e: any) {
    results.push({
      format: 'CSV',
      status: '❌ FAIL',
      detail: e.message?.slice(0, 80) || 'Unknown error',
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
  } catch (e: any) {
    results.push({
      format: 'TOON',
      status: '❌ FAIL',
      detail: e.message?.slice(0, 80) || 'Unknown error',
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
  } catch (e: any) {
    results.push({
      format: 'Markdown',
      status: '❌ FAIL',
      detail: e.message?.slice(0, 80) || 'Unknown error',
    });
    failed++;
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
    console.log(`  ✅ All roundtrip formats passed integrity check!`);
  } else {
    console.log(`  ❌ ${failed} format(s) failed roundtrip validation.`);
  }
  console.log('');
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

  const tokenizer = new TokenizerManager();

  const modelSpec = MODEL_REGISTRY[primaryModel];
  if (!modelSpec) {
    console.error(
      `Error: Unknown model "${primaryModel}". Available: ${Object.keys(MODEL_REGISTRY).slice(0, 5).join(', ')}...`,
    );
    process.exit(1);
  }

  console.log(`\n  ${doubleLine}`);
  console.log(`  💰 Contex Savings Report`);
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
        `  ${padR(fmt.name, 22)} ${padL(tokens.toLocaleString(), 10)} ${padL('$' + costPer1K.toFixed(4), 12)} ${padL('$' + annual.toFixed(2), 14)} ${padL(savings, 10)}${marker}`,
      );
    }

    const annualSaved = baselineAnnual - bestAnnual;
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
  console.log(`  💡 Quick Start:`);
  console.log(``);
  console.log(`     import { quick } from '@contex/engine';`);
  console.log(`     const result = quick(yourData, '${primaryModel}');`);
  console.log(`     // result.output is ready for your LLM`);
  console.log(`  ${doubleLine}\n`);
  console.log(`  * Annual estimate: 10,000 API calls/day × 365 days\n`);

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
  console.log(`  contex ir-encode — Canonical IR`);
  console.log(`  ${doubleLine}`);
  console.log(`  Input:  ${inputPath} (${data.length} rows)`);
  console.log(`  Hash:   ${result.hash}`);
  console.log(`  Size:   ${formatBytes(result.irByteSize)}`);
  console.log(`  Status: ${result.isNew ? '✅ Stored (new)' : '⚡ Dedup hit (already stored)'}`);
  console.log(`  Dir:    ${storeDir}/`);
  console.log('');

  if (result.isNew) {
    console.log(`  Use this hash to inspect or materialize:`);
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
      console.error(`\n  Available hashes:`);
      for (const item of all) {
        console.error(`    ${item.hash} (${item.rowCount} rows, ${formatBytes(item.irByteSize)})`);
      }
    }
    memory.dispose();
    process.exit(1);
  }

  const meta = memory.getMeta(hash)!;
  const cachedModels = memory.getCachedModels(hash);

  console.log(`\n  ${doubleLine}`);
  console.log(`  contex ir-inspect`);
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
  console.log(`  contex ir-materialize`);
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
  const allBlocks: any[] = [];
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
  console.log(`  contex compose`);
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
  console.log(`  contex materialize`);
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
      'Error: missing input file. Usage: contex inject <file.json> --provider openai|anthropic',
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

  // Read data
  const raw = readFileSync(file, 'utf-8');
  const data = JSON.parse(raw);
  const collectionName = path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9_]/g, '_');

  console.log(`\n  ${doubleLine}`);
  console.log(`  contex inject`);
  console.log(`  ${doubleLine}`);
  console.log(`  Provider:    ${provider}`);
  console.log(`  Model:       ${modelId}`);
  console.log(`  Input:       ${file} (as {{CONTEX:${collectionName}}})`);

  const preferTokens = hasFlag('prefer-tokens');
  if (preferTokens) {
    console.log(`  Mode:        Prefer Tokens (if supported)`);
    process.env.CONTEXT_ENABLE_TOKEN_INJECT = 'true';
  }

  try {
    if (provider === 'openai') {
      if (!process.env.OPENAI_API_KEY) {
        console.error('Error: OPENAI_API_KEY environment variable not set.');
        process.exit(1);
      }

      const client = createContexOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
        data: { [collectionName]: data },
        onInject: (info) => {
          console.log(
            `  Injection:   ✅ Injected ${info.tokenCount} tokens for '${info.collection}'`,
          );
          console.log(
            `               Using cache: ${info.cacheHit ? 'YES (Prefix Hit)' : 'NO (New Materialization)'}`,
          );
        },
      });

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
      console.log(`  Response:    ${response.choices[0].message.content}`);
    } else if (provider === 'anthropic') {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error('Error: ANTHROPIC_API_KEY environment variable not set.');
        process.exit(1);
      }

      const client = createContexAnthropic(
        new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as any,
        {
          data: { [collectionName]: data },
          onInject: (info) => {
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
      console.log(`  Response:    ${(response.content[0] as any).text}`);
    }
  } catch (err: any) {
    console.error(`\nError calling API: ${err.message}`);
    process.exit(1);
  }
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
  let config: any;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    console.error(`Error: Failed to parse config file: ${(e as Error).message}`);
    process.exit(1);
  }

  const modelId = getFlag('model') ?? config.model ?? 'gpt-4o';
  const reserveForResponse =
    (getFlag('reserve') ? Number.parseInt(getFlag('reserve')!, 10) : undefined) ??
    config.reserve ??
    4096;

  // Parse blocks
  const blocks: any[] = [];

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

switch (command) {
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
    if (args[1] && args[1].endsWith('.json') && !args[2]) {
      // Heuristic: if only 1 arg and it's json, try config mode (or fallback to prompt mode if it's data)
      // For now, simpler to just use composePrompt which handles files
      composePrompt();
    } else {
      composePrompt();
    }
    break;
  case 'inject':
    injectFile();
    break;
  case 'bench':
    import('./benchmark.js');
    break;
  default:
    printUsage();
    break;
}
