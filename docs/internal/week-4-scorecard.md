# Week 4 Scorecard — Production Proof Pack

> **Date:** 2026-02-16  
> **Status:** Active (fixed-set cadence enabled)

---

## Goal

Week 4 tracks reproducible scorecard drift using one fixed 3-dataset set and a repeatable artifact bundle.

---

## Fixed Dataset Set (Frozen)

| Family | Path |
|--------|------|
| baseline | `dummy.json` |
| synthetic-small | `.contex/dummy_1000.json` |
| synthetic-large | `.contex/dummy_2000.json` |

The dataset manifest is generated each run with SHA-256 hashes to enforce fixed-input comparability.

### Baseline Clarification

- `my_test_data.json` is not broken; it is a low-repetition, wide-schema stress-case dataset.
- In `--contex-only` mode it yields ~21.43% reduction and should be tracked as stress-case evidence, not the fixed-set baseline gate input.
- Fixed-set cadence uses `dummy.json` baseline so floor/median gates reflect the intended production-proof dataset mix.

---

## Weekly Cadence Command

```bash
pnpm generate:week4-proof-pack
```

This command:

1. Runs `contex analyze` on all three fixed datasets
2. Runs `contex scorecard` on the combined snapshot
3. Runs `contex validate dummy.json --semantic-guard`
4. Writes full artifacts to `artifacts/scorecards/YYYY-MM-DD/week4-fixed-set/<run-id>/`
5. Updates cadence history at `artifacts/scorecards/week4-cadence.json`
6. Computes drift deltas (`floor`, `median`, `dataset_count`) vs previous run

---

## Artifact Bundle Contract

Each run includes:

- `question.md`
- `run-command.txt`
- `dataset-manifest.json`
- `raw-output.json`
- `scorecard.md`
- `correctness-report.txt`
- `drift-report.json`

---

## Decision Policy

- `ship` when scorecard gate passes
- `iterate` when scorecard gate fails
- Use drift deltas to determine whether movement is improving, regressing, or flat

---

## Related Documentation

- [CONTEX_TOP_LEVEL_PLAN.md](./CONTEX_TOP_LEVEL_PLAN.md)
- [OUR_SIDE_EXECUTION_PLAN.md](./OUR_SIDE_EXECUTION_PLAN.md)
- [WHERE_CONTEXT_WINS.md](./WHERE_CONTEXT_WINS.md)
