import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Contex } from '../engine.js';

// Use a temp directory for each test to avoid cross-test contamination
const TEST_DATA_DIR = path.join(process.cwd(), '.test-data-engine');

function cleanTestDir() {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

// Clean up before and after all tests
cleanTestDir();

afterEach(() => {
  cleanTestDir();
});

describe('Contex Engine', () => {
  it('inserts and retrieves data', () => {
    const engine = new Contex('cl100k_base');
    const data = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];

    engine.insert('users', data);
    const result = engine.query('GET users');

    expect(result.data.length).toBeGreaterThanOrEqual(2);
    // Check the data contains our inserted records
    const names = result.data.map((d: any) => d.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
    engine.dispose();
  });

  it('queries with PQL filter', () => {
    const engine = new Contex('cl100k_base');
    engine.insert('tickets', [
      { id: 1, status: 'open' },
      { id: 2, status: 'closed' },
      { id: 3, status: 'open' },
    ]);

    const result = engine.query('GET tickets WHERE status = open');
    // All returned rows should have status = open
    expect(result.data.length).toBeGreaterThan(0);
    for (const row of result.data) {
      expect(row.status).toBe('open');
    }
    engine.dispose();
  });

  it('queries with LIMIT', () => {
    const engine = new Contex('cl100k_base');
    engine.insert(
      'items',
      Array.from({ length: 50 }, (_, i) => ({ id: i })),
    );

    const result = engine.query('GET items LIMIT 5');
    expect(result.count).toBe(5);
    engine.dispose();
  });

  it('queries with FORMAT', () => {
    const engine = new Contex('cl100k_base');
    engine.insert('data', [{ id: 1, val: 'test' }]);

    const csvResult = engine.query('GET data FORMAT csv');
    expect(csvResult.format).toBe('csv');
    expect(csvResult.output).toContain('id');

    const jsonResult = engine.query('GET data FORMAT json');
    expect(jsonResult.format).toBe('json');

    engine.dispose();
  });

  it('contextWindow returns formatted string', () => {
    const engine = new Contex('cl100k_base');
    engine.insert('col', [{ x: 1 }, { x: 2 }]);

    const output = engine.contextWindow('col', { format: 'csv' });
    expect(typeof output).toBe('string');
    expect((output as string).length).toBeGreaterThan(0);

    engine.dispose();
  });

  it('contextWindow returns TENS binary', () => {
    const engine = new Contex('cl100k_base');
    engine.insert('col', [{ x: 1 }]);

    const output = engine.contextWindow('col', { format: 'tens' });
    expect(output).toBeInstanceOf(Uint8Array);

    engine.dispose();
  });

  it('analyzeFormats returns token counts', () => {
    const engine = new Contex('cl100k_base');
    engine.insert('col', [{ id: 1, name: 'Alice' }]);

    const analyses = engine.analyzeFormats('col');
    expect(analyses.length).toBeGreaterThan(0);

    for (const a of analyses) {
      expect(a.tokenCount).toBeGreaterThan(0);
      expect(a.format).toBeDefined();
    }

    engine.dispose();
  });

  it('getOptimizedContext returns budget and output', () => {
    const engine = new Contex('o200k_base');
    engine.insert(
      'tickets',
      Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        title: `Ticket ${i + 1}`,
        status: i % 2 === 0 ? 'open' : 'closed',
      })),
    );

    const result = engine.getOptimizedContext('tickets', {
      model: 'gpt-4o',
      systemPrompt: 500,
      reserve: 1000,
    });

    expect(result.output).toBeDefined();
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.usedRows).toBeGreaterThan(0);
    expect(result.debug).toBeDefined();

    engine.dispose();
  });

  it('listCollections returns inserted collection names', () => {
    const engine = new Contex('cl100k_base');
    engine.insert('alpha', [{ x: 1 }]);
    engine.insert('beta', [{ y: 2 }]);

    const collections = engine.listCollections();
    expect(collections).toContain('alpha');
    expect(collections).toContain('beta');

    engine.dispose();
  });

  it('drop removes a collection', () => {
    const engine = new Contex('cl100k_base');
    engine.insert('temp', [{ x: 1 }]);
    expect(engine.listCollections()).toContain('temp');

    engine.drop('temp');
    expect(engine.listCollections()).not.toContain('temp');

    engine.dispose();
  });
});
