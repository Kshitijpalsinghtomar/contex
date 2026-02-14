import { describe, expect, it } from 'vitest';
import { SchemaRegistry } from '../schema.js';

describe('SchemaRegistry', () => {
  it('returns same ID for same field set', () => {
    const registry = new SchemaRegistry();
    const id1 = registry.register({ a: 1, b: 2, c: 3 });
    const id2 = registry.register({ a: 10, b: 20, c: 30 });

    expect(id1).toBe(id2);
  });

  it('returns different ID for different field sets', () => {
    const registry = new SchemaRegistry();
    const id1 = registry.register({ a: 1, b: 2 });
    const id2 = registry.register({ x: 1, y: 2 });

    expect(id1).not.toBe(id2);
  });

  it('field order does not matter (canonical sort)', () => {
    const registry = new SchemaRegistry();
    const id1 = registry.register({ z: 1, a: 2, m: 3 });
    const id2 = registry.register({ a: 2, m: 3, z: 1 });

    expect(id1).toBe(id2);
  });

  it('handles single-field objects', () => {
    const registry = new SchemaRegistry();
    const schema = registry.register({ onlyField: 1 });
    expect(typeof schema.id).toBe('number');
  });

  it('tracks schema count correctly', () => {
    const registry = new SchemaRegistry();
    registry.register({ a: 1 });
    registry.register({ a: 1, b: 2 });
    registry.register({ a: 1 }); // duplicate

    expect(registry.getAll().length).toBe(2);
  });
});
