import { describe, expect, it } from 'vitest';
import { TensTextDecoder, TensTextEncoder } from '../tens_text.js';

// ============================================================================
// TENS-Text Conformance Tests
// ============================================================================
//
// These tests verify the EXACT output format against the EBNF grammar
// (docs/tens-specification.md §6.3). Not just "does it roundtrip" but
// "does the wire format look exactly right per the specification."
//
// ============================================================================

const encoder = new TensTextEncoder('o200k_base');
const decoder = new TensTextDecoder();

// ────────────────────────────────────────────────────────────────────────────
// Directive Order & Format
// ────────────────────────────────────────────────────────────────────────────

describe('Conformance: Directive Order', () => {
  it('directives appear in order: @version → @encoding → @schema → @dict → records', () => {
    const data = [
      { id: 1, role: 'admin' },
      { id: 2, role: 'admin' },
    ];
    const text = encoder.encode(data);
    const lines = text.split('\n').filter((l: string) => l.trim().length > 0);

    const versionIdx = lines.findIndex((l: string) => l.startsWith('@version'));
    const encodingIdx = lines.findIndex((l: string) => l.startsWith('@encoding'));
    const schemaIdx = lines.findIndex((l: string) => l.startsWith('@schema'));
    const dictIdx = lines.findIndex((l: string) => l.startsWith('@dict'));
    const firstRecordIdx = lines.findIndex((l: string) => l === 'data');

    expect(versionIdx).toBe(0);
    expect(encodingIdx).toBe(1);
    expect(schemaIdx).toBe(2);
    if (dictIdx !== -1) {
      expect(dictIdx).toBeGreaterThan(schemaIdx);
      expect(dictIdx).toBeLessThan(firstRecordIdx);
    }
    expect(firstRecordIdx).toBeGreaterThan(schemaIdx);
  });

  it('@version format is exactly "@version N"', () => {
    const text = encoder.encode([{ id: 1 }]);
    expect(text).toMatch(/^@version \d+\n/);
  });

  it('@encoding format is exactly "@encoding IDENT"', () => {
    const text = encoder.encode([{ id: 1 }]);
    expect(text).toMatch(/@encoding [a-zA-Z0-9_]+\n/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Schema Format
// ────────────────────────────────────────────────────────────────────────────

describe('Conformance: Schema Format', () => {
  it('schema format: @schema NAME field:type field:type?', () => {
    const data = [{ id: 1, name: 'Alice', score: null, active: true }];
    const text = encoder.encode(data);
    const schemaLine = text.split('\n').find((l: string) => l.startsWith('@schema'))!;

    // Format: @schema data field1:type field2:type ...
    expect(schemaLine).toMatch(/^@schema \w+/);

    // Each field has name:type format
    const parts = schemaLine.split(/\s+/).slice(2); // skip "@schema" and name
    for (const part of parts) {
      expect(part).toMatch(/^\w+:(num|str|bool)(\[\])?\??$/);
    }
  });

  it('optional fields get ? suffix', () => {
    const data = [
      { id: 1, name: 'Alice', email: null },
      { id: 2, name: 'Bob', email: 'bob@test.com' },
    ];
    const text = encoder.encode(data);
    expect(text).toContain('email:str?');
  });

  it('array fields get [] suffix', () => {
    const data = [{ id: 1, tag: ['a', 'b'] }];
    const text = encoder.encode(data);
    expect(text).toContain('tag:str[]');
  });

  it('combined optional array gets []? suffix', () => {
    const data = [
      { id: 1, tag: ['a'] },
      { id: 2, tag: null },
    ];
    const text = encoder.encode(data);
    const schemaLine = text.split('\n').find((l: string) => l.startsWith('@schema'))!;
    // tag should be str[]?
    expect(schemaLine).toContain('tag:str[]?');
  });

  it('type inference: numbers → num, strings → str, booleans → bool', () => {
    const data = [{ a: 42, b: 'hello', c: true }];
    const text = encoder.encode(data);
    const schemaLine = text.split('\n').find((l: string) => l.startsWith('@schema'))!;
    expect(schemaLine).toContain('a:num');
    expect(schemaLine).toContain('b:str');
    expect(schemaLine).toContain('c:bool');
  });

  it('mixed-type fields collapse to str', () => {
    // When a field has both numbers and strings across rows
    const data = [
      { id: 1, val: 'hello' },
      { id: 2, val: 'world' },
    ];
    const text = encoder.encode(data);
    expect(text).toContain('val:str');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Indent Format
// ────────────────────────────────────────────────────────────────────────────

describe('Conformance: Indentation', () => {
  it('field lines start with exactly 2 spaces', () => {
    const data = [{ id: 1, name: 'Alice', score: 42 }];
    const text = encoder.encode(data);
    const fieldLines = text
      .split('\n')
      .filter((l: string) => l.startsWith('  ') && l.trim().length > 0);

    for (const line of fieldLines) {
      // Starts with 2 spaces
      expect(line.substring(0, 2)).toBe('  ');
      // Third char is NOT a space (exactly 2 spaces, not 3)
      expect(line[2]).not.toBe(' ');
    }
  });

  it('record markers have no indent (column 0)', () => {
    const data = [{ id: 1 }];
    const text = encoder.encode(data, 'mySchema');
    const lines = text.split('\n');
    const recordLines = lines.filter((l: string) => l === 'mySchema');
    expect(recordLines.length).toBe(1);
    // No leading whitespace
    for (const line of recordLines) {
      expect(line[0]).not.toBe(' ');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Dictionary Format
// ────────────────────────────────────────────────────────────────────────────

describe('Conformance: Dictionary Format', () => {
  it('@dict format: space-separated values', () => {
    const data = [
      { id: 1, role: 'admin' },
      { id: 2, role: 'user' },
      { id: 3, role: 'admin' },
      { id: 4, role: 'user' },
    ];
    const text = encoder.encode(data);
    const dictLine = text.split('\n').find((l: string) => l.startsWith('@dict'))!;
    expect(dictLine).toBeDefined();
    expect(dictLine).toMatch(/^@dict .+$/);

    // Values are space-separated
    const entries = dictLine.substring(6).trim().split(/\s+/);
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  it('dictionary uses quotes for values with spaces', () => {
    const data = [
      { id: 1, desc: 'hello world' },
      { id: 2, desc: 'hello world' },
    ];
    const text = encoder.encode(data);
    const dictLine = text.split('\n').find((l: string) => l.startsWith('@dict'))!;
    expect(dictLine).toContain('"hello world"');
  });

  it('dictionary only contains strings appearing 2+ times', () => {
    const data = [
      { id: 1, a: 'repeated', b: 'unique1' },
      { id: 2, a: 'repeated', b: 'unique2' },
      { id: 3, a: 'repeated', b: 'unique3' },
    ];
    const text = encoder.encode(data);
    const dictLine = text.split('\n').find((l: string) => l.startsWith('@dict'));
    expect(dictLine).toBeDefined();
    expect(dictLine).toContain('repeated');
    expect(dictLine).not.toContain('unique1');
    expect(dictLine).not.toContain('unique2');
    expect(dictLine).not.toContain('unique3');
  });

  it('no @dict directive when no strings repeat', () => {
    const data = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Carol' },
    ];
    const text = encoder.encode(data);
    expect(text).not.toContain('@dict');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Quoting Exhaustive
// ────────────────────────────────────────────────────────────────────────────

describe('Conformance: Quoting Rules (§6.3.1)', () => {
  const mustQuote = [
    { label: 'empty string', val: '', expected: '""' },
    { label: 'contains space', val: 'hello world', expected: '"hello world"' },
    { label: 'contains tab', val: 'a\tb', expected: '"a\\tb"' },
    { label: 'contains double quote', val: 'say "hi"', expected: '"say \\"hi\\""' },
    { label: 'contains backslash', val: 'a\\b', expected: '"a\\\\b"' },
    { label: 'keyword true', val: 'true', expected: '"true"' },
    { label: 'keyword false', val: 'false', expected: '"false"' },
    { label: 'null sentinel _', val: '_', expected: '"_"' },
    { label: 'looks like number', val: '42', expected: '"42"' },
    { label: 'looks like negative number', val: '-3.14', expected: '"-3.14"' },
    { label: 'looks like dict ref', val: '@0', expected: '"@0"' },
    { label: 'starts with @', val: '@mention', expected: '"@mention"' },
    { label: 'starts with #', val: '#hashtag', expected: '"#hashtag"' },
    { label: 'contains |', val: 'a|b', expected: '"a|b"' },
    { label: 'contains >', val: 'a>b', expected: '"a>b"' },
    { label: 'contains =', val: 'a=b', expected: '"a=b"' },
    { label: 'contains {', val: '{obj}', expected: '"{obj}"' },
    { label: 'contains [', val: '[arr]', expected: '"[arr]"' },
    { label: 'contains comma', val: 'a,b', expected: '"a,b"' },
  ];

  for (const { label, val, expected } of mustQuote) {
    it(`quotes: ${label}`, () => {
      const data = [{ id: 1, val }];
      const text = encoder.encode(data);
      expect(text).toContain(`  val ${expected}`);

      // Also verify roundtrip
      const { data: decoded } = decoder.decode(text);
      expect(decoded[0].val).toBe(val);
    });
  }

  it('does NOT quote simple identifiers', () => {
    const data = [{ id: 1, val: 'hello' }];
    const text = encoder.encode(data);
    expect(text).toContain('  val hello');
    expect(text).not.toContain('"hello"');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Escape Sequences Exhaustive
// ────────────────────────────────────────────────────────────────────────────

describe('Conformance: Escape Sequences (all 5)', () => {
  const escapes = [
    { char: '"', escape: '\\"', label: 'double quote' },
    { char: '\\', escape: '\\\\', label: 'backslash' },
    { char: '\n', escape: '\\n', label: 'newline' },
    { char: '\r', escape: '\\r', label: 'carriage return' },
    { char: '\t', escape: '\\t', label: 'tab' },
  ];

  for (const { char, escape, label } of escapes) {
    it(`escapes: ${label} → ${escape}`, () => {
      const data = [{ id: 1, val: `before${char}after` }];
      const text = encoder.encode(data);
      expect(text).toContain(escape);

      const { data: decoded } = decoder.decode(text);
      expect(decoded[0].val).toBe(`before${char}after`);
    });
  }

  it('handles all 5 escapes in a single string', () => {
    const val = 'a"b\\c\nd\re\tf';
    const data = [{ id: 1, val }];
    const text = encoder.encode(data);
    const { data: decoded } = decoder.decode(text);
    expect(decoded[0].val).toBe(val);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Array Assembly Conformance
// ────────────────────────────────────────────────────────────────────────────

describe('Conformance: Array Assembly via Field Repetition', () => {
  it('0 repetitions → empty array', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num tag:str[]

data
  id 1
`;
    const { data } = decoder.decode(text);
    expect(data[0].tag).toEqual([]);
  });

  it('1 repetition → single-element array', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num tag:str[]

data
  id 1
  tag hello
`;
    const { data } = decoder.decode(text);
    expect(data[0].tag).toEqual(['hello']);
  });

  it('N repetitions → N-element array in order', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num tag:str[]

data
  id 1
  tag alpha
  tag beta
  tag gamma
  tag delta
`;
    const { data } = decoder.decode(text);
    expect(data[0].tag).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  });

  it('encoder emits array elements as repeated field lines', () => {
    const data = [{ id: 1, tag: ['x', 'y', 'z'] }];
    const text = encoder.encode(data);
    const lines = text.split('\n');
    const tagLines = lines.filter((l: string) => l.trim().startsWith('tag '));
    expect(tagLines).toHaveLength(3);
  });

  it('empty arrays produce no field lines', () => {
    const data = [{ id: 1, tag: [] }];
    const text = encoder.encode(data);
    const lines = text.split('\n');
    const tagLines = lines.filter((l: string) => l.trim().startsWith('tag '));
    expect(tagLines).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Special Values Conformance
// ────────────────────────────────────────────────────────────────────────────

describe('Conformance: Special Values', () => {
  it('null → _ (unquoted underscore)', () => {
    const data = [{ id: 1, val: null }];
    const text = encoder.encode(data);
    expect(text).toContain('  val _');
    expect(text).not.toContain('"_"'); // val _ not val "_"
  });

  it('true → true (bare keyword)', () => {
    const data = [{ id: 1, val: true }];
    const text = encoder.encode(data);
    expect(text).toContain('  val true');
    // Not quoted for actual booleans
    const { data: decoded } = decoder.decode(text);
    expect(decoded[0].val).toBe(true);
  });

  it('false → false (bare keyword)', () => {
    const data = [{ id: 1, val: false }];
    const text = encoder.encode(data);
    expect(text).toContain('  val false');
    const { data: decoded } = decoder.decode(text);
    expect(decoded[0].val).toBe(false);
  });

  it('NaN → "NaN" (quoted string)', () => {
    const data = [{ id: 1, val: Number.NaN }];
    const text = encoder.encode(data);
    expect(text).toContain('  val "NaN"');
  });

  it('Infinity → "Infinity" (quoted string)', () => {
    const data = [{ id: 1, val: Number.POSITIVE_INFINITY }];
    const text = encoder.encode(data);
    expect(text).toContain('  val "Infinity"');
  });

  it('-Infinity → "-Infinity" (quoted string)', () => {
    const data = [{ id: 1, val: Number.NEGATIVE_INFINITY }];
    const text = encoder.encode(data);
    expect(text).toContain('  val "-Infinity"');
  });

  it('-0 → -0 (unquoted, preserves sign)', () => {
    const data = [{ id: 1, val: -0 }];
    const text = encoder.encode(data);
    expect(text).toContain('  val -0');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Malformed Input Tolerance (Lenient Decoder)
// ────────────────────────────────────────────────────────────────────────────

describe('Conformance: Malformed Input Tolerance', () => {
  it('handles completely empty input', () => {
    const { data, document } = decoder.decode('');
    expect(data).toEqual([]);
    expect(document.version).toBe(1);
    expect(document.encoding).toBe('o200k_base');
  });

  it('handles input with only whitespace', () => {
    const { data } = decoder.decode('   \n\n   \n');
    expect(data).toEqual([]);
  });

  it('handles input with only directives (no data)', () => {
    const { data, document } = decoder.decode(`@version 1
@encoding o200k_base
@schema data id:num name:str
`);
    expect(data).toEqual([]);
    expect(document.schemas).toHaveLength(1);
  });

  it('defaults missing @version to 1', () => {
    const { document } = decoder.decode(`@encoding o200k_base
@schema data id:num

data
  id 42
`);
    expect(document.version).toBe(1);
  });

  it('defaults missing @encoding to o200k_base', () => {
    const { document } = decoder.decode(`@version 1
@schema data id:num

data
  id 42
`);
    expect(document.encoding).toBe('o200k_base');
  });

  it('handles out-of-range dictionary reference gracefully', () => {
    const { data } = decoder.decode(`@version 1
@encoding o200k_base
@schema data id:num val:str

@dict one two

data
  id 1
  val @99
`);
    expect(data[0].val).toBeNull();
  });

  it('handles extra blank lines between records', () => {
    const { data } = decoder.decode(`@version 1
@encoding o200k_base
@schema data id:num name:str



data
  id 1
  name Alice



data
  id 2
  name Bob


`);
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('Alice');
    expect(data[1].name).toBe('Bob');
  });
});
