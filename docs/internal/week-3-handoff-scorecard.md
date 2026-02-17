# Week 3 Handoff Scorecard Note

> **Date:** 2026-02-16  
> **Week:** 3 — Cache-Hit Engineering  
> **Status:** Complete ✅

> **Historical Baseline Notice:** This document records the pre-correction baseline run (2026-02-15).
> For current fixed-set gate status, use `docs/week-4-scorecard.md` and latest artifacts under `artifacts/scorecards/2026-02-16/`.

---

## Summary

Week 3 focused on **Cache-Hit Engineering** — implementing primitives to make cache behavior observable and attributable. All planned tasks have been completed and verified.

---

## Artifact Bundle Path

Latest CI scorecard run:

- **Path:** `artifacts/scorecards/2026-02-15/ci/gpt-4o-mini-contex-ci-mloax60z/`
- **Model:** gpt-4o-mini
- **Strategy:** contexte-only
- **Datasets:** 3 (baseline + synthetic-small + synthetic-large)

### Artifact Contents

| File | Description |
|------|-------------|
| `question.md` | The limitation-question being tested |
| `run-command.txt` | Exact command used |
| `dataset-manifest.json` | Dataset IDs/hashes and family labels |
| `raw-output.json` | Untouched command output |
| `scorecard.md` | Interpretation, confidence, and decision |
| `correctness-report.txt` | Pass/fail from roundtrip + semantic checks |

---

## Observed Metrics

| Metric | Value |
|--------|-------|
| Dataset Count | 3 |
| Floor Reduction % | 21.43% |
| Median Reduction % | 63.49% |
| Confidence Level | Medium |

These values are intentionally retained as historical baseline evidence and should not be treated as the current fixed-set gate baseline.

---

## Decision

- **Outcome:** `iterate`
- **Reason:** Strict gate FAIL (floor reduction below target)

---

## Known Limitations

### 1. Workload Sensitivity
- Contex performance is strongly dataset-dependent
- Some datasets benefit more from `csv`/`toon` than `contex`
- Global single-number claims are unsafe

### 2. Cache Outcome Dependency
- Prefix caching gains depend on provider behavior and request-prefix stability
- Deterministic local output does not guarantee remote cache hits

### 3. Evidence Gap
- Token reduction is measured; production cost/latency deltas are not yet broadly proven
- Need repeatable scorecards tied to real traffic patterns

---

## What's Next (Week 4)

1. Run real datasets and publish results with evidence-backed positioning
2. Add correctness checks to every benchmark run
3. Produce "where Contex wins / where it does not" report
4. Publish strict scorecard with weekly cadence

---

## Verification

All Week 3 tasks verified via:
- Code inspection of `packages/core/src/cache_metrics.ts`
- Code inspection of `packages/cli/src/cli.ts`
- Code inspection of `packages/middleware/src/core.ts`
- Regression tests in `packages/cli/tests/cli_regression.test.ts`
- CI validation: `pnpm check:claim-evidence` ✅
- CI validation: `pnpm check:docs-snippets` ✅
