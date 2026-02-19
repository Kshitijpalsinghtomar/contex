<div align="center">

# Contex Examples

> **Real-world use cases** — Copy-paste examples for every scenario.

</div>

---

## Table of Contents

1. [Customer Support Chatbot](#-customer-support-chatbot)
2. [RAG with Knowledge Base](#-rag-with-knowledge-base)
3. [Code Review Assistant](#-code-review-assistant)
4. [Data Analysis Dashboard](#-data-analysis-dashboard)
5. [Content Generation](#-content-generation)
6. [Enterprise Use Cases](#-enterprise-use-cases)
7. [Performance Patterns](#-performance-patterns)

---

## 💬 Customer Support Chatbot

Build a chatbot that has access to ticket history and knowledge base.

```typescript
// support-bot.ts
import OpenAI from 'openai';
import { createContexOpenAI } from '@contex-llm/middleware';
import { Tens } from '@contex-llm/core';

// Fetch customer data (simulated)
const tickets = await fetchCustomerTickets(customerId);
const kb = await fetchKnowledgeBase();

// Encode at startup (build time)
const tens = Tens.encode({ tickets, kb });

// Pre-materialize for production
tens.materialize('gpt-4o');

export function createSupportBot() {
  return createContexOpenAI(new OpenAI(), {
    data: { tickets, kb },
    format: 'toon',
    onInject: (info) => {
      console.log(`Used ${info.tokenCount} tokens`);
    }
  });
}

// In your API handler
app.post('/chat', async (req, res) => {
  const client = createSupportBot();
  
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { 
        role: 'system', 
        content: `You are a helpful support agent. 
Use the provided ticket history and knowledge base to answer.
Tickets: {{CONTEX:tickets}}
Knowledge: {{CONTEX:kb}}` 
      },
      { role: 'user', content: req.body.message }
    ]
  });
  
  res.json({ reply: response.choices[0].message.content });
});
```

**Result:**
- ✅ 72% avg token reduction (up to 90% on nested data)
- ✅ Cache hit on repeated tickets
- ✅ Faster response times

---

## 📐š RAG with Knowledge Base

Build a Retrieval-Augmented Generation system with context optimization.

```typescript
// rag.ts
import { createContexOpenAI } from '@contex-llm/middleware';
import { Tens } from '@contex-llm/core';
import { Chroma } from 'langchain/vectorstores/chroma';

// 1. Build Knowledge Base
async function buildKnowledgeContext(query: string) {
  // Retrieve relevant documents
  const docs = await vectorStore.similaritySearch(query, 10);
  
  // Extract content
  const content = docs.map(d => d.pageContent);
  
  // Encode with Contex
  const tens = Tens.encode({ documents: content });
  
  // Get token count
  const tokenCount = tens.tokenCount('gpt-4o');
  
  // If too many tokens, reduce documents
  if (tokenCount > 40000) {
    const reduced = docs.slice(0, 5);
    const tensSmall = Tens.encode({ documents: reduced.map(d => d.pageContent) });
    return tensSmall;
  }
  
  return tens;
}

// 2. Query with Context
export async function ragQuery(query: string, openai: OpenAI) {
  const tens = await buildKnowledgeContext(query);
  const context = formatOutput(tens.fullIR.data, 'toon');
  
  const client = createContexOpenAI(openai, {
    data: { context: tens }
  });
  
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'Answer based ONLY on the provided context.'
      },
      {
        role: 'user',
        content: `Context:\n{{CONTEX:context}}\n\nQuestion: ${query}`
      }
    ]
  });
  
  return response.choices[0].message.content;
}
```

**Key Features:**
- Dynamic context sizing
- Token budget management
- Cache

---

##-friendly for repeated queries 🔍 Code Review Assistant

Analyze code changes with context about the codebase.

```typescript
// code-review.ts
import { createContexOpenAI } from '@contex-llm/middleware';
import { Tens } from '@contex-llm/core';
import { getDiff, getFileContext } from './git';

interface ReviewRequest {
  pr: string;
  files: string[];
}

export async function reviewPR(request: ReviewRequest) {
  const { pr, files } = request;
  
  // Get git diff
  const diff = await getDiff(pr);
  
  // Get file context (function definitions, imports)
  const contexts = await Promise.all(
    files.map(f => getFileContext(f))
  );
  
  // Encode diff and context
  const tens = Tens.encode({
    changes: diff,
    context: contexts
  });
  
  const client = createContexOpenAI(new OpenAI(), {
    data: { review: tens },
    format: 'markdown'  // Markdown better for code reviews
  });
  
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a code reviewer. Provide constructive feedback.
        
Changes:
{{CONTEX:changes}}

File Context:
{{CONTEX:context}}`
      },
      {
        role: 'user',
        content: 'Review these changes and suggest improvements.'
      }
    ]
  });
  
  return {
    review: response.choices[0].message.content,
    tokens: tens.materialize('gpt-4o').tokenCount
  };
}
```

---

## 📊 Data Analysis Dashboard

Create dashboards that analyze data with AI assistance.

```typescript
// analytics.ts
import { createContexOpenAI } from '@contex-llm/middleware';
import { Tens, formatOutput } from '@contex-llm/core';

interface DashboardRequest {
  metrics: Metric[];
  timeframe: string;
}

export async function analyzeMetrics(request: DashboardRequest) {
  const { metrics, timeframe } = request;
  
  // Encode metrics
  const tens = Tens.encode({
    metrics,
    period: timeframe
  });
  
  // Get different formats for different purposes
  const summary = tens.toString('csv');
  const detailed = tens.toString('markdown');
  const tokenized = tens.materialize('gpt-4o');
  
  const client = createContexOpenAI(new OpenAI(), {
    data: { metrics: tokenized }
  });
  
  // Generate insights
  const insights = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a data analyst. Generate insights from the metrics.
        
Period: {{CONTEX:period}}
Metrics:
{{CONTEX:metrics}}`
      },
      {
        role: 'user',
        content: 'What are the key trends and anomalies?'
      }
    ]
  });
  
  return {
    insights: insights.choices[0].message.content,
    summary,
    detailed,
    tokenCount: tokenized.tokenCount,
    savings: `${((1 - tokenized.tokenCount / 39605) * 100).toFixed(1)}%`
  };
}
```

---

## ✍️ Content Generation

Generate content using structured data as context.

```typescript
// content-generator.ts
import { createContexOpenAI } from '@contex-llm/middleware';
import { Tens } from '@contex-llm/core';

interface Product {
  name: string;
  description: string;
  features: string[];
  price: number;
  category: string;
}

export async function generateProductDescription(product: Product) {
  // Encode product data
  const tens = Tens.encode({ product });
  
  const client = createContexOpenAI(new OpenAI(), {
    data: tens
  });
  
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Generate compelling product descriptions.
        
Product Info:
{{CONTEX:product}}`
      },
      {
        role: 'user',
        content: 'Create a marketing description and bullet points.'
      }
    ]
  });
  
  return response.choices[0].message.content;
}

// Batch generation
export async function generateCatalog(products: Product[]) {
  const tens = Tens.encode({ products });
  const tokens = tens.materialize('gpt-4o');
  
  const client = createContexOpenAI(new OpenAI(), {
    data: { products: tens }
  });
  
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'Generate catalog descriptions for these products.'
      },
      {
        role: 'user',
        content: 'Products:\n{{CONTEX:products}}'
      }
    ]
  });
  
  return response.choices[0].message.content;
}
```

---

## 🏢 Enterprise Use Cases

### Multi-Tenant SaaS

```typescript
// tenant-context.ts
import { createContexOpenAI } from '@contex-llm/middleware';
import { Tens } from '@contex-llm/core';

// Per-tenant cache
const tenantCache = new Map<string, Tens>();

export function getTenantContext(tenantId: string, data: any) {
  // Check cache
  if (tenantCache.has(tenantId)) {
    const cached = tenantCache.get(tenantId);
    if (cached && cached.hasCache('gpt-4o')) {
      return cached;
    }
  }
  
  // Encode and cache
  const tens = Tens.encode(data);
  tens.materialize('gpt-4o'); // Pre-warm cache
  tenantCache.set(tenantId, tens);
  
  return tens;
}

// API handler
app.get('/ai/chat', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const context = getTenantContext(tenantId, req.tenantData);
  
  const client = createContexOpenAI(openai, {
    data: { context }
  });
  
  // ... handle chat
});
```

### Financial Reporting

```typescript
// finance.ts
import { createContexAnthropic } from '@contex-llm/middleware';
import { Tens } from '@contex-llm/core';

interface Transaction {
  date: string;
  amount: number;
  category: string;
  description: string;
}

export async function generateFinancialReport(
  transactions: Transaction[],
  period: string
) {
  const tens = Tens.encode({ transactions, period });
  
  // Use Claude for better reasoning
  const client = createContexAnthropic(new Anthropic(), {
    data: { transactions: tens },
    model: 'claude-3-5-sonnet'
  });
  
  const summary = await client.messages.create({
    model: 'claude-3-5-sonnet-20240620',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `Analyze these transactions for {{CONTEX:period}}:
{{CONTEX:transactions}}

Provide:
1. Total spending by category
2. Unusual transactions
3. Recommendations`
      }
    ]
  });
  
  return {
    report: summary.content[0].type === 'text' 
      ? summary.content[0].text 
      : 'Error generating report',
    tokenSavings: tens.materialize('claude-3-5-sonnet').tokenCount
  };
}
```

---

## ⚡ Performance Patterns

### Pre-warm Cache

```typescript
// Build script - run at deployment
import { Tens } from '@contex-llm/core';

const data = require('./data.json');
const tens = Tens.encode(data);

// Pre-materialize for all models
['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-1.5-flash']
  .forEach(model => tens.materialize(model));

console.log('Cache warmed!');
```

### Batch Processing

```typescript
// Process multiple items efficiently
import { Tens } from '@contex-llm/core';

const items = loadItems(); // 1000 items

// Batch encode
const tens = Tens.encode({ items });

// Process in parallel
const results = await Promise.all([
  tens.materialize('gpt-4o'),
  tens.materialize('claude-3-5-sonnet')
]);

console.log(`GPT: ${results[0].tokenCount} tokens`);
console.log(`Claude: ${results[1].tokenCount} tokens`);
```

### Streaming with Context

```typescript
// Stream responses while using context
const stream = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { 
      role: 'system', 
      content: 'Summarize the data.' 
    },
    { 
      role: 'user', 
      content: `Data: {{CONTEX:data}}` 
    }
  ],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

---

## 🔗 Framework Integrations

### LangChain Integration

Use Contex with LangChain for RAG pipelines.

```typescript
// langchain-rag.ts
import { ContexLoader } from '@contex-llm/adapters';
import { Chroma } from 'langchain/vectorstores/chroma';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';

// 1. Create Contex Loader
const loader = new ContexLoader({
  format: 'toon'  // Use TOON format for better token efficiency
});

// 2. Load and split documents
const docs = await loader.load('./data/*.json');
const splitter = new RecursiveCharacterTextSplitter();
const splits = await splitter.splitDocuments(docs);

// 3. Create vector store
const vectorStore = await Chroma.fromDocuments(
  splits,
  new OpenAIEmbeddings()
);

// 4. Query with context
export async function ragQuery(query: string) {
  const retriever = vectorStore.asRetriever();
  const relevantDocs = await retriever.getRelevantDocuments(query);
  
  // Use Contex to encode retrieved docs
  const tens = ContexLoader.toTens(relevantDocs.map(d => ({ content: d.pageContent })));
  const tokens = tens.materialize('gpt-4o');
  
  return tokens;
}
```

### LlamaIndex Integration

Use Contex with LlamaIndex for advanced indexing.

```typescript
// llamaindex-rag.ts
import { ContexReader } from '@contex-llm/adapters';
import { VectorStoreIndex } from 'llamaindex';
import { OpenAI } from 'llm';

// 1. Create Contex Reader
const reader = new ContexReader({
  format: 'toon'
});

// 2. Load documents
const documents = await reader.loadData('./data/*.json');

// 3. Create index
const index = await VectorStoreIndex.fromDocuments(documents);

// 4. Query engine
export async function queryIndex(query: string) {
  const queryEngine = index.asQueryEngine();
  
  // Get response with Contex-optimized context
  const response = await queryEngine.query(query);
  
  return response.response;
}
```

---

## 🔗 Related

- [Getting Started](./getting-started.md) — Quick tutorial
- [Quickstart Guide](./quickstart.md) — ⭐ 3-line workflow
- [Migration Guide](./migration-from-json.md) — Coming from JSON?
- [API Reference](../reference/core.md) — Full API docs
- [Middleware API](../reference/middleware.md) — Provider integration
- [Benchmarks](./benchmarks.md) — Performance data
