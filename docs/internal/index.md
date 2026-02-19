
<div align="center">

# The Intelligent Context Engine for LLMs

**Contex stores structured data as a canonical intermediate representation (TENS) and serves it in the most token-efficient format for any LLM — saving 46-90% of context costs.**

[![npm version](https://img.shields.io/npm/v/@contex-llm/core.svg)](https://www.npmjs.com/package/@contex-llm/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Test Status](https://img.shields.io/badge/Tests-600%2B%20Passed-10b981.svg)]()

</div>

---

## 🚀 Quick Start

```bash
# Install
pnpm add @contex-llm/core @contex-llm/middleware

# Encode and materialize
import { Tens } from '@contex-llm/core';
import { createContexOpenAI } from '@contex-llm/middleware';

const tens = Tens.encode(myData);
const tokens = tens.materialize('gpt-4o');

// Or use middleware (recommended)
const client = createContexOpenAI(new OpenAI(), {
  data: { context: myData }
});
```


---

## 📐– Documentation Navigation

### Getting Started

| Guide | Description |
|:------|:------------|
| [Installation & Quick Start](./guide/getting-started.md) | Install, encode, decode, and optimize in 5 minutes |
| [Examples](./guide/examples.md) | Real-world copy-paste examples |

### Concepts

| Guide | Description |
|:------|:------------|
| [TENS Specification](./tens-specification.md) | What TENS is, why it exists, binary layout, and capabilities |
| [Architecture](./architecture.md) | Data pipeline, package structure, and design decisions |

### Comparison

| Guide | Description |
|:------|:------------|
| [Contex vs Alternatives](./guide/comparison.md) | Why Contex wins over JSON, MessagePack, Protocol Buffers |

### Guides

| Guide | Description |
|:------|:------------|
| [Benchmarks](./guide/benchmarks.md) | Running and interpreting the research-grade benchmark suite |
| [High-Gain Playbook](./guide/high-gain-playbook.md) | When to prefer CSV/TOON vs Contex in real workloads |
| [3-Dataset Scorecard (2026-02-15, historical baseline)](./guide/scorecard-2026-02-15.md) | Historical pre-correction baseline; see Week 4 fixed-set docs for current gate status |
| [Artifact Bundle Runbook](./guide/artifact-bundle-runbook.md) | Standard evidence package for benchmark claims |

### Reference

| Guide | Description |
|:------|:------------|
| [Core API](./reference/core.md) | Complete API reference for @contex-llm/core |
| [Middleware API](./reference/middleware.md) | OpenAI/Anthropic/Gemini SDK integration |
| [CLI Reference](./reference/cli.md) | All CLI commands, options, and examples |
| [Format Hierarchy](./reference/formats.md) | TENS binary vs .tens-text vs Contex Compact |

---

## 💎 Key Features

| Feature | Description |
|---------|-------------|
| **46-90% Token Reduction** | Avg 72% token savings, up to 90% on nested data |
| **Deterministic Output** | Stable hashes for prefix caching |
| **Multi-Model Support** | OpenAI, Anthropic, Gemini |
| **Zero Config** | Works out of the box |
| **TypeScript** | Full type safety |
| **Streaming** | Full streaming support |

---

## 📊 The Pipeline

```
Your Data → TENS (Canonical IR) → Budget Engine → Middleware → LLM
```

Contex doesn't pick one format. It stores data canonically and serves the **cheapest format** for the target model:

| Format | Best For |
|--------|----------|
| **Contex Compact** | Everything — dictionary compression + deep flattening (best overall) |
| **TOON** | Nested/typed data going to LLMs |
| **CSV** | Flat tabular data |
| **Markdown** | Human-readable reporting |
| **JSON** | API compatibility |

---

## 🏆 Benchmark Results (v8)

| Metric | Value | Details |
|----------|-------|----------------|
| **Avg Pipeline Savings** | **72%** | Across 21 dataset types |
| **Best Format Savings** | **90%** | DeepNested data (Contex Compact) |
| **RealWorld Savings** | **68%** | Production-like ticket data |
| **Data Fidelity** | **20/20** | Perfect roundtrip accuracy |
| **Benchmark Tests** | **36/36** | All pass |

---

## 🔗 Related

- [GitHub](https://github.com/kshitijpalsinghtomar/contex-llm)
- [NPM Packages](./packages/)
- [Contributing](../CONTRIBUTING.md)
