# Contex — Product Requirements Document (PRD)

**Version:** 3.0
**Date:** February 14, 2026
**Status:** v3 Complete (Phases 1–6)

---

<div align="center">

## Executive Summary

**Contex** is an **infrastructure-grade token compiler** for LLM applications. It addresses two critical inefficiencies in LLM data handling:

| Problem | Solution |
|---------|----------|
| **Token waste** | JSON syntax overhead consumes 30–60% of available tokens |
| **Non-deterministic tokenization** | Identical data produces different tokens, breaking provider-side prefix caches |

Contex v3 solves both via **Canonical IR** — a deterministic, model-agnostic intermediate representation.

</div>

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Product Vision](#product-vision)
3. [Technical Architecture](#technical-architecture)
4. [Feature Status](#feature-status)
5. [Success Metrics](#success-metrics)
6. [Risks & Mitigations](#risks--mitigations)
7. [Future Roadmap](#future-roadmap)

---

## Problem Statement

### 1.1 Token Overhead

LLMs process data as tokens. JSON's syntax overhead (brackets, quotes, repeated keys) wastes ~60% of tokens on non-information.

### 1.2 Cache Miss Problem

LLM providers (OpenAI, Anthropic, Google) offer prefix caching — reusing KV computations for identical token prefixes. But non-deterministic formatting means:

| Issue | Impact |
|-------|--------|
| Same data → different JSON strings | Different tokens |
| Different tokens | Cache miss |
| Cache miss | Full re-computation = maximum cost |

### 1.3 Why Format Optimization Alone Is Insufficient

v2 of Contex focused on format selection (TOON, CSV, Markdown). While effective for token reduction, it didn't address determinism. v3 adds canonical encoding as the foundation.

---

## Product Vision

### Vision Statement

Contex is the **compilation layer** between applications and LLMs. It compiles structured data into deterministic token sequences, enabling prefix cache reuse, content deduplication, and budget-validated prompt composition.

### Core Value Proposition

| Audience | Value |
|---|---|
| **LLM App Developers** | 30–59% fewer tokens, deterministic caching |
| **RAG Systems** | More documents fit per context window |
| **Enterprise AI** | Significant cost reduction at scale via cache hits |
| **Multi-Model Deployments** | Model-agnostic IR, per-model materialization |

### Product Principles

| Principle | Description |
|-----------|-------------|
| **Determinism first** | Same data → same output. Always. |
| **Model agnostic** | Store once (IR), materialize per model. |
| **Zero configuration** | `quick(data, model)` works immediately. |
| **Content-addressed** | SHA-256 hashing for deduplication. |
| **Lazy materialization** | Tokens computed on demand, cached on disk. |

---

## Technical Architecture

### 2.1 Canonical IR

The core innovation. All structured data is canonicalized:

- Keys sorted lexicographically
- Values normalized (numbers, strings, booleans)
- Deterministic byte sequence → SHA-256 content hash

### 2.2 Pipeline

```
Data → encodeIR → Canonical IR (model-agnostic)
                ↓
           TokenMemory (content-addressed disk storage)
                ↓
           materialize → Model-specific tokens (cached)
```

### 2.3 Package Structure

| Package | Responsibility |
|---|---|
| `@contex-llm/core` | IR encoder, materializer, TokenMemory, composition |
| `@contex-llm/engine` | Budget calculator, `quick()` API, model registry |
| `@contex-llm/middleware` | OpenAI, Anthropic, Gemini SDK wrappers |
| `@contex-llm/cli` | IR tools, benchmarks, cost analysis |

---

## Feature Status

### Phase 1: Foundation ✅

- [x] Canonical IR encoder (`encodeIR`) with deterministic output
- [x] Materializer with tokenizer fingerprinting
- [x] Binary token cache (`.tokens.bin`)
- [x] Multi-tokenizer support (WASM-based)

### Phase 2: Token Memory ✅

- [x] Content-addressed disk storage
- [x] IR deduplication via SHA-256
- [x] Binary cache with drift detection

### Phase 3: Token Composition ✅

- [x] Multi-block prompt composition (`compose`)
- [x] Budget validation against model context windows
- [x] Compose from stored IR hashes

### Phase 4: Middleware ✅

- [x] OpenAI SDK wrapper
- [x] Anthropic SDK wrapper
- [x] Gemini SDK wrapper
- [x] Canonical JSON injection (deterministic)

### Phase 5: quick() Rewrite ✅

- [x] Returns IR + tokens (not just text)
- [x] `.asText()` backward-compatible fallback
- [x] IR-based `analyzeSavings()`

### Phase 6: Documentation ✅

- [x] README.md updated for v3
- [x] Getting Started guide
- [x] Architecture documentation
- [x] PRD updated

---

## Success Metrics

| Metric | Target | Status |
|---|---|---|
| **Token Reduction** | > 30% vs JSON | **30–59%** ✅ |
| **Deterministic Output** | 100% repeatability | **100%** ✅ |
| **IR Encoding** | < 10ms typical | **< 5ms** ✅ |
| **Cache Load** | < 5ms | **< 1ms** ✅ |
| **Test Coverage** | > 400 tests | **441+ tests** ✅ |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **LLM APIs accept raw tokens** | Contex is ready — IR materializes to token arrays directly |
| **Context windows expand** | Cost-per-token remains; cache hit value scales with volume |
| **Tokenizer library drift** | Fingerprinting detects drift, auto-invalidates caches |

---

## Future Roadmap

- [ ] **Phase 7**: Cleanup (dead files, root directory)
- [ ] Direct token injection when LLM APIs support it
- [ ] Streaming materialization for large datasets
- [ ] Multi-tenant TokenMemory for server deployments
- [ ] Python SDK
- [ ] Vercel AI SDK Support

---

## Related Documentation

- [Architecture](./architecture.md) — System architecture
- [Getting Started](./guide/getting-started.md) — Quick tutorial
- [CONTEX_V3_MASTER.md](../CONTEX_V3_MASTER.md) — Single source of truth
