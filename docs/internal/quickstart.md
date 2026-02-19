<div align="center">

# Contex Quickstart — 3 Lines to Production

> **Get up and running with Contex in under 10 minutes.**
> This guide covers the complete workflow: **Encode → Materialize → Inject**

</div>

---

## 🎯 The 3-Line Workflow

Contex v3 follows a simple **Build → Inject** pattern:

```typescript
// Line 1: Encode your data into TENS format (deterministic, cached)
const tens = Tens.encode(myData);

// Line 2: Pre-materialize for your target model (build time)
const tokens = tens.materialize('gpt-4o');

// Line 3: Inject into any LLM provider
const client = createContexOpenAI(openai, { data: { context: tens } });
```

That's it! Your data is now **46-90% smaller** and **cache-ready**.

---

## Table of Contents

1. [Which Package Do I Need?](#which-package-do-i-need)
2. [Quick Start (5 Minutes)](#quick-start-5-minutes)
3. [The Complete Workflow](#the-complete-workflow)
4. [Real-World Examples](#real-world-examples)
5. [Troubleshooting](#troubleshooting)

---

## Which Package Do I Need?

| Package | When to Use | What's Inside |
|---------|-------------|---------------|
| `@contex-llm/core` | **Most users** — Encoding, materialization, utilities | `Tens`, `TokenMemory`, formatters |
| `@contex-llm/engine` | Need budget analysis, multi-model support | `quick()`, model registry, cost calculators |
| `@contex-llm/middleware` | Want drop-in provider integration | `createContexOpenAI()`, `createContexAnthropic()` |
| `@contex-llm/cli` | CLI tools, benchmarking | `contex` command-line tool |

### Decision Tree

```
START
  │
  ▼
Do you want CLI tools or benchmarking?
  │
  ├─ YES → @contex-llm/cli
  │
  ▼ NO
Do you want drop-in OpenAI/Anthropic integration?
  │
  ├─ YES → @contex-llm/middleware (+ @contex-llm/core)
  │
  ▼ NO
Just need to encode and tokenize data?
  │
  └─ YES → @contex-llm/core
```

---

## Quick Start (5 Minutes)

### Step 1: Install

```bash
# For most users (recommended)
pnpm add @contex-llm/core @contex-llm/middleware

# For advanced usage with cost analysis
pnpm add @contex-llm/core @contex-llm/engine @contex-llm/middleware
```

### Step 2: Encode & Inject (Most Common)

```typescript
import { Tens } from '@contex-llm/core';
import { createContexOpenAI } from '@contex-llm/middleware';

// Your data
const tickets = [
  { id: 1, title: 'Login issue', priority: 'high', status: 'open' },
  { id: 2, title: 'Payment failed', priority: 'critical', status: 'pending' },
  // ... more tickets
];

// 1️⃣ Encode (once at startup/build time)
const tens = Tens.encode(tickets);

// 2️⃣ Pre-materialize (build time - optional but recommended)
const tokens = tens.materialize('gpt-4o');

// 3️⃣ Inject (runtime)
const client = createContexOpenAI(new OpenAI(), {
  data: { tickets: tens }  // Pass Tens object directly
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { 
      role: 'system', 
      content: 'You are a support agent.' 
    },
    { 
      role: 'user', 
      content: 'Summarize these tickets: {{CONTEX:tickets}}' 
    }
  ]
});
```

**Result:**
- ✅ 46-90% token reduction (avg 72%)
- ✅ Deterministic output (100% cache hit rate)
- ✅ Faster responses

---

## The Complete Workflow

### Phase 1: Build Time (Encode + Materialize)

```typescript
// build.ts — Run this during deployment/build
import { Tens } from '@contex-llm/core';

const data = loadYourData();

// Encode to TENS (deterministic, compressed)
const tens = Tens.encode(data);

// Pre-materialize for all models you support
const gptTokens = tens.materialize('gpt-4o');
const claudeTokens = tens.materialize('claude-3-5-sonnet');

// Save to cache
// (TokenMemory automatically persists to .contex/ directory)
console.log(`Cached: ${tens.hash}`);
```

### Phase 2: Runtime (Inject)

```typescript
// runtime.ts — Run this in your API
import { Tens } from '@contex-llm/core';
import { createContexOpenAI } from '@contex-llm/middleware';

// Load pre-encoded data
const tens = Tens.loadFromHash(cachedHash);

// Get cached tokens (instant if warm)
const tokens = tens.materialize('gpt-4o');

// Inject
const client = createContexOpenAI(openai, {
  data: { context: tens }
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: `Data: {{CONTEX:context}}` }]
});
```

---

## Real-World Examples

### Example 1: Customer Support Chatbot

```typescript
// support-bot.ts
import { Tens } from '@contex-llm/core';
import { createContexOpenAI } from '@contex-llm/middleware';

export class SupportBot {
  private tens: Tens;
  
  constructor(ticketData: any[]) {
    // Encode once at startup
    this.tens = Tens.encode(ticketData);
    // Pre-warm cache for your model
    this.tens.materialize('gpt-4o');
  }
  
  async ask(question: string) {
    const client = createContexOpenAI(new OpenAI(), {
      data: { tickets: this.tens }
    });
    
    return client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Help with support tickets.' },
        { role: 'user', content: `${question}\n\nTickets: {{CONTEX:tickets}}` }
      ]
    });
  }
}
```

### Example 2: RAG with Cache

```typescript
// rag.ts
import { Tens } from '@contex-llm/core';
import { createContexOpenAI } from '@contex-llm/middleware';

async function ragQuery(query: string, docs: any[]) {
  // Encode documents once
  const tens = Tens.encode(docs);
  
  const client = createContexOpenAI(openai, {
    data: { docs: tens }
  });
  
  return client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'Answer from context.' },
      { role: 'user', content: `Context: {{CONTEX:docs}}\n\nQuestion: ${query}` }
    ]
  });
}
```

### Example 3: Cost Analysis (with Engine)

```typescript
// analyze.ts
import { analyzeSavings } from '@contex-llm/engine';

const data = loadData();

// Get savings across all models
const results = analyzeSavings(data);

results.forEach(r => {
  console.log(`${r.model}:`);
  console.log(`  Tokens: ${r.irTokens} (vs ${r.jsonTokens} JSON)`);
  console.log(`  Savings: ${r.savingsPercent}%`);
  console.log(`  Cost: $${r.costPerCall} per 1M tokens`);
});
```

---

## Troubleshooting

### "I don't know which package to use"

Start with `@contex-llm/core` + `@contex-llm/middleware`. Add `@contex-llm/engine` only if you need cost analysis.

### "How do I check if cache is warm?"

```typescript
if (tens.hasCache('gpt-4o')) {
  console.log('Cache hit! Materialization will be instant.');
}
```

### "How do I save/load cached data?"

```typescript
// Save hash for later
const hash = tens.hash;
// Store hash in database, Redis, etc.

// Load later
const loaded = Tens.loadFromHash(hash);
```

### "What's the difference between toString() and materialize()?"

| Method | Returns | Use Case |
|--------|---------|-----------|
| `tens.toString()` | String (Contex Compact) | Text-based APIs, debugging |
| `tens.materialize()` | Token IDs (Int32Array) | Token injection, production |

---

## Next Steps

- [API Reference](./reference/core.md) — Full API docs
- [Examples](./examples.md) — More real-world patterns
- [Benchmarks](./benchmarks.md) — Performance data
- [Migration Guide](./migration-from-json.md) — Coming from JSON?
