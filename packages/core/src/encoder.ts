// ============================================================================
// TENS v2 Encoder — Dictionary Encoded, Canonical, Structural
// ============================================================================
//
// Memory-optimized: uses pre-allocated typed arrays, reuses TextEncoder
// and DataView instances to minimize GC pressure.

import { StringTable } from './tens/dictionary.js';

// TENS v2 Opcodes
const OP = {
  NULL: 0x00,
  TRUE: 0x01,
  FALSE: 0x02,
  INT8: 0x03,
  INT16: 0x04,
  INT32: 0x05,
  FLOAT64: 0x06,
  STRING_REF: 0x07,
  ARRAY_START: 0x08,
  OBJECT_START: 0x09,
};

// ── Shared instances (avoid per-call allocation) ────────────────────────────

/** Single TextEncoder reused across all encode calls. */
const sharedTextEncoder = new TextEncoder();

/** Scratch buffer for writing numbers — avoids allocating per-value. */
const scratchAB = new ArrayBuffer(8);
const scratchDV = new DataView(scratchAB);
const scratchU8 = new Uint8Array(scratchAB);

// ── Growable Buffer ─────────────────────────────────────────────────────────

/**
 * A growable byte buffer backed by a Uint8Array.
 * Doubles capacity on overflow — amortized O(1) writes, minimal GC.
 */
class GrowableBuffer {
  private buf: Uint8Array;
  private pos = 0;

  constructor(initialCapacity = 4096) {
    this.buf = new Uint8Array(initialCapacity);
  }

  /** Reset position without re-allocating (reuse the buffer). */
  reset() {
    this.pos = 0;
  }

  /** Current number of bytes written. */
  get length() {
    return this.pos;
  }

  /** Return a trimmed copy of the written bytes. */
  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }

  /** Ensure at least `extra` bytes of capacity remain. */
  private ensure(extra: number) {
    const needed = this.pos + extra;
    if (needed <= this.buf.length) return;
    // Double until large enough
    let cap = this.buf.length;
    while (cap < needed) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  /** Write a single byte. */
  writeByte(b: number) {
    this.ensure(1);
    this.buf[this.pos++] = b;
  }

  /** Write a block of bytes. */
  writeBytes(bytes: Uint8Array | number[]) {
    if (bytes instanceof Uint8Array) {
      this.ensure(bytes.length);
      this.buf.set(bytes, this.pos);
      this.pos += bytes.length;
    } else {
      this.ensure(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        this.buf[this.pos++] = bytes[i];
      }
    }
  }

  /** Write a varint (LEB128 unsigned). */
  writeVarint(value: number) {
    this.ensure(5); // max 5 bytes for 32-bit varint
    let remaining = value;
    while (remaining > 127) {
      this.buf[this.pos++] = (remaining & 127) | 128;
      remaining >>>= 7;
    }
    this.buf[this.pos++] = remaining;
  }

  /** Write an int32 (little-endian) using the shared scratch buffer. */
  writeInt32(val: number) {
    scratchDV.setInt32(0, val, true);
    this.ensure(4);
    this.buf[this.pos++] = scratchU8[0];
    this.buf[this.pos++] = scratchU8[1];
    this.buf[this.pos++] = scratchU8[2];
    this.buf[this.pos++] = scratchU8[3];
  }

  /** Write a float64 (little-endian) using the shared scratch buffer. */
  writeFloat64(val: number) {
    scratchDV.setFloat64(0, val, true);
    this.ensure(8);
    for (let i = 0; i < 8; i++) {
      this.buf[this.pos++] = scratchU8[i];
    }
  }
}

// ── TENS Encoder ────────────────────────────────────────────────────────────

/**
 * TENS v2 Binary Encoder.
 *
 * Encodes arbitrary JavaScript values (arrays, objects, primitives) into
 * a canonical TENS binary representation. Key properties:
 *
 * - **Canonical**: Sorted keys → same data always produces same bytes
 * - **Dictionary-encoded**: All strings stored once in a string table
 * - **Type-preserving**: Nulls, booleans, integers, floats preserved exactly
 * - **Varint-compressed**: Small integers use 1-2 bytes instead of 4-8
 * - **Memory-optimized**: Pre-allocated growable buffer, reused scratch pads
 *
 * @example
 * ```ts
 * const encoder = new TensEncoder();
 * const binary = encoder.encode([{ id: 1, name: 'Alice' }]);
 * // binary is a Uint8Array with TENS v2 header + dictionary + encoded values
 * ```
 */
export class TensEncoder {
  private stringTable = new StringTable();
  private buffer = new GrowableBuffer();

  /**
   * Encode a JavaScript value into TENS v2 binary format.
   *
   * @param data - Any JSON-compatible value (array, object, string, number, boolean, null)
   * @returns Canonical TENS binary as Uint8Array
   */
  encode(data: unknown): Uint8Array {
    this.stringTable.clear();
    this.buffer.reset(); // reuse existing allocation
    this.scan(data);
    this.writeHeader();
    this.writeDictionary();
    this.encodeValue(data);
    return this.buffer.toUint8Array();
  }

  private scan(val: unknown) {
    if (typeof val === 'string') {
      this.stringTable.add(val);
    } else if (Array.isArray(val)) {
      for (const item of val) this.scan(item);
    } else if (val && typeof val === 'object') {
      const keys = Object.keys(val).sort();
      const objectValue = val as Record<string, unknown>;
      for (const k of keys) {
        this.stringTable.add(k);
        this.scan(objectValue[k]);
      }
    }
  }

  private writeHeader() {
    this.buffer.writeBytes([0x54, 0x45, 0x4e, 0x53, 0x02]);
  }

  private writeDictionary() {
    const strings = this.stringTable.getAll();
    this.buffer.writeVarint(strings.length);
    for (const s of strings) {
      const utf8 = sharedTextEncoder.encode(s);
      this.buffer.writeVarint(utf8.length);
      this.buffer.writeBytes(utf8);
    }
  }

  private encodeValue(val: unknown) {
    if (val === null || val === undefined) {
      this.buffer.writeByte(OP.NULL);
    } else if (val === true) {
      this.buffer.writeByte(OP.TRUE);
    } else if (val === false) {
      this.buffer.writeByte(OP.FALSE);
    } else if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        if (val >= -128 && val <= 127) {
          this.buffer.writeByte(OP.INT8);
          this.buffer.writeByte(val & 0xff);
        } else {
          this.buffer.writeByte(OP.INT32);
          this.buffer.writeInt32(val);
        }
      } else {
        this.buffer.writeByte(OP.FLOAT64);
        this.buffer.writeFloat64(val);
      }
    } else if (typeof val === 'string') {
      this.buffer.writeByte(OP.STRING_REF);
      const id = this.stringTable.add(val);
      this.buffer.writeVarint(id);
    } else if (Array.isArray(val)) {
      this.buffer.writeByte(OP.ARRAY_START);
      this.buffer.writeVarint(val.length);
      for (const item of val) this.encodeValue(item);
    } else if (typeof val === 'object') {
      this.buffer.writeByte(OP.OBJECT_START);
      const keys = Object.keys(val).sort();
      const objectValue = val as Record<string, unknown>;
      this.buffer.writeVarint(keys.length);
      for (const key of keys) {
        const keyId = this.stringTable.add(key);
        this.buffer.writeVarint(keyId);
        this.encodeValue(objectValue[key]);
      }
    }
  }
}
