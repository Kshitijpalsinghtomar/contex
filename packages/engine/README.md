# @contex-llm/engine

**The Brain of contex.**

The Engine is responsible for packing structured data into the limited context window of LLMs. It handles budgeting, formatting, querying, and optimization.

## Features

- **Token Budgeting:** Calculates exactly how many rows of data can fit into a model's context window (e.g., GPT-4 vs. Claude 3) while reserving space for prompts and responses.
- **Auto-Format Selection:** intelligently calls `selectBestFormat` to choose between JSON, TOON (Token-Optimized Object Notation), CSV, or Markdown based on the model's strengths and the data's shape.

- **Prefix Caching:** Optimizes output order to maximize KV-cache reuse in inference engines like vLLM.
- **Cross-Session Dedup:** `StructuralDedupCache` deduplicates schemas and dictionary values across encode operations, enabling incremental encoding.
- **Predictive Packer:** `packContext()` solves optimal context packing with greedy, density, and knapsack DP strategies.

## Usage

```typescript
import { contex } from '@contex-llm/engine';

const db = new contex();

// 1. Load Data
db.insert('users', [{ id: 1, name: 'Alice', role: 'admin' }, ...]);



// 3. Optimize for LLM Context
const context = db.getOptimizedContext('users', {
  model: 'gpt-4o',
  systemPrompt: 150, // tokens used by system prompt
  userPrompt: 50,    // tokens used by user question
  reserve: 500       // tokens reserved for answer
});

console.log(context.output); 
// -> Returns optimally formatted string (e.g. CSV or TOON) 
// -> Guaranteed to fit in the remaining window
```

## API

### `getOptimizedContext(collection, options)`
The main entry point for RAG pipelines.

- `collection`: Name of the collection to read.
- `options`:
  - `model`: Target model ID (e.g., `gpt-4`).
  - `systemPrompt`: Token count of system instructions.
  - `userPrompt`: Token count of user input.
  - `reserve`: Token count to save for generation.



### `analyzeFormats(collection)`
Returns a report comparing token usage across all supported formats (JSON, TOON, YAML, etc.) for the dataset.

### `packContext(items, options)`
Optimally packs heterogeneous context items within a token budget.

- `items`: Array of `{ id, tokens, priority, content }` objects.
- `options`:
  - `budget`: Max token budget.
  - `strategy`: `'greedy'` | `'density'` | `'knapsack'`

```typescript
import { packContext } from '@contex-llm/engine';

const result = packContext(items, { budget: 4000, strategy: 'knapsack' });
console.log(result.selected);    // IDs of selected items
console.log(result.utilization);  // Budget utilization (0-1)
```

### Cross-Session Dedup

```typescript
import { StructuralDedupCache } from '@contex-llm/engine';

const cache = new StructuralDedupCache();
const r1 = cache.encode([{ id: 1, name: 'Alice' }]); // Full encode
const r2 = cache.encode([{ id: 2, name: 'Bob' }]);   // Incremental (schema deduped)

const state = cache.serialize(); // Persist across sessions
```
