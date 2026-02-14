import { describe, expect, it } from 'vitest';
import { applyFilter, applyLimit, parsePql } from '../query.js';

describe('parsePql', () => {
  it('parses basic GET collection', () => {
    const result = parsePql('GET users');
    expect(result.collection).toBe('users');
  });

  it('parses GET with WHERE clause', () => {
    const result = parsePql('GET tickets WHERE priority = critical');
    expect(result.collection).toBe('tickets');
    expect(result.where).toBeDefined();
  });

  it('parses GET with LIMIT', () => {
    const result = parsePql('GET orders LIMIT 50');
    expect(result.collection).toBe('orders');
    expect(result.limit).toBe(50);
  });

  it('parses GET with FORMAT', () => {
    const result = parsePql('GET data FORMAT csv');
    expect(result.collection).toBe('data');
    expect(result.format).toBe('csv');
  });

  it('parses full PQL with all clauses', () => {
    const result = parsePql('GET tickets WHERE status = open LIMIT 10 FORMAT toon');
    expect(result.collection).toBe('tickets');
    expect(result.where).toBeDefined();
    expect(result.limit).toBe(10);
    expect(result.format).toBe('toon');
  });

  it('is case-insensitive for keywords', () => {
    const result = parsePql('get users where role = admin limit 5 format csv');
    expect(result.collection).toBe('users');
  });
});

describe('applyFilter', () => {
  const data = [
    { id: 1, status: 'open', priority: 'high' },
    { id: 2, status: 'closed', priority: 'low' },
    { id: 3, status: 'open', priority: 'low' },
  ];

  it('filters by exact match', () => {
    const where = { field: 'status', op: '=', value: 'open' };
    const result = applyFilter(data, where);
    expect(result.length).toBe(2);
    expect(result.every((r) => r.status === 'open')).toBe(true);
  });

  it('returns empty array when no matches', () => {
    const where = { field: 'status', op: '=', value: 'pending' };
    const result = applyFilter(data, where);
    expect(result.length).toBe(0);
  });

  it('returns all when filter matches all', () => {
    // Filter on a field value that all have
    const allOpen = data.map((d) => ({ ...d, status: 'open' }));
    const where = { field: 'status', op: '=', value: 'open' };
    const result = applyFilter(allOpen, where);
    expect(result.length).toBe(3);
  });
});

describe('applyLimit', () => {
  const data = Array.from({ length: 100 }, (_, i) => ({ id: i }));

  it('limits results to specified count', () => {
    const result = applyLimit(data, 10);
    expect(result.length).toBe(10);
  });

  it('returns all when limit exceeds data length', () => {
    const result = applyLimit(data, 200);
    expect(result.length).toBe(100);
  });

  it('returns all data for limit 0 (no limit)', () => {
    const result = applyLimit(data, 0);
    expect(result.length).toBe(100);
  });
});
