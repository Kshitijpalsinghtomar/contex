import { TokenStreamDecoder, TokenStreamEncoder, flattenObject } from '@contex-llm/core';

// --- Fuzzy Equality Helper ---
function fuzzyDeepEqual(a: unknown, b: unknown, path = ''): boolean {
  if (a === b) return true;
  if (a === null && b === undefined) return true; // Treat null/undefined as similar (TENS uses null for missing)
  if (a === undefined && b === null) return true;

  // Type coercion (TENS decodes numbers as strings mostly)
  if (typeof a === 'number' && typeof b === 'string') return String(a) === b;
  if (typeof a === 'string' && typeof b === 'number') return a === String(b);

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      console.error(`Array length mismatch at ${path}: ${a.length} vs ${b.length}`);
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!fuzzyDeepEqual(a[i], b[i], `${path}[${i}]`)) return false;
    }
    return true;
  }

  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();

    // Check keys?
    // Sparse rows: undefined in A becomes null in B (from unified schema).
    // So keysB might be a superset if we check generic "all keys".
    // But flattenObject removes undefined?
    // Let's iterate over keys of A first.
    for (const k of keysA) {
      if (!fuzzyDeepEqual(a[k], b[k], `${path}.${k}`)) return false;
    }
    // Iterate over keys of B to check for extra non-null values?
    for (const k of keysB) {
      if (b[k] !== null && b[k] !== undefined && !(k in a)) {
        // Ignore if b[k] is null (padded field)
        console.error(`Extra key in decoded at ${path}.${k}: ${b[k]}`);
        return false;
      }
    }
    return true;
  }

  console.error(`Mismatch at ${path}: ${a} (${typeof a}) vs ${b} (${typeof b})`);
  return false;
}

// --- Data Generators ---
function generateFlat(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@example.com`,
    role: i % 3 === 0 ? 'admin' : i % 3 === 1 ? 'editor' : 'viewer',
    active: i % 2 === 0,
  }));
}

function generateNested(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    profile: {
      name: `User ${i}`,
      details: {
        age: 20 + (i % 50),
        city: i % 2 === 0 ? 'New York' : 'San Francisco',
      },
    },
    tags: [`tag${i}`, `group${i % 5}`],
  }));
}

function generateMixed(count: number) {
  return Array.from({ length: count }, (_, i) => {
    if (i % 3 === 0) return { type: 'A', id: i, value: i * 10 };
    if (i % 3 === 1) return { type: 'B', id: i, name: `Item ${i}`, description: `Desc ${i}` };
    return { type: 'C', id: i, active: true, metadata: { created: '2023-01-01' } };
  });
}

function generateSparse(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const obj: Record<string, unknown> = { id: i };
    if (i % 2 === 0) obj.a = 1;
    if (i % 3 === 0) obj.b = 2;
    if (i % 5 === 0) obj.c = 3;
    if (i % 7 === 0) obj.d = 4;
    return obj;
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown): string {
  return error instanceof Error ? (error.stack ?? '') : '';
}

function generateRepetitive(count: number) {
  const roles = ['admin', 'editor', 'viewer', 'guest', 'superadmin'];
  const cities = ['New York', 'London', 'Tokyo', 'Paris', 'Berlin'];
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    role: roles[i % roles.length],
    city: cities[i % cities.length],
    status: i % 2 === 0 ? 'active' : 'inactive',
    department: `Dept ${i % 3}`,
  }));
}

// --- Main Test Runner ---
async function run() {
  const suites = {
    'Flat (Dictionary, Positional)': generateFlat(100),
    'Nested (Flattening, Fixed Array)': generateNested(100),
    'Mixed (Schema Unification)': generateMixed(100),
    'Sparse (Presence Mask)': generateSparse(100),
    'Repetitive (Dictionary Stress)': generateRepetitive(100),
  };

  console.log('--- Starting TENS v2 Round-Trip Verification (DEBUG MODE) ---');
  let failures = 0;

  for (const [name, data] of Object.entries(suites)) {
    console.log(`Testing: ${name}`);

    try {
      // Encode
      const encoder = new TokenStreamEncoder();
      const binary = encoder.encode(data);

      // Decode
      const decoder = new TokenStreamDecoder();
      const decoded = decoder.decode(binary);

      const flatOriginal = data.map((d) => flattenObject(d));

      if (decoded.length > 0) {
        console.log('First Item Original:', JSON.stringify(flatOriginal[0], null, 2));
        console.log('First Item Decoded:', JSON.stringify(decoded[0], null, 2));
      }

      // Verify items
      if (decoded.length !== flatOriginal.length) {
        console.error(
          `  FAIL: Length mismatch. Original: ${flatOriginal.length}, Decoded: ${decoded.length}`,
        );
        failures++;
        continue;
      }

      let mismatches = 0;
      for (let i = 0; i < flatOriginal.length; i++) {
        if (!fuzzyDeepEqual(flatOriginal[i], decoded[i])) {
          mismatches++;
          if (mismatches <= 5) {
            console.error(`  Mismatch at index ${i}`);
            console.log('  Original:', flatOriginal[i]);
            console.log('  Decoded:', decoded[i]);
          }
        }
      }

      if (mismatches === 0) {
        console.log(`  PASS: ${decoded.length} items verified.`);
      } else {
        console.error(`  FAIL: ${mismatches} items mismatched.`);
        failures++;
      }
    } catch (error: unknown) {
      console.error(`  CRASH: ${getErrorMessage(error)}`);
      console.error(getErrorStack(error));
      failures++;
    }
  }

  if (failures === 0) {
    console.log('\n✅ ALL TESTS PASSED');
    process.exit(0);
  } else {
    console.error(`\n❌ ${failures} SUITES FAILED`);
    process.exit(1);
  }
}

run();
