#!/usr/bin/env node
// ============================================================================
// TENS Stress Test + Structural Token Map
// ============================================================================
// Tests TENS vs TOON across all hard datasets and produces a token-by-token
// breakdown of where overhead comes from.

import {
  ARRAY_LEN_BASE,
  CTRL,
  MASK_CHUNK_BASE,
  MASK_CHUNK_BITS,
  TokenStreamEncoder,
  TokenizerManager,
} from '@contex-llm/core';
import { formatOutput } from '@contex-llm/core';
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

const tokenizer = new TokenizerManager();
const tensEncoder = new TokenStreamEncoder();
const SEED = 42;

// ---- Helpers ----
function extractLeafValues(obj: unknown): string[] {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== 'object') return [String(obj)];
  if (Array.isArray(obj)) return obj.flatMap(extractLeafValues);
  return Object.values(obj as Record<string, unknown>).flatMap(extractLeafValues);
}

const padR = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);
const line = '═'.repeat(90);
const thinLine = '─'.repeat(90);

// All CTRL token IDs for classification
const CTRL_IDS = new Set(Object.values(CTRL).filter((v) => typeof v === 'number') as number[]);

interface TokenBreakdown {
  schemaDef: number; // SCHEMA_DEF tokens
  schemaFieldNames: number; // Tokenized field name tokens within schema def
  schemaSeparators: number; // SEPARATOR tokens within schema def
  rowBreaks: number; // ROW_BREAK tokens
  objBoundary: number; // OBJ_START + OBJ_END (multi-schema only)
  schemaRef: number; // SCHEMA_REF tokens (multi-schema only)
  fixedArray: number; // FIXED_ARRAY + length tokens
  presenceMask: number; // PRESENCE_MASK + mask chunk tokens
  arrBoundary: number; // ARR_START + ARR_END (legacy, should be 0)
  arrSeparators: number; // SEPARATOR within arrays (legacy, should be 0)
  nullBool: number; // NULL_VAL + BOOL_TRUE + BOOL_FALSE
  valueSeparators: number; // SEPARATOR between values (multi-schema)
  dataTokens: number; // Real tokenized value tokens (strings, numbers)
  total: number;
}

function analyzeTokenStream(data: Record<string, unknown>[]): TokenBreakdown {
  const stream: number[] = tensEncoder.encodeToTokenStream(data);

  const breakdown: TokenBreakdown = {
    schemaDef: 0,
    schemaFieldNames: 0,
    schemaSeparators: 0,
    rowBreaks: 0,
    objBoundary: 0,
    schemaRef: 0,
    fixedArray: 0,
    presenceMask: 0,
    arrBoundary: 0,
    arrSeparators: 0,
    nullBool: 0,
    valueSeparators: 0,
    dataTokens: 0,
    total: stream.length,
  };

  let inSchemaDef = false;

  for (let i = 0; i < stream.length; i++) {
    const t = stream[i];

    if (t === CTRL.SCHEMA_DEF) {
      breakdown.schemaDef++;
      inSchemaDef = true;
      continue;
    }

    if (inSchemaDef) {
      if (t === CTRL.SEPARATOR) {
        breakdown.schemaSeparators++;
        continue;
      }
      if (
        t === CTRL.ROW_BREAK ||
        t === CTRL.OBJ_START ||
        t === CTRL.SCHEMA_REF ||
        t === CTRL.PRESENCE_MASK ||
        t === CTRL.FIXED_ARRAY
      ) {
        inSchemaDef = false;
        // Fall through to classify this token
      } else if (t >= 300000 || t >= 400000) {
        inSchemaDef = false;
      } else if (!CTRL_IDS.has(t) && t < 200000) {
        breakdown.schemaFieldNames++;
        continue;
      } else {
        inSchemaDef = false;
      }
    }

    // Row data classification
    if (t === CTRL.ROW_BREAK) {
      breakdown.rowBreaks++;
      continue;
    }
    if (t === CTRL.OBJ_START || t === CTRL.OBJ_END) {
      breakdown.objBoundary++;
      continue;
    }
    if (t === CTRL.SCHEMA_REF) {
      breakdown.schemaRef++;
      i++;
      continue;
    }

    // New: Presence mask + chunked bitfield
    if (t === CTRL.PRESENCE_MASK) {
      breakdown.presenceMask++;
      continue;
    }
    if (t >= MASK_CHUNK_BASE && t < MASK_CHUNK_BASE + 65536) {
      breakdown.presenceMask++;
      continue;
    }

    // New: Fixed array + length token
    if (t === CTRL.FIXED_ARRAY) {
      breakdown.fixedArray++;
      continue;
    }
    if (t >= ARRAY_LEN_BASE && t < ARRAY_LEN_BASE + 100000) {
      breakdown.fixedArray++;
      continue;
    }

    // Legacy array tokens (should be 0 with new encoding)
    if (t === CTRL.ARR_START || t === CTRL.ARR_END) {
      breakdown.arrBoundary++;
      continue;
    }
    if (t === CTRL.SEPARATOR) {
      breakdown.arrSeparators++;
      continue;
    }

    if (t === CTRL.NULL_VAL || t === CTRL.BOOL_TRUE || t === CTRL.BOOL_FALSE) {
      breakdown.nullBool++;
      continue;
    }

    // Everything else is real data tokens
    breakdown.dataTokens++;
  }

  return breakdown;
}

// ============================================================================
// Section 1: Stress Test — TENS vs TOON across ALL hard datasets
// ============================================================================

console.log(`\n${line}`);
console.log('  SECTION 1: TENS vs TOON Stress Test — All Datasets');
console.log(line);

const allDatasets = [
  // --- Structural stress tests ---
  { name: 'Flat', fn: (n: number) => generateFlat(n, SEED) },
  { name: 'Nested', fn: (n: number) => generateNested(n, SEED) },
  { name: 'DeepNested(5)', fn: (n: number) => generateDeepNested(n, 5, SEED) },
  { name: 'Sparse', fn: (n: number) => generateSparse(n, SEED) },
  { name: 'ExtremelySparse', fn: (n: number) => generateExtremelySparse(n, SEED) },
  { name: 'WideSchema(40)', fn: (n: number) => generateWideSchema(n, 40, SEED) },
  { name: 'WideSchema(80)', fn: (n: number) => generateWideSchema(n, 80, SEED) },
  { name: 'WideSchema(120)', fn: (n: number) => generateWideSchema(n, 120, SEED) },
  { name: 'MixedNested', fn: (n: number) => generateMixedNestedTabular(n, SEED) },
  { name: 'ShortStrings', fn: (n: number) => generateShortStrings(n, SEED) },
  { name: 'NumericHeavy', fn: (n: number) => generateNumericHeavy(n, SEED) },
  { name: 'Repetitive', fn: (n: number) => generateRepetitive(n, SEED) },
  { name: 'LongText', fn: (n: number) => generateLongText(n, SEED) },
  { name: 'RealWorld', fn: (n: number) => generateRealWorld(n, SEED) },
  // --- Industry datasets ---
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

const rowCounts = [500, 5000, 10000];

console.log(
  `\n  ${padR('Dataset', 20)} ${padL('Rows', 6)} │ ${padL('TENS', 8)} ${padL('TOON', 8)} ${padL('CSV', 8)} ${padL('JSON', 8)} │ ${padL('TENS%', 7)} ${padL('TOON%', 7)} ${padL('CSV%', 7)} ${padL('JSON%', 7)} │ ${padL('Winner', 6)}`,
);
console.log(`  ${thinLine}`);

const stressResults: Array<{ tensWins: boolean }> = [];

for (const ds of allDatasets) {
  for (const rows of rowCounts) {
    let data: Record<string, unknown>[];
    try {
      data = ds.fn(rows) as Record<string, unknown>[];
    } catch {
      continue;
    }

    const allValues = extractLeafValues(data).join(' ');
    const valueTokens = tokenizer.countTokens(allValues, 'o200k_base');

    const toonOutput = formatOutput(data, 'toon');
    const csvOutput = formatOutput(data, 'csv');
    const jsonOutput = JSON.stringify(data);

    const tTens = tensEncoder.encodeToTokenStream(data).length;
    const tToon = tokenizer.countTokens(toonOutput, 'o200k_base');
    const tCsv = tokenizer.countTokens(csvOutput, 'o200k_base');
    const tJson = tokenizer.countTokens(jsonOutput, 'o200k_base');

    const ohTens = tTens > 0 ? ((tTens - valueTokens) / tTens) * 100 : 0;
    const ohToon = tToon > 0 ? ((tToon - valueTokens) / tToon) * 100 : 0;
    const ohCsv = tCsv > 0 ? ((tCsv - valueTokens) / tCsv) * 100 : 0;
    const ohJson = tJson > 0 ? ((tJson - valueTokens) / tJson) * 100 : 0;

    const winner =
      tTens <= tToon ? (tTens <= tCsv ? 'TENS' : 'CSV') : tToon <= tCsv ? 'TOON' : 'CSV';
    const tensWin = tTens <= tToon;

    console.log(
      `  ${padR(ds.name, 20)} ${padL(String(rows), 6)} │ ${padL(String(tTens), 8)} ${padL(String(tToon), 8)} ${padL(String(tCsv), 8)} ${padL(String(tJson), 8)} │ ${padL(ohTens.toFixed(1), 7)} ${padL(ohToon.toFixed(1), 7)} ${padL(ohCsv.toFixed(1), 7)} ${padL(ohJson.toFixed(1), 7)} │ ${padL(winner, 6)}${tensWin ? ' ✓' : ''}`,
    );

    stressResults.push({
      dataset: ds.name,
      rows,
      tTens,
      tToon,
      tCsv,
      tJson,
      ohTens: +ohTens.toFixed(1),
      ohToon: +ohToon.toFixed(1),
      ohCsv: +ohCsv.toFixed(1),
      ohJson: +ohJson.toFixed(1),
      winner,
      tensWins: tensWin,
    });
  }
}

// Scoreboard
const wins = stressResults.filter((r) => r.tensWins).length;
const total = stressResults.length;
console.log(
  `\n  SCOREBOARD: TENS wins ${wins}/${total} matchups vs TOON (${((wins / total) * 100).toFixed(0)}%)`,
);

// ============================================================================
// Section 2: Structural Token Map — Where does TENS overhead come from?
// ============================================================================

console.log(`\n${line}`);
console.log('  SECTION 2: Structural Token Map — TENS Overhead Breakdown');
console.log(line);

const mapDatasets = [
  { name: 'Flat', data: generateFlat(500, SEED) },
  { name: 'RealWorld', data: generateRealWorld(500, SEED) },
  { name: 'DeepNested(5)', data: generateDeepNested(500, 5, SEED) },
  { name: 'Nested', data: generateNested(500, SEED) },
  { name: 'Sparse', data: generateSparse(500, SEED) },
  { name: 'ExtremelySparse', data: generateExtremelySparse(500, SEED) },
  { name: 'WideSchema(80)', data: generateWideSchema(500, 80, SEED) },
  { name: 'Ecommerce', data: generateEcommerce(500, SEED) },
  { name: 'Healthcare', data: generateHealthcare(500, SEED) },
  { name: 'IoT', data: generateIoT(500, SEED) },
  { name: 'Financial', data: generateFinancial(500, SEED) },
  { name: 'ChatMessages', data: generateChatMessages(500, SEED) },
  { name: 'NumericHeavy', data: generateNumericHeavy(500, SEED) },
  { name: 'Repetitive', data: generateRepetitive(500, SEED) },
  { name: 'MixedNested', data: generateMixedNestedTabular(500, SEED) },
];

console.log(
  `\n  ${padR('Dataset', 18)} │ ${padL('Total', 7)} ${padL('Data', 7)} │ ${padL('Schema', 7)} ${padL('RowBrk', 7)} ${padL('FxdArr', 7)} ${padL('PrsMsk', 7)} ${padL('NulBol', 7)} ${padL('ObjBnd', 7)} │ ${padL('OH%', 6)}`,
);
console.log(`  ${thinLine}`);

for (const ds of mapDatasets) {
  const bd = analyzeTokenStream(ds.data);
  const structTotal =
    bd.schemaDef +
    bd.schemaFieldNames +
    bd.schemaSeparators +
    bd.rowBreaks +
    bd.objBoundary +
    bd.schemaRef +
    bd.fixedArray +
    bd.presenceMask +
    bd.arrBoundary +
    bd.arrSeparators +
    bd.nullBool +
    bd.valueSeparators;
  const ohPct = bd.total > 0 ? (structTotal / bd.total) * 100 : 0;
  const schemaTotal = bd.schemaDef + bd.schemaFieldNames + bd.schemaSeparators;

  console.log(
    `  ${padR(ds.name, 18)} │ ${padL(String(bd.total), 7)} ${padL(String(bd.dataTokens), 7)} │ ` +
      `${padL(String(schemaTotal), 7)} ${padL(String(bd.rowBreaks), 7)} ` +
      `${padL(String(bd.fixedArray), 7)} ${padL(String(bd.presenceMask), 7)} ` +
      `${padL(String(bd.nullBool), 7)} ${padL(String(bd.objBoundary), 7)} │ ${padL(ohPct.toFixed(1), 6)}`,
  );
}

console.log('\n  Legend:');
console.log('    Schema  = SCHEMA_DEF + field name tokens + field separators');
console.log('    RowBrk  = ROW_BREAK delimiters between rows');
console.log('    FxdArr  = FIXED_ARRAY + length tokens (per array value)');
console.log('    PrsMsk  = PRESENCE_MASK + mask chunk tokens (per sparse row)');
console.log('    NulBol  = NULL_VAL + BOOL_TRUE + BOOL_FALSE control tokens');
console.log('    ObjBnd  = OBJ_START + OBJ_END (multi-schema only)');
console.log('    OH%     = (all structural tokens / total tokens) x 100');

// ============================================================================
// Section 3: Per-category breakdown for top datasets
// ============================================================================

console.log(`\n${line}`);
console.log('  SECTION 3: Detailed Token Budget — Top 5 Datasets');
console.log(line);

const detailDatasets = ['RealWorld', 'DeepNested(5)', 'Ecommerce', 'Healthcare', 'MixedNested'];

for (const name of detailDatasets) {
  const ds = mapDatasets.find((d) => d.name === name);
  if (!ds) continue;
  const bd = analyzeTokenStream(ds.data);
  const schemaTotal = bd.schemaDef + bd.schemaFieldNames + bd.schemaSeparators;
  const structTotal =
    schemaTotal +
    bd.rowBreaks +
    bd.arrBoundary +
    bd.arrSeparators +
    bd.nullBool +
    bd.objBoundary +
    bd.schemaRef +
    bd.valueSeparators;
  const pct = (v: number) => (bd.total > 0 ? `${((v / bd.total) * 100).toFixed(1)}%` : '0%');

  console.log(`\n  ${name} (500 rows, ${bd.total} total tokens):`);
  console.log('    ┌────────────────────────┬─────────┬─────────┐');
  console.log('    │ Category               │  Tokens │   Share │');
  console.log('    ├────────────────────────┼─────────┼─────────┤');
  console.log(
    `    │ Data (real values)      │ ${padL(String(bd.dataTokens), 7)} │ ${padL(pct(bd.dataTokens), 7)} │`,
  );
  console.log('    ├────────────────────────┼─────────┼─────────┤');
  console.log(
    `    │ Schema definition       │ ${padL(String(schemaTotal), 7)} │ ${padL(pct(schemaTotal), 7)} │`,
  );
  console.log(
    `    │ Row breaks              │ ${padL(String(bd.rowBreaks), 7)} │ ${padL(pct(bd.rowBreaks), 7)} │`,
  );
  console.log(
    `    │ FIXED_ARRAY + len       │ ${padL(String(bd.fixedArray), 7)} │ ${padL(pct(bd.fixedArray), 7)} │`,
  );
  console.log(
    `    │ PRESENCE_MASK + chunks   │ ${padL(String(bd.presenceMask), 7)} │ ${padL(pct(bd.presenceMask), 7)} │`,
  );
  console.log(
    `    │ Null/Bool CTRL          │ ${padL(String(bd.nullBool), 7)} │ ${padL(pct(bd.nullBool), 7)} │`,
  );
  console.log(
    `    │ Object boundary         │ ${padL(String(bd.objBoundary), 7)} │ ${padL(pct(bd.objBoundary), 7)} │`,
  );
  console.log(
    `    │ Schema ref              │ ${padL(String(bd.schemaRef), 7)} │ ${padL(pct(bd.schemaRef), 7)} │`,
  );
  console.log('    ├────────────────────────┼─────────┼─────────┤');
  console.log(
    `    │ TOTAL STRUCTURAL        │ ${padL(String(structTotal), 7)} │ ${padL(pct(structTotal), 7)} │`,
  );
  console.log(
    `    │ TOTAL DATA              │ ${padL(String(bd.dataTokens), 7)} │ ${padL(pct(bd.dataTokens), 7)} │`,
  );
  console.log('    └────────────────────────┴─────────┴─────────┘');
}

console.log(`\n${line}`);
console.log('  Done.');
console.log(line);

tokenizer.dispose();
tensEncoder.dispose();
