/**
 * Edge-case stress tests for the Contex Compact encoder.
 * Finds bugs like the [object Object] issue proactively.
 */
import { formatOutput } from '../src/formatters.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    const msg = `  ✗ ${name}: ${e.message}`;
    failures.push(msg);
    console.log(msg);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertNoObjectObject(output: string, ctx: string) {
  assert(!output.includes('[object Object]'), `[object Object] found in ${ctx}`);
  assert(!output.includes('[object Array]'), `[object Array] found in ${ctx}`);
}

function assertNoUndefined(output: string, ctx: string) {
  // "undefined" as a literal string (not the _ abbreviation) is a bug
  const lines = output.split('\n');
  for (const line of lines) {
    // Skip @d dictionary lines which might contain the word "undefined" as actual data
    if (line.startsWith('@d') || line.startsWith('@f') || line.startsWith('@sparse')) continue;
    const fields = line.split('\t');
    for (const f of fields) {
      assert(f !== 'undefined', `Literal "undefined" value in ${ctx}: line="${line}"`);
    }
  }
}

function assertNonEmpty(output: string, ctx: string) {
  assert(output.length > 0, `Empty output for ${ctx}`);
}

console.log('\n=== Contex Compact Edge-Case Stress Tests ===\n');

// ─── 1. Deeply nested objects ───────────────────────────────────────────────
console.log('Category: Nested Data');

test('deeply nested object (3 levels)', () => {
  const data = [{ a: { b: { c: { d: 'deep' } } } }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'deep nesting');
  assertNonEmpty(out, 'deep nesting');
  assert(out.includes('deep'), 'Value "deep" should be in output');
});

test('array of objects inside object', () => {
  const data = [{
    user: { name: 'Alice', orders: [{ id: 1, total: 99 }, { id: 2, total: 50 }] }
  }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'array of objects in object');
  assert(out.includes('99') || out.includes('@'), 'Values should be present');
});

test('triple nesting: array > object > array', () => {
  const data = [{
    groups: [
      { name: 'A', members: [{ id: 1 }, { id: 2 }] },
      { name: 'B', members: [{ id: 3 }] },
    ]
  }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'triple nesting');
});

test('mixed nesting: object + array + primitives at same level', () => {
  const data = [{
    name: 'Test',
    tags: ['a', 'b'],
    meta: { x: 1, y: 2 },
    items: [{ id: 1 }],
    score: 42,
    active: true,
    note: null,
  }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'mixed nesting');
  assertNoUndefined(out, 'mixed nesting');
});

// ─── 2. Edge-case values ─────────────────────────────────────────────────────
console.log('\nCategory: Edge-Case Values');

test('empty string values', () => {
  const data = [{ name: '', email: '' }, { name: 'Alice', email: 'a@b.com' }];
  const out = formatOutput(data, 'contex');
  assertNoUndefined(out, 'empty strings');
  // Empty strings should become _ (null abbreviation)
  assert(out.includes('_'), 'Empty strings should become _');
});

test('null, undefined, missing fields', () => {
  const data = [
    { a: null, b: undefined, c: 'yes' },
    { a: 'no', b: 'ok', c: null },
  ];
  const out = formatOutput(data, 'contex');
  assertNoUndefined(out, 'null/undefined');
  assertNoObjectObject(out, 'null/undefined');
});

test('boolean values (true/false)', () => {
  const data = [
    { name: 'A', active: true, verified: false },
    { name: 'B', active: false, verified: true },
  ];
  const out = formatOutput(data, 'contex');
  assert(out.includes('T'), 'true should become T');
  assert(out.includes('F'), 'false should become F');
  assert(!out.includes('true'), 'literal "true" should not appear');
  assert(!out.includes('false'), 'literal "false" should not appear');
});

test('zero, negative zero, NaN, Infinity', () => {
  const data = [{ a: 0, b: -0, c: NaN, d: Infinity, e: -Infinity }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'special numbers');
  assertNonEmpty(out, 'special numbers');
});

test('very large numbers', () => {
  const data = [{ id: 999999999999999, amount: 1234567890.12345 }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'large numbers');
});

test('string that looks like a dict ref: @0, @1', () => {
  const data = [
    { email: '@user1', tag: '@admin' },
    { email: '@user2', tag: '@admin' },
  ];
  const out = formatOutput(data, 'contex');
  assertNonEmpty(out, 'at-sign strings');
  // These should NOT be confused with dictionary refs
});

test('literal @digit values must not collide with dict refs', () => {
  // A value that's literally "@0" or "@1" must be dictionary-encoded
  // or escaped so it's not confused with a real dictionary reference
  const data = [
    { id: 1, code: '@0', label: 'first' },
    { id: 2, code: '@1', label: 'second' },
    { id: 3, code: '@2', label: 'third' },
  ];
  const out = formatOutput(data, 'contex');
  assertNonEmpty(out, '@digit values');
  // The literal strings @0, @1, @2 should appear in the dictionary line
  // so they're referenced unambiguously via dictionary indices
  assert(out.includes('@d'), '@digit values should trigger dictionary');
});

test('string with tab and newline characters', () => {
  const data = [
    { text: 'hello\tworld', note: 'line1\nline2' },
    { text: 'foo\tbar', note: 'a\nb' },
  ];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'special chars');
  // Tabs in values should be escaped
  assert(out.includes('\\t') || !out.includes('hello\tworld'),
    'Tabs should be escaped or handled');
});

test('unicode and emoji values', () => {
  const data = [
    { name: '日本語', emoji: '🚀', desc: 'café' },
    { name: 'العربية', emoji: '🎉', desc: 'naïve' },
  ];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'unicode');
  assert(out.includes('🚀'), 'Emoji should be preserved');
  assert(out.includes('日本語'), 'Unicode should be preserved');
});

// ─── 3. Array edge cases ───────────────────────────────────────────────────
console.log('\nCategory: Array Edge Cases');

test('empty array value', () => {
  const data = [{ name: 'Alice', tags: [] }, { name: 'Bob', tags: ['x'] }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'empty array');
  assertNoUndefined(out, 'empty array');
});

test('array of primitives (numbers)', () => {
  const data = [{ scores: [1, 2, 3] }, { scores: [4, 5, 6] }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'number array');
});

test('array of primitives (strings)', () => {
  const data = [{ tags: ['js', 'ts', 'node'] }, { tags: ['python', 'rust'] }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'string array');
  // Should be space-separated in cells
});

test('array of mixed types', () => {
  const data = [{ values: [1, 'two', true, null] }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'mixed array');
  assertNoUndefined(out, 'mixed array');
});

test('nested array of objects with missing fields', () => {
  const data = [{
    items: [
      { id: 1, name: 'A', extra: 'yes' },
      { id: 2, name: 'B' },  // missing 'extra'
    ]
  }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'array objects missing fields');
  assertNoUndefined(out, 'array objects missing fields');
});

test('array of objects where objects have array values', () => {
  const data = [{
    records: [
      { id: 1, tags: ['a', 'b'] },
      { id: 2, tags: ['c'] },
    ]
  }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'nested array in array objects');
});

// ─── 4. Schema & dictionary edge cases ──────────────────────────────────────
console.log('\nCategory: Dictionary & Schema');

test('dictionary with very long repeated string', () => {
  const longStr = 'a'.repeat(500);
  const data = [
    { val: longStr, id: 1 },
    { val: longStr, id: 2 },
    { val: longStr, id: 3 },
  ];
  const out = formatOutput(data, 'contex');
  // Long value should be in @d dictionary, referenced by @0
  assert(out.includes('@d'), 'Dictionary should exist');
  assert(out.includes('@0'), 'Should use dict ref');
  // The long string should appear only once (in dictionary)
  const occurrences = out.split(longStr).length - 1;
  assert(occurrences === 1, `Long string should appear once in dict, found ${occurrences}`);
});

test('all unique values (no dictionary needed)', () => {
  const data = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' },
  ];
  const out = formatOutput(data, 'contex');
  assert(!out.includes('@d'), 'No dictionary needed for all unique values');
});

test('single-char strings should NOT be dictionary-compressed', () => {
  // Strings of length 1 should be kept as-is (compression overhead > savings)
  const data = [
    { grade: 'A' }, { grade: 'A' }, { grade: 'A' },
  ];
  const out = formatOutput(data, 'contex');
  // 'A' is length 1, should NOT go into dictionary
  assert(!out.includes('@d'), 'Single char should not be dict-compressed');
});

test('numeric dictionary compression', () => {
  const data = [
    { val: 99999, cat: 'x' },
    { val: 99999, cat: 'y' },
    { val: 99999, cat: 'z' },
  ];
  const out = formatOutput(data, 'contex');
  // 99999 is 5 chars, appears 3 times — should be dict-compressed
  assert(out.includes('@d'), 'Numeric dict should exist');
});

// ─── 5. Sparse data ────────────────────────────────────────────────────────
console.log('\nCategory: Sparse Data');

test('highly sparse data (>50% null)', () => {
  const data = [
    { a: 1, b: null, c: null, d: null, e: null },
    { a: null, b: 2, c: null, d: null, e: null },
    { a: null, b: null, c: 3, d: null, e: null },
  ];
  const out = formatOutput(data, 'contex');
  assert(out.includes('@sparse'), 'Should trigger sparse mode');
  assertNoObjectObject(out, 'sparse');
  assertNoUndefined(out, 'sparse');
});

test('exactly 50% sparse (should NOT trigger)', () => {
  const data = [
    { a: 1, b: null },
    { a: null, b: 2 },
  ];
  const out = formatOutput(data, 'contex');
  assert(!out.includes('@sparse'), '50% should not trigger sparse mode');
});

// ─── 6. Row shape variations ─────────────────────────────────────────────
console.log('\nCategory: Row Shape Variations');

test('rows with different keys (heterogeneous)', () => {
  const data = [
    { name: 'Alice', age: 30 },
    { name: 'Bob', role: 'admin' },
    { name: 'Charlie', age: 25, role: 'user' },
  ];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'heterogeneous');
  assertNoUndefined(out, 'heterogeneous');
  // Should handle missing keys gracefully
});

test('single row', () => {
  const data = [{ id: 1, name: 'Only' }];
  const out = formatOutput(data, 'contex');
  assertNonEmpty(out, 'single row');
  assertNoObjectObject(out, 'single row');
});

test('empty array (no rows)', () => {
  const data: Record<string, unknown>[] = [];
  const out = formatOutput(data, 'contex');
  assert(out === '', 'Empty data should produce empty string');
});

test('100 rows stress test', () => {
  const data = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `user_${i}`,
    city: i % 3 === 0 ? 'New York' : i % 3 === 1 ? 'London' : 'Tokyo',
    active: i % 2 === 0,
    score: i * 10.5,
  }));
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, '100 rows');
  assertNoUndefined(out, '100 rows');
  assertNonEmpty(out, '100 rows');
  // Dictionary should exist (cities repeat)
  assert(out.includes('@d'), 'Should have dictionary for repeated cities');
});

// ─── 7. Real-world API data patterns ────────────────────────────────────────
console.log('\nCategory: Real-World Patterns');

test('DummyJSON cart data pattern', () => {
  const data = [{
    id: 1,
    products: [
      { id: 59, title: 'Laptop', price: 1299, quantity: 2, thumbnail: 'https://example.com/laptop.jpg' },
      { id: 88, title: 'Phone', price: 899, quantity: 1, thumbnail: 'https://example.com/phone.jpg' },
    ],
    total: 3497,
    userId: 97,
  }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'cart data');
  assert(out.includes('1299') || out.includes('@'), 'Price should be in output');
});

test('GitHub API-like response with nested user objects', () => {
  const data = [
    { id: 1, title: 'Bug fix', user: { login: 'alice', avatar_url: 'https://img.com/1' }, labels: [{ name: 'bug', color: 'red' }] },
    { id: 2, title: 'Feature', user: { login: 'bob', avatar_url: 'https://img.com/2' }, labels: [{ name: 'feature', color: 'blue' }] },
  ];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'github-like');
  assert(out.includes('alice') || out.includes('@'), 'User login should be in output');
});

test('deeply nested config-like data', () => {
  const data = [{
    server: {
      host: 'localhost',
      port: 3000,
      ssl: {
        enabled: true,
        cert: '/path/to/cert',
        key: '/path/to/key',
      },
    },
    db: {
      host: 'localhost',
      port: 5432,
      name: 'mydb',
    },
  }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'config data');
  assert(out.includes('localhost') || out.includes('@'), 'Host should be in output');
});

test('e-commerce product with variants', () => {
  const data = [{
    name: 'T-Shirt',
    price: 29.99,
    variants: [
      { size: 'S', color: 'red', stock: 10 },
      { size: 'M', color: 'red', stock: 0 },
      { size: 'L', color: 'blue', stock: 5 },
    ],
    reviews: [
      { rating: 5, text: 'Great!' },
      { rating: 3, text: 'OK' },
    ],
  }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'product with variants');
});

// ─── 8. Field name compression edge cases ────────────────────────────────────
console.log('\nCategory: Field Name Compression');

test('fields with common prefixes', () => {
  const data = [
    { customer_name: 'A', customer_email: 'a@b', customer_phone: '123' },
    { customer_name: 'B', customer_email: 'b@c', customer_phone: '456' },
  ];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'common prefixes');
  // Should have @f mapping
  assert(out.includes('@f'), 'Should have field compression mapping');
});

test('single character field names (no compression needed)', () => {
  const data = [
    { a: 1, b: 2, c: 3 },
    { a: 4, b: 5, c: 6 },
  ];
  const out = formatOutput(data, 'contex');
  assert(!out.includes('@f'), 'No compression for single-char keys');
});

// ─── 9. Data that might crash the encoder ────────────────────────────────────
console.log('\nCategory: Crash Safety');

test('row with only null values', () => {
  const data = [{ a: null, b: null, c: null }];
  const out = formatOutput(data, 'contex');
  assertNonEmpty(out, 'all null row');
});

test('deeply nested null', () => {
  const data = [{ a: { b: { c: null } } }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'nested null');
  assertNonEmpty(out, 'nested null');
});

test('object with numeric keys', () => {
  const data = [{ '0': 'a', '1': 'b', '2': 'c' }];
  const out = formatOutput(data, 'contex');
  assertNonEmpty(out, 'numeric keys');
  assertNoObjectObject(out, 'numeric keys');
});

test('value that is an empty object {}', () => {
  const data = [{ meta: {}, name: 'Test' }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'empty object value');
  assertNonEmpty(out, 'empty object value');
});

test('value that is a Date object', () => {
  const data = [{ created: new Date('2026-01-01T00:00:00Z'), name: 'Test' }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'date value');
});

test('array containing null and undefined', () => {
  const data = [{ items: [1, null, undefined, 'test', null] }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'array with nulls');
  assertNoUndefined(out, 'array with nulls');
});

test('nested object with boolean and null fields', () => {
  const data = [{
    settings: {
      dark_mode: true,
      notifications: false,
      custom_theme: null,
    }
  }];
  const out = formatOutput(data, 'contex');
  assertNoObjectObject(out, 'nested bool/null');
  assert(out.includes('T'), 'true should be T');
  assert(out.includes('F'), 'false should be F');
  assert(out.includes('_'), 'null should be _');
});

// ─── 10. Input validation / crash safety on bad inputs ───────────────────────
console.log('\nCategory: Input Validation');

test('null input returns empty string', () => {
  const out = formatOutput(null as unknown as unknown[], 'contex');
  assert(out === '', 'null input should return empty');
});

test('undefined input returns empty string', () => {
  const out = formatOutput(undefined as unknown as unknown[], 'contex');
  assert(out === '', 'undefined input should return empty');
});

test('non-array input returns empty string', () => {
  const out = formatOutput('hello' as unknown as unknown[], 'contex');
  assert(out === '', 'string input should return empty');
});

test('array with non-object items filters them out', () => {
  const data = [123, 'hello', null, { name: 'Alice' }, true, { name: 'Bob' }] as unknown[];
  const out = formatOutput(data, 'contex');
  assertNonEmpty(out, 'mixed array');
  assert(out.includes('Alice'), 'Should include valid objects');
  assert(out.includes('Bob'), 'Should include valid objects');
  assertNoObjectObject(out, 'mixed array');
});

test('all-non-object array returns empty', () => {
  const data = [1, 2, 3, 'hello', null] as unknown[];
  const out = formatOutput(data, 'contex');
  assert(out === '', 'all non-object array should return empty');
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(f);
}
console.log();
process.exit(failed > 0 ? 1 : 0);
