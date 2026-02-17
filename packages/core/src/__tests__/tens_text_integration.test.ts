import { describe, expect, it } from 'vitest';
import { analyzeFormats, formatOutput } from '../formatters.js';
import { TensTextDecoder, TensTextEncoder } from '../tens_text.js';

// ============================================================================
// TENS-Text Integration Tests
// ============================================================================
//
// End-to-end tests verifying TENS-Text works through the public API surface,
// with real-world data patterns, and across the full pipeline.
//
// ============================================================================

const encoder = new TensTextEncoder('o200k_base');
const decoder = new TensTextDecoder();

// ────────────────────────────────────────────────────────────────────────────
// Public API Integration
// ────────────────────────────────────────────────────────────────────────────

describe('Integration: Public API Surface', () => {
  it('formatOutput("tens-text") produces valid TENS-Text', () => {
    const data = [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
    ];
    const output = formatOutput(data, 'tens-text');

    // Should be valid TENS-Text
    expect(output).toContain('@version');
    expect(output).toContain('@encoding');
    expect(output).toContain('@schema');
    expect(output).toContain('data\n');

    // Should be decodable
    const { data: decoded } = decoder.decode(output);
    expect(decoded).toEqual(data);
  });

  it('analyzeFormats includes tens-text with correct metrics', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `User${i + 1}`,
      role: i % 3 === 0 ? 'admin' : 'user',
    }));
    const analyses = analyzeFormats(data);

    const tensText = analyses.find((a) => a.format === 'tens-text');
    expect(tensText).toBeDefined();
    expect(tensText?.byteSize).toBeGreaterThan(0);
    expect(tensText?.output).toContain('@version');

    // TENS-Text should be smaller than JSON for tabular data
    const json = analyses.find((a) => a.format === 'json');
    expect(json).toBeDefined();
    expect(tensText?.byteSize).toBeLessThan(json?.byteSize ?? Number.POSITIVE_INFINITY);
  });

  it('encoder accepts custom schema names', () => {
    const data = [{ id: 1, name: 'Alice' }];
    const text = encoder.encode(data, 'employee');
    expect(text).toContain('@schema employee');
    expect(text).toContain('\nemployee\n');
  });

  it('decode returns document metadata alongside data', () => {
    const data = [{ id: 1, name: 'Alice' }];
    const text = encoder.encode(data);
    const result = decoder.decode(text);

    expect(result.data).toBeDefined();
    expect(result.document).toBeDefined();
    expect(result.document.version).toBe(1);
    expect(result.document.encoding).toBe('o200k_base');
    expect(result.document.schemas.length).toBeGreaterThanOrEqual(1);
    expect(result.document.schemas[0].name).toBe('data');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Real-World Data Patterns
// ────────────────────────────────────────────────────────────────────────────

describe('Integration: Real-World Data Patterns', () => {
  it('support tickets (typical production dataset)', () => {
    const tickets = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1001,
      title: `Ticket #${i + 1001}: ${['Bug in auth', 'UI polish', 'Performance issue', 'Feature request', 'Security audit'][i % 5]}`,
      status: ['open', 'in_progress', 'resolved', 'closed'][i % 4],
      priority: ['low', 'medium', 'high', 'critical'][i % 4],
      assignee: i % 3 === 0 ? null : `user_${(i % 10) + 1}`,
      tag: i % 2 === 0 ? ['backend', 'api'] : ['frontend'],
      createdAt: `2025-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
    }));

    const text = encoder.encode(tickets, 'ticket');
    expect(text).toContain('@schema ticket');
    expect(text).toContain('@dict'); // repeated statuses/priorities

    const { data } = decoder.decode(text);
    expect(data).toEqual(tickets);
  });

  it('e-commerce products with URLs and descriptions', () => {
    const products = Array.from({ length: 100 }, (_, i) => ({
      sku: `SKU-${String(i + 1).padStart(6, '0')}`,
      name: `Product ${i + 1}`,
      price: Number.parseFloat((9.99 + i * 2.5).toFixed(2)),
      currency: 'USD',
      inStock: i % 5 !== 0,
      description: `This is product ${i + 1}. It has "features" & benefits.\nMultiple lines supported.`,
      url: `https://shop.example.com/products/${i + 1}?ref=catalog&sort=price`,
    }));

    const text = encoder.encode(products, 'product');
    const { data } = decoder.decode(text);
    expect(data).toEqual(products);
  });

  it('user profiles with nested-looking strings', () => {
    const users = [
      {
        id: 1,
        name: "Alice O'Brien",
        bio: 'Engineer @ Contex. "Building the future"',
        prefs: '{"theme":"dark","lang":"en"}',
      },
      {
        id: 2,
        name: 'Bob [Admin]',
        bio: 'Manager | Team Lead',
        prefs: '{"theme":"light","lang":"fr"}',
      },
      { id: 3, name: 'Carol, Jr.', bio: 'Analyst @ Contex', prefs: null },
    ];

    const text = encoder.encode(users, 'user');
    const { data } = decoder.decode(text);
    expect(data).toEqual(users);
  });

  it('analytics events with high cardinality IDs', () => {
    const events = Array.from({ length: 500 }, (_, i) => ({
      eventId: `evt_${Date.now()}_${i}`,
      type: ['page_view', 'click', 'scroll', 'submit', 'error'][i % 5],
      userId: `usr_${(i % 50) + 1}`,
      timestamp: i * 1000,
      metadata: i % 10 === 0 ? null : `session_${i % 100}`,
    }));

    const text = encoder.encode(events, 'event');
    const { data } = decoder.decode(text);
    expect(data).toEqual(events);
  });

  it('sparse configuration matrix (mostly nulls)', () => {
    const configs = Array.from({ length: 100 }, (_, i) => ({
      key: `config_${i}`,
      stringVal: i % 3 === 0 ? `value_${i}` : null,
      numVal: i % 4 === 0 ? i * 10 : null,
      boolVal: i % 5 === 0 ? i % 2 === 0 : null,
    }));

    const text = encoder.encode(configs, 'config');
    const { data } = decoder.decode(text);
    expect(data).toEqual(configs);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Cross-Encoding Verification
// ────────────────────────────────────────────────────────────────────────────

describe('Integration: Cross-Encoding', () => {
  it('o200k_base encoder output is decodable', () => {
    const enc = new TensTextEncoder('o200k_base');
    const data = [{ id: 1, val: 'test' }];
    const text = enc.encode(data);
    expect(text).toContain('@encoding o200k_base');

    const { data: decoded } = decoder.decode(text);
    expect(decoded).toEqual(data);
  });

  it('cl100k_base encoder output is decodable', () => {
    const enc = new TensTextEncoder('cl100k_base');
    const data = [{ id: 1, val: 'test' }];
    const text = enc.encode(data);
    expect(text).toContain('@encoding cl100k_base');

    const { data: decoded, document } = decoder.decode(text);
    expect(decoded).toEqual(data);
    expect(document.encoding).toBe('cl100k_base');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// File I/O Simulation
// ────────────────────────────────────────────────────────────────────────────

describe('Integration: File I/O Workflow', () => {
  it('encode → string → Buffer → string → decode (simulates file write/read)', () => {
    const data = [
      { id: 1, name: 'Alice', role: 'admin', active: true },
      { id: 2, name: 'Bob', role: 'user', active: false },
    ];

    // Encode
    const text = encoder.encode(data);

    // Simulate file write/read (via Buffer)
    const buffer = Buffer.from(text, 'utf-8');
    const readBack = buffer.toString('utf-8');

    // Decode
    const { data: decoded } = decoder.decode(readBack);
    expect(decoded).toEqual(data);
  });

  it('handles CRLF line endings (Windows-style)', () => {
    const data = [{ id: 1, name: 'Alice' }];
    const text = encoder.encode(data);

    // Convert to CRLF
    const crlfText = text.replace(/\n/g, '\r\n');

    const { data: decoded } = decoder.decode(crlfText);
    expect(decoded).toEqual(data);
  });

  it('handles trailing newline variations', () => {
    const data = [{ id: 1, name: 'Alice' }];
    const text = encoder.encode(data);

    // No trailing newline
    const noTrailing = text.trimEnd();
    const { data: d1 } = decoder.decode(noTrailing);
    expect(d1).toEqual(data);

    // Multiple trailing newlines
    const multiTrailing = `${text}\n\n\n`;
    const { data: d2 } = decoder.decode(multiTrailing);
    expect(d2).toEqual(data);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Multiple Schema Support (future-proofing)
// ────────────────────────────────────────────────────────────────────────────

describe('Integration: Hand-Crafted Multi-Schema (future-proof)', () => {
  it('decodes hand-crafted file with multiple schemas', () => {
    const text = `@version 1
@encoding o200k_base
@schema user id:num name:str
@schema post id:num title:str authorId:num

user
  id 1
  name Alice
user
  id 2
  name Bob
post
  id 101
  title "Hello World"
  authorId 1
post
  id 102
  title "Second Post"
  authorId 2
`;

    const { data, document } = decoder.decode(text);
    expect(document.schemas).toHaveLength(2);
    expect(document.schemas[0].name).toBe('user');
    expect(document.schemas[1].name).toBe('post');

    // Verify data was decoded
    expect(data.length).toBe(4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Size Efficiency Verification
// ────────────────────────────────────────────────────────────────────────────

describe('Integration: Size Efficiency', () => {
  it('TENS-Text smaller than JSON for ≥50 rows of tabular data', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `User${i + 1}`,
      role: i % 3 === 0 ? 'admin' : 'user',
      active: i % 2 === 0,
      score: (i * 17) % 100,
    }));

    const tensText = encoder.encode(data);
    const json = JSON.stringify(data);

    expect(tensText.length).toBeLessThan(json.length);
  });

  it('dictionary compression grows savings with more rows', () => {
    const makeData = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        status: ['open', 'closed', 'pending'][i % 3],
        region: ['us', 'eu', 'ap'][i % 3],
      }));

    const small = encoder.encode(makeData(10));
    const large = encoder.encode(makeData(100));

    // Bytes per row should decrease with more rows (amortized schema + dict)
    const smallBpr = small.length / 10;
    const largeBpr = large.length / 100;
    expect(largeBpr).toBeLessThan(smallBpr);
  });
});
