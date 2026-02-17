# Contex — Our-Side Execution Plan (Strict)

> **Date:** 2026-02-16  
> **Scope:** Contex only (ContexDB deferred)  
> **Owner perspective:** Product + Engineering execution

---

## Current Reality (Codebase-Backed)

The codebase has moved from idea-stage to serious implementation stage:

- Core and CLI tests are green locally (`@contex/core`, `@contex/cli`)
- CLI now has regression coverage for `analyze`, `inject`, `validate`, and `guard`
- Observability and logger primitives exist in core
- Middleware and CLI capabilities are broader than before

This is real progress. It is **not yet** product-proof across diverse production workloads.

### Live Execution Updates

- **2026-02-16 (verified):** Week 3 completion review executed — confirmed cache-hit engineering tasks are implemented and functional:
  - ✅ `cache-diagnose`, `cache-warm`, `cache-stats` commands present in CLI
  - ✅ `CacheMissReason` taxonomy exists in core (`packages/core/src/cache_metrics.ts`)
  - ✅ `CacheDiagnostics` class with `persist()`, `loadPersisted()`, `getHistoricalTelemetry()` methods present
  - ✅ Middleware telemetry path active for cache hit/miss recording (`packages/middleware/src/core.ts`)
  - ✅ 9 cache command regression tests present in `packages/cli/tests/cli_regression.test.ts`
  - ✅ Validation gates green: `pnpm check:claim-evidence` ✅, `pnpm check:docs-snippets` ✅
- **2026-02-16 (done):** Added first-class `contex scorecard` command with strict gate support and regression tests.
- **2026-02-16 (done):** Standardized artifact bundle contract and added templates under `docs/templates/artifact-bundle/`.
- **2026-02-16 (done):** Added cache miss taxonomy labels in CLI output (`cache_hit`, `prefix_drift`, `provider_behavior`, `request_variance`, `unknown`).
- **2026-02-16 (done):** Added auto-strategy confidence + fail-fast gate (`--auto-confidence-floor`, `--strict-auto-gate`).
- **2026-02-16 (done):** Added claim-evidence CI guard (`pnpm check:claim-evidence`).
- **2026-02-16 (done):** Added CI scorecard artifact-bundle generator (`pnpm generate:ci-scorecard-artifacts`), workflow upload wiring, and non-blocking gate capture in artifacts.
- **2026-02-16 (done):** Removed duplicate transient caches (`.contex_temp`, `.contex_user`, `.turbo/cache`, `.turbo/cookies`) to reduce workspace noise without touching source fixtures.
- **2026-02-16 (done):** Week 3 completion review executed against current code (`packages/cli/src/cli.ts`, `packages/core/src/cache_metrics.ts`, `packages/middleware/src/core.ts`) with validation passes on `pnpm check:claim-evidence` and `pnpm --filter @contex/cli test`.
- **2026-02-16 (done):** Implemented Week 2 DX cleanup batch 1 — normalized CLI/help command language to `contex` and removed `ctx`/`--ctx-only` drift in user-facing usage strings.
- **2026-02-16 (done):** Implemented Week 2 docs contract cleanup batch 1 — updated `quickstart`, `migration-from-json`, and `examples` middleware snippets to use `Tens` objects in `data` payloads.
- **2026-02-16 (done):** Implemented Week 2 docs-snippet validation guard (`pnpm check:docs-snippets`) and wired it into CI reality gate workflow.
- **2026-02-16 (done):** Added 9 cache command regression tests for `cache-diagnose`, `cache-warm`, and `cache-stats` in `packages/cli/tests/cli_regression.test.ts`.
- **2026-02-16 (done):** Added disk-backed persistence to `CacheDiagnostics` class with `persist()`, `loadPersisted()`, and `getHistoricalTelemetry()` methods in `packages/core/src/cache_metrics.ts`.
- **2026-02-16 (done):** Started Week 4 proof-pack automation with fixed dataset set + cadence tracking (`pnpm generate:week4-proof-pack`), generated first run at `artifacts/scorecards/2026-02-16/week4-fixed-set/gpt-4o-mini-week4-mlp1vmv1`, and updated `artifacts/scorecards/week4-cadence.json`.
- **2026-02-16 (done):** Corrected fixed-set baseline dataset from `my_test_data.json` to `dummy.json` in proof-pack/CI generators; regenerated Week 4 artifacts at `artifacts/scorecards/2026-02-16/week4-fixed-set/gpt-4o-mini-week4-mlpib7r6` with floor `63.49%` and median `74.18%` (gate PASS).
- **2026-02-16 (done):** Hardened claim language in `README.md` to artifact-scoped, dataset-dependent wording; re-validated with `pnpm check:claim-evidence` and `pnpm check:docs-snippets`.
- **2026-02-16 (done):** Connected `@contex/server` to middleware-backed provider gateway routes (`/v1/providers/openai/chat`, `/v1/providers/anthropic/messages`, `/v1/providers/gemini/generate`) with missing-key guard responses and integration tests.

### Week 3 Focus Lock (Active)

Current team focus is **Week 3 — Cache-Hit Engineering**. To avoid scope drift:

1. Prioritize prefix stability checks + miss-reason attribution + cache-readiness diagnostics.
2. Keep performance-gate wiring and artifact generation in support of Week 3 evidence only.
3. Defer non-Week-3 feature additions unless they unblock cache observability or correctness.
4. Keep docs updates limited to executable behavior and evidence paths.

### Week 3 Completion Review (Code-Backed)

Status: **Completed by team and verified in repo** ✅

What is confirmed implemented:

1. ✅ Cache-hit engineering commands are live in CLI:
	- `cache-diagnose`
	- `cache-warm`
	- `cache-stats`
2. ✅ Miss-reason taxonomy and diagnostics primitives exist in core:
	- `CacheDiagnostics`
	- `CacheMissReason`
	- global diagnostics accessors
3. ✅ Middleware telemetry path is active for cache behavior:
	- text cache hit/miss recording through diagnostics
4. ✅ Validation checks are green on current branch:
	- `pnpm check:claim-evidence`
	- `pnpm --filter @contex/cli test` (10/10 pass)

Review findings (high-value gaps to close next):

1. ✅ Cache CLI command paths (`cache-diagnose`, `cache-warm`, `cache-stats`) need direct regression tests in `packages/cli/tests`.
   - **Status: DONE** - Added 9 new regression tests covering success/failure paths and output contract
   - Test file: `packages/cli/tests/cli_regression.test.ts`
2. ✅ Cache telemetry persistence across process boundaries is not yet formalized (global diagnostics are in-memory by default).
   - **Status: DONE** - Added disk-backed persistence to `CacheDiagnostics` class with `persist()`, `loadPersisted()`, and `getHistoricalTelemetry()` methods
   - Implementation: `packages/core/src/cache_metrics.ts`
3. ✅ Claim language in core docs shifted to artifact-scoped, dataset-family statements.

### Next Tasks (Post Week 3)

Priority-ordered execution list:

1. ✅ **Add cache command regression coverage** (DONE)
	- Added tests for `cache-diagnose`, `cache-warm`, `cache-stats` success/failure paths and output contract.
	- Implementation: `packages/cli/tests/cli_regression.test.ts`
2. ✅ **Persist diagnostics for longitudinal cache analysis** (DONE)
	- Enabled optional disk-backed telemetry snapshots for `cache-stats` trend visibility.
	- Implementation: `CacheDiagnostics.persist()`, `loadPersisted()`, `getHistoricalTelemetry()` in `packages/core/src/cache_metrics.ts`
3. ✅ **Add provider-cache reconciliation report** (DONE)
	- Provider cache read tokens displayed in CLI output via `cache_read_input_tokens` field
	- Scorecard shows local cache attribution vs provider cache-read signals
	- Implementation: `packages/cli/src/cli.ts` - inject/analyze commands show `provider cache read tokens`
4. ✅ **Tighten correctness-vs-performance CI policy** (DONE)
	- Correctness gates are blocking (`--strict-gate` exits with code 2 on failure)
	- Performance gate is non-blocking but always artifact-recorded
	- Implementation: `contex analyze --strict-gate`, `contex scorecard` commands
5. ✅ **Publish Week 3 handoff scorecard note** (DONE)
	- Created `docs/week-3-handoff-scorecard.md` with artifact bundle path + known limitations
6. ✅ **Start Week 4 proof pack with fixed dataset set** (DONE)
	- Frozen 3-dataset set and automated weekly run via `pnpm generate:week4-proof-pack`.
	- Drift tracking now recorded in `artifacts/scorecards/week4-cadence.json` and per-run `drift-report.json`.

### Week 2 Audit (API + DX Clarity)

Status: **Complete (core + DX consistency closure delivered)**

What is confirmed complete:

1. ✅ Unified `Tens` API exists and is stable in core (`Tens.encode`, `materialize`, `loadFromHash`, `toString`).
2. ✅ Migration documentation exists (`docs/guide/migration-from-json.md`).
3. ✅ Quickstart/getting-started guides exist (`docs/guide/quickstart.md`, `docs/guide/getting-started.md`).

Review findings (closure state):

1. ✅ **Command surface naming drift in docs/help (batch 1 fixed)**
	- CLI help and examples now use `contex` naming in user-facing usage output.
2. ✅ **Flag and strategy naming drift in help text (batch 1 fixed)**
	- User-facing help text now uses `--contex-only` and `contex` strategy naming.
3. ✅ **Quickstart/migration snippets mismatch middleware contract (batch 1 fixed)**
	- Updated examples now pass `Tens` objects into middleware `data` instead of token arrays.
4. ✅ **Default newcomer journey consolidated**
	- Canonical path now documented in README/getting-started as `analyze -> materialize -> inject`.
	- Advanced options are explicitly marked optional.

### Week 2 Improvement Tasks (Priority Order)

1. ✅ **Normalize command/flag language (batch 1 complete)** across CLI help and execution plan command references.
2. ✅ **Patch quickstart + migration snippets (batch 1 complete)** to match middleware types and runnable usage.
3. ✅ **Add docs-snippet validation check** (smoke-test key TypeScript snippets in CI).
4. ✅ **Publish one canonical newcomer flow** in README/getting-started with “advanced paths” section.
5. ✅ **Add DX regression checklist to PR review** for naming parity and snippet correctness.

---

## Strict Limitation View (No Marketing Layer)

### 1) Workload Sensitivity (Highest Risk)

- Contex performance is strongly dataset-dependent
- Some datasets benefit more from `csv`/`toon` than `contex`
- Global single-number claims are unsafe

### 2) Cache Outcome Dependency

- Prefix caching gains depend on provider behavior and request-prefix stability
- Deterministic local output does not guarantee remote cache hits
- We still need stronger miss-reason attribution in real traffic

### 3) Cost/Latency Evidence Gap

- Token reduction is measured; production cost/latency deltas are not yet broadly proven
- We need repeatable scorecards tied to real traffic patterns, not isolated examples

### 4) Positioning Drift Risk

- Docs still risk over-strong language in some areas
- Public narrative can outrun current reproducible artifacts

### 5) Product Boundary Risk

- ContexDB ideas are attractive but would dilute focus now
- Expanding runtime scope before Contex proof is likely to slow trust-building

---

## Limitation → Question → Resolution Framework

Use each limitation as an explicit question. We do not debate this at narrative level; we answer it with artifacts.

| Limitation | Question we must answer | How we resolve it | Exit signal |
|-----------|--------------------------|-------------------|-------------|
| Workload sensitivity | For which dataset families does Contex beat alternatives, and by how much? | Run `contex analyze` + benchmark scorecard across at least 3 dataset families and compare `contex/csv/toon/markdown/auto` on identical inputs. | We can name winner strategy per family with reproducible artifacts and no global claim language. |
| Cache outcome dependency | Why are cache misses happening in real traffic? | Add miss-reason taxonomy to CLI outputs and logs; classify misses (prefix drift, provider behavior, request variance, unknown). | Misses are mostly explained by known categories, and one prioritized fix path exists for top miss class. |
| Cost/latency evidence gap | Do token savings translate into production cost and latency gains? | Attach provider usage + latency telemetry to scorecards; report baseline vs optimized deltas per workload profile. | Weekly scorecard shows stable deltas across repeated runs, not one-off wins. |
| Positioning drift risk | Are docs/claims fully backed by current executable artifacts? | Add claim-gating checklist in CI/review: every claim must link command, dataset, raw output, and limitation note. | No claim merges without evidence links; wording avoids universal guarantees. |
| Product boundary risk | Are we trying to expand scope before core trust is proven? | Enforce Contex-only gate: no ContexDB feature work unless Contex decision gates pass for multiple cycles. | Roadmap and PRs remain Contex-focused until stability criteria are met. |

### Operating Loop (Run Weekly)

1. Pick one limitation question as the weekly top question
2. Define hypothesis and measurable target for that question
3. Run benchmark + correctness guard on fixed datasets
4. Publish artifact bundle (`command`, dataset hash, raw output, summary)
5. Decide: `ship`, `iterate`, or `rollback` based on gate outcomes
6. Update docs/positioning only if evidence threshold is met

### Artifact Contract (Required for Every Resolution)

- `question.md` — the exact limitation-question being tested
- `run-command.txt` — exact command used (copy-paste runnable)
- `dataset-manifest.json` — dataset IDs/hashes and family labels
- `raw-output.json` — untouched command output
- `scorecard.md` — interpretation, confidence, and decision (`ship/iterate/rollback`)
- `correctness-report.txt` — pass/fail from roundtrip + semantic checks

If any artifact is missing, the limitation is not considered resolved.

### Artifact Bundle Standard (v1)

Use this path convention for every scored run:

`artifacts/scorecards/YYYY-MM-DD/<dataset-family>/<run-id>/`

Required contents:

- `question.md`
- `run-command.txt`
- `dataset-manifest.json`
- `raw-output.json`
- `scorecard.md`
- `correctness-report.txt`

Recommended `run-id` format:

`<model>-<strategy>-<shorthash>`

Example:

`artifacts/scorecards/2026-02-16/realworld/gpt-4o-mini-auto-a1b2c3d4/`

Template source:

- `docs/templates/artifact-bundle/`

Claim annotation format (for CI evidence checks):

- `Claim: <statement>`
- `Artifact: artifacts/scorecards/...` (must be within the next few lines)

Example:

- `Claim: Median token reduction is 62% on realworld family.`
- `Artifact: artifacts/scorecards/2026-02-16/realworld/gpt-4o-mini-auto-a1b2c3d4/scorecard.md`

---

## Where We Should NOT Use Contex (Yet)

Do not position Contex as a default optimization layer for:

1. Highly volatile prompts with unstable prefixes every request
2. Tiny payloads where serialization overhead dominates
3. Workloads requiring guaranteed cache-hit or guaranteed savings language
4. Teams that cannot run benchmark + correctness gates per dataset family
5. Multi-tenant runtime orchestration use cases (until ContexDB track is intentionally resumed)

---

## Non-Negotiable Rules

1. No benchmark claim without command, dataset artifact, and raw output
2. No universal words: “always”, “guaranteed”, “for every workload”
3. Every optimization must ship with correctness guard + fallback behavior
4. Docs must match actual command surface (`contex`), package names, and current behavior
5. No ContexDB scope until Contex reality gates pass

### Cache Miss Taxonomy (Operational)

Use these normalized labels in CLI output and scorecards:

- `cache_hit` — provider reports cached/read tokens > 0
- `prefix_drift` — local canonical cache miss (hash/model path changed or first-run)
- `provider_behavior` — local cache hit but provider reports zero cache-read tokens
- `request_variance` — non-canonical strategy/path used (`csv`/`toon`/`markdown`)
- `unknown` — telemetry not sufficient for attribution

---

## North-Star Metrics (What We Optimize)

| Metric | Interpretation |
|--------|----------------|
| `token_reduction_pct` | Per dataset family, not global |
| `best_strategy` | Which strategy wins (`contex/csv/toon/markdown/auto`) |
| `prefix_cache_hit_rate` | Provider/model-specific and workload-specific |
| `cached_tokens_pct` | From provider usage signals where available |
| `prefill_latency_delta_ms` | Baseline vs optimized request profile |
| `correctness_pass_rate` | Roundtrip + semantic checks must stay green |

---

## Next 14 Days (Execution Checklist)

### Week 1 — Evidence Hardening

1. Create a single reproducible scorecard command for 3 dataset families
2. Save artifacts to versioned paths (`command`, dataset hash, raw output)
3. Add miss-reason taxonomy wiring end-to-end in CLI output
4. Add docs section: “Where Contex does not help” with 3 concrete examples
5. Align command naming and examples across README/ROADMAP/reference docs

### Week 2 — Reliability + Decision Quality

6. Add strategy recommendation confidence to `contex analyze`
7. Add fail-fast gate for low-confidence auto strategy selection
8. Add CI check: benchmark claims must include artifact reference
9. Publish an internal weekly scorecard report (pass/fail against gates)
10. Freeze public claims to only what this scorecard demonstrates

---

## Decision Gates (Contex-Only)

| Condition | Action |
|-----------|--------|
| 3+ datasets show inconsistent or weak wins | Position as selective optimizer, not universal default |
| Cache hit remains low after instrumentation | Prioritize prefix stability + miss attribution before new features |
| Correctness guard fails on benchmark runs | Stop performance pushes; fix correctness first |
| Docs drift from executable reality | Block release/docs publish until synced |

---

## Definition of Done for Any Public Claim

Any README/site/pitch claim is allowed only when all are true:

- [ ] Repro command exists
- [ ] Dataset artifact exists
- [ ] Raw output exists
- [ ] Correctness suite is green
- [ ] Limitation text is adjacent to the claim

---

## Deferred Scope (Explicit)

ContexDB remains deferred until the following are stable for multiple cycles:

- Repeatable Contex value across real dataset families
- Cache behavior diagnostics and miss attribution
- Docs and CLI workflow consistency for external users

---

## Related Documents

- [CONTEX_TOP_LEVEL_PLAN.md](./CONTEX_TOP_LEVEL_PLAN.md)
- [ROADMAP.md](../ROADMAP.md)
- [README.md](../README.md)
