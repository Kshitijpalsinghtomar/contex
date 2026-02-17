
<div align="center">

# Getting Started with Contex

> **Get up and running with Contex in 5 minutes.**

</div>

---


## 🚀 Quick Start

```bash
# Install CLI and SDK
pnpm add -g @contex/cli
pnpm add @contex/core @contex/engine @contex/middleware
```


---

## Table of Contents

1. [Installation](#installation)
2. [The V3 Workflow](#the-v3-workflow)
3. [CLI: Analyze & Materialize](#1-cli-analyze--materialize)
4. [SDK: Inject & Execute](#2-sdk-inject--execute)
5. [Advanced: Programmatic API](#advanced-programmatic-api)
6. [Next Steps](#next-steps)

---

## Installation

```bash
# Install CLI globally or locally
pnpm add -g @contex/cli

# Install SDK packages in your project
pnpm add @contex/core @contex/engine @contex/middleware
```

---

## The V3 Workflow

Contex v3 focuses on a **Build → Inject** workflow:

1.  **Materialize**: Compile data into cached tokens during build/ingest.
2.  **Inject**: Use the SDK middleware to inject cached tokens into prompts.

### Default Newcomer Flow (Recommended)

Follow this exact path first:

1. `contex analyze data.json --model gpt-4o-mini`
2. `contex materialize data.json --model gpt-4o-mini`
3. Inject with middleware using `data: { key: <rawData or Tens> }` and `{{CONTEX:key}}`

Then move to advanced options only after this flow is green.

---

## 1. CLI: Analyze & Materialize

Use the CLI to prepare your data.

### Check Savings

See how much you can save before writing code.

```bash
contex savings data.json
# → Savings: 59% tokens, $2.50/1M reqs
```

### Materialize Tokens

Compile your data into model-specific token arrays. This creates a `.contex/` cache folder.

```bash
# Generate cached tokens for GPT-4o
contex materialize data.json --model gpt-4o

# Generate for Claude 3.5 Sonnet
contex materialize data.json --model claude-3-5-sonnet
```

---

## 2. SDK: Inject & Execute

Use the middleware to inject the materialized data.

### OpenAI Example

```typescript
import OpenAI from 'openai';
import { createContexOpenAI } from '@contex/middleware';
import ticketData from './data.json';

// 1. Wrap the client
const openai = createContexOpenAI(new OpenAI(), {
  data: { 
    tickets: ticketData // Injects as {{CONTEX:tickets}}
  }
});

// 2. Use in prompt
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'You are a support agent.' },
    { role: 'user', content: 'Analyze these tickets: {{CONTEX:tickets}}' }
  ]
});
```

### Anthropic Example (with Caching)

Contex automatically adds `cache_control` breakpoints for large payloads.

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { createContexAnthropic } from '@contex/middleware';

const client = createContexAnthropic(new Anthropic(), {
  data: { 
    knowledge_base: kbData // Large dataset
  }
});

const msg = await client.messages.create({
  model: 'claude-3-5-sonnet-20240620',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'Using {{CONTEX:knowledge_base}}, answer the user question.' }
  ]
});
```

---

## Advanced: Programmatic API

This section is optional and intended for advanced/custom pipelines.

For dynamic data or custom pipelines, use the Engine API directly.

### One-Shot `quick()`

```typescript
import { quick } from '@contex/engine';

const result = quick(myData, 'gpt-4o');
console.log(result.tokens);   // [102, 492, ...]
console.log(result.asText()); // Canonical text
```

### Token Memory (Low Level)

```typescript
import { TokenMemory } from '@contex/core';

const memory = new TokenMemory('.contex');
const { hash } = memory.store(myData);
const tokens = memory.materializeAndCache(hash, 'gpt-4o');
```

---

## Next Steps

- [Quickstart Guide](./quickstart.md) — ⭐ New: 3-line workflow in under 10 minutes
- [Migration Guide](./migration-from-json.md) — Coming from JSON? Start here
- [CLI Reference](../reference/cli.md) — Full command list
- [Benchmarks](./benchmarks.md) — Performance methodology
- [Examples](./examples.md) — Real-world use cases
