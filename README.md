
# Contex

**The token compiler for LLMs.**
Canonical IR → Deterministic Tokens → Guaranteed Prefix Cache Hits.
*Reduce LLM infrastructure costs by 30–59% for structured workloads.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](http://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/Status-v3-green.svg)]()

> "Context is infinite. Budgets are not."

---

## The Problem

Every time you send structured data (JSON, CSV, code) to an LLM:
1.  **You pay for syntax**: Brackets, quotes, and whitespace consume tokens but add no information.
2.  **You break the cache**: Simple changes (key order, whitespace) change the token sequence, causing **cache misses**.
3.  **You waste compute**: The provider re-tokenizes the same static data billions of times.

Contex compiles your data into **Canonical IR** — a deterministic, model-agnostic intermediate representation. When you need tokens, it materializes them for the target model. Same data → same IR → same tokens → **prefix cache hits every time**.

```typescript
import { quick } from '@contex/engine';

const result = quick(myData, 'gpt-4o');
result.tokens;           // number[] — deterministic token array
result.savings.percent;  // e.g. 42% fewer tokens than JSON
result.asText();         // canonical JSON (deterministic text for LLM APIs)
```

**One import. One function call. Deterministic output.**

---
## ⚡ The Solution

Contex acts as a **Token Compiler**.

1.  **Canonical IR**: Your data is encoded into a deterministic, model-agnostic binary format (`.tens.ir`).
2.  **Lazy Materialization**: We generate model-specific token arrays **once** and cache them (`.tens.cache`).
3.  **Deterministic Injection**: We inject **canonical text** or **token arrays** that are mathematically guaranteed to be identical, triggering **100% prefix cache hits**.

| Feature | Without Contex | With Contex |
| :--- | :--- | :--- |
| **Tokenization** | Redundant (every request) | **Once** (cached) |
| **Cache Hits** | Random / Flaky | **Guaranteed** (Deterministic) |
| **Cost** | Full price | **-90%** (Anthropic/Google/OpenAI) |
| **Latency** | Network + Tokenization | **Zero-latency** injection |

---

## 🚀 Quick Start

### Install

```bash
pnpm add @contex/core @contex/engine @contex/middleware @contex/cli
```

### 1. CLI: Analyze & Optimize

Use the CLI to inspect your data and see the token savings tokens.

```bash
# Materialize tokens for a specific model (e.g. Claude 3.5 Sonnet)
npx contex materialize my_data.json --model claude-3-5-sonnet

# Output:
#   Input:       my_data.json
#   IR Hash:     a1b2c3d4...
#   Tokens:      14,205 (vs 22,000 JSON)
#   Cached:      ✅ (.contex/cache/...)
```

### 2. SDK: Drop-in Middleware

Wrap your existing OpenAI/Anthropic client. No prompt changes needed.

**Anthropic Example (with Automatic Caching):**
Contex automatically adds `cache_control` breakpoints to large injected payloads (>3.5k chars), saving you 90% on input costs.

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { createContexAnthropic } from '@contex/middleware';

// 1. Wrap the client
const client = createContexAnthropic(new Anthropic(), {
  data: { 
    tickets: myLargeDataset // Injects as {{CONTEX:tickets}}
  },
  onInject: (info) => console.log(`Injected ${info.tokenCount} tokens from cache`),
});

// 2. Use normally
const msg = await client.messages.create({
  model: 'claude-3-5-sonnet-20240620',
  max_tokens: 1024,
  messages: [
    // The placeholder is replaced by deterministic canonical text
    { role: 'user', content: 'Analyze the {{CONTEX:tickets}} and look for patterns.' } 
  ],
});
```

**OpenAI Example:**

```typescript
import OpenAI from 'openai';
import { createContexOpenAI } from '@contex/middleware';

const openai = createContexOpenAI(new OpenAI(), {
   data: { tickets: myTickets } 
});

const response = await openai.chat.completions.create({
   model: 'gpt-4o',
   messages: [{ role: 'user', content: 'Analyze {{CONTEX:tickets}}' }]
});
```

### 3. TENS SDK: Full Control (Phase 10 API)

For advanced usage, interact directly with the **TENS** object. This is the canonical way to work with Contex IR.

```typescript
import { Tens } from '@contex/core';

// 1. Encode: Your data becomes a deterministic, immutable TENS object
const tens = Tens.encode(myData);

console.log(tens.hash);       // SHA-256 Content Hash (Source of Truth)
console.log(tens.toString()); // Canonical Text for Prompt Injection

// 2. Materialize: Generate tokens for specific models (Cached!)
const tokens = tens.materialize('gpt-4o', { maxTokens: 1000 });
```

### 4. CLI Power Tools

**Compose Prompts:**
Combine data files and text blocks into a budget-aware prompt using a config file.

```bash
# compose.json
# {
#   "model": "gpt-4o",
#   "reserve": 500,
#   "blocks": [{ "type": "file", "path": "data.json" }]
# }

npx contex compose compose.json
```

**Real-world Proof (Anthropic Caching):**
Run our demo to see sub-second latency via deterministic caching.

```bash
npx tsx packages/cli/src/examples/anthropic_cache_demo.ts
```

---

## ARCHITECTURE

- **Layer 1: Canonical IR**: `encodeIR(data)` -> `.tens.ir` hash.
- **Layer 2: Memory & Materialization**: `materialize(hash, model)` -> `.tens.cache`.
- **Layer 3: Composition**: `compose(blocks)` -> Context-window fitted prompt.
- **Layer 4: Injection**: `middleware` -> SDK integration.

## License

MIT © Contex
