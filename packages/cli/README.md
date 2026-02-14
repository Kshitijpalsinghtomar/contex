# @contex/cli

**CLI tools and research benchmark suite for Contex.**

## What's Inside

| Component | Description |
|---|---|
| `contex encode` | JSON → TENS binary |
| `contex decode` | TENS binary → JSON (lossless) |
| `contex stats` | Token counts and cost analysis |
| `contex bench` | Full benchmark suite |
| `benchmark.ts` | Research-grade suite: 11 benchmarks, 12 datasets, 10 formats |
| `generate_report.ts` | Interactive HTML dashboard with Chart.js |
| `metrics.ts` | Isolated measurements: marginal cost, structural overhead, entropy |

## Installation

```bash
pnpm add -g @contex/cli
```

## CLI Commands

```bash
# Materialize tokens for a model (cached)
contex materialize data.json --model gpt-4o

# Inject cached tokens into a fresh prompt
contex inject data.json --provider anthropic

# Compose multiple data blocks into one context
contex compose config.json

# Encode JSON to TENS (raw IR)
contex encode data.json

# Decode TENS to JSON
contex decode data.tens

# Analyze savings
contex savings data.json

# Run benchmarks
contex bench
```

## Benchmark Suite (v4.0)

The benchmark suite provides research-grade analysis across:

- **11 benchmarks**: matrix, marginal cost, structural overhead, context fitting, cost savings, determinism, prefix cache, TENS performance, schema width, tokenizer spread, entropy correlation
- **24 datasets**: flat, nested, sparse, repetitive, long text, real-world, wide schema, deep nested, mixed, extremely sparse, short strings, numeric heavy (and industry specific)
- **10 formats**: JSON (3 variants), YAML, XML, NDJSON, CSV, Markdown, TOON, **TENS v2**
- **Deterministic**: Seeded PRNG (seed: 42) for reproducible results

### Running

```bash
# Run the benchmark (generates benchmark_results.json)
npx tsx packages/cli/src/benchmark.ts

# Generate the interactive HTML report
npx tsx packages/cli/src/generate_report.ts

# View the local report
# → open benchmark_report.html
```

### Key Metrics Measured

| Metric | Description |
|---|---|
| Marginal Cost Slope | Δ tokens per added row |
| Structural Overhead | % of tokens that are structure vs values |
| Schema Width Sensitivity | How formats scale from 10 to 80 columns |
| Tokenizer Spread | Token counts across 4 tokenizer encodings |
| Prefix Retention | How much prefix survives data mutations |
| Entropy Correlation | Which format benefits from repetitive data |
| TENS Performance | Encoding/decoding speed (ops/sec, MB/s) |

See [Benchmarks Guide](../../docs/guide/benchmarks.md) for full documentation.
