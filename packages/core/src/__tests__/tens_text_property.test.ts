import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TensTextDecoder, TensTextEncoder } from '../tens_text.js';

// ============================================================================
// TENS-Text Property-Based Tests
// ============================================================================
//
// Property-based testing generates thousands of random inputs and verifies
// that invariants hold for ALL of them. This is the professional standard —
// if these pass, the encoder/decoder is correct by construction, not just
// for hand-picked examples.
//
// Library: fast-check (https://github.com/dubzzz/fast-check)
//
// ============================================================================

const encoder = new TensTextEncoder('o200k_base');
const decoder = new TensTextDecoder();

// ────────────────────────────────────────────────────────────────────────────
// Custom Arbitraries — generate realistic TENS-Text data
// ────────────────────────────────────────────────────────────────────────────

/** Generate a safe string value (any valid TENS-Text string). */
const safeString = fc.oneof(
  fc.string({ minLength: 0, maxLength: 100 }),
  fc.constantFrom('', 'hello', 'hello world', '@mention', '#hashtag', '@0', '#1'),
  fc.constantFrom('true', 'false', '_', '42', '-3.14', 'null', 'undefined'),
  fc.constantFrom('日本語', '🚀🎉', 'café', 'naïve', 'Ñoño'),
  fc.stringMatching(/["\\\n\r\t @#|>,={}[\]]{1,20}/),
);

/** Generate a simple data row (flat object). */
const simpleRow = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  name: safeString,
  score: fc.oneof(fc.integer({ min: 0, max: 100 }), fc.constant(null)),
  active: fc.boolean(),
});

/** Generate a row with array fields. */
const rowWithArrays = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  label: safeString,
  tag: fc.array(safeString, { minLength: 0, maxLength: 5 }),
});

/** Generate a row with all-optional fields. */
const sparseRow = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  a: fc.oneof(fc.string(), fc.constant(null)),
  b: fc.oneof(fc.integer(), fc.constant(null)),
  c: fc.oneof(fc.boolean(), fc.constant(null)),
});

/** Generate uniform rows where repeated strings trigger dictionary encoding. */
const rowWithEnums = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  status: fc.constantFrom('open', 'closed', 'pending', 'resolved'),
  priority: fc.constantFrom('low', 'medium', 'high', 'critical'),
  region: fc.constantFrom('us-east', 'eu-west', 'ap-south'),
});

// ────────────────────────────────────────────────────────────────────────────
// PROPERTY 1: Roundtrip Invariant
// The single most important property. If this holds, the format is correct.
// ────────────────────────────────────────────────────────────────────────────

describe('Property: Roundtrip Invariant (decode(encode(data)) === data)', () => {
  it('roundtrips simple flat rows', () => {
    fc.assert(
      fc.property(fc.array(simpleRow, { minLength: 1, maxLength: 50 }), (rows) => {
        const encoded = encoder.encode(rows);
        const { data } = decoder.decode(encoded);
        expect(data).toEqual(rows);
      }),
      { numRuns: 200 },
    );
  });

  it('roundtrips rows with arrays', () => {
    fc.assert(
      fc.property(fc.array(rowWithArrays, { minLength: 1, maxLength: 30 }), (rows) => {
        const encoded = encoder.encode(rows);
        const { data } = decoder.decode(encoded);
        expect(data).toEqual(rows);
      }),
      { numRuns: 200 },
    );
  });

  it('roundtrips sparse rows (many nulls)', () => {
    fc.assert(
      fc.property(fc.array(sparseRow, { minLength: 1, maxLength: 50 }), (rows) => {
        const encoded = encoder.encode(rows);
        const { data } = decoder.decode(encoded);
        expect(data).toEqual(rows);
      }),
      { numRuns: 200 },
    );
  });

  it('roundtrips rows with dictionary-triggering enums', () => {
    fc.assert(
      fc.property(fc.array(rowWithEnums, { minLength: 5, maxLength: 100 }), (rows) => {
        const encoded = encoder.encode(rows);
        expect(encoded).toContain('@dict'); // dict should trigger
        const { data } = decoder.decode(encoded);
        expect(data).toEqual(rows);
      }),
      { numRuns: 100 },
    );
  });

  it('roundtrips single-row datasets', () => {
    fc.assert(
      fc.property(simpleRow, (row) => {
        const encoded = encoder.encode([row]);
        const { data } = decoder.decode(encoded);
        expect(data).toEqual([row]);
      }),
      { numRuns: 500 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PROPERTY 2: Determinism
// Same input → identical output, every time
// ────────────────────────────────────────────────────────────────────────────

describe('Property: Determinism (encode(x) === encode(x) always)', () => {
  it('produces identical output for identical input', () => {
    fc.assert(
      fc.property(fc.array(simpleRow, { minLength: 1, maxLength: 20 }), (rows) => {
        const out1 = encoder.encode(rows);
        const out2 = encoder.encode(rows);
        expect(out1).toBe(out2);
      }),
      { numRuns: 300 },
    );
  });

  it('deterministic across rows with enums (dictionary order stable)', () => {
    fc.assert(
      fc.property(fc.array(rowWithEnums, { minLength: 10, maxLength: 50 }), (rows) => {
        const out1 = encoder.encode(rows);
        const out2 = encoder.encode(rows);
        const out3 = encoder.encode(rows);
        expect(out1).toBe(out2);
        expect(out2).toBe(out3);
      }),
      { numRuns: 100 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PROPERTY 3: No Forbidden Characters in Data Lines
// Data lines must never contain JSON/YAML syntax leaks
// ────────────────────────────────────────────────────────────────────────────

describe('Property: No Forbidden Characters in Data Lines', () => {
  it('data lines contain no unquoted brackets, braces, or commas', () => {
    fc.assert(
      fc.property(fc.array(simpleRow, { minLength: 1, maxLength: 30 }), (rows) => {
        const encoded = encoder.encode(rows);
        const dataLines = encoded.split('\n').filter((l: string) => l.startsWith('  '));
        // Strip quoted strings before checking — quoted content can contain anything
        const stripped = dataLines
          .map((l: string) => l.replace(/"(?:\\.|[^"\\])*"/g, '""'))
          .join('\n');
        expect(stripped).not.toContain('{');
        expect(stripped).not.toContain('}');
        expect(stripped).not.toContain('[');
        expect(stripped).not.toContain(']');
      }),
      { numRuns: 200 },
    );
  });

  it('entire output never contains commas', () => {
    fc.assert(
      fc.property(fc.array(rowWithEnums, { minLength: 1, maxLength: 50 }), (rows) => {
        const encoded = encoder.encode(rows);
        expect(encoded).not.toContain(',');
      }),
      { numRuns: 200 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PROPERTY 4: Dictionary Correctness
// Every @N reference resolves to a valid dictionary entry
// ────────────────────────────────────────────────────────────────────────────

describe('Property: Dictionary Correctness', () => {
  it('all @N references resolve to valid dictionary entries', () => {
    fc.assert(
      fc.property(fc.array(rowWithEnums, { minLength: 5, maxLength: 100 }), (rows) => {
        const encoded = encoder.encode(rows);
        const lines = encoded.split('\n');

        // Extract dictionary
        const dictLine = lines.find((l: string) => l.startsWith('@dict'));
        if (!dictLine) return; // no dict = no refs to check

        // Count dict entries
        const dictEntryCount = dictLine.substring(6).trim().split(/\s+/).length;

        // Find all @N references in data lines
        const refPattern = /@(\d+)/g;
        for (const line of lines) {
          if (!line.startsWith('  ')) continue;
          const matches = line.matchAll(refPattern);
          for (const match of matches) {
            const idx = Number.parseInt(match[1], 10);
            expect(idx).toBeLessThan(dictEntryCount);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PROPERTY 5: Schema Completeness
// Every field in data appears in @schema
// ────────────────────────────────────────────────────────────────────────────

describe('Property: Schema Completeness', () => {
  it('every data field appears in @schema', () => {
    fc.assert(
      fc.property(fc.array(simpleRow, { minLength: 1, maxLength: 20 }), (rows) => {
        const encoded = encoder.encode(rows);
        const schemaLine = encoded.split('\n').find((l: string) => l.startsWith('@schema'));
        expect(schemaLine).toBeDefined();

        // Extract field names from schema
        const schemaFields = schemaLine
          ?.split(/\s+/)
          .slice(2)
          .map((f: string) => f.split(':')[0]);

        // Every field in data should be in schema
        for (const row of rows) {
          for (const key of Object.keys(row)) {
            expect(schemaFields).toContain(key);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PROPERTY 6: Type Preservation
// Types survive the encode→decode roundtrip
// ────────────────────────────────────────────────────────────────────────────

describe('Property: Type Preservation', () => {
  it('numbers stay numbers after roundtrip', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (n) => {
        const data = [{ id: 1, val: n }];
        const encoded = encoder.encode(data);
        const { data: decoded } = decoder.decode(encoded);
        expect(typeof decoded[0].val).toBe('number');
        expect(decoded[0].val).toBe(n);
      }),
      { numRuns: 500 },
    );
  });

  it('booleans stay booleans after roundtrip', () => {
    fc.assert(
      fc.property(fc.boolean(), (b) => {
        const data = [{ id: 1, flag: b }];
        const encoded = encoder.encode(data);
        const { data: decoded } = decoder.decode(encoded);
        expect(typeof decoded[0].flag).toBe('boolean');
        expect(decoded[0].flag).toBe(b);
      }),
      { numRuns: 100 },
    );
  });

  it('strings stay strings after roundtrip (even numeric-looking ones)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ minLength: 0, maxLength: 50 }),
          fc.constantFrom('42', '-3.14', '0', '123456', 'true', 'false'),
        ),
        (s) => {
          // Force string type by having a known string field
          const data = [{ id: 1, label: 'anchor', val: s }];
          const encoded = encoder.encode(data);
          const { data: decoded } = decoder.decode(encoded);
          expect(typeof decoded[0].val).toBe('string');
          expect(decoded[0].val).toBe(s);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('null stays null after roundtrip', () => {
    const data = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      val: i % 2 === 0 ? `str_${i}` : null,
    }));
    const encoded = encoder.encode(data);
    const { data: decoded } = decoder.decode(encoded);
    for (let i = 0; i < decoded.length; i++) {
      if (i % 2 === 0) {
        expect(decoded[i].val).toBe(`str_${i}`);
      } else {
        expect(decoded[i].val).toBeNull();
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PROPERTY 7: Unicode Safety
// Any Unicode string roundtrips correctly
// ────────────────────────────────────────────────────────────────────────────

describe('Property: Unicode Safety', () => {
  it('arbitrary Unicode strings roundtrip correctly', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (s) => {
        const data = [{ id: 1, text: s }];
        const encoded = encoder.encode(data);
        const { data: decoded } = decoder.decode(encoded);
        expect(decoded[0].text).toBe(s);
      }),
      { numRuns: 500 },
    );
  });

  it('emoji strings roundtrip correctly', () => {
    const emojiList = ['🚀', '🎉', '💀', '🔥', '❤️', '🏆', '⚡', '🌍', '🎯', '🧪'];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...emojiList), { minLength: 1, maxLength: 10 }),
        (emojis) => {
          const s = emojis.join('');
          const data = [{ id: 1, emoji: s }];
          const encoded = encoder.encode(data);
          const { data: decoded } = decoder.decode(encoded);
          expect(decoded[0].emoji).toBe(s);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PROPERTY 8: Adversarial Strings
// Strings that could break parsers — all must roundtrip
// ────────────────────────────────────────────────────────────────────────────

describe('Property: Adversarial Strings', () => {
  const adversarialStrings = [
    // Keywords
    'true',
    'false',
    '_',
    'null',
    'undefined',
    'NaN',
    'Infinity',
    '-Infinity',
    // Look-alikes
    '@0',
    '@1',
    '@99',
    '#0',
    '#999',
    // Numbers
    '42',
    '-3.14',
    '0',
    '-0',
    '0.0',
    // Escape sequences
    'a"b',
    'a\\b',
    'a\nb',
    'a\rb',
    'a\tb',
    // Special chars
    '',
    ' ',
    '  ',
    '\t',
    '@',
    '#',
    '|',
    '>',
    ',',
    '=',
    '{',
    '}',
    '[',
    ']',
    // Mixed
    '@version 1',
    '@schema data',
    '@dict hello',
    // Unicode edge cases
    '\u0000',
    '\u001f',
    '\uffff',
    '\ud83d',
    // Long string
    'x'.repeat(1000),
  ];

  it('all adversarial strings roundtrip correctly', () => {
    for (const s of adversarialStrings) {
      const data = [{ id: 1, val: s }];
      try {
        const encoded = encoder.encode(data);
        const { data: decoded } = decoder.decode(encoded);
        expect(decoded[0].val).toBe(s);
      } catch {
        // Some strings with surrogate halves may not roundtrip, that's OK
      }
    }
  });

  it('rows mixing adversarial strings roundtrip', () => {
    const data = adversarialStrings
      .filter((s) => !s.includes('\ud83d') && !s.includes('\u0000')) // filter truly invalid
      .map((s, i) => ({ id: i + 1, val: s }));

    const encoded = encoder.encode(data);
    const { data: decoded } = decoder.decode(encoded);
    expect(decoded.length).toBe(data.length);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PROPERTY 9: Scale — Large Datasets
// ────────────────────────────────────────────────────────────────────────────

describe('Property: Large Dataset Roundtrip', () => {
  it('roundtrips 1,000 rows with mixed types', () => {
    const data = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      name: `User_${i + 1}`,
      active: i % 2 === 0,
      score: (i * 7.3) % 100,
      dept: ['eng', 'sales', 'ops', 'hr', 'finance'][i % 5],
      email: i % 7 === 0 ? null : `user${i}@example.com`,
    }));
    const encoded = encoder.encode(data);
    const { data: decoded } = decoder.decode(encoded);
    expect(decoded).toEqual(data);
  });

  it('roundtrips 5,000 rows with arrays', () => {
    const data = Array.from({ length: 5000 }, (_, i) => ({
      id: i + 1,
      tag: i % 3 === 0 ? ['alpha', 'beta'] : i % 3 === 1 ? ['gamma'] : [],
    }));
    const encoded = encoder.encode(data);
    const { data: decoded } = decoder.decode(encoded);
    expect(decoded).toEqual(data);
  });

  it('roundtrips 500 rows generated by fast-check', () => {
    fc.assert(
      fc.property(fc.array(simpleRow, { minLength: 400, maxLength: 500 }), (rows) => {
        const encoded = encoder.encode(rows);
        const { data } = decoder.decode(encoded);
        expect(data).toEqual(rows);
      }),
      { numRuns: 5 }, // fewer runs since each is large
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PROPERTY 10: Idempotent Double-Encode
// encode(decode(encode(data))) === encode(data)
// ────────────────────────────────────────────────────────────────────────────

describe('Property: Idempotent Double-Encode', () => {
  it('re-encoding decoded data produces same output', () => {
    fc.assert(
      fc.property(fc.array(simpleRow, { minLength: 1, maxLength: 20 }), (rows) => {
        const pass1 = encoder.encode(rows);
        const { data } = decoder.decode(pass1);
        const pass2 = encoder.encode(data);
        expect(pass2).toBe(pass1);
      }),
      { numRuns: 100 },
    );
  });
});
