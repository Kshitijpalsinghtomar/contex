<div align="center">

# CLI Reference

> **The Contex CLI** — Command-line tools for compiling, injecting, and analyzing structured data for LLMs.

---

</div>

## Installation

```bash
pnpm add -g @contex-llm/cli
```

### Global Output Flags

- `--ascii`: Force ASCII-only CLI rendering (useful on Windows shells showing garbled box characters)
- `--unicode`: Force Unicode box rendering

---

## Table of Contents

1. [Analyze](#contex-analyze-file)
2. [Scorecard](#contex-scorecard)
3. [Materialize](#contex-materialize-file)
4. [IR Commands](#ir-commands)
5. [Inject](#contex-inject-file)
6. [Compose](#contex-compose-files)
7. [Savings](#contex-savings-file)
8. [Stats](#contex-stats-file)
9. [Formats](#contex-formats-file)
10. [Convert](#contex-convert-file)
11. [Validate](#contex-validate-file)
12. [Guard](#contex-guard-file)
13. [Encode/Decode](#encode--decode)
14. [Bench](#contex-bench)

---

## `contex analyze <file>`

Beautiful analysis report with token savings visualization.

```bash
contex analyze data.json
contex analyze data.json --reality-gate
contex analyze data.json --strategy contex,csv,toon,markdown,auto --strict-gate --out report.json
contex analyze data.json --strategy auto --auto-confidence-floor 55 --strict-auto-gate
contex analyze data.json --fingerprint
contex analyze data.json --fingerprint --no-watermark
```

**Options:**

| Option | Description |
|--------|-------------|
| `--strategy <list>` | Comma-separated strategies to compare |
| `--contex-only` | Keep user path pinned to Contex |
| `--semantic-guard` | Enforce semantic relation fidelity checks |
| `--target-floor <n>` | Hard target for worst-case reduction (default: `35`) |
| `--target-median <n>` | Hard target for median reduction (default: `60`) |
| `--auto-confidence-floor <n>` | Minimum confidence for `auto` recommendation (default: `55`) |
| `--strict-auto-gate` | Exit non-zero when auto confidence falls below threshold |
| `--reality-gate` | Show Dynamic/Needed/Correct/Real pass-fail scorecard |
| `--strict-gate` | Exit non-zero when `real` gate is `FAIL` |
| `--fingerprint` | Emit pipeline fingerprint metadata (hash chain + complexity) |
| `--no-watermark` | Disable watermark output when `--fingerprint` is enabled |
| `--out <file>` | Write benchmark snapshot JSON |

Outputs include:
- Pipeline resource report (CPU, heap delta, throughput, efficiency score)
- Structural complexity report (entropy, depth, sparsity, complexity class)
- Optional fingerprint + watermark boxes (`--fingerprint`)

---

## `contex scorecard`

Builds a reproducible scorecard from latest `analyze` snapshots per dataset.

```bash
contex scorecard
contex scorecard --in .contex/analyze_report.json --model gpt-4o-mini
contex scorecard --target-floor 35 --target-median 60 --min-datasets 3 --strict-gate
```

**Options:**

| Option | Description |
|--------|-------------|
| `--in <file>` | Analyze snapshot input file (default: `.contex/analyze_report.json`) |
| `--out <file>` | Scorecard report output file (default: `.contex/scorecard_report.json`) |
| `--model <id>` | Model key used to filter analyze runs (default: `gpt-4o-mini`) |
| `--target-floor <n>` | Hard floor target for reduction percentage (default: `35`) |
| `--target-median <n>` | Hard median target for reduction percentage (default: `60`) |
| `--min-datasets <n>` | Minimum dataset count required for gate pass (default: `3`) |
| `--strict-gate` | Exit code `2` when scorecard gate fails |

Outputs:
- Terminal gate summary (`datasets`, `floor`, `median`, `pass/fail`)
- JSON report for artifact bundles and CI checks

---

## `contex materialize <file>`

One-step encode + materialize. Compiles JSON to IR and generates model-specific tokens.

```bash
contex materialize data.json --model gpt-4o
```

**Options:**

| Option | Description |
|--------|-------------|
| `--model <id>` | Target model ID (e.g., `gpt-4o`, `claude-3-5-sonnet`) |
| `--max-tokens <n>` | Maximum tokens to generate |
| `--store <dir>` | Cache directory (default: `.contex`) |

---

## IR Commands

### `contex ir-encode <file>`

Encodes JSON to Canonical IR and stores it in the cache.

```bash
contex ir-encode data.json
```

Returns the IR hash for later use with `ir-materialize`.

### `contex ir-inspect <hash>`

Inspects stored IR metadata.

```bash
contex ir-inspect <hash>
```

Shows: Row count, IR size, Schema information, Cached materializations

### `contex ir-materialize <hash>`

Materializes previously stored IR for a specific model.

```bash
contex ir-materialize <hash> --model gpt-4o
```

**Options:**
- `--model <id>`: Target model ID. Required.
- `--dump`: Output first 50 tokens.

---

## `contex inject <file>`

Injects data into a prompt and calls the LLM API.

```bash
contex inject data.json --provider openai --model gpt-4o
contex inject data.json --provider anthropic
contex inject data.json --provider openai --strategy auto
contex inject data.json --provider openai --strategy auto --max-input-tokens 30000 --dry-run
```

**Options:**

| Option | Description |
|--------|-------------|
| `--provider <name>` | LLM provider (`openai`, `anthropic`) |
| `--model <id>` | Model ID (defaults: `gpt-4o` or `claude-3-5-sonnet-20240620`) |
| `--prefer-tokens` | Prefer token injection where supported |
| `--strategy <name>` | Representation strategy (`contex`, `csv`, `toon`, `markdown`, `auto`) |
| `--contex-only` | Force user traffic through Contex canonical path |
| `--semantic-guard` | Abort request if Contex roundtrip relation checks fail |
| `--max-input-tokens <n>` | Explicit input token cap |
| `--dry-run` | Compute and print strategy/token plan without calling provider APIs |

**Requires:** `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` environment variables.

Cache diagnostics are emitted in output as taxonomy labels:

- `cache_hit`
- `prefix_drift`
- `provider_behavior`
- `request_variance`
- `unknown`

---

## `contex compose <files...>`

Composes multiple data blocks into a single prompt with budget validation.

```bash
contex compose file1.json file2.json --model gpt-4o
```

**Options:**

| Option | Description |
|--------|-------------|
| `--model <id>` | Target model ID |
| `--reserve <n>` | Tokens to reserve for response (default: 4096) |
| `--system <text>` | System prompt to include |

---

## `contex savings <file>`

Reports token and cost savings vs JSON.

```bash
contex savings data.json
contex savings data.json --model gpt-4o
contex savings data.json --model gpt-4o --out report.json
```

Shows: Per-model token counts, Cost per 1K calls, Annual savings projection

---

## `contex stats <file>`

Shows TENS encoding statistics.

```bash
contex stats data.json --encoding cl100k_base
```

---

## `contex formats <file>`

Compares all output formats (JSON, CSV, TOON, Markdown, TENS-Text).

```bash
contex formats data.json
```

---

## `contex convert <file>`

Exports data to ALL formats.

```bash
contex convert data.json
```

Creates:
- `data.min.json` - Minified JSON
- `data.csv` - CSV
- `data.md` - Markdown table
- `data.toon` - Token-Oriented Object Notation
- `data.tens.txt` - TENS-Text
- `data.tens` - Binary TENS

---

## `contex validate <file>`

Roundtrip integrity test.

```bash
contex validate data.json
contex validate data.json --semantic-guard
contex validate data.json --fingerprint
contex validate data.json --fingerprint --no-watermark
```

**Options:**
- `--semantic-guard`: Adds strict relation checks
- `--fingerprint`: Emit pipeline fingerprint metadata (hash chain + complexity)
- `--no-watermark`: Disable watermark output when `--fingerprint` is enabled

Validation output now also includes:
- Pipeline resource report
- Structural complexity report
- Optional fingerprint + watermark boxes (`--fingerprint`)

---

## `contex guard <file>`

Semantic diagnostics only (triage-first, no format noise).

```bash
contex guard data.json
contex guard data.json --model gpt-4o-mini
```

Outputs only: semantic pass/fail, row count consistency, field-path coverage, row relation match

**Exit codes:**
- `0` — semantic guard passes
- `2` — semantic guard fails

---

## Encode / Decode

### `contex encode <file>`

Encodes JSON to TENS binary.

```bash
contex encode data.json
```

**Options:**
- `--encoding <id>`: Tokenizer encoding (default: `cl100k_base`)

### `contex decode <file>`

Decodes TENS binary to JSON.

```bash
contex decode data.tens
```

---

## `contex bench`

Runs the full benchmark suite.

```bash
contex bench
```

---

## Related Documentation

- [Getting Started](../guide/getting-started.md) — Full tutorial
- [API Reference](./core.md) — Core API
- [Benchmarks](../guide/benchmarks.md) — Performance data
