# Contex Strategy Comparison

This guide compares the practical data-prompt strategies available in this repo.

---

## Strategies

- `contex` / `tens`: canonical IR pipeline with deterministic behavior.
- `csv`: compact for flat tabular data.
- `toon`: compact tabular/structured textual form.
- `markdown`: readability-focused output.
- `json`: interoperability-focused output.

---

## API-Accurate Usage

```ts
import { Tens, formatOutput } from '@contex-llm/core';

const tens = Tens.encode(rows);

// Canonical deterministic text
const canonicalText = tens.toString();

// Model-specific token materialization
const tokens = tens.materialize('gpt-4o');

// Alternative text formats from canonical data
const csv = formatOutput(tens.fullIR.data, 'csv');
const toon = formatOutput(tens.fullIR.data, 'toon');
const markdown = formatOutput(tens.fullIR.data, 'markdown');
const json = formatOutput(tens.fullIR.data, 'json');
```

---

## When Each Wins

### `contex` / `tens`

Best when:
- deterministic canonical flow matters,
- repeated structures/values are common,
- cache consistency is a priority.

### `csv`

Best when:
- records are mostly flat,
- columns are stable,
- strict text compactness is needed.

### `toon`

Best when:
- data is tabular-ish but semi-structured,
- you want compact text with better structural preservation than CSV.

### `markdown`

Best when:
- humans need to inspect prompts/results,
- readability is prioritized over pure token efficiency.

### `json`

Best when:
- downstream tools require strict JSON,
- prompt readability/compatibility is more important than compression.

---

## CLI Evaluation

Use CLI to compare strategies on your own datasets:

```bash
contex analyze my_data.json --strategy contex,csv,toon,markdown,auto --reality-gate
```

Use scorecards for repeatable checks:

```bash
contex scorecard --in .contex/analyze_report.json --model gpt-4o-mini
```

---

## Notes

- Avoid invalid calls like `tens.toString('toon')`; use `formatOutput(tens.fullIR.data, 'toon')`.
- Avoid object-form `Tens.encode({...})` when you intend row datasets; use array rows.
- Keep strategy decisions dataset-family specific instead of relying on one global metric.
