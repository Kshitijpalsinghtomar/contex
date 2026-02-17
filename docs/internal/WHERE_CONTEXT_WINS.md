# Where Contex Wins / Where It Does Not

> **Date:** 2026-02-16  
> **Scope:** Contex strategy selection guidance based on empirical evidence

---

## Executive Summary

Contex is **NOT** a universal solution. This document provides evidence-backed guidance on when Contex delivers value and when alternative strategies should be used.

---

## Where Contex Wins ✅

### 1. High Structure Consistency (Best Use Case)

Contex excels when data has consistent structure across all rows.

| Dataset Type | Example | Contex Reduction | Best Strategy |
|--------------|--------|-----------------|---------------|
| Repetitive values | Status codes, categories | **83.5%** | Contex |
| Fixed schemas | Database records, API responses | **60-80%** | Contex |
| Uniform arrays | Log entries, metrics | **50-70%** | Contex |

**Why:** Contex's dictionary encoding compresses repeated strings effectively.

**Evidence:**
- `dummy.json` (15,840 rows, 5 fields): 83.5% token reduction
- Structure consistency: 100% → Auto-pick: Contex with 100% confidence

### 2. High Value Repetition

When field values repeat frequently across rows.

**Example:**
```json
[
  { "status": "open", "priority": "high" },
  { "status": "open", "priority": "high" },
  { "status": "closed", "priority": "low" }
]
```

Contex stores `"open"`, `"high"`, `"closed"`, `"low"` once and references by index.

### 3. Deterministic Prefix Requirements

When prefix caching stability is critical (vLLM, SGLang, provider caches).

- Contex guarantees same data → same output
- Critical for KV cache reuse in self-hosted models

---

## Where Contex Does NOT Win ❌

### 1. Low Structure Consistency

When rows have varying schemas or optional fields.

| Dataset Type | Example | Contex Reduction | Best Strategy |
|--------------|--------|-----------------|---------------|
| Sparse data | Optional fields, mixed types | **15-25%** | CSV/TOON |
| Dynamic schemas | Evolving API responses | **<20%** | JSON |
| Nested variable depth | Deeply nested objects | **20-30%** | JSON |

**Evidence:**
- `my_test_data.json` (30 rows, 32 fields): 21.4% token reduction
- Auto-pick: CSV with 41.1% reduction (+25.1 points vs Contex)

**Why:** Dictionary encoding overhead exceeds savings for low-repetition data.

### 2. Tiny Payloads

When serialization overhead dominates.

| Payload Size | Contex Overhead | Recommendation |
|--------------|----------------|----------------|
| < 10 rows | Dictionary > data | Use JSON/CSV directly |
| < 1KB | Tokenization time | Use raw format |

**Why:** Contex's schema building phase adds overhead that exceeds savings on small data.

### 3. Already Optimized Formats

When source data is already compact.

| Format | Contex Impact | Recommendation |
|--------|--------------|----------------|
| MessagePack | Minimal gain (+5-10%) | Keep MessagePack |
| Protocol Buffers | Negative | Keep Protobuf |
| Binary formats | Negative | Keep original |

**Why:** Contex optimizes text representation; binary is already optimal.

### 4. Human Readability Requirements

When debugging and human inspection are priority.

- Contex TENS is readable but less familiar than JSON
- CSV/TSV is easier for non-engineers to inspect

---

## Strategy Selection Matrix

Use this decision tree:

```
┌─────────────────────────────────────────────────────────────────┐
│                    STRATEGY SELECTION                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Q1: Is structure consistent across rows?                       │
│      ├─ YES → Q2                                               │
│      └─ NO  → Use CSV/TOON (Contex won't help)                │
│                                                                 │
│  Q2: Are values repetitive?                                    │
│      ├─ YES (>50% repeat) → Use CONTEX (best)                 │
│      └─ NO  → Q3                                               │
│                                                                 │
│  Q3: Is prefix caching critical?                                │
│      ├─ YES → Use CONTEX (deterministic)                      │
│      └─ NO  → Use CSV/TOON (simpler)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Auto Strategy Confidence Guide

The CLI's `--strategy auto` makes recommendations with confidence levels:

| Confidence | Score | When |
|------------|-------|------|
| **HIGH** | 75-100% | Consistent structure + high repetition |
| **MEDIUM** | 55-75% | Moderate consistency or repetition |
| **LOW** | <55% | Irregular structure, try manually |

**Current Evidence:**
- High repetition data: 100% confidence → Contex
- Low repetition data: 42% confidence → CSV recommended but low trust

---

## Performance Gates

| Gate | Target | Current | Status |
|------|--------|---------|--------|
| Floor (worst case) | ≥35% | 21.4% | ❌ FAIL |
| Median | ≥60% | 52.5% | ❌ FAIL |
| Dynamic stability | ≥90% | 94-100% | ✅ PASS |

---

## Recommendations

1. **Default to auto strategy** but verify confidence level
2. **Use Contex** for production workloads with consistent schemas
3. **Use CSV/TOON** for exploratory data or variable schemas
4. **Run analysis** before production deployment: `contex analyze <file> --strategy auto --reality-gate`
5. **Monitor token reduction** per dataset family, not globally

---

## Related Documentation

- [CLI Reference](./reference/cli.md) — Full command list
- [Benchmarks](./guide/benchmarks.md) — Performance data
- [CONTEX_TOP_LEVEL_PLAN](./CONTEX_TOP_LEVEL_PLAN.md) — Product strategy
