// ============================================================================
// @contex-llm/core — Canonical Data Normalization
// ============================================================================
//
// Pure functions that normalize JavaScript values to canonical form.
// Guarantees: same semantic data → same canonical output → same bytes → same hash.
//
// Rules (from CONTEX_V3_MASTER.md):
//   - Object keys: sorted lexicographically (Unicode code point order)
//   - Integers: no leading zeros, no trailing decimal. 1 not 1.0
//   - Floats: IEEE 754 double, shortest representation. 1.5 not 1.50
//   - Strings: NFKC unicode normalization, no trailing whitespace
//   - Booleans: true / false (lowercase) — native JS booleans
//   - Null: explicit (not omitted, not empty string)
//   - Arrays: preserve order
//   - Dates: ISO 8601, UTC, milliseconds
//   - Undefined/missing: omitted from output
// ============================================================================

/**
 * Canonicalize a string value.
 *
 * - Applies NFKC unicode normalization (decomposes compatibility characters)
 * - Strips trailing whitespace from each line
 *
 * @param s - Input string
 * @returns Canonicalized string
 */
export function canonicalizeString(s: string): string {
  // NFKC normalization: fi → fi, ² → 2, etc.
  const normalized = s.normalize('NFKC');
  // Strip trailing whitespace from each line
  return normalized.replace(/[^\S\n]+$/gm, '');
}

/**
 * Canonicalize a number value.
 *
 * - Integers stay as integers: 1.0 → 1
 * - Negative zero → positive zero: -0 → 0
 * - NaN → null (not representable in canonical form)
 * - ±Infinity → null (not representable in canonical form)
 * - Floats: shortest IEEE 754 representation
 *
 * @param n - Input number
 * @returns Canonicalized number, or null for non-finite values
 */
export function canonicalizeNumber(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  // -0 → 0
  if (Object.is(n, -0)) return 0;
  return n;
}

/**
 * Canonicalize a single value (recursive for objects/arrays).
 *
 * @param val - Any JavaScript value
 * @returns Canonicalized value (undefined values are returned as undefined to signal omission)
 */
export function canonicalizeValue(val: unknown): unknown {
  // Undefined → omit (caller handles)
  if (val === undefined) return undefined;

  // Null → explicit null
  if (val === null) return null;

  // Booleans → pass through (already canonical in JS)
  if (typeof val === 'boolean') return val;

  // Numbers → canonicalize
  if (typeof val === 'number') return canonicalizeNumber(val);

  // Strings → NFKC + trim
  if (typeof val === 'string') return canonicalizeString(val);

  // Dates → ISO 8601 UTC with milliseconds
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    return val.toISOString();
  }

  // Arrays → preserve order, canonicalize each element
  if (Array.isArray(val)) return canonicalizeArray(val);

  // Objects → sort keys, canonicalize values
  if (typeof val === 'object') return canonicalizeObject(val as Record<string, unknown>);

  // Fallback: convert to string
  return String(val);
}

/**
 * Canonicalize an array: preserve element order, canonicalize each element.
 * Undefined elements become null (to preserve array positions).
 *
 * @param arr - Input array
 * @returns Canonicalized array
 */
export function canonicalizeArray(arr: unknown[]): unknown[] {
  return arr.map((el) => {
    const v = canonicalizeValue(el);
    // In arrays, undefined → null (arrays are positional)
    return v === undefined ? null : v;
  });
}

/**
 * Canonicalize an object: sort keys lexicographically, canonicalize values.
 * Keys with undefined values are omitted.
 *
 * @param obj - Input object
 * @returns Canonicalized object with sorted keys
 */
export function canonicalizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    const canonicalKey = canonicalizeString(key);
    const canonicalVal = canonicalizeValue(obj[key]);

    // Omit undefined values
    if (canonicalVal === undefined) continue;

    result[canonicalKey] = canonicalVal;
  }

  return result;
}

/**
 * Canonicalize a dataset (array of objects).
 *
 * This is the top-level entry point for the IR encoding pipeline.
 * Takes an array of data objects and returns a fully canonicalized copy
 * where every value is normalized according to the Contex canonicalization rules.
 *
 * Guarantee: `canonicalize(data1)` deep-equals `canonicalize(data2)`
 * whenever data1 and data2 are semantically identical.
 *
 * @param data - Array of data objects to canonicalize
 * @returns Canonicalized array of objects
 */
export function canonicalize(data: object[]): Record<string, unknown>[] {
  return data.map((item) => canonicalizeObject(item as Record<string, unknown>));
}
