# @contex-llm/adapters

LangChain and LlamaIndex adapters for Contex — automatically optimize your data for LLM context windows.

## Installation

```bash
pnpm add @contex-llm/adapters
```

## LangChain

```typescript
import { ContexLoader } from '@contex-llm/adapters/langchain';

const loader = new ContexLoader({ model: 'gpt-4o' });

// From a JSON file
const docs = await loader.load('data.json');

// From raw data
const optimized = loader.optimize(myData);

// Optimize existing LangChain documents
const compressed = loader.optimizeDocuments(existingDocs);
```

## LlamaIndex

```typescript
import { ContexReader } from '@contex-llm/adapters/llamaindex';

const reader = new ContexReader({ model: 'gpt-4o' });

// Optimize retrieved nodes
const nodes = await index.retrieve(query);
const optimized = reader.optimizeNodes(nodes);

// From raw data
const result = reader.optimizeData(myData);

// From a file
const fromFile = await reader.loadFile('data.json');
```

## Options

Both adapters accept:

| Option | Default | Description |
|--------|---------|-------------|
| `format` | `'contex'` | Output format (`'contex'`, `'toon'`, `'csv'`, `'markdown'`, `'json'`) |
| `model` | `'gpt-4o'` | Target model for tokenization |
| `compressFields` | `true` | Enable field name compression |
| `includeMetadata` | `true` | Include document metadata |

## Token Savings

Contex Compact format delivers **46-90% token reduction** vs raw JSON, with 72% average across 21 dataset types.

## License

MIT
