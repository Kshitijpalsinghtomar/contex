# CONTEX MASTER ARCHITECTURE DOCUMENT

> **RULE: Every AI agent and developer MUST read this file FIRST before touching ANY code.**
> **RULE: If what you're building is NOT described in this document, DO NOT BUILD IT.**
> **RULE: If you are unsure about anything, re-read this document. The answer is here.**

---

## WHAT IS CONTEX?

Contex is **token-native data infrastructure for AI systems**.

It provides four capabilities:

1. **Token Encoding** — Structured data → canonical IR (model-agnostic binary) → `.tens.ir` files
2. **Token Materialization** — Canonical IR → model-specific token arrays on demand, cached as hot blobs
3. **Token Memory** — Persistent `.tens.ir` files with content-hash addressing (encode once, reuse forever)
4. **Token Composition** — Assemble prompts by composing token blocks, not concatenating text strings

### The Compiler Analogy

```
TRADITIONAL COMPILERS              CONTEX (TOKEN COMPILER)
────────────────────               ──────────────────────
Source code                   →    Structured data (JSON, objects)
Compiler                      →    TENS IR encoder
Object files (.o)             →    Token objects (.tens.ir)
Linker                        →    Token composer (Tens.compose)
Platform-specific binary      →    Model-specific token array (materialized)
Runtime                       →    LLM inference
```

### The Problem

Every LLM API call today:
```
App sends JSON text → Provider tokenizes it → Token IDs → Model processes
```

This is like shipping source code and recompiling on every request. Wasted compute, wasted money,
no cache consistency. Same data tokenized 10,000 times a day = 10,000 identical redundant operations.

### What Contex Does

```
App encodes data ONCE as canonical IR
  → Materialize to tokens (cached)
  → Compose prompt from token blocks
  → Inject canonical text (deterministic)
  → Provider tokenizes identically
  → Cache HIT guaranteed
```

Encode once. Materialize per model. Compose instantly. Inject deterministically. Guarantee cache hits.

### What Contex Is NOT

- ❌ NOT a database (no WAL, no B-Trees, no SQL, no storage engine)
- ❌ NOT a format converter (we don't just convert JSON → CSV)
- ❌ NOT a text optimizer (we work at the TOKEN level, not text level)
- ❌ NOT a prompt library (we don't store text templates)

---

## THE CRITICAL ARCHITECTURAL DECISION

### Why we CANNOT store per-model tokens only

If you encode data with OpenAI's `o200k_base` tokenizer and store those token IDs:
- ❌ Those tokens are **meaningless** to Claude (different tokenizer)
- ❌ If OpenAI updates their tokenizer, stored tokens become **invalid**
- ❌ Storing tokens for every model = storage explosion (10 models × 10K files = 100K blobs)

### The solution: Canonical IR + Lazy Materialization

```
┌──────────────────────────────────────────────────────────────────┐
│  CANONICAL IR (.tens.ir)                                         │
│  ────────────────────────                                        │
│  Model-AGNOSTIC binary representation of your data               │
│  • Deterministic (same data = same bytes = same hash, ALWAYS)    │
│  • Contains: schema + values in canonical format                 │
│  • Does NOT contain token IDs — those are generated on demand    │
│  • Content-addressed by hash (skip re-encoding if hash exists)   │
│  • This is what you STORE and PERSIST                            │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  MATERIALIZATION (per-model)                                     │
│  ──────────────────────────                                      │
│  Tens.materialize(irHash, 'gpt-4o') → number[]                   │
│  • Takes canonical IR, tokenizes with target model's tokenizer   │
│  • Result is cached as a "hot blob" (.tens.gpt4o, .tens.claude)  │
│  • Cache invalidated when model tokenizer version changes        │
│  • Cold materialization: ~200ms. Warm (cached): <20ms.           │
│  • Only materialize for models you actually use (lazy)           │
└──────────────────────────────────────────────────────────────────┘
```

**This makes TENS model-portable, future-proof, and storage-efficient.**

---

## THE FOUR LAYERS

```
┌────────────────────────────────────────────────────────────────┐
│  LAYER 4: INJECTION                                            │
│  ─────────────────                                             │
│  Tens.wrapOpenAI() / Tens.wrapAnthropic() / Tens.wrapGemini()  │
│  → Drop-in SDK wrappers that auto-inject canonical text        │
│  → Deterministic serialization guarantees provider cache hits  │
└────────────────────────────────────────────────────────────────┘
                              ←'
┌────────────────────────────────────────────────────────────────┐
│  LAYER 3: COMPOSITION                                          │
│  ────────────────────                                          │
│  Tens.compose([systemTokens, dataTokens, queryTokens], model)  │
│  → Assemble prompts from pre-materialized token blocks         │
│  → Validates total fits in model's context window              │
│  → Deterministic token topology → guaranteed cache hits        │
└────────────────────────────────────────────────────────────────┘
                              ←'
┌────────────────────────────────────────────────────────────────┐
│  LAYER 2: MEMORY + MATERIALIZATION                             │
│  ────────────────────────────────                              │
│  Tens.store(data) → customer_data.tens.ir (canonical)          │
│  Tens.materialize(hash, model) → token array (cached)          │
│  → Content-addressed: same data = same hash = skip encoding    │
│  → Model-specific blobs cached only for hot paths              │
└────────────────────────────────────────────────────────────────┘
                              ←'
┌────────────────────────────────────────────────────────────────┐
│  LAYER 1: CANONICAL IR ENCODING                                │
│  ──────────────────────────────                                │
│  Tens.encodeIR(data) → { ir: Uint8Array, schema, hash }       │
│  → Deterministic: sorted keys, canonical numbers, NFKC unicode │
│  → Model-agnostic: no tokenizer dependency                     │
│  → Schema-aware: field names, types, structure                 │
└────────────────────────────────────────────────────────────────┘
                              ←'
┌────────────────────────────────────────────────────────────────┐
│  INPUT: Structured Data (JSON, objects, database rows)          │
└────────────────────────────────────────────────────────────────┘
```

---

## WHY THIS MATTERS NOW (MARKET PROOF)

| Provider | What they support | How TENS exploits it |
|----------|-------------------|----------------------|
| **OpenAI** | **Automatic prefix caching**: 50% discount on inputs >1024 tokens | Canonical text → identical prefix tokens → 100% cache hit rate |
| **Anthropic** | **Explicit prompt caching**: 90% cheaper for exact prefix match | Deterministic canonicalization = guaranteed exact prefix match |
| **Google** | **Implicit & Explicit caching**: 75-90% discount | Same: deterministic output = maximum implicit cache rates |

JSON does NOT guarantee deterministic tokenization: `{"a":1,"b":2}` vs `{"b":2,"a":1}` produce different tokens → cache miss. TENS canonical IR guarantees it.

> **Note:** As of Feb 2026, no major provider accepts raw token arrays in their Chat APIs. Contex achieves the same result by injecting **canonical deterministic text** which produces identical tokens on the provider side.

---

## CANONICALIZATION RULES (MUST BE DETERMINISTIC)

These rules ensure `encodeIR(data)` ALWAYS produces identical bytes for semantically identical data:

| Data Type | Canonicalization Rule |
|-----------|----------------------|
| **Object keys** | Sorted lexicographically (Unicode code point order) |
| **Integers** | No leading zeros, no trailing decimal points. `1` not `1.0` |
| **Floats** | IEEE 754 double, shortest representation. `1.5` not `1.50` |
| **Strings** | NFKC unicode normalization, no trailing whitespace |
| **Booleans** | `true` / `false` (lowercase) |
| **Null** | Explicit null marker in IR (not omitted, not empty string) |
| **Arrays** | Preserve order (arrays are ordered by definition) |
| **Dates** | ISO 8601, UTC, milliseconds. `2026-02-14T12:00:00.000Z` |
| **Undefined/missing** | Omitted from IR (not encoded) |

**Test**: Encode the same data with different key orders 1000 times. Hash must be identical every time.

---

## PACKAGE STRUCTURE

```
contex/
├── packages/
│   ├── core/          ← Layer 1: TENS IR encoding/decoding, tokenization, schemas, canonicalization
│   ├── engine/        ← Layers 2-3: Materialization, memory, composition, budget, model registry
│   ├── middleware/     ← Layer 4: Drop-in SDK wrappers (OpenAI, Anthropic, Gemini)
│   ├── cli/           ← Command-line tools
│   ├── server/        ← [PAUSED] REST API
│   └── tens-wasm/     ← [PAUSED] Rust/WASM
├── docs/              ← Technical documentation
├── website/           ← Marketing website
└── CONTEX_V3_MASTER.md ← THIS FILE
```

---

## FILE-BY-FILE INVENTORY

### `packages/core/src/` — Layer 1: Canonical IR Encoding

| File | Status | Purpose |
|------|--------|---------|
| `encoder.ts` | 🔄 EVOLVE | Currently encodes to per-model tokens. **EVOLVE: split into IR encoding (model-agnostic) + materialization (model-specific). IR encoding becomes the primary path.** |
| `decoder.ts` | ✅ KEEP | Decodes TENS binary → data. |
| `tokenizer.ts` | ✅ KEEP | TokenizerManager. Used during materialization step. |
| `schema.ts` | ✅ KEEP | Schema registry. |
| `types.ts` | ✅ KEEP + EXPAND | Add IR types, materialization types, composition types. |
| `errors.ts` | ✅ KEEP | Error types. |
| `token_cache.ts` | ✅ KEEP | LRU cache. Used for materialization hot blobs. |
| `token_stream_encoder.ts` | ✅ KEEP | Streaming encoder. |
| `pretokenized.ts` | ✅ KEEP | Pre-tokenized utilities. |
| `index.ts` | 🔄 MODIFY | Update exports. |
| `formatters.ts` | ⬇️ FALLBACK | Text formatters (CSV, JSON, Markdown). **FALLBACK ONLY** — used when API doesn't accept tokens. |
| `tens_text.ts` | ⬇️ DEBUG | **DEBUG TOOL ONLY**. Human-readable view of .tens files. Never sent to LLMs. |
| `tens/dictionary.ts` | ✅ KEEP | Dictionary compression. |
| `tens/hashing.ts` | ✅ KEEP + IMPROVE | **IMPROVE: must produce deterministic content-addressable hashes for IR.** |
| `tens/validate.ts` | ✅ KEEP | Binary validation. |

#### NEW FILES IN `packages/core/src/`

| File | Status | Purpose |
|------|--------|---------|
| `canonical.ts` | 🆕 NEW | **Canonicalization module**: implements all rules from the table above. Sorts keys, normalizes numbers, NFKC strings. Every other encoder MUST use this. |
| `ir_encoder.ts` | 🆕 NEW | **IR Encoder**: `Tens.encodeIR(data)` → model-agnostic `Uint8Array` with content hash. Uses canonical.ts for determinism. |
| `materialize.ts` | 🆕 NEW | **Materializer**: `Tens.materialize(ir, modelId)` → `number[]` (model-specific token array). Uses tokenizer.ts. Caches results. |

### `packages/engine/src/` — Layers 2-3: Memory + Composition

| File | Status | Purpose |
|------|--------|---------|
| `budget.ts` | ✅ KEEP + IMPROVE | Budget engine. **IMPROVE: work with token counts from materialization, not text estimates.** |
| `engine.ts` | ✅ KEEP + IMPROVE | Main engine. **IMPROVE: integrate IR encoding + materialization.** |
| `quick.ts` | 🔄 REWRITE | **REWRITE: `Tens.quick()` returns `{ ir, tokens, hash }`, not `{ output: string }`.** |
| `packer.ts` | ✅ KEEP | Context window packing. |
| `prefix.ts` | ✅ KEEP | Prefix cache optimization. |
| `selector.ts` | ✅ KEEP | Format selection (for text fallback). |
| `query.ts` | ✅ KEEP | Query parsing. |
| `session_dedup.ts` | ✅ KEEP + IMPROVE | **IMPROVE: dedup using IR content hashes.** |
| `index.ts` | 🔄 MODIFY | Update exports. |
| `models.json` | ✅ KEEP + EXPAND | **EXPAND: add `tokenizerVersion` per model, `cacheSupport` flags per provider.** |
| `storage.ts` | 🔄 REPURPOSE | **REPURPOSE as Token Memory: hash-addressed `.tens.ir` file storage.** |

#### NEW FILES IN `packages/engine/src/`

| File | Status | Purpose |
|------|--------|---------|
| `memory.ts` | 🆕 NEW | **Token Memory**: `Tens.store()` / `Tens.load()`. Stores `.tens.ir` files. Content-addressed by hash. Caches materialized blobs per model. |
| `compose.ts` | 🆕 NEW | **Token Composition**: `Tens.compose(blocks, model)`. Assembles token arrays from multiple sources. Validates total against model budget. |

### `packages/middleware/src/` — Layer 4: Injection

| File | Status | Purpose |
|------|--------|---------|
| `openai.ts` | 🔄 REWRITE | Inject materialized token arrays via OpenAI token input. Text fallback. |
| `anthropic.ts` | 🔄 REWRITE | Cache-aligned materialization for Anthropic prompt caching. |
| `gemini.ts` | 🔄 REWRITE | Google context caching integration. |
| `types.ts` | 🔄 MODIFY | Update types. |
| `index.ts` | 🔄 MODIFY | Update exports. |

### `packages/cli/src/` — CLI Tools

| File | Status | Purpose |
|------|--------|---------|
| `cli.ts` | 🔄 MODIFY | Commands: encode, decode, inspect, stats, savings, compose, inject. |
| `benchmark.ts` | ✅ KEEP | Update for token injection benchmarks. |
| `generators.ts` | ✅ KEEP | Test data generators. |
| `generate_report.ts` | ✅ KEEP | Report generator. |
| `metrics.ts` | ✅ KEEP | Benchmark metrics. |
| Others | ✅ KEEP | Supporting files. |

### `packages/server/` — ⏸️ PAUSED. Do not modify.

### `packages/tens-wasm/` — ⏸️ PAUSED. Do not modify.

---

## ROOT FILES — CLEANUP

| File | Action |
|------|--------|
| `README.md` | 🔄 REWRITE for v3 vision |
| `USE_CASES.md` | 🔄 REWRITE around token injection + composition |
| `CONTRIBUTING.md` | 🔄 MODIFY |
| `docs/PRD.md` | 🔄 REWRITE |
| `docs/architecture.md` | 🔄 REWRITE |
| `docs/tens-specification.md` | ✅ KEEP + IMPROVE (add IR spec, content hash) |
| `docs/guide/getting-started.md` | 🔄 REWRITE |
| `docs/guide/benchmarks.md` | 🔄 MODIFY |
| `idea.md` | ❌ DELETE |
| `calculate_stats.js` | ❌ DELETE |
| `accuracy_test.jsonl` | ❌ DELETE |
| `benchmark_report.html` | ❌ DELETE |
| `benchmark_results.json` | ❌ DELETE |
| `my_test_data.*` (all) | ❌ DELETE from root (move to fixtures if needed) |
| `Dockerfile` | ⏸️ PAUSE |

---

## THE V3 API

### Layer 1: IR Encoding (`@contex-llm/core`)

```typescript
// Canonical IR encode (model-agnostic)
Tens.encodeIR(data: object[], options?): TensIR
// → { ir: Uint8Array, schema: TensSchema, hash: string }
// Deterministic: same data = same ir bytes = same hash. Always.

// Materialize IR → model-specific token array
Tens.materialize(ir: TensIR, modelId: string): MaterializedTokens
// → { tokens: number[], modelId: string, tokenizerVersion: string, tokenHash: string }
// Cached: subsequent calls for same (hash, modelId) return cached result

// Decode back to data
Tens.decode(ir: TensIR): object[]

// Fast token count estimate
Tens.count(data: object[], modelId: string): number
```

### Layer 2: Memory (`@contex-llm/engine`)

```typescript
// Store canonical IR persistently (content-addressed)
Tens.store(data: object[]): StoredTens
// → { hash: string, path: string, schema: TensSchema }
// If hash already exists → skip encoding, return existing

// Load stored IR
Tens.load(hashOrPath: string): TensIR

// Quick one-shot: encode IR + materialize + fit to budget
Tens.quick(data: object[], model: string): QuickResult
// → { ir: TensIR, tokens: number[], rows: number, savings: {...} }
```

### Layer 3: Composition (`@contex-llm/engine`)

```typescript
// Compose prompt from token blocks
Tens.compose(blocks: TokenBlock[], model: string): ComposedPrompt
// → { tokens: number[], totalTokens: number, fits: boolean }
// TokenBlock = number[] | TensIR | StoredTens | string (text fallback)

// Validate composition fits in model budget
Tens.validate(tokens: number[], model: string): ValidationResult
// → { fits: boolean, totalTokens: number, limit: number }

// Example:
const prompt = Tens.compose([
  systemPromptTokens,
  Tens.load('customer_data'),
  Tens.load('policy_rules'),
  userQueryText
], 'gpt-4o');
```

### Layer 4: Injection (`@contex-llm/middleware`)

```typescript
// Wrap SDKs — auto-inject tokens where supported, text fallback where not
const client = Tens.wrapOpenAI(openai, options);
const client = Tens.wrapAnthropic(anthropic, options);
const client = Tens.wrapGemini(gemini, options);
```

### CLI

```bash
contex encode <file.json>                     # JSON → .tens.ir (canonical)
contex decode <file.tens.ir>                  # .tens.ir → JSON
contex inspect <file.tens.ir>                 # Human-readable debug view
contex materialize <file.tens.ir> --model X   # IR → model-specific tokens
contex stats <file.json>                      # Token counts per model
contex savings <file.json>                    # Cost savings report
contex compose <a.tens.ir> <b.tens.ir> ...    # Compose into single prompt
contex inject <file.tens.ir> --model gpt-4o   # Demo: inject and get response
```

---

## PHASED IMPLEMENTATION PLAN

### Phase 1: Prove the Foundation (FIRST — do this before anything else)

**Goal**: Canonical IR encoding works + token injection produces correct LLM responses.

```
1. Implement canonicalization module (canonical.ts)
   - Sorted keys, canonical numbers, NFKC strings
   - Write 5+ unit tests: different key orders → identical hash

2. Implement IR encoder (ir_encoder.ts)
   - Data → canonical bytes → content hash
   - Model-agnostic: no tokenizer used

3. Implement materialize (materialize.ts)
   - IR → token array for one model (gpt-4o / o200k_base)
   - Uses existing tokenizer.ts

4. End-to-end test:
   - encodeIR → materialize → inject token array to OpenAI
   - Compare response with standard JSON text input
   - Measure: correctness, latency, token counts

5. Acceptance criteria:
   - Same/equivalent LLM responses ≥95% of test cases
   - Materialize cold < 200ms, warm < 20ms
```

### Phase 2: Token Memory

**Goal**: Persistent `.tens.ir` storage with content-hash dedup.

```
1. Implement memory.ts (store/load)
2. Hash-based dedup: if hash exists, skip encoding
3. Materialized blob caching per model
4. CLI: contex encode / contex decode / contex inspect
```

### Phase 3: Token Composition

**Goal**: Compose prompts from token blocks with budget validation.

```
1. Implement compose.ts
2. Budget validation against model context window
3. CLI: contex compose
```

### Phase 4: Middleware Rewrite

**Goal**: Drop-in SDK wrappers inject tokens automatically.

```
1. Rewrite openai.ts, anthropic.ts, gemini.ts
2. Token injection where supported, text fallback where not
3. Test cache hit rates with deterministic token sequences
```

### Phase 5: quick() Rewrite

**Goal**: One-shot API returns IR + tokens.

```
1. Rewrite quick.ts output format
2. Backward-compatible .asText() fallback
3. Update tests
```

### Phase 6: Docs + Website Overhaul

**Goal**: All external materials reflect v3 vision.

```
1. README.md, PRD.md, architecture.md
2. website/index.html, docs.html
3. USE_CASES.md, getting-started.md
```

### Phase 7: Clean Up

**Goal**: Delete dead files, clean root directory.

```
1. Delete: idea.md, calculate_stats.js, accuracy_test.jsonl
2. Delete: benchmark_report/results from root
3. Delete/Move: my_test_data.* → packages/cli/fixtures/
4. Update .gitignore, package.json
```

### Phase 8: Developer Experience (Phase 8 - Current)

**Goal**: CLI commands, End-to-End Demo, and NPM Publish readiness.

```
1. CLI: Implement `materialize`, `compose`, `inject` commands
2. Demo: Build e2e_anthropic_cache.ts to prove 90% savings
3. Instrumentation: Add latency/cache-hit logging
4. Publish: Prepare packages for npm
```

---

## RULES FOR ALL FUTURE DEVELOPMENT

1. **Canonical IR is the source of truth.** All persistent storage is model-agnostic IR. Per-model tokens are cached materializations, not primary storage.

2. **Determinism is non-negotiable.** Same data → same IR bytes → same hash. Always. Test this. If canonicalization is broken, everything is broken.

3. **Materialize lazily.** Only generate per-model token arrays when actually needed for a specific model. Cache the result. Invalidate when tokenizer version changes.

4. **Canonical deterministic text is the primary output.** Until APIs accept token arrays, we inject canonical text that produces identical tokens. This guarantees cache hits.

5. **TENS-Text is a debug tool ONLY.** Never sent to an LLM. Exists for human inspection.

6. **No new text formats.** No TOON, no custom syntaxes. LLMs understand JSON, CSV, Markdown. If falling back to text, use those.

7. **No storage engine features.** No WAL, no B-Trees. Token Memory = `.tens.ir` files on disk with hash lookup. That's it.

8. **No premature optimization.** No Rust/WASM until JS SDK has proven users.

9. **Model version tracking is mandatory.** `models.json` must include `tokenizerVersion`. Materialized blobs must be invalidated when tokenizer changes.

10. **Content-addressing is core.** Every IR blob has a content hash. Same hash = same data = skip re-encoding.

11. **Composition before optimization.** Composing prompts from token blocks > squeezing 5% more savings.

12. **Every PR must answer: "Does this help encode, store, compose, materialize, or inject tokens?"** If no, don't merge it.

---

## DOCUMENTATION & DEVELOPMENT CONTINUITY

> **This project has many components. They will be built and documented incrementally across multiple sessions, potentially by different developers and AI agents. Every piece MUST feel like it belongs to ONE cohesive project — not a patchwork of disconnected efforts.**

### The Problem This Clause Solves

When multiple agents or developers work on different parts of a project:
- README talks in one voice, docs talk in another
- Website uses different terminology than the code
- Each piece looks like it was written by a different person
- The project feels fragmented, not unified

### Rules for Documentation Continuity

1. **Single voice, single terminology.** Every document — README, docs, website, code comments, CLI help text — MUST use the same terms:
   - "TENS" not "token format" or "binary format"
   - "Canonical IR" not "intermediate representation" or "data blob"
   - "Materialize" not "tokenize" or "convert" or "generate tokens"
   - "Compose" not "assemble" or "build" or "concatenate"
   - "Inject" not "send" or "pass" or "transmit"

2. **Incremental, not all-at-once.** Documentation will be built component by component as each phase completes. When documenting a new component:
   - Read existing docs FIRST to match voice and style
   - Reference other components by their established names
   - Link to related docs (don't create islands)
   - Update the table of contents / navigation if it exists

3. **Build-then-document order.** For each phase:
   - Build the feature first
   - Write the docs for that feature immediately after
   - Do NOT document features that don't exist yet (no aspirational docs)
   - Do NOT skip documentation for features that DO exist

4. **Cross-reference everything.** Every document should feel connected:
   - README links to getting-started guide
   - Getting-started links to API reference
   - API reference links to architecture docs
   - Architecture docs link back to this master file
   - Website says the same thing as the README (same pitch, same numbers)

5. **Website = README = Docs = CLI help.** When you update one, check if others need updating too. The pitch on the website MUST match the pitch in the README MUST match what the CLI `--help` says.

6. **Code comments follow the same voice.** JSDoc comments in source files must use the same terminology as the docs. If the docs say "canonical IR", the code comment says "canonical IR", not "serialized data" or "binary output".

### Documentation Components (will be built per-phase)

| Component | Built When | Current Status |
|-----------|------------|----------------|
| `CONTEX_V3_MASTER.md` (this file) | Now | ✅ Complete |
| `README.md` | After Phase 1 proves token injection | 🔄 Needs rewrite |
| `docs/PRD.md` | After Phase 1 | 🔄 Needs rewrite |
| `docs/architecture.md` | After Phase 1 | 🔄 Needs rewrite |
| `docs/tens-specification.md` | After Phase 2 (IR format finalized) | ✅ Exists, needs IR additions |
| `docs/guide/getting-started.md` | After Phase 5 (quick API rewritten) | 🔄 Needs rewrite |
| `docs/guide/benchmarks.md` | After Phase 1 benchmarks run | 🔄 Needs update |
| `website/index.html` | After Phase 1 has publishable results | 🔄 Needs rewrite |
| `website/docs.html` | After API is stable | 🔄 Needs rewrite |
| `USE_CASES.md` | After Phase 4 (middleware working) | 🔄 Needs rewrite |
| `CONTRIBUTING.md` | After Phase 3 | 🔄 Needs update |
| CLI `--help` text | After each CLI command is implemented | 🔄 Updates per phase |
| JSDoc in source files | During each phase's implementation | 🔄 Updates per phase |

### For Any AI Agent Working on Docs

Before writing ANY documentation:
1. Read this master file completely
2. Read the existing README.md and docs/ to understand current voice
3. Use ONLY the terminology defined in Rule #1 above
4. Link to other docs — don't create orphan pages
5. If you're rewriting a doc, preserve the overall tone: technical, direct, no fluff, no hype beyond what's proven

---

## ONE-SENTENCE PITCH

> **Contex is token-native data infrastructure: encode structured data into a canonical model-agnostic IR, materialize to model-specific tokens on demand, compose prompts from reusable token blocks, and inject deterministic canonical text into any LLM — guaranteeing cache hits and eliminating redundant tokenization.**

---

*This document is the single source of truth. Read it before writing any code. Follow it exactly.*
