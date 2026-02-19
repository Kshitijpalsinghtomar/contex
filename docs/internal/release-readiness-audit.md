# Contex Release-Readiness Structural Consolidation Audit

Date: 2026-02-16
Scope: Structural consolidation and release readiness (no feature implementation)

---

## 1) True Production Execution Map

### Primary execution path (actual provider injection path)

1. API/provider wrapper entry:
   - `packages/middleware/src/openai.ts`
   - `packages/middleware/src/anthropic.ts`
   - `packages/middleware/src/gemini.ts`
2. Shared placeholder + context manager:
   - `packages/middleware/src/core.ts` (`ContexContext`)
3. Canonical IR encoding:
   - `packages/core/src/ir_encoder.ts` (`encodeIR`)
4. Store/materialize/cache:
   - `packages/core/src/memory.ts` (`TokenMemory.store`, `materializeAndCache`)
   - `packages/core/src/materialize.ts` (`materialize`, model encoding mapping)
5. Canonical text emission and injection:
   - `packages/middleware/src/core.ts` (`JSON.stringify(ir.data)` / `Tens.toString()`)
6. Provider call pass-through:
   - same wrapper files in step 1

### Secondary paths

- **Secondary A: Server runtime path (canonical IR path)**
   - `packages/server/src/index.ts`
   - Uses `encodeIR` + `TokenMemory` for `/v1/encode` and `/v1/decode`
   - Uses `@contex-llm/engine` `Contex` class for optimize/query/collections

- **Secondary B: CLI IR tooling path**
  - `packages/cli/src/cli.ts`
  - Commands: `ir-encode`, `ir-inspect`, `ir-materialize`, `materialize`, `compose`

### Dead execution paths

- `packages/engine/src/index/btree.ts` (declared phase-2 stub, no runtime usage)
- `packages/engine/src/schema/registry.ts` (no call sites)
- `packages/engine/src/test_persistence.ts` (script-like file under `src`)
- `packages/engine/src/test_rag.ts` (script-like file under `src`)

### Experimental paths

- `packages/core/src/compose.ts` and compose workflow (CLI/test-facing, not provider runtime path)
- `packages/middleware/src/injection.ts` (`injectContexContent`) exported but not used by wrappers
- `packages/tens-wasm` (workspace excluded)

---

## 2) File Classification Table

| File / Area | Classification | Notes |
|---|---|---|
| `packages/middleware/src/openai.ts` | PRODUCTION | Real wrapper entrypoint |
| `packages/middleware/src/anthropic.ts` | PRODUCTION | Real wrapper entrypoint |
| `packages/middleware/src/gemini.ts` | PRODUCTION | Real wrapper entrypoint |
| `packages/middleware/src/core.ts` | PRODUCTION | Shared v3 IR pipeline manager |
| `packages/core/src/ir_encoder.ts` | PRODUCTION | Canonical IR entry function |
| `packages/core/src/memory.ts` | PRODUCTION | Store/load/materialization cache |
| `packages/core/src/materialize.ts` | PRODUCTION | Model-specific token materialization |
| `packages/core/src/canonical.ts` | PRODUCTION | Deterministic canonicalization |
| `packages/server/src/index.ts` | EXPERIMENTAL | Runtime path uses legacy token-stream APIs, not canonical IR |
| `packages/core/src/compose.ts` | EXPERIMENTAL | Mainly test/CLI usage; not in provider runtime path |
| `packages/engine/src/quick.ts` | EXPERIMENTAL | Exported API, little runtime integration |
| `packages/middleware/src/injection.ts` | EXPERIMENTAL | Exported helper, not wired by wrappers |
| `packages/core/src/tens_text.ts` | DEPRECATED | Marked deprecated in public exports |
| `packages/core/src/contex.ts` (`compile`) | DEPRECATED | Legacy surface with TENS-Text emphasis |
| `packages/engine/src/index/btree.ts` | DISCONNECTED | Stub + no external usage |
| `packages/engine/src/schema/registry.ts` | DISCONNECTED | No external usage |
| `packages/engine/src/test_persistence.ts` | DISCONNECTED | Dev script in `src` |
| `packages/engine/src/test_rag.ts` | DISCONNECTED | Dev script in `src` |
| `packages/tens-wasm/*` | DISCONNECTED | Not in active workspace package set |

---

## 3) Structural Fragmentation Findings

### Canonicalization / IR encoding fragmentation

- **v3 canonical IR path exists and is integrated in middleware/core**:
  - `encodeIR` -> `TokenMemory` -> `materialize`
- **parallel legacy path remains active in server/engine**:
  - direct `TokenStreamEncoder/Decoder`
- Result: two non-unified runtime paths contradicting single deterministic canonical IR path objective.

### Materialization fragmentation

- Materialization is in `@contex-llm/core` and works, but there are multiple ways to get tokens (`Tens.materialize`, `TokenMemory.materializeAndCache`, legacy token stream APIs).
- Composition (`compose`) is present but not part of wrapper runtime pipeline.

### Middleware injection fragmentation

- Wrappers use text injection from canonical JSON.
- `injectContexContent` token-path helper exists but is not integrated into wrappers.
- `providerSupportsTokens` defaults to false for all providers (effectively disables token injection path).

### Memory/cache fragmentation

- Strong `TokenMemory` mechanism exists.
- Server's active route path does not leverage the same canonical IR storage/materialization flow for encode/decode endpoints.

---

## 4) Release Risk List

| Severity | Risk | Evidence |
|---|---|---|
| CRITICAL | Dual runtime architectures (legacy token-stream + canonical IR) | `packages/server/src/index.ts` vs `packages/middleware/src/core.ts` + `packages/core/src/ir_encoder.ts` |
| HIGH | Test/demo/dev files in package build surfaces | Most package `tsconfig.json` include `src/**/*` with no test/examples exclusions |
| HIGH | Documentation/API drift (invalid signatures and examples) | `docs/reference/core.md`, `docs/architecture.md`, `docs/guide/comparison.md`, `docs/reference/middleware.md` |
| MEDIUM | Disconnected stubs and partially integrated subsystems | `packages/engine/src/index/btree.ts`, `packages/engine/src/schema/registry.ts` |
| MEDIUM | Exported but practically inactive token injection route | `packages/middleware/src/injection.ts` + `packages/middleware/src/config.ts` |
| LOW | Lint debt concentrated in CLI tests/dev scripts | `biome-warnings-latest.json`, `biome-final-lint.txt` |

---

## 5) Package Structure Validation

### Expected layering

- `@contex-llm/core`: canonicalization, IR, materialization, cache primitives
- `@contex-llm/engine`: budget/selection/context APIs
- `@contex-llm/middleware`: provider wrappers + injection
- `@contex-llm/cli`: tooling and operational workflows

### Findings

- **Cross-layer violations:** none severe in import graph.
- **Circular dependencies:** none detected.
- **Responsibility leaks:**
  - `@contex-llm/server` runtime path bypasses canonical IR path for encode/decode.
  - `@contex-llm/core` exports both modern and legacy/deprecated surfaces.
  - `@contex-llm/engine` contains disconnected storage/index files under active source tree.

### Integrity verdict

- Dependency layering is mostly clean.
- Runtime behavior is not architecturally unified (release concern).

---

## 6) Safe Structural Cleanup List

### DELETE (safe)

- `packages/engine/src/test_persistence.ts`
- `packages/engine/src/test_rag.ts`

### ARCHIVE (safe)

- `packages/engine/src/index/btree.ts`
- `packages/engine/src/schema/registry.ts`
- `packages/tens-wasm/` (or keep as clearly isolated paused track)

### MERGE / CONSOLIDATE

- Consolidate server encode/decode to canonical IR + `Tens`/`TokenMemory` flow:
  - `packages/server/src/index.ts`
- Consolidate public narrative away from legacy compile/TENS-Text-first path:
  - `packages/core/src/contex.ts`
  - docs referencing `Tens.encodeIR`, `Tens.store`, `Tens.wrap*`, `toString('toon')`

---

## 7) Execution Integrity Validation

Requested statuses:

| Primitive | Status | Notes |
|---|---|---|
| `Tens.encodeIR` | UNUSED | Method does not exist on `Tens`; equivalent function `encodeIR` exists and is used |
| `Tens.materialize` | PARTIAL | Works and used; not sole runtime token path; server still legacy |
| `Tens.store` | UNUSED | Method does not exist; storage lives in `TokenMemory` |
| `Tens.compose` | UNUSED | Method does not exist; `compose()` function exists |
| middleware injection | PRODUCTION_READY (text) / PARTIAL (token) | Wrappers are stable for deterministic text injection; token route not actively enabled |

---

## 8) Documentation Alignment Audit

| Document | Status | Reason |
|---|---|---|
| `docs/architecture.md` | ALIGNED | Layer/method references now match current middleware/core runtime path |
| `docs/reference/core.md` | ALIGNED | Updated examples/options to current `Tens`/`TokenMemory`/`Materializer` signatures |
| `docs/reference/middleware.md` | ALIGNED | Recreated with current wrapper signatures and placeholder flow |
| `docs/guide/comparison.md` | ALIGNED | Recreated with API-valid strategy examples and usage |
| `README.md` | PARTIAL | High-level direction aligns, but API-level claims and "stable" framing exceed structural reality |
| `docs/PRD.md` | PARTIAL | Architectural intent aligns with v3 path but not all runtime edges are unified |

---

## 9) Release Consolidation Plan (Ordered)

1. **Freeze canonical execution contract**
   - Officially define one runtime path: `encodeIR -> TokenMemory -> materialize -> middleware deterministic injection`.

2. **Unify server path onto canonical IR**
   - Replace direct TokenStream encode/decode route internals with canonical IR/Tens path.

3. **Remove or quarantine dead/experimental internals**
   - Delete safe files, archive disconnected stubs, isolate paused systems.

4. **Harden build boundaries**
   - Exclude `src/__tests__`, `src/examples`, `src/test_*.ts` from production package tsconfig builds (except dedicated test projects).

5. **Normalize public API surface**
   - De-emphasize/deprecate legacy compile/TENS-Text pathways in release-facing docs and examples.

6. **Documentation truth pass**
   - Rewrite architecture/core/middleware docs to exact current signatures and runtime flow.

7. **Add release gates**
   - CI checks:
     - no legacy TokenStream usage in production entrypoints,
     - docs snippet compile checks,
     - dead path detection / orphan export checks.

8. **Stabilization freeze**
   - No new features until structural unification and doc parity gates are green.

---

## 10) Execution Status (Current Repo Check)

Status legend: `DONE` / `PARTIAL` / `NOT_DONE`

1. **Freeze canonical execution contract** — `DONE`
   - Canonical runtime behavior is implemented in code paths (`encodeIR -> TokenMemory -> materialize -> middleware deterministic injection`).
   - Canonical contract is now codified via `scripts/check-canonical-execution-contract.mjs` and exposed as `pnpm check:canonical-contract`.
   - CI workflow `.github/workflows/cli-reality-gate.yml` enforces the canonical contract gate.

2. **Unify server path onto canonical IR** — `DONE`
   - `packages/server/src/index.ts` uses `encodeIR` + `TokenMemory` for `/v1/encode` and `/v1/decode`.
   - Legacy `TokenStreamEncoder`/`TokenStreamDecoder` usage was removed from server runtime path.

3. **Remove or quarantine dead/experimental internals** — `DONE`
   - Deleted: `packages/engine/src/test_persistence.ts`, `packages/engine/src/test_rag.ts`.
   - Archived: `packages/engine/archive/index/btree.ts`, `packages/engine/archive/schema/registry.ts`.
   - Structural integrity guard enforces that deleted/disconnected paths do not re-enter `src` runtime surfaces.

4. **Harden build boundaries** — `DONE`
   - Package `tsconfig.json` files exclude `src/__tests__`, `src/examples`, and `src/test_*.ts` (plus `*.test.ts`/`*.spec.ts` where applicable).

5. **Normalize public API surface** — `DONE`
   - Added `check:no-legacy-surface-claims` to enforce canonical release-facing API narrative and block legacy surface claims.
   - Updated remaining invalid public examples (`toString('toon')` -> `formatOutput(...)`) and validated gate pass.

6. **Documentation truth pass** — `DONE`
   - Corrected API drift in `docs/architecture.md` and `docs/reference/core.md`.
   - Added `docs/reference/middleware.md` with current wrapper signatures and options.
   - Added `docs/guide/comparison.md` with API-valid strategy examples.

7. **Add release gates** — `DONE`
   - Added and wired: `check:canonical-contract`, `check:no-legacy-tokenstream`, `check:structural-integrity`, `check:docs-snippets`, `check:claim-evidence`, `check:config-parity`, `check:no-legacy-surface-claims`.
   - CI workflow `.github/workflows/cli-reality-gate.yml` runs these gates.

8. **Stabilization freeze** — `DONE`
   - Stabilization freeze policy is codified with `scripts/check-stabilization-freeze.mjs`.
   - Root script `pnpm check:stabilization-freeze` and CI workflow gate enforce required structural/doc-parity release checks before progression.

---

## Appendix: Primary Evidence Files

- `packages/middleware/src/openai.ts`
- `packages/middleware/src/anthropic.ts`
- `packages/middleware/src/gemini.ts`
- `packages/middleware/src/core.ts`
- `packages/core/src/ir_encoder.ts`
- `packages/core/src/memory.ts`
- `packages/core/src/materialize.ts`
- `packages/server/src/index.ts`
- `packages/engine/src/index/btree.ts`
- `packages/engine/src/schema/registry.ts`
- `packages/core/src/index.ts`
- `docs/architecture.md`
- `docs/reference/core.md`
- `docs/reference/middleware.md`
- `docs/guide/comparison.md`
