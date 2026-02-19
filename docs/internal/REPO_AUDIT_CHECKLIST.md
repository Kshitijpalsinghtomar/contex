# Full Repo Audit Checklist

> **Last updated:** 2026-02-16

---

<div align="center">

## 🎯 Audit Status Summary

| Priority | Status | Items |
|----------|--------|-------|
| **P0** | ✅ Complete | Lockfile/workspace wiring for adapters |
| **P1** | ✅ Complete | Duplicate implementations, unused symbols |
| **P2** | ✅ Complete | Node builtin import protocol standardization |
| **P3** | ✅ Complete | Artifact/config duplication decisions + parity guard |

</div>

---

## P0 — Blocker

- [x] **Lockfile/workspace wiring for adapters**
  - Regenerated install/lock state so `packages/adapters` is included as an importer and `@contex-llm/adapters` resolves workspace deps correctly.
  - Build currently fails resolving `@contex-llm/core` in:
    - `packages/adapters/src/langchain.ts`
    - `packages/adapters/src/llamaindex.ts`

---

## P1 — High

- [x] **Remove duplicate implementation: `prefix_simulation`**
  - Kept one source of truth between:
    - `packages/cli/src/prefix_simulation.ts`
    - `packages/cli/src/__tests__/prefix_simulation.ts`

- [x] **Remove duplicate implementation: `repetition_analysis`**
  - Kept one source of truth between:
    - `packages/cli/src/repetition_analysis.ts`
    - `packages/cli/src/__tests__/repetition_analysis.ts`

- [x] **Unused symbols cleanup (TypeScript strict unused checks)**
  - [x] `packages/core` (22 findings)
  - [x] `packages/cli` (19 findings)
  - [x] `packages/engine` (17 findings)
  - [x] `packages/middleware` (6 findings)
  - [x] `packages/server` (3 findings)

---

## P2 — Medium

- [x] **Node builtin import protocol (`node:`) standardization**
  - Applied fixes in:
    - `website/vite.config.js`
    - `packages/adapters/src/langchain.ts`
    - `packages/adapters/src/llamaindex.ts`
    - `packages/cli/src/__tests__/generate_accuracy_test.ts`

---

## P3 — Low

- [x] **Artifact duplication decision (intentional vs accidental)**
  - Review pair:
    - `packages/cli/benchmark_report.html`
    - `website/report.html`
  - Decision: intentional mirror for docs/site distribution.

- [x] **Fixture/root data duplication decision**
  - Review pair:
    - `my_test_data.json`
    - `packages/cli/fixtures/my_test_data.json`
  - Decision: intentional root sample + CLI fixture copy.

- [x] **Config duplication decision (boilerplate divergence risk)**
  - `tsconfig` pair:
    - `packages/core/tsconfig.json`
    - `packages/engine/tsconfig.json`
  - `vitest` set:
    - `packages/core/vitest.config.ts`
    - `packages/engine/vitest.config.ts`
    - `packages/middleware/vitest.config.ts`
  - Decision: keep duplicates but enforce parity via `scripts/check-config-parity.mjs` and CI.

---

## ✅ Working Notes

| Item | Status | Notes |
|------|--------|-------|
| P0 | ✅ Verified | Verified with `pnpm build` |
| P1 | ✅ Verified | Verified with package-level `tsc --noEmit --noUnusedLocals --noUnusedParameters` |
| P2 | ✅ In good state | Lint warnings reduced from 205 → 0; `errors=0` |
| P3 | ✅ Verified | Decisions documented; parity guard wired in scripts + CI |

---

## Related Documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md) — Development guidelines
- [CONTEX_V3_MASTER.md](./CONTEX_V3_MASTER.md) — Architecture source of truth
