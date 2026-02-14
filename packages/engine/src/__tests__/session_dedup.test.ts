// ============================================================================
// Cross-Session Structural Dedup — Tests
// ============================================================================

import { afterAll, describe, expect, it } from 'vitest';
import { StructuralDedupCache } from '../session_dedup.js';

describe('StructuralDedupCache — Schema Dedup', () => {
  it('detects same schema on second encode', () => {
    const cache = new StructuralDedupCache('cl100k_base');

    const batch1 = [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
    ];
    const batch2 = [
      { id: 3, name: 'Charlie', role: 'viewer' },
      { id: 4, name: 'Diana', role: 'admin' },
    ];

    const r1 = cache.encode(batch1);
    const r2 = cache.encode(batch2);

    expect(r1.isSchemaKnown).toBe(false);
    expect(r2.isSchemaKnown).toBe(true);

    const stats = cache.getStats();
    expect(stats.knownSchemas).toBe(1);
    expect(stats.schemaCacheHits).toBe(1);

    cache.dispose();
  });

  it('tracks different schemas separately', () => {
    const cache = new StructuralDedupCache('cl100k_base');

    cache.encode([{ id: 1, name: 'Alice' }]);
    cache.encode([{ x: 1, y: 2, z: 3 }]);
    cache.encode([{ id: 2, name: 'Bob' }]); // same schema as first

    const stats = cache.getStats();
    expect(stats.knownSchemas).toBe(2);
    expect(stats.schemaCacheHits).toBe(1);

    cache.dispose();
  });
});

describe('StructuralDedupCache — Dictionary Dedup', () => {
  it('tracks shared string values across encodes', () => {
    const cache = new StructuralDedupCache('cl100k_base');

    cache.encode([{ role: 'admin' }, { role: 'user' }]);
    // Same values appear again
    cache.encode([{ role: 'admin' }, { role: 'viewer' }]);

    const stats = cache.getStats();
    expect(stats.dictCacheHits).toBeGreaterThan(0);
    expect(stats.estimatedTokensSaved).toBeGreaterThan(0);

    cache.dispose();
  });
});

describe('StructuralDedupCache — Incremental Encoding', () => {
  it('emits only delta rows', () => {
    const cache = new StructuralDedupCache('cl100k_base');

    const batch1 = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];

    const batch2 = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Charlie' },
    ];

    const result = cache.encodeIncremental(batch2, batch1, 'id');

    expect(result.deltaRows).toBe(1); // only Charlie is new
    expect(result.totalRows).toBe(3);
    expect(result.tokensSaved).toBeGreaterThan(0);

    cache.dispose();
  });

  it('handles no overlap (all new)', () => {
    const cache = new StructuralDedupCache('cl100k_base');

    const batch1 = [{ id: 1, name: 'Alice' }];
    const batch2 = [
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Charlie' },
    ];

    const result = cache.encodeIncremental(batch2, batch1, 'id');
    expect(result.deltaRows).toBe(2);

    cache.dispose();
  });

  it('handles full overlap (no new rows)', () => {
    const cache = new StructuralDedupCache('cl100k_base');

    const batch = [{ id: 1, name: 'Alice' }];
    const result = cache.encodeIncremental(batch, batch, 'id');

    expect(result.deltaRows).toBe(0);

    cache.dispose();
  });
});

describe('StructuralDedupCache — Serialization', () => {
  it('serialize + restore preserves all state', () => {
    const cache = new StructuralDedupCache('cl100k_base');

    cache.encode([{ id: 1, name: 'Alice', role: 'admin' }]);
    cache.encode([{ id: 2, name: 'Bob', role: 'admin' }]);

    const state = cache.serializeState();

    // Restore from state
    const restored = StructuralDedupCache.fromState(state);
    const restoredStats = restored.getStats();
    const originalStats = cache.getStats();

    expect(restoredStats.knownSchemas).toBe(originalStats.knownSchemas);
    expect(restoredStats.dictionarySize).toBe(originalStats.dictionarySize);
    expect(restoredStats.totalEncodes).toBe(originalStats.totalEncodes);
    expect(restoredStats.schemaCacheHits).toBe(originalStats.schemaCacheHits);

    // New encode on restored cache should detect known schema
    const r = restored.encode([{ id: 3, name: 'Charlie', role: 'user' }]);
    expect(r.isSchemaKnown).toBe(true);

    cache.dispose();
    restored.dispose();
  });

  it('serialized state is JSON-safe', () => {
    const cache = new StructuralDedupCache('o200k_base');
    cache.encode([{ msg: 'hello world' }]);

    const state = cache.serializeState();
    const json = JSON.stringify(state);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe(1);
    expect(parsed.encoding).toBe('o200k_base');
    expect(parsed.schemas).toHaveLength(1);

    cache.dispose();
  });
});

describe('StructuralDedupCache — Token Savings', () => {
  it('reports cumulative token savings', () => {
    const cache = new StructuralDedupCache('cl100k_base');

    // First encode: baseline
    cache.encode([
      { status: 'active', dept: 'engineering' },
      { status: 'inactive', dept: 'marketing' },
    ]);

    // Second encode: same schema + shared values
    cache.encode([
      { status: 'active', dept: 'sales' },
      { status: 'active', dept: 'engineering' },
    ]);

    const stats = cache.getStats();
    expect(stats.estimatedTokensSaved).toBeGreaterThan(0);

    console.log('\n  Dedup Stats:', JSON.stringify(stats, null, 2));

    cache.dispose();
  });
});
