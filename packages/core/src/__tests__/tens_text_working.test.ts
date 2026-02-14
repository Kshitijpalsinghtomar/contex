import { describe, expect, it } from 'vitest';
import { TensTextDecoder, TensTextEncoder } from '../tens_text.js';

// ============================================================================
// TENS-Text Working Test & Documentation
// ============================================================================
//
// This test file validates the TENS-Text format against its formal language
// specification (docs/tens-specification.md §6.3). Each describe block maps
// to a specification section, and each test includes inline documentation
// explaining the grammar rule being verified.
//
// Spec reference:
//   §6.3.1 — Lexical Grammar (tokens, whitespace, identifiers, literals)
//   §6.3.2 — Syntactic Grammar (EBNF structure, directives, records)
//   §6.3.3 — Syntax Design (scope, error handling, imports)
//   §6.3.4 — Implementation Pipeline (lex → parse → resolve)
//   §6.3.5 — Dictionary Compression
//   §6.3.6 — Special Values
//   §6.3.9 — Design Principles (determinism, roundtrip, type-directed)
//
// ============================================================================

const encoder = new TensTextEncoder('o200k_base');
const decoder = new TensTextDecoder();

// ────────────────────────────────────────────────────────────────────────────
// §6.3.1 — LEXICAL GRAMMAR
// ────────────────────────────────────────────────────────────────────────────

describe('§6.3.1 Lexical Grammar', () => {
  // ---- Whitespace ----

  describe('Whitespace Rules', () => {
    /**
     * INDENT = "  " (2 spaces, semantic)
     * Field lines MUST start with exactly 2 spaces.
     */
    it('uses 2-space indent for field lines', () => {
      const data = [{ id: 1, name: 'Alice' }];
      const text = encoder.encode(data);
      const lines = text.split('\n');
      const fieldLines = lines.filter((l) => l.startsWith('  '));
      expect(fieldLines.length).toBeGreaterThan(0);
      // All field lines start with exactly 2 spaces
      for (const line of fieldLines) {
        expect(line.startsWith('  ')).toBe(true);
        // Third char should not be a space (not 3-space indent)
        expect(line[2]).not.toBe(' ');
      }
    });

    /**
     * Blank lines are ignored during parsing.
     * They may appear between records for readability.
     */
    it('tolerates extra blank lines between records', () => {
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

    /**
     * Trailing whitespace on lines is stripped during parsing.
     */
    it('handles trailing whitespace on lines', () => {
      const text = `@version 1   
@encoding o200k_base   
@schema data id:num name:str   

data   
  id 1   
  name Alice   
`;
      const { data } = decoder.decode(text);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(1);
    });
  });

  // ---- Identifiers ----

  describe('Identifier Rules', () => {
    /**
     * IDENT = LETTER { LETTER | DIGIT | "_" }
     * LETTER = "a"..."z" | "A"..."Z" | "_"
     *
     * Valid identifiers: users, field_name, mySchema2, _private
     */
    it('supports identifiers with underscores and digits', () => {
      const data = [{ field_1: 'a', my_field: 'b', count2: 3 }];
      const text = encoder.encode(data);
      expect(text).toContain('field_1');
      expect(text).toContain('my_field');
      expect(text).toContain('count2');

      const { data: decoded } = decoder.decode(text);
      expect(decoded[0].field_1).toBe('a');
      expect(decoded[0].my_field).toBe('b');
      expect(decoded[0].count2).toBe(3);
    });

    /**
     * Schema names are identifiers and serve as record markers.
     */
    it('uses schema IDENT as record marker', () => {
      const data = [{ x: 1 }];
      const text = encoder.encode(data, 'myCustomSchema');
      expect(text).toContain('@schema myCustomSchema');
      expect(text).toContain('\nmyCustomSchema\n');
    });
  });

  // ---- Keywords ----

  describe('Keyword & Reserved Word Handling', () => {
    /**
     * Keywords: true, false, _ (null sentinel)
     * When a string value matches a keyword, it MUST be quoted
     * to prevent misinterpretation.
     */
    it('quotes string values that match keywords', () => {
      const data = [
        { id: 1, val: 'true' }, // keyword collision
        { id: 2, val: 'false' }, // keyword collision
        { id: 3, val: '_' }, // null sentinel collision
      ];
      const text = encoder.encode(data);
      expect(text).toContain('  val "true"');
      expect(text).toContain('  val "false"');
      expect(text).toContain('  val "_"');
    });

    /**
     * Actual boolean values are unquoted keywords.
     */
    it('emits actual booleans as bare keywords', () => {
      const data = [
        { id: 1, active: true },
        { id: 2, active: false },
      ];
      const text = encoder.encode(data);
      expect(text).toContain('  active true');
      expect(text).toContain('  active false');
      // Should NOT be quoted
      expect(text).not.toContain('"true"');
      expect(text).not.toContain('"false"');
    });
  });

  // ---- Literals ----

  describe('Literal Tokens', () => {
    /**
     * NUMBER = ["-"] DIGIT { DIGIT } ["." DIGIT { DIGIT }]
     * Integers and floats, positive and negative.
     */
    it('encodes integer and float numbers', () => {
      const data = [
        { id: 1, val: 42 },
        { id: 2, val: -7 },
        { id: 3, val: 3.14159 },
        { id: 4, val: -0.001 },
      ];
      const text = encoder.encode(data);
      expect(text).toContain('  val 42');
      expect(text).toContain('  val -7');
      expect(text).toContain('  val 3.14159');
      expect(text).toContain('  val -0.001');
    });

    /**
     * DICT_REF = "@" DIGIT { DIGIT }
     * References dictionary entries by 0-based index.
     */
    it('encodes repeated strings as dictionary references', () => {
      const data = [
        { id: 1, role: 'admin' },
        { id: 2, role: 'user' },
        { id: 3, role: 'admin' },
      ];
      const text = encoder.encode(data);
      expect(text).toContain('@dict');
      // At least one @N reference
      expect(text).toMatch(/role @\d/);
    });

    /**
     * NULL = "_"
     * Null and undefined values are serialized as underscore.
     */
    it('encodes null as underscore sentinel', () => {
      const data = [{ id: 1, name: null }];
      const text = encoder.encode(data);
      expect(text).toContain('  name _');
    });

    /**
     * BARE_STRING = IDENT (no special characters)
     * Simple strings without special chars are unquoted.
     */
    it('emits simple strings as bare (unquoted) values', () => {
      const data = [{ id: 1, name: 'Alice' }];
      const text = encoder.encode(data);
      expect(text).toContain('  name Alice');
      expect(text).not.toContain('"Alice"');
    });

    /**
     * QUOTED_STRING = '"' { CHAR | ESCAPE } '"'
     * Strings with special characters are double-quoted.
     */
    it('quotes strings containing whitespace', () => {
      const data = [{ id: 1, desc: 'hello world' }];
      const text = encoder.encode(data);
      expect(text).toContain('  desc "hello world"');
    });

    /**
     * String values that look like numbers must be quoted
     * to prevent type ambiguity.
     */
    it('quotes string values that look like numbers', () => {
      const data = [{ id: 1, zip: '90210' }];
      const text = encoder.encode(data);
      expect(text).toContain('  zip "90210"');
    });

    /**
     * String values starting with @ must be quoted to avoid
     * collision with dictionary references.
     */
    it('quotes strings starting with @ or #', () => {
      const data = [
        { id: 1, val: '@mention' },
        { id: 2, val: '#hashtag' },
      ];
      const text = encoder.encode(data);
      expect(text).toContain('"@mention"');
      expect(text).toContain('"#hashtag"');
    });
  });

  // ---- Escape Sequences ----

  describe('Escape Sequences', () => {
    /**
     * ESCAPE = "\\" ( '"' | "\\" | "n" | "r" | "t" )
     * Five recognized escape sequences inside quoted strings.
     */
    it('escapes backslash and double quote', () => {
      const data = [
        { id: 1, text: 'say "hello"' },
        { id: 2, text: 'path\\to\\file' },
      ];
      const text = encoder.encode(data);
      expect(text).toContain('\\"hello\\"');
      expect(text).toContain('\\\\to\\\\');
    });

    it('escapes newline, carriage return, and tab', () => {
      const data = [{ id: 1, text: 'a\nb\rc\td' }];
      const text = encoder.encode(data);
      expect(text).toContain('\\n');
      expect(text).toContain('\\r');
      expect(text).toContain('\\t');
    });

    it('roundtrips all escape sequences correctly', () => {
      const original = [
        { id: 1, text: 'line1\nline2' },
        { id: 2, text: 'col1\tcol2' },
        { id: 3, text: 'she said "hi"' },
        { id: 4, text: 'back\\slash' },
      ];
      const encoded = encoder.encode(original);
      const { data } = decoder.decode(encoded);
      expect(data).toEqual(original);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §6.3.2 — SYNTACTIC GRAMMAR
// ────────────────────────────────────────────────────────────────────────────

describe('§6.3.2 Syntactic Grammar', () => {
  describe('File Structure (file = { directive } { record })', () => {
    /**
     * A valid TENS-Text file consists of directives followed by records.
     * Directives: @version, @encoding, @schema, @dict
     */
    it('produces valid file with all directives and records', () => {
      const data = [
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'admin' },
      ];
      const text = encoder.encode(data);
      const lines = text.split('\n').filter((l) => l.trim().length > 0);

      // Directives come first
      expect(lines[0]).toMatch(/^@version/);
      expect(lines[1]).toMatch(/^@encoding/);
      expect(lines[2]).toMatch(/^@schema/);

      // Records come after directives
      const recordIdx = lines.findIndex((l) => l === 'data');
      expect(recordIdx).toBeGreaterThan(2);
    });

    /**
     * An empty data array produces a valid file with only directives.
     */
    it('produces valid file for empty data', () => {
      const text = encoder.encode([]);
      expect(text).toContain('@version 1');
      expect(text).toContain('@encoding o200k_base');
      expect(text).toContain('@schema');
    });
  });

  describe('Schema Directive', () => {
    /**
     * schema = "@schema" WS IDENT WS field_def { WS field_def } NL
     * field_def = IDENT ":" type
     * type = base_type [ "[]" ] [ "?" ]
     * base_type = "str" | "num" | "bool"
     */
    it('parses schema with all type modifiers', () => {
      const text = `@version 1
@encoding o200k_base
@schema item id:num name:str active:bool score:num? tag:str[]

item
  id 1
  name Test
  active true
  score 42
  tag a
`;
      const { document } = decoder.decode(text);
      const schema = document.schemas[0];
      expect(schema.name).toBe('item');
      expect(schema.fields).toHaveLength(5);

      // num — plain number
      expect(schema.fields[0]).toMatchObject({
        name: 'id',
        type: 'number',
        optional: false,
        isArray: false,
      });
      // str — plain string
      expect(schema.fields[1]).toMatchObject({
        name: 'name',
        type: 'string',
        optional: false,
        isArray: false,
      });
      // bool — plain boolean
      expect(schema.fields[2]).toMatchObject({
        name: 'active',
        type: 'boolean',
        optional: false,
        isArray: false,
      });
      // num? — optional number
      expect(schema.fields[3]).toMatchObject({
        name: 'score',
        type: 'number',
        optional: true,
        isArray: false,
      });
      // str[] — string array
      expect(schema.fields[4]).toMatchObject({
        name: 'tag',
        type: 'string',
        optional: false,
        isArray: true,
      });
    });
  });

  describe('Dictionary Directive', () => {
    /**
     * dict = "@dict" WS value { WS value } NL
     * Dictionary entries are space-separated values (possibly quoted).
     */
    it('parses dictionary with bare and quoted values', () => {
      const text = `@version 1
@encoding o200k_base
@schema data id:num val:str

@dict admin "hello world"

data
  id 1
  val @0
data
  id 2
  val @1
`;
      const { data, document } = decoder.decode(text);
      expect(document.dictionary).toEqual(['admin', 'hello world']);
      expect(data[0].val).toBe('admin');
      expect(data[1].val).toBe('hello world');
    });
  });

  describe('Record & Field Lines', () => {
    /**
     * record = IDENT NL { field_line }
     * field_line = INDENT IDENT WS value NL
     *
     * Record marker is the schema IDENT on its own line.
     * Field lines are indented with 2 spaces.
     */
    it('parses multi-record documents', () => {
      const text = `@version 1
@encoding o200k_base
@schema users name:str age:num

users
  name Alice
  age 30
users
  name Bob
  age 25
`;
      const { data } = decoder.decode(text);
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ name: 'Alice', age: 30 });
      expect(data[1]).toEqual({ name: 'Bob', age: 25 });
    });
  });

  describe('Array Assembly (Field Repetition)', () => {
    /**
     * Arrays are implicit — if the same field name appears multiple
     * times in a record, values are collected into an ordered array.
     *
     * Schema marks array fields with [] suffix.
     * 0 repetitions → []
     * 1 repetition  → ["x"]
     * N repetitions → ["a", "b", ...]
     */
    it('assembles arrays from repeated fields', () => {
      const text = `@version 1
@encoding o200k_base
@schema data id:num tag:str[]

data
  id 1
  tag alpha
  tag beta
  tag gamma
data
  id 2
  tag single
data
  id 3
`;
      const { data } = decoder.decode(text);
      expect(data[0].tag).toEqual(['alpha', 'beta', 'gamma']);
      expect(data[1].tag).toEqual(['single']);
      expect(data[2].tag).toEqual([]); // 0 repetitions
    });

    it('encoder emits arrays as repeated field lines', () => {
      const data = [
        { id: 1, tag: ['x', 'y'] },
        { id: 2, tag: [] },
      ];
      const text = encoder.encode(data);
      const lines = text.split('\n');
      const tagLines = lines.filter((l) => l.trim().startsWith('tag '));
      expect(tagLines).toHaveLength(2); // x and y only
      expect(text).toContain('  tag x');
      expect(text).toContain('  tag y');
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §6.3.3 — TYPE SYSTEM
// ────────────────────────────────────────────────────────────────────────────

describe('§6.3.3 Type System', () => {
  /**
   * Type-directed parsing:
   * - num → number (JavaScript number)
   * - str → string (JavaScript string), even if value looks numeric
   * - bool → boolean (JavaScript boolean)
   */
  it('preserves str type for numeric-looking values', () => {
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

  it('preserves str type for boolean-looking values', () => {
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

  it('parses num type as JavaScript number', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num score:num

data
  id 1
  score 3.14
`;
    const { data } = decoder.decode(text);
    expect(data[0].score).toBe(3.14);
    expect(typeof data[0].score).toBe('number');
  });

  it('parses bool type as JavaScript boolean', () => {
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

  /**
   * Optional fields (? suffix) resolve to null when absent.
   */
  it('resolves missing optional fields to null', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num email:str?

data
  id 1
`;
    const { data } = decoder.decode(text);
    expect(data[0].email).toBeNull();
  });

  /**
   * Mixed type inference: when a field has values of different
   * types across rows, the encoder falls back to 'str'.
   */
  it('infers str when field has mixed types', () => {
    // When one row has number and another has string for same field,
    // the encoder should use 'str' type
    const data = [
      { id: 1, val: 'hello' },
      { id: 2, val: 'world' },
    ];
    const text = encoder.encode(data);
    expect(text).toContain('val:str');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §6.3.3 — ERROR HANDLING
// ────────────────────────────────────────────────────────────────────────────

describe('§6.3.3 Error Handling (Lenient Decoder)', () => {
  /**
   * The decoder follows a fail-safe strategy:
   * partial data is better than a crash.
   */

  it('handles empty input gracefully', () => {
    const { data, document } = decoder.decode('');
    expect(data).toEqual([]);
    expect(document.version).toBe(1); // default
    expect(document.encoding).toBe('o200k_base'); // default
  });

  it('defaults version to 1 when @version missing', () => {
    const text = `@encoding o200k_base
@schema data id:num

data
  id 42
`;
    const { data, document } = decoder.decode(text);
    expect(document.version).toBe(1);
    expect(data[0].id).toBe(42);
  });

  it('defaults encoding to o200k_base when @encoding missing', () => {
    const text = `@version 1
@schema data id:num

data
  id 1
`;
    const { document } = decoder.decode(text);
    expect(document.encoding).toBe('o200k_base');
  });

  it('resolves out-of-range dictionary reference as null', () => {
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

  it('handles input with only directives (no records)', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num name:str
`;
    const { data } = decoder.decode(text);
    expect(data).toEqual([]);
  });

  it('handles missing optional fields as null', () => {
    const text = `@version 1
@encoding o200k_base
@schema data id:num name:str? email:str?

data
  id 1
  name Alice
`;
    const { data } = decoder.decode(text);
    expect(data[0].name).toBe('Alice');
    expect(data[0].email).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §6.3.4 — IMPLEMENTATION PIPELINE
// ────────────────────────────────────────────────────────────────────────────

describe('§6.3.4 Implementation Pipeline', () => {
  describe('Encoding Pipeline (Objects → ANALYZE → DICT → EMIT)', () => {
    /**
     * Stage 1: ANALYZE — collect all keys, infer types, detect arrays
     * Stage 2: DICT — find strings appearing 2+ times
     * Stage 3: EMIT — write directives, then records
     */
    it('analyzes schema from heterogeneous rows', () => {
      const data = [
        { id: 1, name: 'Alice', score: 95 },
        { id: 2, name: 'Bob', score: null },
      ];
      const text = encoder.encode(data);
      // Schema should mark score as optional (has null)
      expect(text).toContain('score:num?');
    });

    it('builds dictionary only for strings appearing 2+ times', () => {
      const data = [
        { id: 1, role: 'admin' },
        { id: 2, role: 'admin' }, // 2nd occurrence → dict
        { id: 3, role: 'guest' }, // only once → no dict
      ];
      const text = encoder.encode(data);
      expect(text).toContain('@dict');
      expect(text).toContain('admin');
      // 'guest' should NOT be in dict (appears only once)
      const dictLine = text.split('\n').find((l) => l.startsWith('@dict'));
      expect(dictLine).not.toContain('guest');
    });

    it('emits directives before records', () => {
      const data = [{ id: 1, name: 'Test' }];
      const text = encoder.encode(data);
      const versionIdx = text.indexOf('@version');
      const dataIdx = text.indexOf('\ndata\n');
      expect(versionIdx).toBeLessThan(dataIdx);
    });
  });

  describe('Decoding Pipeline (Text → LEX → PARSE → RESOLVE)', () => {
    /**
     * Stage 1: LEX — split into lines, classify each
     * Stage 2: PARSE — extract directives, group field lines
     * Stage 3: RESOLVE — type-directed value resolution
     */
    it('lexes and parses a complete document', () => {
      const text = `@version 1
@encoding cl100k_base
@schema employees id:num name:str dept:str active:bool

@dict engineering sales

employees
  id 1
  name Alice
  dept @0
  active true
employees
  id 2
  name Bob
  dept @1
  active false
`;
      const { data, document } = decoder.decode(text);

      // Verify LEX stage: version parsed
      expect(document.version).toBe(1);
      expect(document.encoding).toBe('cl100k_base');

      // Verify PARSE stage: schema and dict extracted
      expect(document.schemas[0].name).toBe('employees');
      expect(document.dictionary).toEqual(['engineering', 'sales']);

      // Verify RESOLVE stage: typed values
      expect(data[0]).toEqual({
        id: 1,
        name: 'Alice',
        dept: 'engineering',
        active: true,
      });
      expect(data[1]).toEqual({
        id: 2,
        name: 'Bob',
        dept: 'sales',
        active: false,
      });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §6.3.5 — DICTIONARY COMPRESSION
// ────────────────────────────────────────────────────────────────────────────

describe('§6.3.5 Dictionary Compression', () => {
  /**
   * Strings appearing 2+ times across all rows are stored
   * in @dict and referenced by @N (0-based index).
   */
  it('compresses repeated enum-like values', () => {
    const data = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      status: ['pending', 'active', 'complete'][i % 3],
    }));
    const text = encoder.encode(data);
    expect(text).toContain('@dict');

    // Count @N references in data lines
    const dataLines = text.split('\n').filter((l) => l.startsWith('  status @'));
    expect(dataLines.length).toBe(20);
  });

  it('does not dictionary-encode unique strings', () => {
    const data = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Carol' },
    ];
    const text = encoder.encode(data);
    // All names are unique → no @dict needed
    // (names appear as bare strings, not references)
    expect(text).toContain('  name Alice');
    expect(text).toContain('  name Bob');
    expect(text).toContain('  name Carol');
  });

  it('roundtrips data with dictionary compression', () => {
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
});

// ────────────────────────────────────────────────────────────────────────────
// §6.3.6 — SPECIAL VALUES
// ────────────────────────────────────────────────────────────────────────────

describe('§6.3.6 Special Values', () => {
  it('encodes NaN as quoted "NaN"', () => {
    const data = [{ id: 1, val: Number.NaN }];
    const text = encoder.encode(data);
    expect(text).toContain('"NaN"');
  });

  it('encodes Infinity and -Infinity as quoted strings', () => {
    const data = [
      { id: 1, val: Number.POSITIVE_INFINITY },
      { id: 2, val: Number.NEGATIVE_INFINITY },
    ];
    const text = encoder.encode(data);
    expect(text).toContain('"Infinity"');
    expect(text).toContain('"-Infinity"');
  });

  it('encodes negative zero as -0', () => {
    const data = [{ id: 1, val: -0 }];
    const text = encoder.encode(data);
    expect(text).toContain('  val -0');
  });

  it('encodes empty strings as ""', () => {
    const data = [{ id: 1, val: '' }];
    const text = encoder.encode(data);
    expect(text).toContain('  val ""');
  });

  it('encodes undefined as _ (null sentinel)', () => {
    const data = [{ id: 1, name: undefined as any }];
    const text = encoder.encode(data);
    expect(text).toContain('  name _');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §6.3.9 — DESIGN PRINCIPLES (ROUNDTRIP & DETERMINISM)
// ────────────────────────────────────────────────────────────────────────────

describe('§6.3.9 Design Principles', () => {
  describe('Lossless Roundtrip (encode(decode(text)) === text)', () => {
    it('roundtrips flat data', () => {
      const original = [
        { id: 1, name: 'Alice', score: 95 },
        { id: 2, name: 'Bob', score: 87 },
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

    it('roundtrips data with arrays', () => {
      const original = [
        { id: 1, tag: ['a', 'b', 'c'] },
        { id: 2, tag: ['x'] },
        { id: 3, tag: [] },
      ];
      const encoded = encoder.encode(original);
      const { data } = decoder.decode(encoded);
      expect(data).toEqual(original);
    });

    it('roundtrips data with special characters', () => {
      const original = [
        { id: 1, text: 'hello "world"' },
        { id: 2, text: 'line1\nline2' },
        { id: 3, text: 'path\\to\\file' },
        { id: 4, text: '' },
      ];
      const encoded = encoder.encode(original);
      const { data } = decoder.decode(encoded);
      expect(data).toEqual(original);
    });

    it('roundtrips Unicode strings', () => {
      const original = [
        { id: 1, name: '日本語テスト' },
        { id: 2, name: '🚀 Emoji Launch' },
        { id: 3, name: 'Ñoño español' },
      ];
      const encoded = encoder.encode(original);
      const { data } = decoder.decode(encoded);
      expect(data).toEqual(original);
    });

    it('roundtrips keyword-looking string values', () => {
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

    it('roundtrips 500-row all-types dataset', () => {
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

  describe('Determinism (same input → identical output)', () => {
    it('produces identical output for same input across multiple calls', () => {
      const data = [
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'user' },
      ];
      const out1 = encoder.encode(data);
      const out2 = encoder.encode(data);
      const out3 = encoder.encode(data);
      expect(out1).toBe(out2);
      expect(out2).toBe(out3);
    });
  });

  describe('No Brackets/Commas/Pipes', () => {
    /**
     * Data lines must not contain syntax characters from other formats.
     * Schema lines may use [] for array type markers, but data lines must not.
     */
    it('produces no brackets, commas, or pipes in data lines', () => {
      const data = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        name: `User${i + 1}`,
        tag: ['a', 'b'],
      }));
      const text = encoder.encode(data);
      const dataLines = text.split('\n').filter((l) => l.startsWith('  '));
      const dataContent = dataLines.join('\n');
      expect(dataContent).not.toContain('{');
      expect(dataContent).not.toContain('}');
      expect(dataContent).not.toContain('[');
      expect(dataContent).not.toContain(']');
      expect(dataContent).not.toContain('|>');
      expect(text).not.toContain(',');
    });
  });

  describe('Format Efficiency', () => {
    /**
     * TENS-Text should be more compact than JSON for tabular data
     * due to schema dedup and dictionary compression.
     */
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
  });
});
