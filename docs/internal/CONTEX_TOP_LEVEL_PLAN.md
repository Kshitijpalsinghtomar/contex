# Contex — Top-Level Execution Plan (Reality First)

> **Date:** 2026-02-15
> **Scope:** Contex only. ContexDB stays deferred until Contex proves repeatable value in real workloads.

---

<div align="center">

## 🎯 Mission

Contex must be a production optimization layer teams can trust because it is:

| Quality | Description |
|---------|-------------|
| **Dynamic** | Adapts to real request patterns and makes cache behavior observable |
| **Needed** | Solves pain users already have (cost, latency, unstable prompts) |
| **Correct** | Zero semantic regressions and deterministic output under test |
| **Real** | Every feature has benchmark proof and failure-mode behavior |

</div>

---

## Table of Contents

1. [Mission](#mission)
2. [What We Will NOT Do Right Now](#what-we-will-not-do-right-now)
3. [Reality Gate](#reality-gate-must-pass-before-any-promotion)
4. [Product Shape](#top-level-product-shape-contex-only)
5. [Success Metrics](#success-metrics-north-star)
6. [4-Week Focus Plan](#4-week-focus-plan)
7. [Operating Rules](#operating-rules)
8. [Go/No-Go Gate for Reconsidering DB](#go-no-go-gate-for-reconsidering-db)

---

## What We Will NOT Do Right Now

| Item | Reason |
|------|--------|
| ❌ No ContexDB runtime/service build | Deferred until Contex proves value |
| ❌ No broad platform expansion work | Focus on core |
| ❌ No claim-heavy marketing updates without artifacts | Evidence-based only |

---

## Reality Gate (Must Pass Before Any Promotion)

Contex is only "ready" when all four gates are green:

### 1. Dynamic Gate
- Cache miss reasons are captured and attributable
- Prefix stability diagnostics run in CI and CLI

### 2. Need Gate
- At least 3 production-like datasets show >=15% value on one key metric
- "Where Contex does not help" is documented with examples

### 3. Correctness Gate
- Roundtrip and semantic correctness tests pass for all benchmark runs
- Deterministic-prefix tests stay green across providers

### 4. Real Feature Gate
- Every shipped feature includes benchmark delta, regression test, and fallback behavior

---

## Top-Level Product Shape (Contex Only)

Contex has 4 user-visible outcomes:

| Outcome | Description |
|---------|-------------|
| **1. Analyze** | Payload suitability and expected gains |
| **2. Compile** | Deterministic canonical representation |
| **3. Inject** | Stable prefixes into provider prompts |
| **4. Measure** | Cost/cache/latency outcomes with reproducible reports |

---

## Success Metrics (North Star)

| Metric | Description |
|--------|-------------|
| `token_reduction_pct` | Token reduction percentage |
| `prefix_cache_hit_rate` | Provider cache hit rate |
| `cached_tokens_pct` | Percentage of tokens served from cache |
| `prefill_latency_delta_ms` | Latency difference vs baseline |
| `cost_per_1k_requests` | Cost per 1K requests |
| `correctness_pass_rate` | Test pass rate |

---

## 4-Week Focus Plan

### Week 1 — Baseline Truth

| Task | Exit Criteria |
|------|---------------|
| Build benchmark harness for 3 workload types | One command generates baseline report |
| Capture provider usage fields in unified report format | |
| Add dataset suitability scoring in CLI output | |
| Add hard pass/fail scorecard for gates | |

### Week 2 — API and DX Clarity

| Task | Exit Criteria |
|------|---------------|
| Complete unified `Tens` API path as default journey | New user can run compile->materialize->inject in <10 min |
| Reduce confusing entry points in docs/examples | |
| Add migration examples | |

### Week 3 — Cache-Hit Engineering ✅ COMPLETE (Verified 2026-02-16)

| Task | Exit Criteria | Status |
|------|---------------|--------|
| Add prompt-prefix stability checks | 100% hit rate on controlled test workload | ✅ Complete |
| Add miss-reason taxonomy | | ✅ Complete |
| Add cache-readiness diagnostics in CLI | | ✅ Complete |
| Add middleware telemetry | | ✅ Complete |

#### Week 3 Verification (Real-Time Check)

**Verified on 2026-02-16:**

- ✅ `CacheMissReason` enum present in `packages/core/src/cache_metrics.ts` with full taxonomy (IR_NOT_STORED, MODEL_NEVER_MATERIALIZED, ENCODING_DRIFT, TOKENIZER_VERSION_CHANGE, MAX_TOKENS_CHANGED, TOKEN_CACHE_EXPIRED, TOKEN_CACHE_MISSED, TEXT_CACHE_MISSED, DISK_IO_ERROR, CORRUPTED_CACHE)
- ✅ `CacheDiagnostics` class implemented with `recordHit()`, `recordMiss()`, `persist()`, `loadPersisted()`, `getHistoricalTelemetry()` methods
- ✅ CLI commands implemented: `contex cache-diagnose`, `contex cache-warm`, `contex cache-stats`
- ✅ Middleware cache telemetry active in `packages/middleware/src/core.ts` - records text cache hits/misses via global diagnostics
- ✅ 9 regression tests present in `packages/cli/tests/cli_regression.test.ts` covering cache commands
- ✅ Validation gates: `pnpm check:claim-evidence` ✅, `pnpm check:docs-snippets` ✅

#### Week 3 — Detailed Implementation ✅

##### 3.1 Miss-Reason Taxonomy ✅

**Location:** `packages/core/src/cache_metrics.ts`

```typescript
export enum CacheMissReason {
  // IR Level
  IR_NOT_STORED = 'IR_NOT_STORED',
  IR_HASH_MISMATCH = 'IR_HASH_MISMATCH',
  
  // Materialization Level  
  MODEL_NEVER_MATERIALIZED = 'MODEL_NEVER_MATERIALIZED',
  ENCODING_DRIFT = 'ENCODING_DRIFT',
  TOKENIZER_VERSION_CHANGE = 'TOKENIZER_VERSION_CHANGE',
  MAX_TOKENS_CHANGED = 'MAX_TOKENS_CHANGED',
  
  // Token Level
  TOKEN_CACHE_EXPIRED = 'TOKEN_CACHE_EXPIRED',
  TOKEN_CACHE_MISSED = 'TOKEN_CACHE_MISSED',
  
  // Text Level
  TEXT_CACHE_MISSED = 'TEXT_CACHE_MISSED',
  
  // System
  DISK_IO_ERROR = 'DISK_IO_ERROR',
  CORRUPTED_CACHE = 'CORRUPTED_CACHE',
}
```

##### 3.2 CacheDiagnostics Class ✅

**Location:** `packages/core/src/cache_metrics.ts`

- Track every cache access with timestamp, collection, operation, hit/miss + reason, latency
- Provide `getTelemetry()` for aggregate stats
- Support in-memory + optional disk persistence

##### 3.3 Integration Points ✅

| Component | Integration |
|-----------|-------------|
| `Materializer` | Track materialization cache hits/misses |
| `TokenMemory.materializeAndCache` | Track disk cache hits/misses with fingerprint check |
| `ContexContext` | Track text cache hits/misses |
| `TokenCache` | Track format+tokenize cache hits/misses |

##### 3.4 CLI Commands ✅

| Command | Description |
|---------|-------------|
| `contex cache-diagnose <file> --model <model>` | Show cache readiness for a file |
| `contex cache-warm <file> --models gpt-4o,claude-3-5-sonnet` | Pre-materialize for multiple models |
| `contex cache-stats` | Show aggregate cache telemetry |

##### 3.5 Exit Criteria Validation

- [x] Every cache miss includes an attributable reason logged
- [x] `contex cache-diagnose` shows readiness for any file
- [x] Middleware exports cache telemetry via callback
- [x] 100% hit rate achievable on re-materialization

### Week 4 — Production Proof Pack

| Task | Exit Criteria |
|------|---------------|
| Run real datasets and publish results | Evidence-backed positioning |
| Add correctness checks to every benchmark run | |
| Produce "where Contex wins / where it does not" report | |
| Publish strict scorecard | |

---

## Operating Rules

| Rule | Description |
|------|-------------|
| No performance claim without command + dataset + raw output | |
| No universal guarantees in docs | |
| Every feature must include correctness test, benchmark delta, and fallback behavior | |

---

## Go/No-Go Gate for Reconsidering DB

Revisit ContexDB only if all are true:

- [ ] Contex shows repeatable value on multiple real datasets
- [ ] Cache-hit engineering is stable and observable
- [ ] API and benchmark flow are clean enough for external users

---

## Related Documentation

- [OUR_SIDE_EXECUTION_PLAN.md](./OUR_SIDE_EXECUTION_PLAN.md) — Detailed execution timeline
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Development guidelines
- [CONTEX_V3_MASTER.md](../CONTEX_V3_MASTER.md) — Architecture source of truth
