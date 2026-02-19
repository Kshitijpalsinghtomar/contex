# M4 — ContexDB: Compiled Context Store

**Status:** 🔲 Not Started  
**Target Date:** TBD  
**Author:** Kshitij Pal Singh Tomar (@kshitijpalsinghtomar)

---

## Research Questions

1. Can a content-addressed, token-aware database outperform traditional vector stores for LLM context retrieval?
2. What storage layout and indexing strategy minimizes token waste for multi-format, multi-model context serving?
3. How does context deduplication at the token level affect storage efficiency and retrieval latency?

## Scope

- Content-addressed compiled context store (hash-based dedup, token-level indexing)
- Query engine: retrieve by schema, model, token budget, semantic similarity
- Storage backends: embedded (SQLite/LMDB), cloud (S3 + metadata index)
- Context versioning and diffing (delta encoding between context versions)
- Benchmark: ContexDB vs Pinecone/Chroma/Weaviate on context retrieval workloads

## Deliverables

| Deliverable | Type | Evidence |
|-------------|------|----------|
| ContexDB core engine | Code | `packages/contexdb/` |
| Storage adapter layer | Code | `packages/contexdb/src/storage/` |
| Query engine with budget-aware retrieval | Code | `packages/contexdb/src/query/` |
| Context diffing module | Code | `packages/contexdb/src/diff/` |
| Retrieval benchmark vs vector stores | Artifact | `artifacts/m4/retrieval-benchmark.json` |
| Storage efficiency analysis | Artifact | `artifacts/m4/storage-analysis.json` |

## Validation Criteria

- [ ] CRUD operations pass integration tests
- [ ] Content-addressed dedup reduces storage by >30% on repeated schemas
- [ ] Query latency < 10ms for budget-constrained retrieval (1000 stored contexts)
- [ ] Context diff correctly identifies added/removed/changed fields
- [ ] Benchmark shows advantage over vector store on structured context tasks
- [ ] Multi-model materialization from single stored context works correctly

## Dependencies

- M1 Core (complete)
- M3 TENS Protocol (for binary storage format)

---

*Template created 2026-02-18. Fill in results as work progresses.*
