// ============================================================================
// @contex/core — Schema Registry
// ============================================================================
//
// Deduplicates object shapes: if two objects have the same sorted field names
// and types, they share a single schema ID. This enables the TENS token stream
// to reference schemas by ID instead of repeating field definitions per row.
// ============================================================================

import type { TensSchema, TensType } from './types.js';

/**
 * Infer the TENS type of a JavaScript value.
 *
 * @param value - Any JavaScript value
 * @returns The TENS type string
 */
export function inferType(value: unknown): TensType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as TensType;
}

/**
 * Recursively flatten a nested object into dot-notation keys.
 *
 * @example
 * ```ts
 * flattenObject({ user: { name: 'Alice', profile: { age: 30 } } })
 * // → { 'user.name': 'Alice', 'user.profile.age': 30 }
 * ```
 *
 * Arrays are NOT flattened — they remain as values.
 * Null values are preserved as null (handled by presence mask).
 */
export function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

/**
 * Reconstruct a nested object from dot-notation keys.
 * Inverse of flattenObject.
 *
 * @example
 * ```ts
 * unflattenObject({ 'user.name': 'Alice', 'user.profile.age': 30 })
 * // → { user: { name: 'Alice', profile: { age: 30 } } }
 * ```
 */
export function unflattenObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const parts = key.split('.');
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
  return result;
}

/**
 * Schema registry for TENS structural deduplication.
 *
 * Registers object shapes (sorted field names + types) and assigns
 * unique IDs. Identical shapes return the same schema ID.
 *
 * @example
 * ```ts
 * const registry = new SchemaRegistry();
 * const s1 = registry.register({ name: 'Alice', age: 30 });
 * const s2 = registry.register({ age: 25, name: 'Bob' });
 * // s1.id === s2.id (same shape: fields ['age', 'name'])
 * ```
 */
export class SchemaRegistry {
  private schemas: TensSchema[] = [];
  private signatureToId = new Map<string, number>();

  /**
   * Register an object and return its schema.
   * If an identical shape already exists, returns the existing schema.
   *
   * @param obj - Object whose shape to register
   * @returns The schema definition (existing or newly created)
   */
  register(obj: Record<string, unknown>): TensSchema {
    const fields = Object.keys(obj).sort();
    const fieldTypes = fields.map((k) => inferType(obj[k]));

    // Signature is field names ONLY — not types.
    // This ensures rows with the same keys but differing null patterns
    // share a single schema, enabling positional encoding + presence mask.
    const signature = fields.join(',');

    let id = this.signatureToId.get(signature);
    if (id !== undefined) {
      return this.schemas[id];
    }

    id = this.schemas.length;
    const schema = { id, fields, fieldTypes };
    this.schemas.push(schema);
    this.signatureToId.set(signature, id);
    return schema;
  }

  /** Get a schema by ID. */
  get(id: number): TensSchema | undefined {
    return this.schemas[id];
  }

  /** Get all registered schemas. */
  getAll(): TensSchema[] {
    return this.schemas;
  }

  /** Clear all registered schemas. */
  clear() {
    this.schemas = [];
    this.signatureToId.clear();
  }
}
