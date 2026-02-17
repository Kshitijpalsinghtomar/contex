# High-Gain Playbook: Contex vs CSV vs TOON vs Markdown

> **Use this playbook when you want real token wins in production workloads.**

---

<div align="center">

## Quick Rule of Thumb

| Format | Best For |
|--------|----------|
| **CSV** | Flat, mostly tabular rows with stable columns |
| **TOON** | Semi-structured records with nested-but-regular fields |
| **Contex** | Determinism, caching, and SDK injection matter most |
| **Markdown** | Readability is a primary requirement |

</div>

---

## Table of Contents

1. [Workload Mapping](#workload-mapping)
2. [CLI Workflow](#cli-workflow)
3. [Production Guardrails](#production-guardrails)
4. [Practical Targeting](#practical-targeting)

---

## Workload Mapping

### 1) Flat Operational Tables

**Examples:** support tickets, orders, inventory snapshots

| Strategy | Notes |
|----------|-------|
| **First try:** `csv` | CSV has minimal structural overhead when schema is stable |
| **Fallback:** `toon` | |

### 2) Nested but Repeatable Business Objects

**Examples:** user profiles with nested preferences, CRM entities

| Strategy | Notes |
|----------|-------|
| **First try:** `toon` | TOON keeps structure compact while preserving repeated key/value patterns |
| **Fallback:** `contex` | |

### 3) Mixed or Unstable Schemas

**Examples:** event payloads with optional fields, heterogeneous rows

| Strategy | Notes |
|----------|-------|
| **First try:** `contex` | Canonicalization and deterministic encoding handle drift better |
| **Fallback:** `toon` | |

### 4) Human-in-the-Loop Review Prompts

**Examples:** analyst review, report explanation, QA summaries

| Strategy | Notes |
|----------|-------|
| **First try:** `markdown` | Readability can outweigh pure token efficiency |
| **Fallback:** `toon` | |

---

## CLI Workflow

### Compare All Strategies

Run one command to compare all strategies:

```bash
contex analyze my_data.json --strategy contex,csv,toon,markdown,auto --reality-gate
```

### Enforce Input Safety

Enforce input safety before expensive calls:

```bash
contex inject my_data.json --provider openai --strategy auto --dry-run
```

### Set Hard Budget Cap

If needed, set a hard budget cap:

```bash
contex inject my_data.json --provider anthropic --strategy auto --max-input-tokens 30000 --dry-run
```

---

## Production Guardrails

| Guardrail | Command |
|-----------|---------|
| **Fail on gate failure** | `contex analyze --strict-gate` |
| **Persist snapshots** | `--out .contex/snapshot.json` |
| **Auto strategy selection** | `--strategy auto` |
| **Check after schema changes** | Re-run with `--strategy auto` |

---

## Practical Targeting

### Baseline Each Dataset Family

```bash
# Run analysis and save snapshot
contex analyze my_data.json --out .contex/scorecard_runs.json
```

### Track Median Reduction

Track median token reduction by dataset family, not one global number.

### Promote Defaults Carefully

Promote strategy defaults only after 3-dataset scorecards stay stable across runs.

---

## Related Documentation

- [Benchmarks](./benchmarks.md) — Performance data
- [Getting Started](./getting-started.md) — Quick tutorial
- [API Reference](../reference/core.md) — Full API docs
