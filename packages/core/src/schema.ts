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
 * Compress field names by finding the shortest unique prefix for each field.
 *
 * This reduces token usage by shortening long field names like:
 * - `customer_shipping_address` → `shipping`
 * - `customer_billing_address` → `billing`
 * - `customer_email` → `email`
 *
 * The compression is context-aware: it only compresses if the shortened
 * name is unique within the dataset.
 *
 * @param fields - Array of field names (should be sorted)
 * @returns Map of original field name → compressed field name
 *
 * @example
 * ```ts
 * const fields = ['customer_shipping_address', 'customer_billing_address', 'customer_email'];
 * const mapping = compressFieldNames(fields);
 * // mapping: {
 * //   'customer_shipping_address' → 'shipping',
 * //   'customer_billing_address' → 'billing',
 * //   'customer_email' → 'email'
 * // }
 * ```
 */
export function compressFieldNames(fields: string[]): Map<string, string> {
  const mapping = new Map<string, string>();

  // If fewer than 2 fields, no compression needed
  if (fields.length < 2) {
    for (const field of fields) {
      mapping.set(field, field);
    }
    return mapping;
  }

  // For each field, find the shortest unique prefix
  for (let i = 0; i < fields.length; i++) {
    const fullName = fields[i];
    const otherFields = fields.filter((_, idx) => idx !== i);

    // Skip if this field is already a prefix of others (can't compress)
    const isPrefixOfOthers = otherFields.some((f) => f.startsWith(`${fullName}_`));
    if (isPrefixOfOthers) {
      mapping.set(fullName, fullName);
      continue;
    }

    // Find shortest prefix that's unique
    let bestPrefix = fullName;
    for (let prefixLen = 1; prefixLen <= fullName.length; prefixLen++) {
      const prefix = fullName.substring(0, prefixLen);

      // Check if any other field starts with this prefix
      const conflicts = otherFields.some((f) => f.startsWith(prefix));

      if (!conflicts) {
        bestPrefix = prefix;
        break;
      }
    }

    mapping.set(fullName, bestPrefix);
  }

  // Second pass: ensure all compressed names are actually unique
  // If there's a collision, fall back to longer names
  const usedNames = new Set<string>();
  for (const [original, compressed] of mapping) {
    if (usedNames.has(compressed)) {
      // Collision - find a longer unique name
      let longerName = compressed;
      for (let len = compressed.length + 1; len <= original.length; len++) {
        const candidate = original.substring(0, len);
        if (!usedNames.has(candidate)) {
          longerName = candidate;
          break;
        }
      }
      usedNames.add(longerName);
      mapping.set(original, longerName);
    } else {
      usedNames.add(compressed);
    }
  }

  return mapping;
}

/**
 * Apply field name compression to a schema.
 *
 * @param schema - The original schema
 * @param compression - Map of original → compressed field names
 * @returns New schema with compressed field names
 */
export function applyFieldCompression(
  schema: TensSchema,
  compression: Map<string, string>,
): TensSchema {
  const compressedFields = schema.fields.map((f) => compression.get(f) || f);

  return {
    ...schema,
    fields: compressedFields,
  };
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
