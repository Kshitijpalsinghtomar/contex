# Contex Format Hierarchy

> Understanding TENS, .tens-text, Contex Compact, and output format relationships

---

## Overview

Contex uses a layered format architecture. Each layer serves a different purpose:

```
Raw Data (JSON objects)
    │
    ▼
┌─────────────────────────────────────┐
│  TENS Binary (Canonical IR)         │  ← Internal, model-agnostic
│  Uint8Array • Content-hashed        │
│  Used for: storage, dedup, caching  │
└──────────────┬──────────────────────┘
               │
    ┌──────────┼──────────────┐
    ▼          ▼              ▼
 Contex     .tens-text     Other Formats
 Compact    (Human-        (JSON, CSV,
 (@d, @f)   readable IR)   Markdown, TOON)
```

---

## Format Reference

### 1. TENS Binary (`'tens'`)

**What:** The canonical Intermediate Representation (IR). A `Uint8Array` with a SHA-256 content hash.

**When used:** Internally by `Tens.encode()`. Never sent to LLMs directly.

**Properties:**
- Model-agnostic (same binary regardless of target LLM)
- Deterministic: same data → same hash → 100% cache hit
- Stores schema, field types, and data in binary form
- Content-addressed for deduplication

**Code:** `packages/core/src/ir_encoder.ts`

```typescript
const tens = Tens.encode(data);
tens.ir;    // → Uint8Array (TENS binary)
tens.hash;  // → "abc123..." (SHA-256)
```

---

### 2. .tens-text (`'tens-text'`)

**What:** A human-readable text serialization of the TENS binary format. Uses `@`-directives, indentation-based syntax, field-per-line layout.

**File extension:** `.tens`

**When used:** Debugging, inspection, version control diffs. Lossless 1:1 roundtrip with TENS binary.

**Properties:**
- `@version`, `@encoding`, `@schema`, `@dict` directives
- Indentation-based records (2-space indent)
- Dictionary compression for repeated values (`@0`, `@1`, ...)
- No brackets, no commas — grammar simpler than YAML
- Full specification: `docs/tens-specification.md §6.3`

**Code:** `packages/core/src/tens_text.ts` (TensTextEncoder / TensTextDecoder)

```typescript
import { formatOutput } from '@contex/core';
const tensText = formatOutput(data, 'tens-text');
// → @version 1
//   @encoding o200k_base
//   @schema row name:str age:num
//   row
//     name Alice
//     age 30
```

---

### 3. Contex Compact (`'contex'`) — **Recommended for LLM Injection**

**What:** The ultra-efficient output format designed specifically for sending structured data to LLMs. The **default** format used by `Tens.toString()`.

**When used:** Any time you send data to an LLM (OpenAI, Anthropic, Google, Meta, etc.)

**Properties:**
- **Deep flattening:** nested objects → dot-notation keys (`user.address.city`)
- **Field name compression:** shortest unique prefix (`customer_shipping_address` → `s`)
- **Dictionary compression:** repeated values → `@0`, `@1`, ... (strings AND numbers)
- **Tab-separated:** schema declared once in header, values in rows
- **Boolean abbreviation:** `T`/`F` instead of `true`/`false`
- **Null abbreviation:** `_` instead of `null`/empty
- **Integer shortening:** no trailing `.0`
- **Sparse mode:** >50% nulls → only non-null values with column indices
- **No brackets, no quotes, no colons, no commas**

**Code:** `packages/core/src/formatters.ts` → `formatOutput(data, 'contex')`

```typescript
const tens = Tens.encode(data);
const compact = tens.toString(); // Always Contex Compact

// Example output:
// n	a	c
// @f	n=name	a=age	c=city
// @d	New York	Engineering
// Alice	30	@0
// Bob	25	@0
// Charlie	35	@1
```

**Savings:** 40-94% token reduction vs JSON (43% average across 15 dataset types).

---

### 4. Other Output Formats

| Format | Code | Use Case | Typical Savings |
|--------|------|----------|-----------------|
| `'json'` | Pretty-printed JSON | Baseline / debugging | 0% (baseline) |
| `'csv'` | Comma-separated values | Flat tabular data | ~38% |
| `'markdown'` | Pipe-delimited table | Documentation | ~6% |
| `'toon'` | Tab-separated (no dict) | Simple tabular | ~25% |
| `'tokens'` | Raw token IDs | Direct model injection | N/A |

---

## When to Use Each Format

| Scenario | Format | Why |
|----------|--------|-----|
| Sending data to any LLM | `contex` | Best token efficiency |
| Debugging / inspecting IR | `tens-text` | Human-readable, lossless roundtrip |
| Storing compiled contexts | tens binary | Content-addressed, fast cache lookup |
| LLM structured output needed | `json` | Models parse JSON natively |
| Simple flat data, no nesting | `csv` | Low overhead for flat tables |
| Documentation / reports | `markdown` | Visual in rendered docs |

---

## API Quick Reference

```typescript
import { Tens, formatOutput } from '@contex/core';

// Encode once
const tens = Tens.encode(data);

// Default: Contex Compact (recommended)
const compact = tens.toString();

// Specific format
const csv = formatOutput(data, 'csv');
const tensText = formatOutput(data, 'tens-text');
const json = formatOutput(data, 'json');

// Token materialization (model-specific)
const tokens = tens.materialize('gpt-4o');
```

---

## Format Selection (Engine)

The engine's `selectBestFormat()` automatically picks the optimal format:

```typescript
import { selectBestFormat } from '@contex/engine';

const { format, reason, providerNote, estimatedSavings } = selectBestFormat({
  model: 'gpt-4o',
  data: myData,
});
// → { format: 'contex', reason: '...', providerNote: '...', estimatedSavings: 0.45 }
```

Decision factors:
- **Data size:** <5 rows → JSON, ≥5 rows → Contex
- **Sparsity:** >80% empty → JSON fallback
- **Depth:** nested objects → Contex (flattening wins)
- **Context pressure:** data fills >30% of window → Contex
- **Provider:** model-specific guidance notes
