# Future Scope — Status & Roadmap

**Author:** Kshitij Pal Singh Tomar (@kshitijpalsinghtomar)  
**Last Updated:** 2026-02-18

---

## Overview

Six future-scope features are referenced on the Contex vision page. This document tracks their current state, existing code, and what's needed to make each production-ready.

---

## 1. Semantic Fingerprinting

| Aspect | Status |
|--------|--------|
| **State** | Partial — structural fingerprinting works, semantic layer missing |
| **Existing Code** | `packages/engine/src/session_dedup.ts` (SchemaFingerprint), `packages/core/src/materialize.ts` (tokenizerFingerprint) |
| **What Exists** | Schema shape tracking (sorted field-name signatures), tokenizer probe fingerprints for cache keying |
| **What's Missing** | Content-meaning hashing (MinHash/SimHash/embedding-based), `SemanticFingerprint` class, similarity threshold detection |
| **Target Location** | `packages/core/src/semantic/fingerprint.ts` |
| **Milestone** | M3 |
| **Research Needed** | MinHash vs SimHash vs embedding cosine for structured data; existing work on schema-aware locality-sensitive hashing |

---

## 2. Vercel AI SDK Integration

| Aspect | Status |
|--------|--------|
| **State** | Working (basic adapter shipped) |
| **Existing Code** | `packages/core/src/vercel.ts` (86 lines, `contex()` wrapper), `scripts/validate-e2e.ts`, `packages/cli/src/examples/vercel_integration.ts` |
| **What Exists** | `contex()` function that auto-detects JSON arrays in user messages and compiles them |
| **What's Missing** | `useContex()` React hook, dedicated `@contex-llm/vercel-ai-sdk` package, streaming re-hydration, `ai` package peer-dependency |
| **Target Location** | `packages/vercel-ai-sdk/` (new package) |
| **Milestone** | M2 |
| **Research Needed** | Vercel AI SDK v4+ `experimental_transform` API, React Server Components integration pattern |

---

## 3. Context Diffing & Versioning

| Aspect | Status |
|--------|--------|
| **State** | Partial — row-level deltas exist, structural diffs missing |
| **Existing Code** | `packages/engine/src/session_dedup.ts` (`encodeIncremental()` — row-level delta) |
| **What Exists** | Identifies new rows by key across batches |
| **What's Missing** | Field-level structural diff, column-level patches, token-cost impact comparison, `contextDiff()` API |
| **Target Location** | `packages/engine/src/diff/` |
| **Milestone** | M4 |
| **Research Needed** | CRDT-style diff for structured data, operational transform approaches for token sequences |

---

## 4. Adaptive Budget Engine

| Aspect | Status |
|--------|--------|
| **State** | Partial — static budget engine working, adaptive logic missing |
| **Existing Code** | `packages/engine/src/budget.ts` (265 lines), `packages/engine/src/packer.ts` (316 lines) |
| **What Exists** | Model registry, `computeBudget()`, format auto-selection, 3 packing strategies (greedy/density/knapsack) |
| **What's Missing** | Dynamic prioritization policies, constraint-satisfaction solver, runtime adaptivity, policy DSL |
| **Target Location** | `packages/engine/src/adaptive/` |
| **Milestone** | M4 |
| **Research Needed** | Constraint satisfaction for token budgets, multi-objective optimization (cost vs completeness vs latency) |

---

## 5. WASM Encoder

| Aspect | Status |
|--------|--------|
| **State** | Stub — scaffolded Rust crate, not production-ready |
| **Existing Code** | `packages/tens-wasm/src/lib.rs`, `encoder.rs`, `schema.rs`, `utils.rs`, `Cargo.toml` |
| **What Exists** | `TensEncoder` with basic `encode()`, `SchemaRegistry`, wasm-bindgen setup |
| **What's Missing** | `decode_tens()` (stub returning null), dictionary dedup, number encoding (placeholder), TENS-Text output, tests, build output, byte-for-byte parity with TS encoder |
| **Target Location** | `packages/tens-wasm/` (existing, needs completion) |
| **Milestone** | M3 |
| **Research Needed** | wasm-pack build targets (nodejs vs web vs bundler), performance comparison vs JS encoder |
| **Note** | Currently excluded from pnpm workspace (`!packages/tens-wasm` in pnpm-workspace.yaml) |

---

## 6. Multi-Turn Context Streaming

| Aspect | Status |
|--------|--------|
| **State** | Missing — no streaming protocol exists |
| **Existing Code** | Middleware handles LLM-side `stream: true` (pass-through), `encodeIncremental()` is a building block |
| **What Exists** | LLM response stream pass-through, row-level incremental encoding |
| **What's Missing** | Delta-token streaming protocol, append-only log segments, turn-aware context pipeline, cross-turn token budget tracking |
| **Target Location** | `packages/engine/src/streaming/` |
| **Milestone** | M4–M5 |
| **Research Needed** | Server-Sent Events vs WebSocket for context deltas, append-only log architectures (Kafka-style segments for context) |

---

## Priority Order (Recommended)

1. **WASM Encoder** — closest to done, high impact for M3
2. **Vercel AI SDK** — basic adapter works, polish into standalone package
3. **Semantic Fingerprinting** — extend existing infra, needed for M3
4. **Adaptive Budget Engine** — extend existing engine, needed for M4
5. **Context Diffing & Versioning** — needed for M4/ContexDB
6. **Multi-Turn Context Streaming** — most complex, save for M4–M5
