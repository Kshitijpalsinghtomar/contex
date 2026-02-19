// ============================================================================
// Protocol Test Vectors — TENS v2 Binary Encoding Conformance
// ============================================================================
//
// These tests verify byte-for-byte determinism of the TENS v2 binary encoder.
// The vectors are shared with the Rust WASM encoder to guarantee cross-language
// parity (M3 milestone requirement).
//
// Each vector pins: input → exact hex bytes → SHA-256 hash.
// Any change = protocol-breaking change that must bump the TENS version.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { TensEncoder } from '../encoder.js';
import vectors from './fixtures/protocol-vectors.json';

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('TENS v2 Protocol Test Vectors', () => {
  const encoder = new TensEncoder();

  describe('Binary encoding byte-for-byte', () => {
    for (const vec of vectors) {
      it(`[${vec.name}] produces exact expected bytes`, () => {
        const bytes = encoder.encode(vec.input);
        const hex = toHex(bytes);
        expect(hex).toBe(vec.expected_hex);
        expect(bytes.length).toBe(vec.byte_length);
      });
    }
  });

  describe('SHA-256 hash stability', () => {
    for (const vec of vectors) {
      it(`[${vec.name}] hash matches`, () => {
        const bytes = encoder.encode(vec.input);
        const hash = sha256Hex(bytes);
        expect(hash).toBe(vec.expected_hash);
      });
    }
  });

  describe('Binary header structure', () => {
    it('all vectors start with TENS magic + v2', () => {
      for (const vec of vectors) {
        const bytes = encoder.encode(vec.input);
        // Magic: 0x54 0x45 0x4E 0x53 = "TENS"
        expect(bytes[0]).toBe(0x54);
        expect(bytes[1]).toBe(0x45);
        expect(bytes[2]).toBe(0x4e);
        expect(bytes[3]).toBe(0x53);
        // Version: 2
        expect(bytes[4]).toBe(0x02);
      }
    });
  });

  describe('Encode-twice idempotence (encode → same input → identical bytes)', () => {
    for (const vec of vectors) {
      it(`[${vec.name}] encode is idempotent`, () => {
        const bytes1 = encoder.encode(vec.input);
        const bytes2 = encoder.encode(vec.input);
        expect(toHex(bytes1)).toBe(toHex(bytes2));
        expect(toHex(bytes1)).toBe(vec.expected_hex);
      });
    }
  });

  describe('Canonicalization invariants', () => {
    it('-0 canonicalizes to 0', () => {
      const bytesNegZero = encoder.encode(-0);
      const bytesZero = encoder.encode(0);
      expect(toHex(bytesNegZero)).toBe(toHex(bytesZero));
    });

    it('key order does not affect output', () => {
      const a = encoder.encode({ z: 1, a: 2 });
      const b = encoder.encode({ a: 2, z: 1 });
      expect(toHex(a)).toBe(toHex(b));
    });

    it('NaN is encoded as FLOAT64 by raw encoder (canonical pipeline converts to null)', () => {
      // TensEncoder preserves NaN as a FLOAT64 opcode.
      // The canonicalize step in encodeIR() converts NaN→null before encoding.
      const bytesNaN = encoder.encode(Number.NaN);
      // header(5) + string_count_varint(1) + opcode(1) + float64(8) = 15
      expect(bytesNaN.length).toBe(15);
      expect(bytesNaN[6]).toBe(0x06); // OP_FLOAT64 at offset 6 (after 5-byte header + 1-byte string count)
    });

    it('Infinity is encoded as FLOAT64 by raw encoder (canonical pipeline converts to null)', () => {
      const bytesInf = encoder.encode(Number.POSITIVE_INFINITY);
      expect(bytesInf[6]).toBe(0x06); // OP_FLOAT64
    });
  });

  describe('Determinism under repeated encoding', () => {
    it('encoding the same input 100 times produces identical bytes', () => {
      const input = [
        { id: 1, name: 'Alice', score: 95.5 },
        { id: 2, name: 'Bob', score: 87.3 },
      ];
      const reference = toHex(encoder.encode(input));
      for (let i = 0; i < 100; i++) {
        expect(toHex(encoder.encode(input))).toBe(reference);
      }
    });
  });
});

describe('Cross-language parity (WASM)', () => {
  let wasmModule: {
    TensEncoder: new () => { encode(val: unknown): Uint8Array; hash(val: unknown): string };
  } | null = null;

  try {
    // Try workspace package first, then relative fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    wasmModule = require('@contex-llm/tens-wasm');
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      wasmModule = require('../../../../tens-wasm/pkg/contex_tens_wasm.js');
    } catch {
      // WASM not built — skip
    }
  }

  const describeWasm = wasmModule ? describe : describe.skip;

  describeWasm('WASM encoder produces identical bytes', () => {
    for (const vec of vectors) {
      it(`[${vec.name}] TS and WASM produce identical hex`, () => {
        const tsEncoder = new TensEncoder();
        const tsBytes = toHex(tsEncoder.encode(vec.input));

        const wasmEncoder = new wasmModule!.TensEncoder();
        const wasmBytes = toHex(new Uint8Array(wasmEncoder.encode(vec.input)));

        expect(wasmBytes).toBe(tsBytes);
        expect(wasmBytes).toBe(vec.expected_hex);
      });
    }
  });

  describeWasm('WASM hash matches TS hash', () => {
    for (const vec of vectors) {
      it(`[${vec.name}] hash matches`, () => {
        const wasmEncoder = new wasmModule!.TensEncoder();
        const wasmHash = wasmEncoder.hash(vec.input);
        expect(wasmHash).toBe(vec.expected_hash);
      });
    }
  });
});
