
<div align="center">

# Contex Architecture

> **The technical architecture of Contex — the token-native data infrastructure for AI systems.**

</div>

---


## 🎯 Overview

Contex is a **token compiler** that transforms structured data into optimized, deterministic representations. Think of it like a traditional compiler:

| Traditional Compiler | Contex (Token Compiler) |
|---|---|
| Source code | Structured data (JSON, objects) |
| Compiler frontend | Canonical IR encoder |
| Object files (`.o`) | IR files (`.tens.ir`) |
| Linker | Token composer |
| Platform-specific binary | Model-specific token array |
| Runtime | LLM inference |


---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Solution](#the-solution)
3. [Four Layers](#the-four-layers)
4. [Package Structure](#package-structure)
5. [Storage Layout](#storage-layout)
6. [Design Decisions](#design-decisions)

---

## The Problem

Every LLM API call today:

```
App sends JSON text → Provider tokenizes it → Token IDs → Model processes
```

This is like shipping source code and recompiling on every request:
- ❌ **Wasted compute** — Identical data tokenized thousands of times a day
- ❌ **Cache misses** — Non-deterministic formatting breaks provider-side prefix caches
- ❌ **Token waste** — JSON syntax (brackets, quotes, repeated keys) consumes 30–60%

---

## The Solution

```
App encodes data ONCE as canonical IR
  → Materialize to tokens (cached)
  → Compose prompt from token blocks
  → Inject canonical text (deterministic)
  → Provider tokenizes identically
  → Cache HIT guaranteed
```

**Encode once. Materialize per model. Compose instantly. Inject deterministically. Guarantee cache hits.**

---

## The Four Layers

```
┌────────────────────────────────────────────────────────────────┐
│  LAYER 4: INJECTION                                            │
│  ─────────────────                                             │
│  createContexOpenAI() / createContexAnthropic() / createContexGemini() │
│  → Drop-in SDK wrappers that auto-inject canonical text        │
│  → Deterministic serialization guarantees provider cache hits  │
└────────────────────────────────────────────────────────────────┘
                              ←'
┌────────────────────────────────────────────────────────────────┐
│  LAYER 3: COMPOSITION                                          │
│  ────────────────────                                          │
│  compose({ model, blocks, reserveForResponse })                │
│  → Assemble prompts from pre-materialized token blocks         │
│  → Validates total fits in model's context window              │
│  → Deterministic token topology → guaranteed cache hits        │
└────────────────────────────────────────────────────────────────┘
                              ←'
┌────────────────────────────────────────────────────────────────┐
│  LAYER 2: MEMORY + MATERIALIZATION                             │
│  ────────────────────────────────                              │
│  TokenMemory.store(data) → customer_data.tens.ir (canonical)   │
│  TokenMemory.materializeAndCache(hash, model) → token array    │
│  → Content-addressed: same data = same hash = skip encoding    │
│  → Model-specific blobs cached only for hot paths              │
└────────────────────────────────────────────────────────────────┘
                              ←'
┌────────────────────────────────────────────────────────────────┐
│  LAYER 1: CANONICAL IR ENCODING                                │
│  ──────────────────────────────                                │
│  encodeIR(data) → { ir: Uint8Array, schema, hash }             │
│  → Deterministic: sorted keys, canonical numbers, NFKC unicode │
│  → Model-agnostic: no tokenizer dependency                     │
│  → Schema-aware: field names, types, structure                 │
└────────────────────────────────────────────────────────────────┘
                              ←'
┌────────────────────────────────────────────────────────────────┐
│  INPUT: Structured Data (JSON, objects, database rows)         │
└────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
contex/
├── packages/
│   ├── core/          ← Layer 1: TENS IR encoding/decoding, tokenization, schemas, canonicalization
│   ├── engine/        ← Layers 2-3: Materialization, memory, composition, budget, model registry
│   ├── middleware/     ← Layer 4: Drop-in SDK wrappers (OpenAI, Anthropic, Gemini)
│   ├── cli/           ← Command-line tools
│   ├── adapters/      ← LangChain & LlamaIndex integrations
│   ├── server/        ← [PAUSED] REST API
│   └── tens-wasm/     ← [PAUSED] Rust/WASM
├── docs/              ← Technical documentation
├── website/           ← Marketing website
└── CONTEX_V3_MASTER.md ← Single source of truth
```

### Package Responsibilities

| Package | Layer | Responsibility |
|---------|-------|----------------|
| `@contex-llm/core` | Layer 1 | Canonical IR encoder, materializer, tokenizer manager |
| `@contex-llm/engine` | Layers 2-3 | Budget engine, `quick()` API, model registry |
| `@contex-llm/middleware` | Layer 4 | OpenAI, Anthropic, Gemini SDK wrappers |
| `@contex-llm/cli` | Tools | CLI tools, benchmarks, cost analysis |

---

## Storage Layout

```
.contex/
├── ir/
│   └── {sha256-hash}/
│       ├── ir.bin       ← Canonical IR bytes (model-agnostic)
│       └── meta.json    ← Schema, row count, version
└── cache/
    └── {ir-hash}/
        └── {model}.{encoding}.{version}/
            ├── tokens.bin  ← Int32Array binary cache
            └── meta.json   ← Fingerprint, token count
```

### Why Binary Token Cache?

`tokens.bin` stores raw `Int32Array` buffers:
- **4x smaller** than JSON arrays
- **Instant to load** — buffer read, no parsing
- **Fingerprint validated** — auto-invalidates if tokenizer changes

---

## Design Decisions

### Why Not Store Per-Model Tokens Only?

If you encode data with OpenAI's `o200k_base` tokenizer and store those token IDs:
- ❌ Those tokens are **meaningless** to Claude (different tokenizer)
- ❌ If OpenAI updates their tokenizer, stored tokens become **invalid**
- ❌ Storing tokens for every model = storage explosion (10 models × 10K files = 100K blobs)

### The Solution: Canonical IR + Lazy Materialization

```
┌──────────────────────────────────────────────────────────────────┐
│  CANONICAL IR (.tens.ir)                                         │
│  ────────────────────────                                        │
│  Model-AGNOSTIC binary representation of your data               │
│  • Deterministic (same data = same bytes = same hash, ALWAYS)    │
│  • Contains: schema + values in canonical format                 │
│  • Does NOT contain token IDs — those are generated on demand    │
│  • Content-addressed by hash (skip re-encoding if hash exists)   │
│  • This is what you STORE and PERSIST                            │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  MATERIALIZATION (per-model)                                     │
│  ──────────────────────────                                      │
│  TokenMemory.materializeAndCache(irHash, 'gpt-4o') → number[]    │
│  • Takes canonical IR, tokenizes with target model's tokenizer   │
│  • Result is cached as a "hot blob" (.tens.gpt4o, .tens.claude)  │
│  • Cache invalidated when model tokenizer version changes        │
│  • Cold materialization: ~200ms. Warm (cached): <20ms.           │
│  • Only materialize for models you actually use (lazy)           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Why This Matters Now (Market Proof)

| Provider | What they support | How TENS exploits it |
|----------|-------------------|----------------------|
| **OpenAI** | **Automatic prefix caching**: 50% discount on inputs >1024 tokens | Canonical text → identical prefix tokens → 100% cache hit rate |
| **Anthropic** | **Explicit prompt caching**: 90% cheaper for exact prefix match | Deterministic canonicalization = guaranteed exact prefix match |
| **Google** | **Implicit & Explicit caching**: 75-90% discount | Same: deterministic output = maximum implicit cache rates |

> **Note:** As of Feb 2026, no major provider accepts raw token arrays in their Chat APIs. Contex achieves the same result by injecting **canonical deterministic text** which produces identical tokens on the provider side.

---

## Related Documentation

- [TENS Specification](./tens-specification.md) — Binary format details
- [Getting Started](./guide/getting-started.md) — Quick tutorial
- [API Reference](./reference/core.md) — Complete API docs
- [CONTEX_V3_MASTER.md](../CONTEX_V3_MASTER.md) — Single source of truth
