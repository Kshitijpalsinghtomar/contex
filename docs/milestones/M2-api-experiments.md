# M2 — Contex API & Serving Architecture

**Status:** 🔲 Not Started  
**Target Date:** TBD  
**Author:** Kshitij Pal Singh Tomar (@kshitijpalsinghtomar)

---

## Research Questions

1. What is the optimal serving architecture for token-compiled context (latency, throughput, cache reuse)?
2. How does a dedicated context API compare to inline SDK middleware in real-world LLM pipelines?
3. What are the failure modes and reliability guarantees for a stateless context compilation service?

## Scope

- Production-grade REST/gRPC API for Contex operations (encode, decode, materialize, budget-pack)
- Authentication, rate limiting, observability (OpenTelemetry traces)
- Cache layer (in-memory + optional Redis/persistent) with hit-rate telemetry
- Multi-model endpoint (single request, multiple model materializations)
- Benchmark suite: latency p50/p95/p99, throughput (req/s), cache hit ratio under load

## Deliverables

| Deliverable | Type | Evidence |
|-------------|------|----------|
| API server with full endpoint coverage | Code | `packages/server/` |
| Load test results (k6/autocannon) | Artifact | `artifacts/m2/load-test-results.json` |
| Latency benchmark (cold vs warm cache) | Artifact | `artifacts/m2/latency-benchmark.json` |
| API documentation (OpenAPI spec) | Doc | `docs/reference/api.md` |
| Architecture decision record | Doc | `docs/milestones/M2-adr.md` |

## Validation Criteria

- [ ] All endpoints pass integration tests
- [ ] p95 latency < 50ms for cached materialization
- [ ] Throughput > 500 req/s on single node
- [ ] Cache hit rate > 80% on repeated payloads
- [ ] OpenAPI spec validates against implementation
- [ ] Comparison table: API vs middleware (latency, DX, failure modes)

## Dependencies

- M1 Core (complete)

---

*Template created 2026-02-18. Fill in results as work progresses.*
