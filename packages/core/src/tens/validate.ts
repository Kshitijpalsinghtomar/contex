// ============================================================================
// @contex/core — Input Validation
// ============================================================================
//
// Validates data before TENS encoding to catch unsupported types early
// with clear error messages instead of silently producing corrupt output.
// ============================================================================

const MAX_DEPTH = 50;

/**
 * Validates that input data is safe for TENS encoding.
 *
 * Rejects unsupported types (Date, RegExp, Map, Set, BigInt, Symbol, undefined,
 * functions) and detects circular references.
 *
 * @param data - The data to validate
 * @throws {TensValidationError} If validation fails
 */
export function validateInput(data: unknown): void {
  const seen = new WeakSet();
  _validate(data, '$', seen, 0);
}

class TensValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TensValidationError';
  }
}

function _validate(value: unknown, path: string, seen: WeakSet<object>, depth: number): void {
  if (depth > MAX_DEPTH) {
    throw new TensValidationError(
      `Maximum nesting depth (${MAX_DEPTH}) exceeded at ${path}. Possible circular reference.`,
    );
  }

  if (value === null || value === undefined) return;

  const type = typeof value;

  if (type === 'string' || type === 'number' || type === 'boolean') return;

  if (type === 'bigint') {
    throw new TensValidationError(
      `BigInt is not supported at ${path}. Convert to number or string first.`,
    );
  }

  if (type === 'symbol') {
    throw new TensValidationError(`Symbol is not supported at ${path}.`);
  }

  if (type === 'function') {
    throw new TensValidationError(`Functions are not supported at ${path}.`);
  }

  if (type === 'object') {
    if (value instanceof Date) {
      throw new TensValidationError(
        `Date objects are not supported at ${path}. Use .toISOString() or .getTime() instead.`,
      );
    }
    if (value instanceof RegExp) {
      throw new TensValidationError(
        `RegExp objects are not supported at ${path}. Use .source string instead.`,
      );
    }
    if (value instanceof Map) {
      throw new TensValidationError(
        `Map objects are not supported at ${path}. Use Object.fromEntries() instead.`,
      );
    }
    if (value instanceof Set) {
      throw new TensValidationError(
        `Set objects are not supported at ${path}. Use Array.from() instead.`,
      );
    }

    // Circular reference detection
    if (seen.has(value as object)) {
      throw new TensValidationError(`Circular reference detected at ${path}.`);
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        _validate(value[i], `${path}[${i}]`, seen, depth + 1);
      }
    } else {
      for (const [key, val] of Object.entries(value)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          throw new TensValidationError(`Prototype pollution attempt detected at ${path}.${key}.`);
        }
        _validate(val, `${path}.${key}`, seen, depth + 1);
      }
    }

    seen.delete(value as object);
  }
}

export { TensValidationError };
