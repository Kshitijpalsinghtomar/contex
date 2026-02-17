# Contex Roadmap & Vision

> **Last Updated:** February 16, 2026

---

<div align="center">

# 🚀 Contex Development Roadmap

*A living document tracking our journey from infrastructure-grade to industry-standard*

---

## 📊 Current Status

| Phase | Status | Description |
|:------|:-------|:------------|
| **P0: Foundation** | ✅ Complete | Production-ready core infrastructure |
| **P1: Developer Experience** | ✅ Complete | CLI polish, unified API, documentation |
| **P2: Performance** | ✅ Complete | Token-aware APIs, field compression |
| **P1-R: Reality Sprint** | 🚧 In Progress | Hardening for production workloads |

</div>

---

## 🎯 Current Focus: P1-R Reality Sprint

**Objective:** Sustain worst-case dataset reduction at 50%+ while keeping median ≥60% on the fixed-set cadence.

**Status:** 🚧 In Progress

---

## Table of Contents

1. [Current State](#current-state)
2. [Completed Phases](#completed-phases)
   - [P0: Foundation](#p0-foundation--complete)
   - [P1: Developer Experience](#p1-developer-experience--complete)
   - [P2: Performance](#p2-performance--complete)
3. [Reality Sprint (P1-R)](#p1-r-reality-sprint-🚧-in-progress)
4. [Future Vision](#future-vision-p3)
5. [ContexDB: The Future Layer](#contexdb-the-future-layer)

---

## Current State

### ✅ What's Working

| Component | Status | Description |
|-----------|--------|-------------|
| **Canonical IR Encoding** | ✅ Stable | Model-agnostic binary representation |
| **Token Materialization** | ✅ Stable | IR → model-specific token arrays |
| **Content-Hash Deduplication** | ✅ Stable | Same data = same hash = automatic dedup |
| **Token Memory Storage** | ✅ Stable | Persistent `.contex/` directory with caching |
| **Composition Engine** | ✅ Stable | Assemble prompts from token blocks |
| **PQL Query Language** | ✅ Stable | Query compiled contexts |
| **Budget Engine** | ✅ Stable | Context window budget calculations |
| **Prefix Cache Optimization** | ✅ Stable | Deterministic output for vLLM cache reuse |
| **Middleware (OpenAI/Anthropic/Gemini)** | ✅ Stable | SDK wrappers with auto-injection |

### 📊 Verified Benchmarks (v7 — Contex Compact)

| Metric | Value | Notes |
|--------|-------|-------|
| **Average Pipeline Savings** | **43%** | Across 15 dataset types |
| **Best Format Savings** | **94%** | DeepNested via Contex Compact |
| **RealWorld Compact Savings** | **68%** | Production-like mixed data |
| **Data Fidelity** | **20/20** | All round-trip tests pass |
| **Total Tests** | **560+** | Core + Engine + Middleware + CLI + Server |

> **Note:** Benchmark v7 uses 15 dataset types (Flat, Nested, DeepNested, Wide, Sparse, Repetitive, Mixed, RealWorld, etc.) with Contex Compact format (dictionary compression, deep flattening, tab-separated values).

---

## Completed Phases

### P0: Foundation ✅ Complete

> **Goal:** Make Contex production-ready and bulletproof

#### ✅ P0-1: Streaming Support

**Problem:** Real chat applications need `stream: true`. Previously, Contex didn't support streaming responses.

**Solution:** IMPLEMENTED - Middleware now handles streaming with prefix caching:

```typescript
// Now works with prefix caching
const stream = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Summarize {{CONTEX:data}}' }],
  stream: true // ✅ Works with prefix caching
});
```

---

#### ✅ P0-2: Error Handling & Validation

**Solution:** IMPLEMENTED - Comprehensive error types:

```typescript
import { ContexValidationError, ContexModelNotFoundError } from '@contex/core';

try {
  Tens.encode(data);
} catch (e) {
  if (e instanceof ContexValidationError) {
    console.log(`Invalid field: ${e.field}, reason: ${e.reason}`);
  } else if (e instanceof ContexModelNotFoundError) {
    console.log(`Available models: ${e.availableModels}`);
  }
}
```

**Implementation:** 8+ new error types added to `packages/core/src/errors.ts`

---

#### ✅ P0-3: Observability

**Solution:** IMPLEMENTED - Built-in logging with environment controls:

```typescript
// Enable debug output
CONTEX_DEBUG=1 node app.js

// Output:
// [Contex] encodeIR: 12.34ms for 1000 rows
// [Contex] materialize: 45.67ms for gpt-4o (2341 tokens)
// [Contex] cache HIT for abc123 (gpt-4o)

// Callback-based tracking
const client = createContexOpenAI(openai, {
  data: myData,
  onInject: (info) => console.log(`Injected ${info.tokenCount} tokens`),
  onCacheHit: (hash) => console.log(`Cache hit: ${hash}`),
});
```

---

#### ✅ P0-4: Test Coverage at 100%

**Result:** 560+ tests passing (100%)

```
Core        446 passed (2 skipped)
Engine       64 passed
Middleware   20 passed
CLI          23 passed
Server        7 passed
Adapters      2 passed
```

---

### P1: Developer Experience ✅ Complete

> **Goal:** Make Contex amazing to use — dead simple API, great DX

#### ✅ P1-1: Unified, Simple API

```typescript
// Simple (recommended)
import { Tens } from '@contex/core';

const tens = Tens.encode(data);           // Compile once
const tokens = tens.materialize('gpt-4o'); // Get tokens
const text = tens.toString();              // Get canonical text

// Advanced (when needed)
import { TokenMemory } from '@contex/core';
const memory = new TokenMemory('./.contex');
memory.store(data);
memory.materializeAndCache(hash, 'gpt-4o');
```

---

#### ✅ P1-2: CLI Polish

```bash
$ npx contexto analyze data.json

╔═══════════════════════════════════════════════════════════════════╗
║                    CONTEXT ANALYSIS                               ║
╠═══════════════════════════════════════════════════════════════════╣
║  Input:        data.json                                          ║
║  JSON Tokens:  39,605                                             ║
║  Contex Tokens: 22,570  ████████████░░░░░░  43%                   ║
║  Savings:      $3.40 per 1M requests                              ║
╠═══════════════════════════════════════════════════════════════════╣
║  Format Ranking:                                                  ║
║    contex (Compact)  43% saved   ★ Best                           ║
║    csv               38% saved                                    ║
║    markdown           6% saved                                    ║
║    json                0% saved   (baseline)                      ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

#### ✅ P1-3: TypeScript Strict Mode

- `"strict": true` enabled in `tsconfig.base.json`
- All packages compile without errors under strict mode

---

#### ✅ P1-4: Documentation Overhaul

| Document | Status |
|----------|--------|
| API Reference | ✅ Complete |
| Middleware API | ✅ Complete |
| Examples | ✅ Complete |
| Comparison Guide | ✅ Complete |

---

#### ✅ P1-5: Semantic Relation Guard

```bash
$ npx contexto guard data.json

╭──────────────────────────────────────────────────────╮
│          Semantic Relation Guard                     │
├──────────────────────────────────────────────────────┤
│  Input:    data.json                                 │
│  Model:    gpt-4o-mini                               │
│  Status:   PASS (Semantic relation integrity...)     │
│  Rows:     1000/1000                                 │
│  Fields:   95.0% (target >= 95%)                     │
│  RowMatch: 98.5% (target >= 95%)                     │
╰──────────────────────────────────────────────────────╯
```

---

### P2: Performance ✅ Complete

> **Goal:** Push token efficiency further and expand ecosystem

#### ✅ P2-1: Better Field Name Compression

Already implemented in `packages/core/src/schema.ts`:
- `compressFieldNames()` finds shortest unique prefix
- Example: `customer_shipping_address` → `shipping`, `customer_billing_address` → `billing`

---

#### ✅ P2-2: Array Optimization

Already implemented in `packages/core/src/formatters.ts`:
- **Delta encoding** for sorted numeric arrays
- **Run-length encoding** for repeated values
- **Dictionary compression** for common string patterns

---

#### ✅ P2-3: LangChain & LlamaIndex Adapters

```typescript
// LangChain
import { ContexLoader } from '@contex/adapters/langchain';
const docs = await new ContexLoader({ format: 'markdown' }).load('data.json');

// LlamaIndex
import { ContexReader } from '@contex/adapters/llamaindex';
const reader = new ContexReader({ model: 'gpt-4o' });
const optimized = reader.optimizeNodes(nodes);
```

---

## P1-R: Reality Sprint 🚧 In Progress

**Problem:** Strong claims need repeatable verification

### Current Targets

| Metric | Current | Target |
|--------|---------|--------|
| Average pipeline savings | 43% | 40%+ |
| Best format savings | 94% (DeepNested) | 50%+ |
| Data fidelity | 20/20 PASS | 100% |

### Latest Scorecard Results

| Run Date | Floor Reduction | Median Reduction | Floor Pass | Median Pass |
|----------|-----------------|------------------|------------|-------------|
| 2026-02-15 | 21.43% | 63.49% | ❌ FAIL | ✅ PASS |
| 2026-02-16 (legacy baseline mix) | 21.43% | 21.43% | ❌ FAIL | ❌ FAIL |
| 2026-02-16 (fixed-set corrected) | 63.49% | 74.18% | ✅ PASS | ✅ PASS |

### Implementation Status

- [x] Benchmark scorecards with pass/fail gates
- [x] Cache-readiness diagnostics
- [x] `contex guard` command
- [x] Strategy auto-selection for high-structure datasets
- [x] Semantic fingerprint improvements (Jaccard-like similarity for Dynamic gate)
- [x] Server provider gateway routes connected to middleware (`openai`, `anthropic`, `gemini`)
- [x] Server integration tests include provider-route configuration guards
- [x] Raise floor reduction from 21.43% to 50%+ (fixed-set corrected run: 63.49%)
- [x] Improve dynamic gate stability to ≥90% (fixed-set reality gate: 94.3%-100.0%)

---

## Future Vision (P3)

### P3-1: Python SDK

```python
from contexto import Tens

tens = Tens.encode(data)           # Compile once
tokens = tens.materialize("gpt-4o")  # Get tokens
```

---

### P3-2: Token-Native Protocol

```typescript
// Future: Direct token injection
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  token_inputs: {
    context: tens.materialize('gpt-4o').tokens  // Raw tokens!
  }
});
```

---

### P3-3: Semantic Fingerprinting (Optional Module)

```typescript
import { SemanticFingerprint } from '@contex/core/optional/semantic';

const fp = new SemanticFingerprint();
const ctx1 = Tens.encode([{ text: "The cat sat on the mat" }]);
const ctx2 = Tens.encode([{ text: "A feline rested on the rug" }]);

// Both hash to same semantic ID
console.log(ctx1.semanticHash === ctx2.semanticHash); // true
```

---

### P3-4: Vercel AI SDK Support

```typescript
import { useContex } from '@contex/vercel-ai-sdk';

const { messages } = useContex({
  data: userData,
  provider: openai,
});
```

---

## ContexDB — The Compiled Context Store

> **Contex = The Compiler | ContexDB = The Runtime Storage**

### Philosophy

- **Contex** stays focused: data → deterministic IR → tokens
- **ContexDB** builds on top: stores and reuses compiled contexts
- **NOT a database** — No SQL, no queries, no transactions
- They are **separate by design** — different layers, different concerns

### What ContexDB IS

A **content-addressed context store** that persists:
- TensDocument (compiled IR)
- TENS Binary
- Token cache per model
- Metadata (timestamps, schema, stats)

### Core API

```typescript
import { ContexDB } from '@contexdb/core';

const db = new ContexDB('./.contexdb');

// Compile once, use forever
const ctxId = await db.compile(userData);
// Returns: "abc123def456" (hash-based context ID)

// Get stored context
const ctx = await db.get(ctxId);

// Materialize for specific model
const tokens = await db.materialize(ctxId, 'gpt-4o');

// List all contexts
const contexts = await db.list();

// Delete a context
await db.delete(ctxId);
```

### Storage Layout

```
.contexdb/
├── contexts/
│   └── {context-id}/           # Hash-based ID
│       ├── ir.bin              # Canonical IR (model-agnostic)
│       ├── meta.json           # Schema, timestamps, stats
│       └── cache/
│           └── {model}/        # Per-model token cache
│               └── tokens.bin
└── index.json                  # Context ID index
```

### What ContexDB is NOT

| ❌ NOT | Reason |
|--------|--------|
| SQL database | No query language, no joins |
| Natural language query | Use Contex compose() instead |
| Distributed system | Single-node content-addressed storage |
| Transactional | Simple CRUD operations only |

### Usage with Contex

```typescript
import { ContexDB } from '@contexdb/core';
import { Tens } from '@contex/core';

const db = new ContexDB('./.contexdb');

// Build: Compile and store
const ctxId = await db.compile({
  users: userData,
  products: productData
});

// Runtime: Materialize on demand
const tokens = await db.materialize(ctxId, 'gpt-4o');

// Or use Contex directly for ad-hoc
const tens = Tens.encode(userData);
const tokens = tens.materialize('gpt-4o');
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

MIT © Contex Team
