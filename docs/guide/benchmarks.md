
<div align="center">

# Contex Benchmarks

> **Benchmark v7** — 15 dataset types, 36/36 tests passing, 20/20 data fidelity.

</div>

---


## ⚡ Executive Summary

| Metric | Value | Status |
|:-------|:------|:-------|
| **Avg Pipeline Savings** | 43% | ✅ VALIDATED |
| **Best Format Savings** | 94% (DeepNested) | ✅ VALIDATED |
| **RealWorld Savings** | 68% (Contex Compact) | ✅ VALIDATED |
| **Data Fidelity** | 20/20 | ✅ PERFECT |
| **Benchmark Tests** | 36/36 | ✅ ALL PASS |

---

## Table of Contents

1. [Format Savings](#1-format-savings-by-dataset)
2. [Format Ranking](#2-format-ranking)
3. [Cost Savings](#3-cost-savings--roi)
4. [Latency](#4-encoding-latency)
5. [Data Fidelity](#5-data-fidelity)
6. [Methodology](#methodology)

---

## 1. Format Savings by Dataset

Contex Compact consistently delivers the highest savings across all dataset types.

| Dataset | Format Savings | Pipeline Savings | Notes |
| :--- | :--- | :--- | :--- |
| **DeepNested/100** | **94%** | **88%** | Deep objects flattened via dot-notation |
| **Repetitive/500** | **70%** | **55%** | Dictionary compression excels |
| **RealWorld/500** | **68%** | **52%** | Production-like ticket data |
| **Nested/500** | **60%** | **48%** | 2-level nested objects |
| **Flat/500** | **45%** | **35%** | Simple tabular data |

---

## 2. Format Ranking

All formats compared on RealWorld/500 (customer support tickets):

| Format | Savings vs JSON | Best For |
| :--- | :--- | :--- |
| **Contex Compact** | **-68%** | Everything (dictionary compression + deep flattening) |
| **TOON** | **-56%** | Flat/tabular data (tab-separated) |
| **CSV** | **-54%** | Simple flat data |
| **TENS-Text** | **-43%** | Legacy format |
| **Markdown** | **-38%** | Human-readable output |

---

## 3. Cost Savings: ROI

Projected annual savings at 10M requests/month, 10K token context, using 43% avg savings.

| Provider | Cost/1M Tokens | Projected Annual Savings |
| :--- | :--- | :--- |
| **OpenAI (gpt-4o)** | $2.50 | **$154,800/year** |
| **Claude 3.5 Sonnet** | $3.00 | **$185,760/year** |
| **Gemini 2.5 Flash** | $0.30 | **$18,576/year** |

---

## 4. Encoding Latency

Contex format encoding is negligible — measured in microseconds per row.

| Dataset | Rows | Latency (μs/row) | Verdict |
| :--- | :--- | :--- | :--- |
| **Flat** | 500 | 1.6 | Instant |
| **RealWorld** | 500 | 8.2 | Fast |
| **DeepNested** | 100 | 42 | Fast |

> **Zero latency penalty.** Format encoding is sub-millisecond for typical datasets.

---

## 5. Data Fidelity

Every format's output is verified for roundtrip accuracy.

| Test Category | Result | Details |
| :--- | :--- | :--- |
| **Data Fidelity** | 20/20 PASS | All formats preserve data integrity |
| **Connectivity** | 16/16 PASS | Pipeline end-to-end verification |
| **Total** | 36/36 PASS | All benchmark tests passing |

---

## Methodology

### Benchmark Suite (v7)

| # | Test Category | What It Measures |
|---|---|---|
| 1 | **Comprehensive Matrix** | Token counts for 15 datasets × 5 sizes × 6 formats |
| 2 | **Data Fidelity** | Roundtrip accuracy across all formats |
| 3 | **Format Comparison** | Side-by-side format ranking |
| 4 | **Latency** | Encoding speed in μs/row |
| 5 | **Pipeline Connectivity** | End-to-end pipeline verification |

### Datasets Tested (15 types)

| Dataset | Description | Focus |
|---|---|---|
| Flat | 6-column simple records | Baseline |
| Nested | 2-level nested objects | Object handling |
| DeepNested | 4+ levels deep | Deep flattening |
| Sparse | ~90% null fields | Null handling |
| Repetitive | Highly repeated values | Dictionary encoding |
| RealWorld | Customer support tickets | Production fidelity |
| Wide | 50+ columns | Wide tables |
| Narrow | 2-3 columns | Minimal data |
| Mixed | Various value types | Type handling |
| LargeValues | Long strings | Value-heavy data |
| Unicode | Non-ASCII characters | Encoding |
| ManyColumns | 100+ fields | Column scaling |
| Boolean | Boolean-heavy data | T/F abbreviation |
| IDs | ID-heavy data | Integer performance |
| Timestamps | Date-heavy data | Date serialization |

### Running Benchmarks

```bash
# Run the full benchmark suite
npx tsx packages/cli/src/benchmark.ts
```

---

## Related Documentation

- [Getting Started](./getting-started.md) — Try it in 5 minutes
- [API Reference](../reference/core.md) — Deep dive
- [Comparison](./comparison.md) — Contex vs JSON vs alternatives
