
---

<div align="center">

# Contex v3 — Complete Master Walkthrough

> **Structure, theory, and what was built across all phases.** No code — just architecture.


# 🎯 Contex Architecture Deep Dive

*The Token Compiler for AI Systems*

</div>
 

## The Problem Contex Solves

Every LLM API call today ships raw JSON text. The provider re-tokenizes it from scratch. This means:

| Issue | Impact |
|-------|--------|
| **Wasted compute** | Identical data tokenized thousands of times a day |
| **Cache misses** | `{"a":1,"b":2}` and `{"b":2,"a":1}` produce different tokens → provider prefix cache miss |
| **Token waste** | JSON syntax (brackets, quotes, repeated keys) consumes 30–60% of the context window |

Contex eliminates all three by treating structured data the way compilers treat source code: **encode once into a canonical intermediate representation, materialize per target on demand.**



---

## Table of Contents

1. [The Compiler Analogy](#the-compiler-analogy)
2. [Phase 1: Foundation](#phase-1-foundation--canonical-ir--materialization)
3. [Phase 2: Token Memory](#phase-2-token-memory--content-addressed-storage)
4. [Phase 3: Token Composition](#phase-3-token-composition--multi-block-prompts)
5. [Phase 4: Middleware Rewrite](#phase-4-middleware-rewrite--drop-in-sdk-wrappers)
6. [Phase 5: quick() Rewrite](#phase-5-quick-rewrite--one-shot-api)
7. [Phase 6: Documentation Overhaul](#phase-6-documentation-overhaul)
8. [Final Architecture](#final-architecture)

---

## The Compiler Analogy

| Traditional Compiler | Contex (Token Compiler) |
|---|---|
| Source code | Structured data (JSON, objects) |
| Compiler frontend | Canonical IR encoder |
| Object files (`.o`) | IR files (`.tens.ir`) |
| Linker | Token composer |
| Platform-specific binary | Model-specific token array |
| Runtime | LLM inference |

---

## Phase 1: Foundation — Canonical IR + Materialization

### The Core Guarantee

> **Same data → same IR bytes → same hash → same tokens. Always.**

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CANONICAL IR ENCODING                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Structured Data      canonical.ts          ir_encoder.ts               │
│  (JSON, objects)  ─────────────────▶  ─────────────────▶  TensIR       │
│                      Canonicalization         encodeIR()                 │
│                          │                                               │
│                          │            materializer.ts                    │
│                          └─────────────────────▶  MaterializedTokens    │
│                                                          │             │
│                                                          ▼             │
│                                             {tokens, modelId,          │
│                                              fingerprint}               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Canonicalization Rules

The canonicalizer guarantees deterministic output:

| Data Type | Canonicalization Rule |
|-----------|----------------------|
| **Object keys** | Sorted lexicographically (Unicode code point order) |
| **Numbers** | Shortest IEEE 754 representation (`1.5` not `1.50`, `1` not `1.0`) |
| **Strings** | NFKC unicode normalization, trimmed whitespace |
| **Nulls** | Explicit marker (not omitted) |
| **Arrays** | Order preserved |

### Why Not Store Tokens Directly?

Storing per-model tokens locks you to one model. If OpenAI updates their tokenizer, stored tokens become invalid. Storing for every model = storage explosion. **Canonical IR is model-agnostic; tokens are a cached materialization.**

### Verification

- 441 total tests across `@contex/core`
- Determinism tests: same data with shuffled keys, 1000 iterations, identical hash every time
- Roundtrip tests: encode → materialize → verify token counts match direct tokenization

---

## Phase 2: Token Memory — Content-Addressed Storage

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TOKEN MEMORY STORAGE                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  TokenMemory.store(data)  ──────────────┐                               │
│                                          │                               │
│                                          ▼                               │
│  ┌─────────────────────┐    ┌─────────────────────┐                    │
│  │  Hash exists?       │    │    Store IR         │                    │
│  │       │             │    │  .contex/ir/{hash}/ │                    │
│  │  Yes  │ No          │    │       ir.bin        │                    │
│  │   │   │             │    │       meta.json     │                    │
│  └─────┼─┘             │    └─────────────────────┘                    │
│        │               │                                               │
│        ▼               ▼                                               │
│  Skip encoding    encodeIR → store                                      │
│  Return hash     return hash                                            │
│                                                                         │
│  TokenMemory.materializeAndCache(hash, model)                          │
│                                                                         │
│  ┌─────────────────────┐    ┌─────────────────────┐                    │
│  │  Cache exists +     │    │    Materialize      │                    │
│  │  fingerprint match? │    │  .contex/cache/{hash}/│                  │
│  │       │             │    │     {model}/tokens.bin │                │
│  │  Yes  │ No          │    │     {model}/meta.json  │                │
│  └─────┼─┘             │    └─────────────────────┘                    │
│        │               │                                               │
│        ▼               ▼                                               │
│  Load from cache   materialize → cache                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Storage Layout

```
.contex/
├── ir/
│   └── {sha256-hash}/
│       ├── ir.bin       ← Canonical IR bytes
│       └── meta.json    ← Schema, row count, version
└── cache/
    └── {ir-hash}/
        └── {model}.{encoding}.{version}/
            ├── tokens.bin  ← Int32Array binary cache
            └── meta.json   ← Fingerprint, token count
```

### Why Binary Token Cache?

`tokens.bin` stores raw `Int32Array` buffers — **4x smaller** than JSON arrays and instant to load (buffer read, no parsing).

---

## Phase 3: Token Composition — Multi-Block Prompts

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TOKEN COMPOSITION                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ System Prompt│    │  Customer    │    │  Policy      │          │
│  │ IR Block     │    │  Data        │    │  Rules       │          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                    │                    │                   │
│         └────────────────────┼────────────────────┘                   │
│                              │                                          │
│                              ▼                                          │
│                     ┌──────────────┐                                   │
│                     │   compose()  │                                   │
│                     └──────┬───────┘                                   │
│                              │                                          │
│         ┌────────────────────┼────────────────────┐                   │
│         │                    │                    │                   │
│         ▼                    ▼                    ▼                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  Fits in     │    │  Composed    │    │  Overflow   │          │
│  │  context?    │    │  Prompt      │    │  detected   │          │
│  │              │    │  {blocks,    │    │  (trim or   │          │
│  │   Yes         │    │   total,     │    │   error)    │          │
│  │              │    │   fits:true} │    │             │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Two Composition APIs

1. **`compose()`**: Takes raw data arrays, encodes IR on the fly, materializes, validates budget
2. **`composeFromHashes()`**: Takes pre-stored IR hashes from TokenMemory, loads and materializes — optimized for repeated compositions

---

## Phase 4: Middleware Rewrite — Drop-In SDK Wrappers

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MIDDLEWARE INJECTION                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ createContex │    │ ContexContext│    │   Provider   │          │
│  │  OpenAI()   │───▶│              │───▶│    API       │          │
│  └──────────────┘    └──────┬───────┘    └──────────────┘          │
│                              │                                          │
│         ┌────────────────────┼────────────────────┐                   │
│         │                    │                    │                   │
│         ▼                    ▼                    ▼                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ Scan for     │    │  encodeIR    │    │  Replace     │          │
│  │ {{CONTEX:   │    │  → materialize│    │  placeholders│          │
│  │   name}}    │    │  → canonical  │    │  with text   │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Per-SDK Handling

| SDK | What Gets Wrapped | Special Handling |
|---|---|---|
| **OpenAI** | `chat.completions.create()` | Scans message `content` strings for `{{CONTEX:name}}` |
| **Anthropic** | `messages.create()` | Scans `system` field + all message content blocks |
| **Gemini** | `generateContent()` + `startChat().sendMessage()` | Handles both string and structured `contents` arrays |

---

## Phase 5: quick() Rewrite — One-Shot API

### Old vs New

| | v2 `quick()` | v3 `quick()` |
|---|---|---|
| **Returns** | `{ output: string }` | `{ irHash, tokens, savings, asText() }` |
| **Pipeline** | Text formatting + token counting | IR encode → materialize → budget |
| **Determinism** | Format-dependent | Guaranteed (canonical IR) |
| **Token access** | None (text only) | Full `number[]` array |
| **Backward compat** | N/A | `.asText()` returns canonical JSON |

---

## Phase 6: Documentation Overhaul

Every external-facing document rewritten to reflect the v3 "token compiler" vision.

| Document | What Changed |
|---|---|
| **README.md** | Complete rewrite: IR pipeline, new quick() API, middleware with data option, architecture diagram |
| **docs/architecture.md** | IR-first pipeline diagram, package component tables, storage layout diagram |
| **docs/PRD.md** | Repositioned as "token compiler", all phases marked complete |
| **docs/guide/getting-started.md** | All examples use `encodeIR`, `TokenMemory`, `compose`, data-driven middleware |
| **USE_CASES.md** | New multi-model use case, middleware use case |

---

## Final Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FINAL ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 4: INJECTION                                            │  │
│  │  @contex/middleware — OpenAI · Anthropic · Gemini             │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                    ▲                                    │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 3: BUDGET + QUICK                                       │  │
│  │  @contex/engine — quick() · calculateBudget() · analyzeSavings │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                    ▲                                    │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 2: MEMORY + COMPOSITION                                 │  │
│  │  TokenMemory — Content-addressed .contex/ storage              │  │
│  │  compose() · composeFromHashes()                              │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                    ▲                                    │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 1: CANONICAL IR                                         │  │
│  │  Canonicalization — Sorted keys · NFKC · IEEE 754              │  │
│  │  encodeIR() — Data → deterministic bytes → SHA-256 hash       │  │
│  │  Materializer — IR → model-specific tokens + fingerprint       │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Test Coverage Summary

| Package | Tests | Status |
|---|---|---|
| `@contex/core` | 441 | ✅ All passing |
| `@contex/engine` (quick) | 10 | ✅ All passing |
| `@contex/middleware` | 20 | ✅ All passing |
| **Total** | **471+** | ✅ |

All three active packages build clean with `tsc`.

---

## License

MIT © Contex Team
