# Artifact Bundle Runbook

This runbook defines the minimum evidence package for any Contex performance claim.

## Path Convention

Store each run at:

`artifacts/scorecards/YYYY-MM-DD/<dataset-family>/<run-id>/`

Example:

`artifacts/scorecards/2026-02-16/realworld/gpt-4o-mini-auto-a1b2c3d4/`

## Required Files

Copy templates from:

`docs/templates/artifact-bundle/`

Required files per run:

- `question.md`
- `run-command.txt`
- `dataset-manifest.json`
- `raw-output.json`
- `scorecard.md`
- `correctness-report.txt`

## Execution Flow

1. Fill `question.md` with one limitation-question.
2. Run `contex analyze` and capture JSON output in `raw-output.json`.
3. Run `contex scorecard` against snapshot input.
4. Complete `scorecard.md` with confidence + decision.
5. Run correctness checks and write `correctness-report.txt`.

CI automation command:

```bash
pnpm generate:ci-scorecard-artifacts
```

This generates a full bundle at:

`artifacts/scorecards/YYYY-MM-DD/ci/<run-id>/`

## Example Commands

```bash
contex analyze datasets/realworld.json --model gpt-4o-mini --strategy auto --reality-gate --auto-confidence-floor 55 --strict-auto-gate --out .contex/analyze_report.json
contex scorecard --in .contex/analyze_report.json --out .contex/scorecard_report.json --model gpt-4o-mini --target-floor 35 --target-median 60 --min-datasets 3
```

## Gate Policy

A claim can be published only when:

- Dataset count gate passes
- Floor and median gates pass
- Correctness checks pass
- Limitation note is adjacent to the claim

## Claim Annotation (CI-Enforced)

When adding benchmark claims to markdown docs, use:

- `Claim: <benchmark statement>`
- `Artifact: artifacts/scorecards/...` (or `.contex/scorecard_report.json`)

The CI claim-evidence guard checks that each `Claim:` has a nearby `Artifact:` reference.
