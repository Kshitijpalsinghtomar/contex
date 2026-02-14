# Benchmark Suite (v3.0)

Contex includes a research-grade benchmark suite designed for scientific rigor. All benchmarks are **deterministic** (seeded PRNG), **isolated** (each metric measured independently), and **comprehensive** (12 datasets x 10 formats).

---

## Running Benchmarks

```bash
# Run the full suite (generates benchmark_results.json)
npx tsx packages/cli/src/benchmark.ts

# Generate the interactive HTML report
npx tsx packages/cli/src/generate_report.ts

# Open the report
# → open benchmark_report.html
```

---

## Benchmark Suite

| # | Benchmark | What It Measures |
|---|---|---|
| 1 | **Comprehensive Matrix** | Token counts for 12 datasets x 6 sizes x 10 formats (720 data points) |
| 2 | **Marginal Cost Slope** | Δ tokens per added row at intervals 100→500, 500→1K, 1K→5K |
| 3 | **Structural Overhead** | % of tokens that are structural (keys, brackets) vs actual values |
| 4 | **Context Fitting** | Max rows fitting in each model's context window |
| 5 | **Annual Cost Savings** | Projected yearly savings at 1M requests/month |
| 6 | **Determinism** | Verifies same data → same output regardless of key order |
| 7 | **Prefix Cache** | Prefix retention under 7 mutation types (append, delete, shuffle, etc.) |
| 8 | **TENS Performance** | Encoding/decoding throughput (ops/sec, MB/s) |
| 9 | **Schema Width** | Format scaling at 10/20/40/80 columns |
| 10 | **Tokenizer Spread** | Token counts across 4 tokenizer encodings |
| 11 | **Entropy Correlation** | Which format benefits most from repetitive data |

---

## Datasets

| Dataset | Description | Focus |
|---|---|---|
| Flat | 6-column simple records | Baseline |
| Nested | 3-level nested objects | Format nesting support |
| Sparse | ~90% empty fields | Null handling |
| Repetitive | Highly repeated values | Dictionary encoding benefit |
| LongText | Long string values | Tokenizer behavior |
| RealWorld | Customer support tickets | Production-like data |
| WideSchema | 40-column records | Schema width stress |
| DeepNested | 5-level recursive nesting | Deep structure handling |
| MixedNested | 50% flat, 50% nested rows | Heterogeneous shapes |
| ExtremelySparse | 20 cols, 90% null | Extreme sparsity |
| ShortStrings | 1-5 character values | Short token behavior |
| NumericHeavy | Numbers only, no strings | Numeric encoding |

---

## Formats Tested

| Format | Type | Description |
|---|---|---|
| `json` | Text | Standard JSON (minified) |
| `json-min` | Text | JSON without whitespace |
| `json-pretty` | Text | JSON with 2-space indent |
| `yaml` | Text | YAML serialization |
| `xml` | Text | XML with `<root><row>` structure |
| `ndjson` | Text | Newline-delimited JSON |
| `csv` | Text | Comma-separated values |
| `markdown` | Text | Markdown table |
| `toon` | Text | Tab-separated header+rows |
| `tens` | Binary/Stream | TENS token-stream encoding |

---

## Output Files

- **`benchmark_results.json`** — Raw results with all metrics. Sections: `metadata`, `matrix`, `marginalCost`, `structuralOverhead`, `context`, `cost`, `determinism`, `prefix`, `tens`, `schemaWidth`, `tokenizerSpread`, `entropyCorrelation`.
- **`benchmark_report.html`** — Locally generated interactive dashboard with Chart.js visualizations.

---

## Methodology

### Deterministic Execution
All data generation uses a seeded PRNG (`mulberry32`, seed: 42). Running the suite twice produces identical results.

### Isolated Metrics
Each metric is measured independently with its own tokenizer and encoder instances. No metric calculation depends on another.

### Multiple Tokenizers
Token counts are measured across all 4 available encodings: `cl100k_base` (GPT-4), `o200k_base` (GPT-4o), `p50k_base` (GPT-3), `r50k_base` (Codex).

### Structural Overhead
Leaf values are extracted from data, joined with spaces, and tokenized separately. Structural tokens = total − value tokens. This measures the true formatting cost.
