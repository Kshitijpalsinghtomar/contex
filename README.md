<div align="center">

# Contex

# The Token-Native Data Infrastructure for AI Systems

**Reduce token volume by 40-94% before the tokenizer ever runs.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](http://www.typescriptlang.org/)
[![npm version](https://img.shields.io/npm/v/@contex/core.svg)](https://www.npmjs.com/package/@contex/core)
[![Test Status](https://img.shields.io/badge/Tests-560%2B%20Passed-10b981.svg)]()

---

> **"You cannot modify the OpenAI tokenizer. But you CAN modify your structure."**

[![Get Started](https://img.shields.io/badge/🚀-Quick_Start-blue.svg)](./docs/guide/getting-started.md)
[![View Benchmarks](https://img.shields.io/badge/📊-Benchmarks-blue.svg)](./docs/benchmarks.md)
[![Read the Docs](https://img.shields.io/badge/📖-Documentation-blue.svg)](./docs/index.md)

</div>

---

## ⚡ Measured Snapshot (Benchmark v7)

Benchmark v7 covers 15 dataset types across multiple sizes, with 36/36 tests passing and 20/20 data fidelity checks.

| Metric | Value | Details |
| :--- | :--- | :--- |
| **Avg Pipeline Savings** | **43%** | Across 15 dataset types |
| **Best Format Savings** | **94%** (DeepNested) | Contex Compact format |
| **RealWorld Savings** | **68%** | Production-like ticket data |
| **Data Fidelity** | **20/20** | Perfect roundtrip accuracy |
| **Test Suite** | **560+ tests** | Across 7 packages |

> [!IMPORTANT]
> **Benchmark v7 evidence scope.**
> *   ✅ **Contex Compact format**: Dictionary compression + deep object flattening
> *   ✅ **Type Safe**: Full TypeScript support with strict mode
> *   ✅ **Deterministic**: Stable canonical prefixes for prefix cache reuse
> *   ✅ **Multi-provider**: Works across OpenAI, Anthropic, and Gemini
> *   ✅ **Verified**: 36/36 benchmark tests, 20/20 fidelity tests, 16/16 connectivity tests


---

## 🚀 The Problem: Structural Bloat

Every LLM API call today suffers from structural inefficiency:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  YOUR PIPELINE TODAY                                                        │
│  ─────────────────                                                          │  
│                                                                             │
│  Your App    →    JSON (Bloated)    →    Tokenizer    →    Inference        │
│                          ↑                                                  │
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
│                       ↑                                                                   │
│                  40-94% reduction                                           │
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
pnpm add @contex/core @contex/engine @contex/middleware
```

### 2. Analyze Your Data (CLI)

```bash
npx contex analyze my_data.json --model gpt-4o
```

For strict confidence gating:

```bash
npx contex analyze my_data.json --model gpt-4o-mini --strategy auto --auto-confidence-floor 55 --strict-auto-gate
```

**Output:**
```
╔══════════════════════════════════════════════════════════════════════╗
║                     CONTEXT ANALYSIS REPORT                          ║
╠══════════════════════════════════════════════════════════════════════╣
║  Input:          my_data.json                                        ║
║  JSON Tokens:    39,605                                              ║
║  Contex Tokens:  22,572  ████████████░░░░░░░░░░  -43% 🟢              ║
║  Savings:        $4.27 per 1M requests                               ║
╠══════════════════════════════════════════════════════════════════════╣
║  Format Ranking:                                                     ║
║    Contex Compact  43% saved (best overall)                          ║
║    TOON            35% saved                                         ║
║    CSV             33% saved                                         ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 3. Integrate (SDK)

**One line of code** to enable structural optimization:

```typescript
import OpenAI from 'openai';
import { createContexOpenAI } from '@contex/middleware';

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

### The Four Layers

| Layer | Package | Description |
|-------|---------|-------------|
| **Layer 1: Canonical IR** | `@contex/core` | Deterministic binary encoding |
| **Layer 2: Materialization** | `@contex/core` | Model-specific token generation |
| **Layer 3: Composition** | `@contex/engine` | Prompt assembly with budget validation |
| **Layer 4: Injection** | `@contex/middleware` | Drop-in SDK wrappers |

---

## 📦 Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@contex/core` | Canonical IR, materializer, TokenMemory | ✅ Stable |
| `@contex/engine` | Budget engine, quick() API | ✅ Stable |
| `@contex/middleware` | OpenAI, Anthropic, Gemini wrappers | ✅ Stable |
| `@contex/cli` | CLI tools and benchmarks | ✅ Stable |
| `@contex/adapters` | LangChain & LlamaIndex integrations | ⏸ Paused |

---

## ✅ Production Ready (P0 Complete)

All critical features implemented and tested:

| Feature | Status | Description |
|---------|--------|-------------|
| **Streaming Support** | ✅ Complete | Works with OpenAI, Anthropic, Gemini streaming |
| **Error Handling & Validation** | ✅ Complete | 8+ custom error types |
| **Observability** | ✅ Complete | Built-in logging with CONTEX_DEBUG |
| **Test Coverage** | ✅ Complete | 560+ tests passing across 7 packages |

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](./docs/guide/getting-started.md) | 5-minute quick start tutorial |
| [🚀 Quickstart](./docs/guide/quickstart.md) | ⭐ New: 3-line workflow in under 10 minutes |
| [📄 Migration Guide](./docs/guide/migration-from-json.md) | Coming from JSON? Start here |
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

## 📄 License

MIT © Contex Team

---

<div align="center">

**Built with ❤️ for the AI Developer Community**

[![GitHub Stars](https://img.shields.io/github/stars/kshitijpalsinghtomar/contex?style=social)](https://github.com/kshitijpalsinghtomar/contex)
[![Follow on X](https://img.shields.io/twitter/follow/contex?style=social)](https://twitter.com/contex)

</div>
