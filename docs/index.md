# Contex Documentation

**The Intelligent Context Engine for LLMs.**

Contex stores structured data as a canonical intermediate representation (TENS) and serves it in the most token-efficient format for any LLM — saving 50-70% of context costs.

---

## 📖 Documentation

### Getting Started
- [Installation & Quick Start](./guide/getting-started.md) — Install, encode, decode, and optimize in 5 minutes

### Concepts
- [TENS Specification](./tens-specification.md) — What TENS is, why it exists, binary layout, and capabilities
- [Architecture](./architecture.md) — Data pipeline, package structure, and design decisions

### Guides
- [Benchmarks](./guide/benchmarks.md) — Running and interpreting the research-grade benchmark suite

### Reference
- [CLI Reference](./reference/cli.md) — All CLI commands, options, and examples
- [Server API](../packages/server/) — REST API endpoints and usage
- [Middleware](../packages/middleware/) — OpenAI/Anthropic SDK integration

---

## Key Concepts

### TENS — Token Encoded Native Structure

TENS is the canonical binary **intermediate representation** at the core of Contex. It's not a transport format — it's an LLM-aware structural IR that provides:

- **Canonical output** — Same data always produces the same bytes
- **Schema deduplication** — Object shapes stored once, referenced by ID
- **Dictionary encoding** — Repeated strings stored once
- **Deterministic layout** — Sorted keys for prefix cache compatibility

> 📖 Full spec: [TENS Specification](./tens-specification.md)

### The Pipeline

```
Your Data → TENS (Canonical IR) → Budget Engine → Middleware → LLM
```

Contex doesn't pick one format. It stores data canonically and serves the **cheapest format** for the target model:

| Format | Best For |
|---|---|
| **TOON** | Nested/typed data going to LLMs |
| **CSV** | Flat tabular data (best token density) |
| **Markdown** | Human-readable reporting |
| **JSON** | API compatibility |

### Context Budgeting

```typescript
const result = db.getOptimizedContext('tickets', {
  model: 'gpt-4o',
  systemPrompt: 800,
  reserve: 4096
});
// → { 
//   output: "...",
//   usedRows: 4123,
//   debug: { recommendedFormat: 'toon', maxRows: 4123, availableTokens: 123456 }
// }
```

### Prefix Caching

Deterministic, sorted output for vLLM/SGLang KV cache reuse. Adding a row preserves the existing prefix — only new tokens need recomputation.
