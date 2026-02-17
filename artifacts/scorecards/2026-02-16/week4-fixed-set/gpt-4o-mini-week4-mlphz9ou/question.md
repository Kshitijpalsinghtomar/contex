# Week 4 Limitation Question

## Limitation
- Cost/latency evidence gap and workload sensitivity in mixed real-world data.

## Question to Answer
- On a fixed 3-dataset set, are floor/median reduction metrics stable week-over-week under identical settings?

## Hypothesis
- Median remains >= 60%; floor movement is measurable and attributable by dataset family.

## Decision Threshold
- Publish artifacts each run; use drift deltas to decide ship/iterate/rollback.