<div align="center">

# Migration Guide: From JSON to Contex

> **Complete guide for migrating from raw JSON to Contex**
> This guide covers common patterns, gotchas, and best practices.

</div>

---

## Table of Contents

1. [Why Migrate?](#why-migrate)
2. [Quick Comparison](#quick-comparison)
3. [Step-by-Step Migration](#step-by-step-migration)
4. [Common Patterns](#common-patterns)
5. [Troubleshooting](#troubleshooting)
6. [Performance Tips](#performance-tips)

---

## Why Migrate?

| Aspect | JSON | Contex |
|--------|------|--------|
| **Token Usage** | 100% (baseline) | 60-70% |
| **Cache Hits** | ❌ None | ✅ 100% deterministic |
| **Cost** | $10/1M tokens | $6-7/1M tokens |
| **Setup** | None | 3 lines |

### Real Impact

If you're spending **$10,000/month** on LLM calls with JSON:

- With Contex: ~$6,000/month
- **Savings: $4,000/month** ($48,000/year)

---

## Quick Comparison

### Before (JSON)

```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: `Analyze: ${JSON.stringify(data)}` }
  ]
});
```

### After (Contex)

```typescript
import { Tens } from '@contex-llm/core';
import { createContexOpenAI } from '@contex-llm/middleware';

// Encode once
const tens = Tens.encode(data);

// Materialize for your model
const tokens = tens.materialize('gpt-4o');

// Inject
const client = createContexOpenAI(openai, { data: { context: tens }});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: `Analyze: {{CONTEX:context}}` }
  ]
});
```

---

## Step-by-Step Migration

### Step 1: Install Dependencies

```bash
# Basic usage
pnpm add @contex-llm/core @contex-llm/middleware

# With cost analysis
pnpm add @contex-llm/engine
```

### Step 2: Replace JSON Stringification

**Before:**

```typescript
// ❌ Old way
const prompt = `Analyze this data: ${JSON.stringify(tickets)}`;
```

**After:**

```typescript
// ✅ New way
import { Tens } from '@contex-llm/core';

// Encode once (at startup/build time)
const tens = Tens.encode(tickets);

// Get canonical text OR tokens
const text = tens.toString();        // For text APIs
const tokens = tens.materialize('gpt-4o');  // For token injection

const prompt = `Analyze this data: ${text}`;
```

### Step 3: Use Middleware (Recommended)

**Before:**

```typescript
// ❌ Old way
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: `Data: ${JSON.stringify(data)}` }
  ]
});
```

**After:**

```typescript
// ✅ New way with middleware
import { createContexOpenAI } from '@contex-llm/middleware';

// Wrap your client
const client = createContexOpenAI(openai, {
  data: { 
    tickets: Tens.encode(data)
  }
});

// Use placeholders in prompts
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Summarize: {{CONTEX:tickets}}' }
  ]
});
```

---

## Common Patterns

### Pattern 1: Static Data (Build Time)

Best for: Knowledge bases, system prompts, static context

```typescript
// build.ts — Run once during deployment
import { Tens } from '@contex-llm/core';

const kb = loadKnowledgeBase();
const tens = Tens.encode(kb);

// Pre-materialize for all models
const models = ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet'];
const caches = {};
for (const model of models) {
  caches[model] = tens.materialize(model);
}

// Save to file/database
saveCache('knowledge-base', { hash: tens.hash, caches });
```

### Pattern 2: Dynamic Data (Runtime)

Best for: User-specific data, Real-time queries

```typescript
// runtime.ts — Run per request
import { Tens } from '@contex-llm/core';

export async function handleRequest(userId: string) {
  // Fetch user data
  const userData = await db.getUserData(userId);
  
  // Encode and materialize
  const tens = Tens.encode(userData);
  const tokens = tens.materialize('gpt-4o');
  
  // Inject
  const client = createContexOpenAI(openai, {
    data: { user: tens }
  });
  
  return client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: 'Profile: {{CONTEX:user}}' }
    ]
  });
}
```

### Pattern 3: Cached Context

Best for: RAG, repeated queries

```typescript
// cache.ts
import { Tens } from '@contex-llm/core';

const contextCache = new Map<string, Tens>();

function getContext(documents: any[]) {
  // Create hash of documents
  const key = JSON.stringify(documents).slice(0, 100);
  
  // Check cache
  if (contextCache.has(key)) {
    return contextCache.get(key);
  }
  
  // Encode and cache
  const tens = Tens.encode(documents);
  contextCache.set(key, tens);
  
  return tens;
}

// Usage
const context = getContext(retrievedDocs);
const tokens = context.materialize('gpt-4o');
```

### Pattern 4: Streaming Responses

```typescript
// stream.ts
const stream = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Summarize: {{CONTEX:data}}' }
  ],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

---

## Troubleshooting

### Issue: "I need to update data frequently"

**Solution:** Re-encode on update. Tens encoding is fast (~60K ops/sec).

```typescript
// When data changes
const tens = Tens.encode(newData);
const tokens = tens.materialize('gpt-4o');
```

### Issue: "How do I handle nested objects?"

**Solution:** Contex automatically flattens nested structures.

```typescript
const data = [
  { user: { name: 'John', address: { city: 'NYC' } } }
];

// Contex handles this automatically
const tens = Tens.encode(data);
// Output is deterministic regardless of nesting
```

### Issue: "What about large datasets?"

**Solution:** Use pagination + Contex together.

```typescript
// Chunk large data
const chunkSize = 1000;
for (let i = 0; i < data.length; i += chunkSize) {
  const chunk = data.slice(i, i + chunkSize);
  const tens = Tens.encode(chunk);
  // Process chunk
}
```

### Issue: "JSON parse errors in prompts"

**Solution:** Use TOON format instead of JSON.

```typescript
const toonText = formatOutput(tens.fullIR.data, 'toon');
// Output:
// name	age	city
// John	30	NYC
// Jane	25	LA
```

---

## Performance Tips

### 1. Pre-materialize at Build Time

```typescript
// Build script
const tens = Tens.encode(data);
const tokens = tens.materialize('gpt-4o'); // Cache for runtime
```

### 2. Check Cache Before Materialization

```typescript
if (tens.hasCache('gpt-4o')) {
  console.log('Using cached tokens (instant)');
}
const tokens = tens.materialize('gpt-4o');
```

### 3. Use Token Injection (Not Text)

```typescript
// ✅ Faster, cheaper
const client = createContexOpenAI(openai, {
  data: { context: tens }  // Tens object
});

// ⚠️ Slower, more expensive
const client = createContexOpenAI(openai, {
  data: { context: text }   // String
});
```

### 4. Batch Similar Requests

```typescript
// ✅ Better: One encode, multiple materializations
const tens = Tens.encode(customers);
const gpt4 = tens.materialize('gpt-4o');
const gptMini = tens.materialize('gpt-4o-mini');

// ❌ Worse: Encode per request
for (const customer of customers) {
  const tens = Tens.encode([customer]); // Repeated work
}
```

---

## Migration Checklist

- [ ] Install `@contex-llm/core` and `@contex-llm/middleware`
- [ ] Replace `JSON.stringify(data)` with `Tens.encode(data).toString()`
- [ ] Or use `Tens.encode(data).materialize(model)` for token injection
- [ ] Wrap LLM client with `createContexOpenAI()` or `createContexAnthropic()`
- [ ] Replace data in prompts with `{{CONTEX:key}}` placeholders
- [ ] Test with sample data to verify token reduction
- [ ] Monitor costs after migration

---

## Next Steps

- [Quickstart Guide](./quickstart.md) — 3-line workflow
- [API Reference](./reference/core.md) — Full API docs
- [Examples](./examples.md) — More patterns
