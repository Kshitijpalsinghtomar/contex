# @contex/tens-wasm

**High-Performance TENS Core (Rust + WASM)**

This package contains the Rust implementation of the TENS encoder/decoder. It compiles to WebAssembly for use in Node.js and Browser environments.

## Prerequisites

- **Rust**: `rustc` and `cargo` must be installed.
- **wasm-pack**: `cargo install wasm-pack`

## Build

```bash
wasm-pack build --target nodejs --out-dir pkg/node
wasm-pack build --target web --out-dir pkg/web
```

## Status

🚧 **Scaffold Only**: The Rust implementation is currently a placeholder. The TypeScript implementation in `@contex/core` is the production-ready version.
