# 3-Dataset Scorecard (2026-02-15)

> **Historical Baseline (Legacy):** This page captures the pre-correction fixed-set baseline run.
> Current fixed-set baseline and gate results are documented in `docs/week-4-scorecard.md`.

> **Baseline reality-gate and reduction outcomes**

---

## 📊 Scorecard Results

**Model:** `gpt-4o-mini`

**Command:** `contex analyze --strategy contex,csv,toon,markdown,auto --reality-gate --out .contex/scorecard_runs.json`


---

## Results

| Dataset | Contex Reduction | Best Strategy | Best Reduction | Real Gate |
|---|---:|---|---:|---|
| `my_test_data.json` | 21.43% | CSV | 41.14% | ❌ FAIL (Dynamic) |
| `dummy_1000.json` | 63.49% | Contex | 63.49% | ✅ PASS |
| `dummy_2000.json` | 74.18% | Contex | 74.18% | ✅ PASS |

---

## Aggregate Statistics

| Metric | Value |
|--------|-------|
| **Median token reduction (Contex)** | **63.49%** |
| **Median breakthrough reduction** | **63.49%** |
| **Lowest Contex reduction** | 21.43% (`my_test_data.json`) |
| **Lowest best-strategy reduction** | 41.14% (`my_test_data.json`) |

---

## 🎯 Next Hard Target

| Metric | Current | Target |
|--------|---------|--------|
| **Worst-case reduction** | 21.43% | **50%+** |
| **Median reduction** | 63.49% | **≥60%** |
| **Dynamic gate stability** | FAIL | **≥90%** |

---

## Action Items

- [ ] Raise worst-case dataset reduction from **21.43% → 35%+** using strategy auto-selection
- [ ] Keep median reduction **≥ 60%** across the same 3-dataset scorecard
- [ ] Move `my_test_data.json` from `Real=FAIL` to `Real=PASS` by improving Dynamic gate stability to **≥90%**
- [ ] Implement strategy auto-selection for high-structure datasets

---

## Related Documentation

- [High-Gain Playbook](./high-gain-playbook.md) — Strategy selection guide
- [Benchmarks](./benchmarks.md) — Performance data
- [CLI Reference](../reference/cli.md) — Full command list
