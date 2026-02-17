// ============================================================================
// Measurable Token Cost Reduction Proof
// ============================================================================
//
// Proves with real numbers:
// "TENS-Text uses X% fewer tokens than JSON, saving $Y per 1M requests."
//
// Tests across multiple formats, dataset sizes, and model encodings.
// ============================================================================

import { afterAll, describe, expect, it } from 'vitest';
import { TokenizerManager, formatOutput } from '../index.js';
import type { OutputFormat, TokenizerEncoding } from '../types.js';

const tokenizer = new TokenizerManager('cl100k_base');

afterAll(() => {
  tokenizer.dispose();
});

// ── Model pricing ($/1M tokens, as of Feb 2026) ────────────────────────────

const MODEL_PRICING: Record<
  string,
  { encoding: TokenizerEncoding; inputPricePer1M: number; name: string }
> = {
  'gpt-4o': { encoding: 'o200k_base', inputPricePer1M: 2.5, name: 'GPT-4o' },
  'gpt-4o-mini': { encoding: 'o200k_base', inputPricePer1M: 0.15, name: 'GPT-4o-mini' },
  'gpt-4-turbo': { encoding: 'cl100k_base', inputPricePer1M: 10.0, name: 'GPT-4 Turbo' },
  'gpt-3.5-turbo': { encoding: 'cl100k_base', inputPricePer1M: 0.5, name: 'GPT-3.5 Turbo' },
};

// ── Test data generators ────────────────────────────────────────────────────

function generateUserData(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    role: ['admin', 'editor', 'viewer'][i % 3],
    active: i % 4 !== 0,
    score: Math.round(Math.random() * 100 * 100) / 100,
  }));
}

function generateProductData(n: number): Record<string, unknown>[] {
  const categories = ['Electronics', 'Clothing', 'Books', 'Home', 'Sports'];
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Product ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`,
    category: categories[i % categories.length],
    price: Math.round((10 + Math.random() * 990) * 100) / 100,
    inStock: i % 3 !== 0,
    rating: Math.round((1 + Math.random() * 4) * 10) / 10,
    tags: ['sale', 'new', 'featured'].slice(0, (i % 3) + 1),
  }));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface FormatResult {
  format: OutputFormat;
  bytes: number;
  tokens: Record<string, number>;
}

function measureFormats(
  data: Record<string, unknown>[],
  encodings: TokenizerEncoding[],
): FormatResult[] {
  const textFormats: OutputFormat[] = ['json', 'csv', 'markdown', 'toon', 'tens-text'];
  const byteEncoder = new TextEncoder();

  return textFormats.map((format) => {
    const output = formatOutput(data, format);
    const bytes = byteEncoder.encode(output).length;
    const tokens: Record<string, number> = {};
    for (const enc of encodings) {
      tokens[enc] = tokenizer.countTokens(output, enc);
    }
    return { format, bytes, tokens };
  });
}

function printTable(label: string, results: FormatResult[], encodings: TokenizerEncoding[]) {
  console.log(`\n═══ ${label} ═══`);
  const header = ['Format', 'Bytes', ...encodings.map((e) => `Tokens (${e})`)];
  console.log(header.join('\t'));
  console.log(header.map((h) => '─'.repeat(h.length)).join('\t'));

  for (const r of results) {
    const row = [r.format, String(r.bytes), ...encodings.map((e) => String(r.tokens[e]))];
    console.log(row.join('\t'));
  }

  // Print savings vs JSON
  const jsonResult = requireFormatResult(results, 'json');
  console.log('\n  Token savings vs JSON:');
  for (const r of results) {
    if (r.format === 'json') continue;
    for (const enc of encodings) {
      const savings = ((jsonResult.tokens[enc] - r.tokens[enc]) / jsonResult.tokens[enc]) * 100;
      console.log(`    ${r.format} (${enc}): ${savings.toFixed(1)}%`);
    }
  }
}

function requireFormatResult(results: FormatResult[], format: OutputFormat): FormatResult {
  const found = results.find((result) => result.format === format);
  if (!found) {
    throw new Error(`Expected benchmark results to include format: ${format}`);
  }
  return found;
}

// ============================================================================
// Tests
// ============================================================================

const ENCODINGS: TokenizerEncoding[] = ['cl100k_base', 'o200k_base'];

describe('Token Cost Proof — User Data', () => {
  for (const size of [10, 100, 500]) {
    describe(`${size} rows`, () => {
      const data = generateUserData(size);
      let results: FormatResult[];

      it('measures all formats', () => {
        results = measureFormats(data, ENCODINGS);
        printTable(`User Data (${size} rows)`, results, ENCODINGS);
        expect(results).toHaveLength(5);
      });

      it('TENS-Text uses fewer tokens than JSON (cl100k_base)', () => {
        const json = requireFormatResult(results, 'json');
        const tens = requireFormatResult(results, 'tens-text');
        expect(tens.tokens.cl100k_base).toBeLessThan(json.tokens.cl100k_base);
      });

      it('TENS-Text uses fewer tokens than JSON (o200k_base)', () => {
        const json = requireFormatResult(results, 'json');
        const tens = requireFormatResult(results, 'tens-text');
        expect(tens.tokens.o200k_base).toBeLessThan(json.tokens.o200k_base);
      });

      it('TENS-Text uses fewer bytes than JSON', () => {
        const json = requireFormatResult(results, 'json');
        const tens = requireFormatResult(results, 'tens-text');
        expect(tens.bytes).toBeLessThan(json.bytes);
      });
    });
  }
});

describe('Token Cost Proof — Product Data (with arrays)', () => {
  for (const size of [10, 100]) {
    describe(`${size} rows`, () => {
      const data = generateProductData(size);
      let results: FormatResult[];

      it('measures all formats', () => {
        results = measureFormats(data, ENCODINGS);
        printTable(`Product Data (${size} rows)`, results, ENCODINGS);
        expect(results).toHaveLength(5);
      });

      it('TENS-Text uses fewer tokens than JSON', () => {
        const json = requireFormatResult(results, 'json');
        const tens = requireFormatResult(results, 'tens-text');
        expect(tens.tokens.cl100k_base).toBeLessThan(json.tokens.cl100k_base);
      });
    });
  }
});

describe('Cost Savings at Model Pricing', () => {
  const data = generateUserData(100);

  it('calculates real dollar savings per 1M requests', () => {
    const results = measureFormats(data, ENCODINGS);
    const json = requireFormatResult(results, 'json');
    const tens = requireFormatResult(results, 'tens-text');

    console.log('\n═══ Cost Savings per 1M Requests ═══');
    console.log('Model\t\t\tJSON Cost\tTENS Cost\tSavings\t\t%');
    console.log('─'.repeat(80));

    for (const [_modelId, model] of Object.entries(MODEL_PRICING)) {
      const jsonTokens = json.tokens[model.encoding];
      const tensTokens = tens.tokens[model.encoding];

      const jsonCost = (jsonTokens / 1_000_000) * model.inputPricePer1M * 1_000_000;
      const tensCost = (tensTokens / 1_000_000) * model.inputPricePer1M * 1_000_000;
      const savings = jsonCost - tensCost;
      const pct = (savings / jsonCost) * 100;

      console.log(
        `${model.name.padEnd(20)}\t$${jsonCost.toFixed(2)}\t\t$${tensCost.toFixed(2)}\t\t$${savings.toFixed(2)}\t\t${pct.toFixed(1)}%`,
      );

      // TENS should always be cheaper than JSON
      expect(tensCost).toBeLessThan(jsonCost);
    }
  });
});
