import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CANONICALIZATION_VERSION, IR_VERSION, encodeIR } from '../ir_encoder.js';
import { TOKENIZER_VERSION } from '../materialize.js';
import { TokenMemory } from '../memory.js';

// ============================================================================
// Token Memory Tests — v2 Architecture
// ============================================================================

const TEST_DIR = '.contex-test-memory-v2';
const SAMPLE_DATA = [
  { name: 'Alice', age: 30, city: 'New York' },
  { name: 'Bob', age: 25, city: 'London' },
];

describe('Token Memory v2', () => {
  let memory: TokenMemory;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    memory = new TokenMemory(TEST_DIR);
  });

  afterEach(() => {
    memory.dispose();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ---- Directory Structure ----

  describe('directory structure', () => {
    it('creates ir/{hash}/ir.bin and ir/{hash}/meta.json', () => {
      const result = memory.store(SAMPLE_DATA);
      const irDir = join(TEST_DIR, 'ir', result.hash);

      expect(existsSync(join(irDir, 'ir.bin'))).toBe(true);
      expect(existsSync(join(irDir, 'meta.json'))).toBe(true);
    });

    it('creates cache/{hash}/{model}.{encoding}.{version}/ on materialize', () => {
      const result = memory.store(SAMPLE_DATA);
      memory.materializeAndCache(result.hash, 'gpt-4o');

      const cacheDir = join(
        TEST_DIR,
        'cache',
        result.hash,
        `gpt-4o.o200k_base.${TOKENIZER_VERSION}`,
      );
      expect(existsSync(join(cacheDir, 'tokens.bin'))).toBe(true);
      expect(existsSync(join(cacheDir, 'meta.json'))).toBe(true);
    });
  });

  // ---- IR Versioning ----

  describe('IR versioning', () => {
    it('stores irVersion and canonicalizationVersion in meta', () => {
      const result = memory.store(SAMPLE_DATA);
      const meta = memory.getMeta(result.hash);
      expect(meta).toBeDefined();
      if (!meta) {
        throw new Error('Expected metadata to exist');
      }
      expect(meta.irVersion).toBe(IR_VERSION);
      expect(meta.canonicalizationVersion).toBe(CANONICALIZATION_VERSION);
    });

    it('loaded IR includes version fields', () => {
      const result = memory.store(SAMPLE_DATA);
      const ir = memory.load(result.hash);
      expect(ir.irVersion).toBe(IR_VERSION);
      expect(ir.canonicalizationVersion).toBe(CANONICALIZATION_VERSION);
    });

    it('list() returns version info', () => {
      memory.store(SAMPLE_DATA);
      const items = memory.list();
      expect(items.length).toBe(1);
      expect(items[0].irVersion).toBe(IR_VERSION);
      expect(items[0].canonicalizationVersion).toBe(CANONICALIZATION_VERSION);
    });
  });

  // ---- Binary Token Cache ----

  describe('binary token cache', () => {
    it('writes tokens as binary Int32Array, not JSON', () => {
      const result = memory.store(SAMPLE_DATA);
      memory.materializeAndCache(result.hash, 'gpt-4o');

      const cacheDir = join(
        TEST_DIR,
        'cache',
        result.hash,
        `gpt-4o.o200k_base.${TOKENIZER_VERSION}`,
      );
      const tokensBin = readFileSync(join(cacheDir, 'tokens.bin'));

      // Should be a raw binary buffer, not JSON text
      expect(tokensBin.byteLength % 4).toBe(0); // Int32Array alignment
      expect(() => JSON.parse(tokensBin.toString())).toThrow();
    });

    it('binary roundtrip produces correct token array', () => {
      const r = memory.store(SAMPLE_DATA);
      const original = memory.materializeAndCache(r.hash, 'gpt-4o');

      // Create new memory instance (cold cache)
      memory.dispose();
      const memory2 = new TokenMemory(TEST_DIR);
      const loaded = memory2.materializeAndCache(r.hash, 'gpt-4o');

      expect(loaded.tokens).toEqual(original.tokens);
      expect(loaded.tokenCount).toBe(original.tokenCount);
      memory2.dispose();
    });
  });

  // ---- Model Fingerprinting ----

  describe('model fingerprinting', () => {
    it('stores tokenizerVersion in cache meta', () => {
      const r = memory.store(SAMPLE_DATA);
      const result = memory.materializeAndCache(r.hash, 'gpt-4o');
      expect(result.tokenizerVersion).toBe(TOKENIZER_VERSION);
    });

    it('stores tokenizerFingerprint in cache meta', () => {
      const r = memory.store(SAMPLE_DATA);
      const result = memory.materializeAndCache(r.hash, 'gpt-4o');
      expect(result.tokenizerFingerprint).toBeTruthy();
      expect(typeof result.tokenizerFingerprint).toBe('string');
      expect(result.tokenizerFingerprint.length).toBeGreaterThan(10);
    });

    it('cache meta on disk contains fingerprint', () => {
      const r = memory.store(SAMPLE_DATA);
      memory.materializeAndCache(r.hash, 'gpt-4o');

      const cacheDir = join(TEST_DIR, 'cache', r.hash, `gpt-4o.o200k_base.${TOKENIZER_VERSION}`);
      const meta = JSON.parse(readFileSync(join(cacheDir, 'meta.json'), 'utf-8'));
      expect(meta.tokenizerFingerprint).toBeTruthy();
      expect(meta.tokenizerVersion).toBe(TOKENIZER_VERSION);
    });
  });

  // ---- Content-Hash Deduplication ----

  describe('deduplication', () => {
    it('same data produces same hash', () => {
      const r1 = memory.store(SAMPLE_DATA);
      const r2 = memory.store([...SAMPLE_DATA]);
      expect(r1.hash).toBe(r2.hash);
      expect(r1.isNew).toBe(true);
      expect(r2.isNew).toBe(false);
    });

    it('different data produces different hash', () => {
      const r1 = memory.store(SAMPLE_DATA);
      const r2 = memory.store([{ x: 1 }]);
      expect(r1.hash).not.toBe(r2.hash);
    });
  });

  // ---- Load / Has ----

  describe('load', () => {
    it('loaded IR matches original', () => {
      const r = memory.store(SAMPLE_DATA);
      const ir = memory.load(r.hash);
      expect(ir.hash).toBe(r.hash);
      expect(ir.data).toEqual(encodeIR(SAMPLE_DATA).data);
    });

    it('throws for unknown hash', () => {
      expect(() => memory.load('nonexistent')).toThrow(/not found/);
    });

    it('has() returns correct status', () => {
      const r = memory.store(SAMPLE_DATA);
      expect(memory.has(r.hash)).toBe(true);
      expect(memory.has('nonexistent')).toBe(false);
    });
  });

  // ---- Materialization ----

  describe('materialize and cache', () => {
    it('materializes for different models', () => {
      const r = memory.store(SAMPLE_DATA);
      const gpt = memory.materializeAndCache(r.hash, 'gpt-4o');
      const claude = memory.materializeAndCache(r.hash, 'claude-3-5-sonnet');

      expect(gpt.encoding).toBe('o200k_base');
      expect(claude.encoding).toBe('cl100k_base');
      expect(gpt.tokenCount).toBeGreaterThan(0);
      expect(claude.tokenCount).toBeGreaterThan(0);
    });

    it('cache hit returns same result', () => {
      const r = memory.store(SAMPLE_DATA);
      const first = memory.materializeAndCache(r.hash, 'gpt-4o');
      const second = memory.materializeAndCache(r.hash, 'gpt-4o');
      expect(second.tokens).toEqual(first.tokens);
    });
  });

  // ---- loadMaterialized ----

  describe('loadMaterialized', () => {
    it('returns null for uncached model', () => {
      const r = memory.store(SAMPLE_DATA);
      expect(memory.loadMaterialized(r.hash, 'gpt-4o')).toBeNull();
    });

    it('returns cached tokens after materializeAndCache', () => {
      const r = memory.store(SAMPLE_DATA);
      const original = memory.materializeAndCache(r.hash, 'gpt-4o');
      const loaded = memory.loadMaterialized(r.hash, 'gpt-4o');
      expect(loaded).not.toBeNull();
      expect(loaded?.tokens).toEqual(original.tokens);
    });
  });

  // ---- getCachedModels ----

  describe('getCachedModels', () => {
    it('lists models with cached materializations', () => {
      const r = memory.store(SAMPLE_DATA);
      memory.materializeAndCache(r.hash, 'gpt-4o');
      memory.materializeAndCache(r.hash, 'claude-3-5-sonnet');

      const models = memory.getCachedModels(r.hash);
      expect(models).toContain('gpt-4o');
      expect(models).toContain('claude-3-5-sonnet');
    });
  });

  // ---- Cross-instance persistence ----

  describe('cross-instance persistence', () => {
    it('data survives dispose and re-open', () => {
      const r = memory.store(SAMPLE_DATA);
      memory.materializeAndCache(r.hash, 'gpt-4o');
      memory.dispose();

      const memory2 = new TokenMemory(TEST_DIR);
      expect(memory2.has(r.hash)).toBe(true);
      const ir = memory2.load(r.hash);
      expect(ir.data).toEqual(encodeIR(SAMPLE_DATA).data);

      const tokens = memory2.materializeAndCache(r.hash, 'gpt-4o');
      expect(tokens.tokenCount).toBeGreaterThan(0);
      memory2.dispose();
    });
  });
});
