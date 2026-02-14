import { describe, expect, it } from 'vitest';
import { TensTextDecoder, TensTextEncoder } from '../tens_text.js';

// ============================================================================
// TENS-Text Performance Regression Tests
// ============================================================================
//
// These tests set hard performance ceilings. If encoding or decoding gets
// slower, these tests FAIL — preventing performance regressions from shipping.
//
// Thresholds are generous (10x headroom) to avoid flaky CI failures while
// still catching catastrophic regressions (e.g. O(n²) → O(n³) bugs).
//
// ============================================================================

const encoder = new TensTextEncoder('o200k_base');
const decoder = new TensTextDecoder();

// ────────────────────────────────────────────────────────────────────────────
// Test data generators
// ────────────────────────────────────────────────────────────────────────────

function makeTickets(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `Ticket ${i + 1}: ${['Bug', 'Feature', 'Task', 'Epic', 'Story'][i % 5]} report`,
    status: ['open', 'in_progress', 'resolved', 'closed'][i % 4],
    priority: ['low', 'medium', 'high', 'critical'][i % 4],
    assignee: i % 3 === 0 ? null : `user_${(i % 10) + 1}`,
    tag: i % 2 === 0 ? ['backend', 'api'] : ['frontend'],
    score: (i * 7.3) % 100,
    active: i % 2 === 0,
  }));
}

function makeHighCardinality(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    uuid: `uuid-${i}-${Math.random().toString(36).substring(7)}`,
    email: `user${i}@domain${i % 1000}.com`,
    value: Math.random() * 1000,
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Encoding Performance
// ────────────────────────────────────────────────────────────────────────────

describe('Performance: Encoding', () => {
  it('encodes 100 rows in < 20ms', () => {
    const data = makeTickets(100);
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      encoder.encode(data);
    }
    const elapsed = (performance.now() - start) / 10;
    expect(elapsed).toBeLessThan(20);
  });

  it('encodes 1,000 rows in < 100ms', () => {
    const data = makeTickets(1000);
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      encoder.encode(data);
    }
    const elapsed = (performance.now() - start) / 5;
    expect(elapsed).toBeLessThan(100);
  });

  it('encodes 5,000 rows in < 500ms', () => {
    const data = makeTickets(5000);
    const start = performance.now();
    encoder.encode(data);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('encodes 10,000 rows in < 1000ms', () => {
    const data = makeTickets(10000);
    const start = performance.now();
    encoder.encode(data);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Decoding Performance
// ────────────────────────────────────────────────────────────────────────────

describe('Performance: Decoding', () => {
  it('decodes 100 rows in < 10ms', () => {
    const text = encoder.encode(makeTickets(100));
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      decoder.decode(text);
    }
    const elapsed = (performance.now() - start) / 10;
    expect(elapsed).toBeLessThan(10);
  });

  it('decodes 1,000 rows in < 50ms', () => {
    const text = encoder.encode(makeTickets(1000));
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      decoder.decode(text);
    }
    const elapsed = (performance.now() - start) / 5;
    expect(elapsed).toBeLessThan(50);
  });

  it('decodes 5,000 rows in < 300ms', () => {
    const text = encoder.encode(makeTickets(5000));
    const start = performance.now();
    decoder.decode(text);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(300);
  });

  it('decodes 10,000 rows in < 600ms', () => {
    const text = encoder.encode(makeTickets(10000));
    const start = performance.now();
    decoder.decode(text);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(600);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Dictionary Build Performance
// ────────────────────────────────────────────────────────────────────────────

describe('Performance: Dictionary Building', () => {
  it('builds dictionary for 1,000 rows with low cardinality in < 50ms', () => {
    const data = makeTickets(1000); // 4 statuses, 4 priorities = low cardinality
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      encoder.encode(data);
    }
    const elapsed = (performance.now() - start) / 5;
    expect(elapsed).toBeLessThan(50);
  });

  it('builds dictionary for 1,000 rows with high cardinality in < 100ms', () => {
    const data = makeHighCardinality(1000); // unique UUIDs/emails
    const start = performance.now();
    for (let i = 0; i < 3; i++) {
      encoder.encode(data);
    }
    const elapsed = (performance.now() - start) / 3;
    expect(elapsed).toBeLessThan(100);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Roundtrip Performance
// ────────────────────────────────────────────────────────────────────────────

describe('Performance: Full Roundtrip', () => {
  it('roundtrips 1,000 rows in < 100ms', () => {
    const data = makeTickets(1000);
    const start = performance.now();
    for (let i = 0; i < 3; i++) {
      const text = encoder.encode(data);
      decoder.decode(text);
    }
    const elapsed = (performance.now() - start) / 3;
    expect(elapsed).toBeLessThan(100);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Size Regression
// ────────────────────────────────────────────────────────────────────────────

describe('Performance: Size Regression', () => {
  it('TENS-Text is smaller than JSON for 50+ row datasets', () => {
    const sizes = [50, 100, 500, 1000];
    for (const n of sizes) {
      const data = makeTickets(n);
      const tensText = encoder.encode(data);
      const json = JSON.stringify(data);
      expect(tensText.length).toBeLessThan(json.length);
    }
  });

  it('dictionary compression ratio improves with more rows', () => {
    const sizes = [10, 50, 100, 500];
    const ratios: number[] = [];

    for (const n of sizes) {
      const data = makeTickets(n);
      const tensText = encoder.encode(data);
      const json = JSON.stringify(data);
      ratios.push(tensText.length / json.length);
    }

    // Each ratio should be <= previous (or very close)
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeLessThanOrEqual(ratios[i - 1] + 0.02); // 2% tolerance
    }
  });

  it('output size scales linearly with row count', () => {
    const data100 = encoder.encode(makeTickets(100));
    const data1000 = encoder.encode(makeTickets(1000));

    // 10x rows should produce roughly 10x output (±30% for header amortization)
    const ratio = data1000.length / data100.length;
    expect(ratio).toBeGreaterThan(7); // at least 7x
    expect(ratio).toBeLessThan(13); // at most 13x
  });
});
