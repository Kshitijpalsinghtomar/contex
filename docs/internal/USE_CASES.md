<div align="center">

# Contex Use Cases

> **Real-world scenarios** showing how Contex saves tokens and money with deterministic IR-backed context.

</div>


---
# 💡 Practical Use Cases

| Use Case | Token Savings | Best For |
|----------|--------------|----------|
| RAG Pipelines | 30-59% | Fitting more documents in context |
| Customer Support | 31% | Complete ticket history |
| Multi-Model Deployments | 25-35% | One IR, all models |
| Financial Analysis | 40%+ | High-volume transactions |
| Drop-in Middleware | 30% | Zero code changes |



---

## Table of Contents

1. [RAG Pipeline](#1-rag-pipeline--fit-more-retrieved-documents)
2. [Customer Support Agent](#2-customer-support-agent--no-more-truncation)
3. [Multi-Model Deployment](#3-multi-model-deployment--one-ir-many-models)
4. [Financial Analysis](#4-financial-analysis--cut-costs-at-scale)
5. [Drop-In Middleware](#5-drop-in-middleware--zero-code-changes)

---

## 1. RAG Pipeline — Fit More Retrieved Documents

**The Pain:** Your retrieval system finds 50 relevant documents, but only 20 fit in GPT-4o's context window when sent as JSON.

### Before Contex

```typescript
const docs = await vectorDB.search(query, { limit: 50 });

// JSON: 50 docs × ~1,200 tokens each = 60,000 tokens
// GPT-4o context: 128K tokens
// After system prompt + response reserve: ~90K available
// Result: You truncate to 20 docs and lose relevant context

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Based on these documents: ${JSON.stringify(docs.slice(0, 20))}` }
  ]
});
```

### After Contex

```typescript
import { quick } from '@contex/engine';

const docs = await vectorDB.search(query, { limit: 50 });

// Canonical IR → deterministic tokens, 30-59% fewer
const result = quick(docs, 'gpt-4o', {
  systemPromptTokens: 500,
  reserve: 4096,
});

console.log(`Fits ${result.rows} docs, saving ${result.savings.percent}% tokens`);

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Based on these documents:\n${result.asText()}` }
  ]
});
```

**Result:** 75% more documents fit → better answers, same cost, prefix cache hits.

---

## 2. Customer Support Agent — No More Truncation

**The Pain:** Your agent's tool returns 200 tickets, but the context window can't hold them all as JSON.

### Before Contex

```typescript
async function fetchTickets(customerId: string) {
  const tickets = await db.getTickets(customerId);
  // 200 tickets × 300 tokens each = 60,000 tokens as JSON
  return JSON.stringify(tickets.slice(0, 50)); // Lost 150 tickets
}
```

### After Contex

```typescript
import { quick } from '@contex/engine';

async function fetchTickets(customerId: string) {
  const tickets = await db.getTickets(customerId);
  const result = quick(tickets, 'gpt-4o');
  return result.asText(); // All 200 tickets, deterministic output
}
```

**Result:** Agent sees complete history. No truncation. Better resolutions.

---

## 3. Multi-Model Deployment — One IR, Many Models

**The Pain:** You route requests to GPT-4o, Claude, or Gemini depending on the task. Each model has different tokenizers. Formatting data once produces inconsistent token counts.

### After Contex

```typescript
import { encodeIR, TokenMemory } from '@contex/core';

const memory = new TokenMemory('.contex');
const { hash } = memory.store(myData); // Store once (model-agnostic)

// Materialize per model — each gets optimal tokens, cached
const gpt = memory.materializeAndCache(hash, 'gpt-4o');
const claude = memory.materializeAndCache(hash, 'claude-3-5-sonnet');
const gemini = memory.materializeAndCache(hash, 'gemini-2-5-pro');

console.log(`GPT-4o: ${gpt.tokenCount}, Claude: ${claude.tokenCount}, Gemini: ${gemini.tokenCount}`);
```

**Result:** Store once, serve everywhere. Binary cache per model. Zero re-encoding.

---

## 4. Financial Analysis — Cut Costs at Scale

**The Pain:** 1,000 transactions per call, 10K calls/day. Token costs add up.

### After Contex

```typescript
import { quick } from '@contex/engine';

// 1,000 transactions: ~25,000 tokens (was ~60,000 as JSON)
// GPT-4o: $2.50/1M input → $0.06/call (was $0.15)
// Daily: $625 (was $1,500) → Annual savings: $319K

const result = quick(transactions, 'gpt-4o');

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: `Analyze:\n${result.asText()}` }
  ]
});
```

**Result:** $319K/year saved. Same data, same answers, deterministic caching.

---

## 5. Drop-In Middleware — Zero Code Changes

**The Pain:** You don't want to refactor your existing LLM code.

```typescript
import { createContexOpenAI } from '@contex/middleware';

// Wrap once, save everywhere
const openai = createContexOpenAI(new OpenAI(), {
  data: { tickets: myTickets, users: myUsers },
});

// Your existing code — zero changes, just use placeholders
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Analyze: {{CONTEX:tickets}} For users: {{CONTEX:users}}' }
  ],
});
```

---

## 📊 Cost Comparison

| Scenario | JSON Cost | Contex Cost | Savings |
|----------|-----------|-------------|---------|
| 10K requests/day | $1,200/mo | $780/mo | **$420/mo** |
| 100K requests/day | $12,000/mo | $7,800/mo | **$4,200/mo** |
| 1M requests/day | $120,000/mo | $78,000/mo | **$42,000/mo** |

*Based on GPT-4o pricing, 10K token context per request*

---

## 🔧 See Your Own Savings

```bash
npx contexto savings your_data.json --model gpt-4o
```

Contex analyzes your data and shows:
- Exact token reduction percentage
- Dollar savings per 1M requests
- How many more rows fit per model

---

## 📚 Related Documentation

- [Getting Started](./docs/guide/getting-started.md) — Quick tutorial
- [API Reference](./docs/reference/core.md) — Full API docs
- [Benchmarks](./docs/benchmarks.md) — Performance data
