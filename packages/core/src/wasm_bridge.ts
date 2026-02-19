// ============================================================================
// @contex-llm/core — WASM Bridge
// ============================================================================
//
// Auto-detects and loads the Rust WASM encoder when available.
// Falls back to the TypeScript encoder transparently.
//
// Usage:
//   import { getWasmEncoder, isWasmAvailable } from './wasm_bridge.js';
//
//   if (isWasmAvailable()) {
//     const encoder = getWasmEncoder();
//     const bytes = encoder.encode(data);
//   }
// ============================================================================

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Interface matching the WASM TensEncoder API */
export interface WasmTensEncoder {
  encode(val: unknown): Uint8Array;
  encodeText(val: unknown, encoding?: string): string;
  hash(val: unknown): string;
  hashBinary(bytes: Uint8Array): string;
}

/** Interface for standalone WASM decoder functions */
export interface WasmModule {
  TensEncoder: new () => WasmTensEncoder;
  decodeTens(binary: Uint8Array): unknown;
  decodeTensText(text: string): unknown;
}

// ── Lazy singleton ──────────────────────────────────────────────────────────

let _wasmModule: WasmModule | null | undefined; // undefined = not yet probed
let _wasmError: string | null = null;

/**
 * Attempt to load the WASM module.
 * Returns the module if available, null otherwise.
 * Result is cached after first probe.
 */
function probeWasm(): WasmModule | null {
  if (_wasmModule !== undefined) return _wasmModule;

  // Create a require() function that works in both CJS and ESM contexts
  const esmRequire = createRequire(import.meta.url);

  try {
    // Try the scoped workspace package first
    const mod = esmRequire('@contex-llm/tens-wasm');
    if (mod?.TensEncoder) {
      _wasmModule = mod as WasmModule;
      return _wasmModule;
    }
  } catch {
    // Not available via package — try relative path
  }

  try {
    // Fallback: direct relative path to built WASM package
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const wasmPath = path.resolve(thisDir, '..', '..', 'tens-wasm', 'pkg', 'contex_tens_wasm.js');
    const mod = esmRequire(wasmPath);
    if (mod?.TensEncoder) {
      _wasmModule = mod as WasmModule;
      return _wasmModule;
    }
  } catch {
    // WASM not available
  }

  _wasmModule = null;
  _wasmError = 'WASM module not found. Install @contex-llm/tens-wasm or build with wasm-pack.';
  return null;
}

/**
 * Check if the WASM encoder is available.
 *
 * @returns true if WASM module loaded successfully
 */
export function isWasmAvailable(): boolean {
  return probeWasm() !== null;
}

/**
 * Get the reason WASM is not available (if applicable).
 *
 * @returns Error message or null if WASM is available
 */
export function wasmUnavailableReason(): string | null {
  probeWasm();
  return _wasmError;
}

/**
 * Create a new WASM encoder instance.
 *
 * @throws Error if WASM is not available
 * @returns A fresh WasmTensEncoder instance
 */
export function createWasmEncoder(): WasmTensEncoder {
  const mod = probeWasm();
  if (!mod) {
    throw new Error(_wasmError ?? 'WASM module not available');
  }
  return new mod.TensEncoder();
}

/**
 * Get the WASM module (for decoders and other standalone functions).
 *
 * @throws Error if WASM is not available
 * @returns The full WASM module
 */
export function getWasmModule(): WasmModule {
  const mod = probeWasm();
  if (!mod) {
    throw new Error(_wasmError ?? 'WASM module not available');
  }
  return mod;
}
