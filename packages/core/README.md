# @contex/core

**The format engine for Contex.**

Zero storage dependencies. Pure format operations: encode, decode, tokenize, and format structured data.

## What's Inside

| Component | Description |
|---|---|
| `TokenStreamEncoder` | Encodes structured data → TENS binary (canonical) or token stream |
| `TokenStreamDecoder` | Decodes TENS binary → structured data (lossless roundtrip) |
| `TokenizerManager` | Multi-tokenizer with LRU cache: `cl100k_base`, `o200k_base`, `p50k_base`, `r50k_base` |
| `SchemaRegistry` | Deduplicates object shapes via SHA-256 hashes of sorted key names |
| `formatOutput()` | Converts data arrays → TOON, CSV, Markdown, JSON text |
| `analyzeFormats()` | Compares token cost across all output formats |
| `TensTextEncoder/Decoder` | Human-readable TENS-Text format with schema & dictionary encoding |
| `PreTokenizedBlock` | PTOK binary: stores data with embedded token IDs, field-level access |

## Installation

```bash
pnpm add @contex/core
```

## Usage

### TENS SDK (High-Level)

The `Tens` class is the recommended way to work with Contex IR. It handles hashing, storage, and materialization automatically.

```typescript
import { Tens } from '@contex/core';

// 1. Encode (Synchronous)
const tens = Tens.encode([{ id: 1, name: 'Alice' }]);

console.log(tens.hash);       // SHA-256 hash
console.log(tens.toString()); // Canonical JSON for API injection

// 2. Materialize Tokens (Cached)
const tokens = tens.materialize('gpt-4o');
```

### Low-Level: TENS Encode / Decode

```typescript
import { TokenStreamEncoder, TokenStreamDecoder } from '@contex/core';

const encoder = new TokenStreamEncoder();
const binary = encoder.encode([{ id: 1, name: 'Alice' }]);

const decoder = new TokenStreamDecoder();
const data = decoder.decode(binary);
// data[0] === { id: 1, name: 'Alice' }
```

### Token Counting

```typescript
import { TokenizerManager } from '@contex/core';

const tm = new TokenizerManager();
const count = tm.countTokens('Hello world', 'o200k_base');
const ids = tm.tokenize('Hello world', 'o200k_base');

tm.dispose(); // Clean up
```

### Format Output

```typescript
import { formatOutput } from '@contex/core';

const data = [{ id: 1, name: 'Alice', role: 'admin' }];

formatOutput(data, 'toon');
// → "id\tname\trole\n1\tAlice\tadmin"

formatOutput(data, 'csv');
// → "id,name,role\n1,Alice,admin"
```

## TENS Binary Format

TENS is the canonical intermediate representation. See the [TENS Specification](../../docs/tens-specification.md) for full details.

Key properties:
- **Canonical** — Same data → same bytes, always
- **Schema-indexed** — Object shapes stored once
- **Dictionary-encoded** — Repeated strings stored once
- **Lossless** — Full type preservation (nulls, booleans, numbers, strings)

## Pre-Tokenized Blocks (PTOK)

PTOK stores data with embedded token IDs for near-zero latency on repeated serves:

```typescript
import { createPreTokenizedBlock, readPreTokenizedBlock } from '@contex/core';

const block = createPreTokenizedBlock({ id: 1, name: 'Alice' }, 'o200k_base');
const result = readPreTokenizedBlock(block);
console.log(result.fields.name.tokenIds); // Pre-computed token IDs
```
