# @contex-llm/tens-wasm

**High-Performance TENS v2 Encoder/Decoder (Rust + WASM)**

Full Rust implementation of the TENS v2 binary format encoder, decoder, TENS-Text format, and SHA-256 hashing — designed for byte-for-byte parity with the TypeScript encoder in `@contex-llm/core`.

## Features

- **Binary Encoder** — TENS v2 wire format: header, LEB128 varints, string table, proper opcodes
- **Binary Decoder** — full decode back to JSON
- **TENS-Text** — human-readable format with `@schema`, `@dict`, `@version` directives
- **SHA-256 Hashing** — deterministic content hashing of binary output
- **Canonicalization** — sorted keys, NFKC strings, canonical numbers (-0→0, NaN→null)
- **WASM Bindings** — `TensEncoder`, `decodeTens()`, `decodeTensText()` exposed via `wasm-bindgen`

## Prerequisites

- **Rust** ≥ 1.70: `rustc` and `cargo`
- **wasm-pack**: `cargo install wasm-pack`
- **MSVC Build Tools** (Windows) or equivalent C linker

## Build

```bash
# Node.js target
wasm-pack build --target nodejs

# Browser target
wasm-pack build --target web
```

## Usage (Node.js)

```js
const { TensEncoder, decodeTens } = require('./pkg/contex_tens_wasm');

const encoder = new TensEncoder();

// Encode to TENS binary (Uint8Array)
const binary = encoder.encode({ name: "Alice", age: 30 });

// Decode back to JS
const decoded = decodeTens(binary);

// SHA-256 hash
const hash = encoder.hash({ name: "Alice", age: 30 });

// TENS-Text format
const text = encoder.encodeText([
  { name: "Alice", score: 95 },
  { name: "Bob", score: 88 }
]);
```

## Wire Format

```
┌─────────────┬────────────────────────┬──────────────────┐
│ Header (5B) │ Dictionary (varint+str)│ Value Tree       │
│ TENS\x02    │ count + entries        │ opcode + payload │
└─────────────┴────────────────────────┴──────────────────┘
```

**Opcodes**: NULL=0x00, TRUE=0x01, FALSE=0x02, INT8=0x03, INT32=0x05, FLOAT64=0x06, STRING_REF=0x07, ARRAY_START=0x08, OBJECT_START=0x09

## Testing

```bash
cargo test
```

## Status

Production-ready Rust implementation with full encode/decode round-trip, TENS-Text support, and content hashing.

