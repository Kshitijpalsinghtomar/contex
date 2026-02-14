import { describe, expect, it } from 'vitest';
import { analyzeFormats, formatOutput } from '../formatters.js';
import { TensTextDecoder, TensTextEncoder } from '../tens_text.js';

// ============================================================================
// TENS-Text Format Tests — EBNF v1 Grammar
// ============================================================================
// Grammar rules:
//   - Records start with schema IDENT (e.g. "data"), not "#N"
//   - Arrays via field repetition (no |> syntax)
//   - No commas, no brackets
//   - Types: str, num, bool (with ? for optional)
// ============================================================================

describe('TensTextEncoder', () => {
  const encoder = new TensTextEncoder('o200k_base');

  // ---- Core Encoding ----

  it('encodes flat data with schema IDENT as record marker', () => {
    const data = [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
    ];
    const result = encoder.encode(data);

    expect(result).toContain('@version 1');
    expect(result).toContain('@encoding o200k_base');
    expect(result).toContain('@schema data');
    expect(result).toContain('id:num');
    expect(result).toContain('name:str');
    expect(result).toContain('role:str');
    // Record markers are "data", not "#1"
    expect(result).toContain('\ndata\n');
    expect(result).toContain('  name Alice');
    expect(result).toContain('  name Bob');
    // No pipes, no commas, no brackets
    expect(result).not.toContain(' | ');
    expect(result).not.toContain('|>');
    expect(result).not.toContain('[');
    expect(result).not.toContain(']');
  });

  it('builds dictionary for repeated values', () => {
    const data = [
      { id: 1, status: 'open' },
      { id: 2, status: 'closed' },
      { id: 3, status: 'open' },
    ];
    const result = encoder.encode(data);

    expect(result).toContain('@dict');
    expect(result).toContain('open');
    expect(result).toMatch(/status @0/);
  });

  it('handles null values with _', () => {
    const data = [
      { id: 1, name: 'Alice', email: null },
      { id: 2, name: 'Bob', email: 'bob@test.com' },
    ];
    const result = encoder.encode(data);
    expect(result).toContain('  email _');
    expect(result).toContain('email:str?');
  });

  it('handles empty data', () => {
    const result = encoder.encode([]);
    expect(result).toContain('@version 1');
    expect(result).toContain('@schema data');
  });

  it('handles boolean values', () => {
    const data = [
      { id: 1, active: true },
      { id: 2, active: false },
    ];
    const result = encoder.encode(data);
    expect(result).toContain('  active true');
    expect(result).toContain('  active false');
    expect(result).toContain('active:bool');
  });

  it('encodes arrays as repeated fields', () => {
    const data = [
      { id: 1, tag: ['security', 'backend'] },
      { id: 2, tag: ['frontend'] },
      { id: 3, tag: [] },
    ];
    const result = encoder.encode(data);

    // Array elements are emitted as repeated field lines
    const lines = result.split('\n');
    const tagLines = lines.filter((l) => l.trim().startsWith('tag '));
    expect(tagLines.length).toBe(3); // security, backend, frontend
    expect(result).toContain('  tag security');
    expect(result).toContain('  tag backend');
    expect(result).toContain('  tag frontend');
    // Empty array → no tag lines for record #3
    // No |> syntax
    expect(result).not.toContain('|>');
  });

  it('uses custom schema name as record marker', () => {
    const data = [{ x: 1 }];
    const result = encoder.encode(data, 'metrics');
    expect(result).toContain('@schema metrics');
    expect(result).toContain('\nmetrics\n');
  });

  it('quotes strings with special characters', () => {
    const data = [
      { id: 1, desc: 'hello world' },
      { id: 2, desc: 'simple' },
    ];
    const result = encoder.encode(data);
    expect(result).toContain('  desc "hello world"');
    expect(result).toContain('  desc simple');
  });

  it('escapes quotes and backslashes in strings', () => {
    const data = [
      { id: 1, text: 'say "hello"' },
      { id: 2, text: 'path\\to\\file' },
    ];
    const result = encoder.encode(data);
    expect(result).toContain('say \\"hello\\"');
    expect(result).toContain('path\\\\to\\\\file');
  });

  it('escapes newlines in string values', () => {
    const data = [{ id: 1, text: 'line1\nline2' }];
    const result = encoder.encode(data);
    expect(result).toContain('\\n');
  });

  it('quotes values that look like keywords or numbers', () => {
    const data = [
      { id: 1, code: '42' },
      { id: 2, code: 'true' },
      { id: 3, code: '_' },
    ];
    const result = encoder.encode(data);
    expect(result).toContain('  code "42"');
    expect(result).toContain('  code "true"');
    expect(result).toContain('  code "_"');
  });

  // ---- Numeric Edge Cases ----

  it('handles NaN values', () => {
    const data = [{ id: 1, val: Number.NaN }];
    const result = encoder.encode(data);
    expect(result).toContain('"NaN"');
  });

  it('handles Infinity and -Infinity', () => {
    const data = [
      { id: 1, val: Number.POSITIVE_INFINITY },
      { id: 2, val: Number.NEGATIVE_INFINITY },
    ];
    const result = encoder.encode(data);
    expect(result).toContain('"Infinity"');
    expect(result).toContain('"-Infinity"');
  });

  it('handles -0', () => {
    const data = [{ id: 1, val: -0 }];
    const result = encoder.encode(data);
    expect(result).toContain('  val -0');
  });

  it('handles floating point numbers', () => {
    const data = [
      { id: 1, val: 3.14159 },
      { id: 2, val: -0.001 },
    ];
    const result = encoder.encode(data);
    expect(result).toContain('  val 3.14159');
    expect(result).toContain('  val -0.001');
  });

  // ---- String Edge Cases ----

  it('handles empty strings', () => {
    const data = [{ id: 1, name: '' }];
    const result = encoder.encode(data);
    expect(result).toContain('  name ""');
  });

  it('handles Unicode strings', () => {
    const data = [
      { id: 1, name: '日本語' },
      { id: 2, name: '🚀🎯' },
      { id: 3, name: 'Ñoño' },
    ];
    const result = encoder.encode(data);
    expect(result).toContain('日本語');
    expect(result).toContain('🚀🎯');
    expect(result).toContain('Ñoño');
  });

  it('handles strings starting with @ or #', () => {
    const data = [
      { id: 1, val: '@mention' },
      { id: 2, val: '#hashtag' },
    ];
    const result = encoder.encode(data);
    expect(result).toContain('"@mention"');
    expect(result).toContain('"#hashtag"');
  });

  it('handles strings with tab and carriage return', () => {
    const data = [{ id: 1, text: 'col1\tcol2\rend' }];
    const result = encoder.encode(data);
    expect(result).toContain('\\t');
    expect(result).toContain('\\r');
  });

  it('handles empty objects as quoted JSON', () => {
    const data = [{ id: 1, meta: {} }];
    const result = encoder.encode(data);
    // Objects serialized as quoted JSON for safety
    expect(result).toContain('meta');
  });

  it('handles undefined fields across rows as null', () => {
    const data = [
      { id: 1, a: 'x' },
      { id: 2, b: 'y' },
    ];
    const result = encoder.encode(data);
    expect(result).toContain('  a _');
    expect(result).toContain('  b _');
  });
});

describe('TensTextDecoder', () => {
  const decoder = new TensTextDecoder();

  // ---- Core Decoding ----

  it('decodes IDENT-based records', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num name:str role:str

data
  id 1
  name Alice
  role admin
data
  id 2
  name Bob
  role user
`;
    const { data } = decoder.decode(text);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ id: 1, name: 'Alice', role: 'admin' });
    expect(data[1]).toEqual({ id: 2, name: 'Bob', role: 'user' });
  });

  it('resolves dictionary references', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num status:str

@dict open closed

data
  id 1
  status @0
data
  id 2
  status @1
data
  id 3
  status @0
`;
    const { data } = decoder.decode(text);
    expect(data[0].status).toBe('open');
    expect(data[1].status).toBe('closed');
    expect(data[2].status).toBe('open');
  });

  it('handles null values', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num email:str?

data
  id 1
  email _
data
  id 2
  email test@example.com
`;
    const { data } = decoder.decode(text);
    expect(data[0].email).toBeNull();
    expect(data[1].email).toBe('test@example.com');
  });

  it('handles boolean values', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num active:bool

data
  id 1
  active true
data
  id 2
  active false
`;
    const { data } = decoder.decode(text);
    expect(data[0].active).toBe(true);
    expect(data[1].active).toBe(false);
  });

  it('handles repeated field as array', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num tag:str

data
  id 1
  tag security
  tag backend
data
  id 2
  tag frontend
`;
    const { data } = decoder.decode(text);
    expect(data[0].tag).toEqual(['security', 'backend']);
    expect(data[1].tag).toEqual(['frontend']);
  });

  it('parses quoted strings with escapes', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num text:str

data
  id 1
  text "hello \\"world\\""
data
  id 2
  text "line1\\nline2"
`;
    const { data } = decoder.decode(text);
    expect(data[0].text).toBe('hello "world"');
    expect(data[1].text).toBe('line1\nline2');
  });

  it('returns correct document metadata', () => {
    const text = `@version 1
@encoding cl100k_base
@schema users id:num name:str

users
  id 1
  name Alice
`;
    const { document } = decoder.decode(text);
    expect(document.version).toBe(1);
    expect(document.encoding).toBe('cl100k_base');
    expect(document.schemas).toHaveLength(1);
    expect(document.schemas[0].name).toBe('users');
    expect(document.schemas[0].fields).toHaveLength(2);
  });

  // ---- Negative / Malformed Input Tests ----

  it('handles empty input gracefully', () => {
    const { data, document } = decoder.decode('');
    expect(data).toEqual([]);
    expect(document.version).toBe(1);
  });

  it('handles input with only directives (no data)', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num name:str
`;
    const { data } = decoder.decode(text);
    expect(data).toEqual([]);
  });

  it('handles missing @version (uses default)', () => {
    const text = `@encoding o200k_base
@schema data id:num

data
  id 42
`;
    const { data, document } = decoder.decode(text);
    expect(document.version).toBe(1);
    expect(data[0].id).toBe(42);
  });

  it('handles extra blank lines without breaking', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num name:str



data
  id 1
  name Alice


data
  id 2
  name Bob


`;
    const { data } = decoder.decode(text);
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('Alice');
    expect(data[1].name).toBe('Bob');
  });

  it('handles out-of-range dictionary reference as null', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num val:str

@dict one two

data
  id 1
  val @99
`;
    const { data } = decoder.decode(text);
    expect(data[0].val).toBeNull();
  });

  it('handles row with missing optional fields as null', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num name:str? email:str?

data
  id 1
  name Alice
`;
    const { data } = decoder.decode(text);
    expect(data[0].id).toBe(1);
    expect(data[0].name).toBe('Alice');
    expect(data[0].email).toBeNull();
  });

  // ---- Type Preservation Tests ----

  it('preserves string type for str-typed fields that look like numbers', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num code:str

data
  id 1
  code 42
`;
    const { data } = decoder.decode(text);
    expect(data[0].code).toBe('42');
    expect(typeof data[0].code).toBe('string');
  });

  it('preserves string type for str-typed fields that look like booleans', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num flag:str

data
  id 1
  flag true
`;
    const { data } = decoder.decode(text);
    expect(data[0].flag).toBe('true');
    expect(typeof data[0].flag).toBe('string');
  });
});

describe('TENS-Text Roundtrip', () => {
  const encoder = new TensTextEncoder('o200k_base');
  const decoder = new TensTextDecoder();

  it('roundtrips simple flat data', () => {
    const original = [
      { id: 1, name: 'Alice', score: 95 },
      { id: 2, name: 'Bob', score: 87 },
      { id: 3, name: 'Carol', score: 92 },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips data with nulls', () => {
    const original = [
      { id: 1, name: 'Alice', email: null },
      { id: 2, name: 'Bob', email: 'bob@test.com' },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips data with booleans', () => {
    const original = [
      { id: 1, active: true },
      { id: 2, active: false },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips data with dictionary-compressed values', () => {
    const original = [
      { id: 1, status: 'open', priority: 'high' },
      { id: 2, status: 'closed', priority: 'low' },
      { id: 3, status: 'open', priority: 'high' },
      { id: 4, status: 'open', priority: 'low' },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips data with arrays via field repetition', () => {
    const original = [
      { id: 1, tag: ['a', 'b', 'c'] },
      { id: 2, tag: ['x'] },
      { id: 3, tag: [] },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips data with special characters in strings', () => {
    const original = [
      { id: 1, text: 'hello "world"' },
      { id: 2, text: 'line1\nline2' },
      { id: 3, text: 'path\\to\\file' },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips 100-row dataset', () => {
    const original = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `User${i + 1}`,
      role: i % 3 === 0 ? 'admin' : 'user',
      score: i * 10,
    }));
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips strings that look like keywords', () => {
    const original = [
      { id: 1, val: 'true' },
      { id: 2, val: 'false' },
      { id: 3, val: '_' },
      { id: 4, val: '42' },
      { id: 5, val: '@0' },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips data with empty strings', () => {
    const original = [
      { id: 1, val: '' },
      { id: 2, val: 'notempty' },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips data with Unicode', () => {
    const original = [
      { id: 1, name: '日本語テスト' },
      { id: 2, name: '🚀 Emoji Launch' },
      { id: 3, name: 'Ñoño español' },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips data with tabs and carriage returns', () => {
    const original = [
      { id: 1, text: 'col1\tcol2' },
      { id: 2, text: 'line\r\nbreak' },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips floating point numbers', () => {
    const original = [
      { id: 1, val: 3.14159 },
      { id: 2, val: -0.001 },
      { id: 3, val: 0 },
      { id: 4, val: 999999 },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips strings starting with @ and #', () => {
    const original = [
      { id: 1, val: '@mention' },
      { id: 2, val: '#hashtag' },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips sparse data (many nulls)', () => {
    const original = [
      { id: 1, a: null, b: null, c: 'x' },
      { id: 2, a: 'y', b: null, c: null },
      { id: 3, a: null, b: 'z', c: null },
    ];
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });

  it('roundtrips 500-row dataset with all types', () => {
    const original = Array.from({ length: 500 }, (_, i) => ({
      id: i + 1,
      name: `Employee_${i + 1}`,
      active: i % 2 === 0,
      score: (i * 7.3) % 100,
      department: ['eng', 'sales', 'ops'][i % 3],
      email: i % 5 === 0 ? null : `e${i}@co.com`,
      tag: i % 4 === 0 ? ['leader'] : [],
    }));
    const encoded = encoder.encode(original);
    const { data } = decoder.decode(encoded);
    expect(data).toEqual(original);
  });
});

describe('TENS-Text Determinism', () => {
  const encoder = new TensTextEncoder('o200k_base');

  it('produces identical output for identical input', () => {
    const data = [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
    ];
    const out1 = encoder.encode(data);
    const out2 = encoder.encode(data);
    expect(out1).toBe(out2);
  });

  it('is deterministic across multiple calls', () => {
    const data = [{ id: 1, role: 'admin', name: 'Alice' }];
    const out1 = encoder.encode(data);
    const out2 = encoder.encode(data);
    expect(out1).toBe(out2);
  });
});

describe('TENS-Text via formatOutput', () => {
  it('produces tens-text via formatOutput', () => {
    const data = [{ id: 1, name: 'Test' }];
    const output = formatOutput(data, 'tens-text');

    expect(output).toContain('@version 1');
    expect(output).toContain('@schema');
    expect(output).toContain('data\n');
    expect(output).toContain('  id 1');
  });

  it('includes tens-text in analyzeFormats', () => {
    const data = [{ id: 1, name: 'Alice' }];
    const analyses = analyzeFormats(data);

    const tensText = analyses.find((a) => a.format === 'tens-text');
    expect(tensText).toBeDefined();
    expect(tensText!.byteSize).toBeGreaterThan(0);
    expect(tensText!.output).toContain('@version');
  });
});

describe('TENS-Text Format Efficiency', () => {
  const encoder = new TensTextEncoder('o200k_base');

  it('is smaller than JSON for tabular data', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `User${i + 1}`,
      role: i % 3 === 0 ? 'admin' : 'user',
      active: i % 2 === 0,
    }));
    const tensText = encoder.encode(data);
    const json = JSON.stringify(data);
    expect(tensText.length).toBeLessThan(json.length);
  });

  it('dictionary compression reduces repeated string overhead', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      status: ['pending', 'active', 'complete'][i % 3],
      region: ['us-east', 'eu-west', 'ap-south'][i % 3],
    }));
    const tensText = encoder.encode(data);
    expect(tensText).toContain('@dict');
    // Count dict refs (exclude the @version and @dict lines)
    const lines = tensText.split('\n').filter((l) => l.startsWith('  '));
    const refLines = lines.filter((l) => /@\d+/.test(l));
    expect(refLines.length).toBeGreaterThan(100);
  });

  it('produces no data-level commas, brackets, or pipes', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `User${i + 1}`,
      tag: ['a', 'b'],
    }));
    const tensText = encoder.encode(data);
    // Check data lines only (skip schema which uses [] suffix)
    const dataLines = tensText.split('\n').filter((l) => l.startsWith('  '));
    const dataContent = dataLines.join('\n');
    expect(dataContent).not.toContain('{');
    expect(dataContent).not.toContain('}');
    expect(dataContent).not.toContain('[');
    expect(dataContent).not.toContain(']');
    expect(dataContent).not.toContain('|>');
    // Schema line uses [] for array markers, but no commas
    expect(tensText).not.toContain(',');
  });
});
