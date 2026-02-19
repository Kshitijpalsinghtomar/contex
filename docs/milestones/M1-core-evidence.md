# M1 — Core System Evidence Report

**Status:** ✅ Complete (Engineering Validation)  
**Date Frozen:** 2026-02-18  
**Author:** Kshitij Pal Singh Tomar (@kshitijpalsinghtomar)

---

## Problem Statement

LLM context windows are expensive, inefficient, and non-deterministic when fed raw JSON/text.  
Contex provides a token compiler that canonicalizes structured data into minimal, deterministic token sequences — reducing cost, improving cache hit rates, and enabling reproducible AI pipelines.

## Method

1. **Canonical IR** — Normalize arbitrary structured data into a stable intermediate representation (key-sorted, type-normalized, schema-extracted).
2. **Multi-Format Encoding** — Encode IR into token-optimized formats: CSV, Markdown, TOON, TENS-Text.
3. **Materialization** — Convert IR to model-specific token arrays with caching and fingerprinting.
4. **Budget Engine** — Pack context within token budgets using format selection and priority-based allocation.

## Metrics & Results

| Metric | Target | Achieved |
|--------|--------|----------|
| Token savings vs JSON (CSV) | >50% | 65–67% |
| Token savings vs JSON (TOON) | >60% | 69–70% |
| Token savings vs JSON (TENS-Text) | >15% | 20–27% |
| Determinism (50-iteration identical output) | 100% | 100% |
| Cache hit on repeated materialization | Yes | Yes (sub-0.1ms warm) |
| TENS-Text round-trip fidelity | Lossless | Lossless |
| Test suite pass rate | 100% | 100% (533 tests across core/engine/cli) |

## Evidence Artifacts

- `packages/core/src/__tests__/token_cost_proof.test.ts` — Token savings proof at 10/100/500 rows
- `packages/core/src/__tests__/e2e_ir_pipeline.test.ts` — Full pipeline determinism proof
- `packages/core/src/__tests__/materialize.test.ts` — Materialization caching proof
- `packages/engine/src/__tests__/` — Budget, packer, query, session dedup tests
- `packages/cli/tests/` — CLI integration tests (23 commands)
- `scripts/check-claim-evidence.mjs` — Automated claim-to-evidence validation
- `scripts/check-canonical-execution-contract.mjs` — Contract conformance check
- `scripts/check-structural-integrity.mjs` — Structural integrity check

## Limitations

- Pre-tokenized block speedup test shows <1x on some hardware (CI-dependent).
- TENS-Text savings are lower than columnar formats for flat tabular data.
- No external peer evaluation yet (internal benchmarks only).

## Reproducibility

```bash
pnpm install
pnpm test                          # 533 tests, 0 failures
pnpm run check:claim-evidence      # claim-evidence integrity
pnpm run check:canonical-contract  # canonical contract check
pnpm run check:structural-integrity # structural integrity
pnpm run check:docs-snippets       # documentation validity
```

---

*Frozen as M1 evidence package. Any post-freeze changes require a new milestone.*
