<div align="center">

# Contex

# The Token-Native Data Infrastructure for AI Systems

**Reduce token volume by 46-90% before the tokenizer ever runs.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](http://www.typescriptlang.org/)
[![npm version](https://img.shields.io/npm/v/@contex-llm/core.svg)](https://www.npmjs.com/package/@contex-llm/core)
[![Test Status](https://img.shields.io/badge/Tests-600%2B%20Passed-10b981.svg)]()

---

> **"You cannot modify the OpenAI tokenizer. But you CAN modify your structure."**

[![Get Started](https://img.shields.io/badge/🚀-Quick_Start-blue.svg)](./docs/guide/getting-started.md)
[![View Benchmarks](https://img.shields.io/badge/📊-Benchmarks-blue.svg)](./docs/benchmarks.md)
[![Read the Docs](https://img.shields.io/badge/📐–-Documentation-blue.svg)](./docs/index.md)

</div>

---

## ⚡ Measured Snapshot (Benchmark v8)

Benchmark v8 covers 21 dataset types across multiple sizes, with 36/36 tests passing and 20/20 data fidelity checks.

| Metric | Value | Details |
| :--- | :--- | :--- |
| **Avg Pipeline Savings** | **72%** | Across 21 dataset types |
| **Best Format Savings** | **90%** (DeepNested) | Contex Compact format |
| **RealWorld Savings** | **68%** | Production-like ticket data |
| **Data Fidelity** | **20/20** | Perfect roundtrip accuracy |
| **WASM Acceleration** | **Active** | Rust-compiled encoder via WebAssembly |
| **Test Suite** | **600+ tests** | Across 7 packages |

> [!IMPORTANT]
> **Benchmark v8 evidence scope.**
> *   ✅ **Contex Compact format**: 7+ compression directives (@t, @d, @c, @p, @f, @sparse, bool/null)
> *   ✅ **WASM Acceleration**: Rust-compiled encoder for 2-5× faster encoding
> *   ✅ **Type Safe**: Full TypeScript support with strict mode
> *   ✅ **Deterministic**: Stable canonical prefixes for prefix cache reuse
> *   ✅ **Multi-provider**: Works across OpenAI, Anthropic, and Gemini (39 models in registry)
> *   ✅ **compose() & quick()**: High-level APIs for prompt assembly and one-shot encoding
> *   ✅ **pipeline() helper**: Chained encode → optimize → materialize in one call
> *   ✅ **Verified**: 36/36 benchmark, 20/20 fidelity, 16/16 connectivity, 532 core tests


---

## 🚀 The Problem: Structural Bloat

Every LLM API call today suffers from structural inefficiency:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  YOUR PIPELINE TODAY                                                        │
│  ─────────────────                                                          │  
│                                                                             │
│  Your App    →    JSON (Bloated)    →    Tokenizer    →    Inference        │
│                          ←'                                                  │
│                     30-60% of tokens                                        │
│                     are just SYNTAX                                         │
│                     (brackets, quotes,                                      │
│                      repeated keys)                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**What's happening:**
1.  **You pay for syntax**: Brackets, quotes, and whitespace consume tokens but add no information
2.  **You waste compute**: The provider re-tokenizes the same static keys billions of times
3.  **You break caching**: Non-deterministic JSON serialization kills your cache hit rate

---

## 💡 The Solution: Prompt Structure Optimization

Contex inserts itself at the only layer you control: **Before the Tokenizer.**

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│  CONTAX OPTIMIZED PIPELINE                                                                │
│  ──────────────────────────                                                               │
│                                                                                           │
│  Your App    →    Contex Compiler    →    Optimized    →    Tokenizer    →    Inference   │
│                                           Structure                                       │
│                       ←'                                                                   │
│                  46-90% reduction                                           │
│                  before we ever                                              │
│                  reach the tokenizer                                         │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

Contex compiles your data into **Canonical IR (TENS)** — a deterministic, model-agnostic format optimized to reduce structural token overhead.

### Why It Works

| Feature | Benefit |
|---------|---------|
| **Not Overfit** | Works across OpenAI, Anthropic, and Gemini |
| **Not Accidental** | Structural efficiency is fundamental, not a trick |
| **Infrastructure Grade** | 0ms latency penalty. Type-safe. Deterministic |

---

## 🛠️ Quick Start

### Canonical Newcomer Flow (Default)

Use this single path first, then branch into advanced options only if needed.

1. `contex analyze` — verify reduction and strategy on your dataset
2. `contex materialize` — build model-specific cache artifacts
3. SDK inject with middleware — run prompts using `{{CONTEX:key}}`

### 1. Install

```bash
pnpm add @contex-llm/core @contex-llm/engine @contex-llm/middleware
```

### 2. Analyze Your Data (CLI)

```bash
npx contex analyze my_data.json --model gpt-4o
npx contex analyze my_data.json --model gpt-4o --fingerprint
```

For strict confidence gating:

```bash
npx contex analyze my_data.json --model gpt-4o-mini --strategy auto --auto-confidence-floor 55 --strict-auto-gate
npx contex analyze my_data.json --model gpt-4o-mini --fingerprint --no-watermark
```

**Output:**
```
╔══════════════════════════════════════════════════════════════════════╗
║                     CONTEXT ANALYSIS REPORT                         ║
╠══════════════════════════════════════════════════════════════════════╣
║  Input:          my_data.json                                        ║
║  JSON Tokens:    39,605                                              ║
║  Contex Tokens:  18,218  ████████████░░░░░░░░░░  -72% 🟢              ║
║  Savings:        $5.47 per 1M requests                               ║
╠══════════════════════════════════════════════════════════════════════╣
║  Format Ranking:                                                     ║
║    Contex Compact  72% saved (best overall)                          ║
║    TOON            35% saved                                         ║
║    CSV             38% saved                                         ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 3. Integrate (SDK)

**One line of code** to enable structural optimization:

```typescript
import OpenAI from 'openai';
import { createContexOpenAI } from '@contex-llm/middleware';

// Wrap your client - that's it!
const client = createContexOpenAI(new OpenAI(), {
  data: { 
    users: myLargeDataset  // Automatically optimized
  }
});

// Use as normal - placeholders get replaced automatically
await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ 
    role: 'user', 
    content: 'Analyze these users: {{CONTEX:users}}' 
  }],
});
```

### Advanced Paths (Optional)

- Multi-dataset analysis: `contex savings data.json`
- Roundtrip validation: `contex validate data.json --semantic-guard`
- Fingerprint + watermark proof: `contex validate data.json --fingerprint`
- Fingerprint only (no watermark): `contex validate data.json --fingerprint --no-watermark`
- Full benchmark suite: `npx tsx packages/cli/src/benchmark.ts`

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CONTEX ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐             │
│  │   Your App   │────▶│   Contex    │────▶│    LLM       │             │
│  │  (Data In)   │     │   Compiler   │     │  (Optimized) │             │
│  └──────────────┘     └──────┬───────┘     └──────────────┘             │
│                               │                                         │
│         ┌─────────────────────┼─────────────────────┐                   │
│         │                     │                     │                   │
│         ▼                     ▼                     ▼                   │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐              │
│  │   Canonical │      │  Materialize│      │  Middleware │              │
│  │      IR     │─────▶│   (Tokens)  │─────▶│  (Injection)│             │
│  │  (TENS)     │      │             │      │             │              │
│  └─────────────┘      └─────────────┘      └─────────────┘              │
│         │                     │                     │                   │
│         └─────────────────────┴─────────────────────┘                   │
│                               │                                         │
│                               ▼                                         │
│                      ┌──────────────┐                                   │
│                      │  .contex/    │                                   │
│                      │  (Cache)     │                                   │
│                      └──────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Five Layers

| Layer | Package | Description |
|-------|---------|-------------|
| **Layer 1: Canonical IR** | `@contex-llm/core` | Deterministic binary encoding (TENS) |
| **Layer 1b: WASM Acceleration** | `@contex-llm/tens-wasm` | Rust-compiled encoder for 2-5× speedup |
| **Layer 2: Materialization** | `@contex-llm/core` | Model-specific token generation with 7+ Compact directives |
| **Layer 3: Composition** | `@contex-llm/engine` | compose(), quick(), pipeline(), budget validation |
| **Layer 4: Injection** | `@contex-llm/middleware` | Drop-in SDK wrappers for OpenAI, Anthropic, Gemini |

---

## 📐¦ Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@contex-llm/core` | Canonical IR, materializer, TokenMemory, WASM bridge | ✅ Stable |
| `@contex-llm/engine` | Budget engine, compose(), quick(), pipeline(), MODEL_REGISTRY (39 models) | ✅ Stable |
| `@contex-llm/middleware` | OpenAI, Anthropic, Gemini wrappers | ✅ Stable |
| `@contex-llm/cli` | CLI tools, benchmarks (21 datasets), ANSI colored output | ✅ Stable |
| `@contex-llm/tens-wasm` | Rust-compiled WASM encoder | ✅ Stable |
| `@contex-llm/adapters` | LangChain & LlamaIndex integrations | ⏸ Paused |

---

## ✅ Production Ready (P0 Complete)

All critical features implemented and tested:

| Feature | Status | Description |
|---------|--------|-------------|
| **Streaming Support** | ✅ Complete | Works with OpenAI, Anthropic, Gemini streaming |
| **Error Handling & Validation** | ✅ Complete | 8+ custom error types |
| **Observability** | ✅ Complete | Built-in logging with CONTEX_DEBUG |
| **Test Coverage** | ✅ Complete | 600+ tests passing across 7 packages |

---

## 📐š Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](./docs/guide/getting-started.md) | 5-minute quick start tutorial |
| [🚀 Quickstart](./docs/guide/quickstart.md) | ⭐ New: 3-line workflow in under 10 minutes |
| [📐" Migration Guide](./docs/guide/migration-from-json.md) | Coming from JSON? Start here |
| [Architecture](./docs/architecture.md) | Deep dive into system design |
| [API Reference](./docs/reference/core.md) | Complete API documentation |
| [Benchmarks](./docs/benchmarks.md) | Performance benchmarks and methodology |
| [Examples](./docs/guide/examples.md) | Real-world use cases (including LangChain & LlamaIndex) |
| [Comparison](./docs/guide/comparison.md) | Contex vs JSON, MessagePack, Protobuf |

---

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run benchmarks
pnpm bench

# Run linter
pnpm lint
```

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## 📐" License

MIT © Contex Team

---

<div align="center">

**Built with ❤️ for the AI Developer Community**

[![GitHub Stars](https://img.shields.io/github/stars/kshitijpalsinghtomar/contex-llm?style=social)](https://github.com/kshitijpalsinghtomar/contex-llm)
[![Follow on X](https://img.shields.io/twitter/follow/contex?style=social)](https://twitter.com/contex)

</div>
