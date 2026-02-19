<div align="center">

# @contex-llm/core API Reference

> **The Token-Native Data Infrastructure for AI Systems**
>
> Contex transforms structured data into optimized, deterministic representations that reduce token volume by **46-90%** before the tokenizer runs.

</div>


## 🎯 Quick Reference

```bash
# Install
pnpm add @contex-llm/core
```

### Core Classes

| Class | Purpose |
|-------|---------|
| `Tens` | High-level API for encoding/decoding |
| `TokenMemory` | Persistent token caching |
| `Materializer` | Model-specific token generation |
| `Composer` | Assemble multiple contexts |


---

## Table of Contents

1. [Getting Started](#-getting-started)
2. [Tens API](#-tens--the-main-api)
3. [TokenMemory](#-tokenmemory--persistent-caching)
4. [Materializer](#-materializer--fine-grained-control)
5. [Utility Functions](#-utility-functions)
6. [Output Formats](#-output-formats)
7. [Performance Tips](#-performance-tips)
8. [Error Handling](#-error-handling)
9. [TypeScript Support](#-typescript-support)

---

## 🚀 Getting Started

```typescript
import { Tens } from '@contex-llm/core';

// Encode once, use everywhere
const tens = Tens.encode([
  { title: "Fix login bug", priority: "high", status: "open" },
  { title: "Add dark mode", priority: "medium", status: "closed" }
]);

// Materialize for any model
const gptTokens = tens.materialize('gpt-4o');
const claudeTokens = tens.materialize('claude-3-5-sonnet');

// Get canonical text
const text = tens.toString();
```

---

## 📐¦ Tens — The Main API

The `Tens` class is your primary interface to Contex.

### `Tens.encode(data, options?)`

Encodes structured data into the TENS canonical intermediate representation.

```typescript
import { Tens } from '@contex-llm/core';

const tens = Tens.encode(myData, {
  memory: new TokenMemory('./.contex')
});
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `memory` | `TokenMemory` | `undefined` | Optional persistent IR/token cache |

---

### `tens.materialize(model, options?)`

Generates model-specific tokens from the TENS representation.

```typescript
const tokens = tens.materialize('gpt-4o', {
  maxTokens: 50000
});

console.log(tokens.length);      // Int32Array token count

const full = tens.materializeFull('gpt-4o');
console.log(full.tokenCount);    // Detailed metadata path
```

**Supported Models:**

| Provider | Models |
|----------|--------|
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo` |
| **Anthropic** | `claude-3-5-sonnet`, `claude-3-opus`, `claude-3-haiku` |
| **Google** | `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash` |

---

### `tens.toString()`

Returns human-readable representation.

```typescript
// Default canonical format
const canonical = tens.toString();

// For alternate formats use formatOutput on canonical data
import { formatOutput } from '@contex-llm/core';
const csv = formatOutput(tens.fullIR.data, 'csv');
const markdown = formatOutput(tens.fullIR.data, 'markdown');
const json = formatOutput(tens.fullIR.data, 'json');
```

---

### `tens.hasCache(model)`

Check if tokens are cached for a model.

```typescript
if (tens.hasCache('gpt-4o')) {
  console.log('Cache hit - no recomputation needed!');
}
```

---

### `tens.tokenCount(model)`

Get token count without materializing.

```typescript
const count = tens.tokenCount('gpt-4o');
console.log(`Will use ${count} tokens`);
```

---

### `tens.serialize() / tens.deserialize()`

Serialize/deserialize for persistence.

```typescript
// Save to disk
const serialized = tens.serialize();
fs.writeFileSync('context.tens', serialized);

// Load later
const loaded = Tens.deserialize(serialized);
```

---

## 💾 TokenMemory — Persistent Caching

Low-level API for manual token caching.

```typescript
import { TokenMemory } from '@contex-llm/core';

const memory = new TokenMemory('./.contex');

// Store data
const { hash, rowCount } = memory.store(myData);

// Materialize and cache
const tokens = memory.materializeAndCache(hash, 'gpt-4o');

// Check cache
const cachedModels = memory.getCachedModels(hash);
if (cachedModels.includes('gpt-4o')) {
  console.log('Using cached tokens!');
}
```

### Constructor Options

```typescript
const memory = new TokenMemory('./.contex');
```

---

## 🎨 Materializer — Fine-Grained Control

For advanced use cases requiring detailed control.

```typescript
import { createMaterializer, encodeIR } from '@contex-llm/core';

const materializer = createMaterializer();
const ir = encodeIR(data);
const result = materializer.materialize(ir, 'gpt-4o');
```

---

## 🔧 Utility Functions

### `compile(data, options?)`

Legacy one-shot compile to text.

```typescript
import { compile } from '@contex-llm/core';

const text = compile(myData, {
  model: 'gpt-4o'
});

console.log(text);
```

### `canonicalize(data)`

Convert data to canonical form.

```typescript
import { canonicalize } from '@contex-llm/core';

const canonical = canonicalize({
  b: { z: 1, a: 2 },
  a: { x: 3, y: 4 }
});
// Returns sorted, deterministic structure
```

### `formatOutput(data, format)`

Format tokens for output.

```typescript
import { formatOutput } from '@contex-llm/core';

const formatted = formatOutput(tens.fullIR.data, 'markdown');
// Returns beautifully formatted markdown table
```

---

## 📊 Output Formats

Contex supports multiple output formats optimized for different use cases:

### TOON (Token-Oriented Object Notation Object Notation)

```typescript
const toon = formatOutput(tens.fullIR.data, 'toon');
// id	name	priority	status
// 1	Fix bug	high	open
// 2	Add feature	medium	closed
```

**Best for:** Nested data, maximum token savings

### CSV

```typescript
const csv = formatOutput(tens.fullIR.data, 'csv');
// id,name,priority,status
// 1,Fix bug,high,open
```

**Best for:** Flat tabular data

### Markdown

```typescript
const md = formatOutput(tens.fullIR.data, 'markdown');
// | id | name    | priority | status |
// |----|---------|----------|--------|
// | 1  | Fix bug | high     | open   |
```

**Best for:** Human-readable reports

### JSON

```typescript
const json = formatOutput(tens.fullIR.data, 'json');
// [{"id":1,"name":"Fix bug","priority":"high","status":"open"}]
```

**Best for:** API compatibility

---

## ⚡ Performance Tips

### 1. Cache Early, Use Often

```typescript
// Build time: Encode and cache
const tens = Tens.encode(expensiveData);
tens.materialize('gpt-4o'); // Populates cache

// Request time: Instant retrieval
const tokens = tens.materialize('gpt-4o'); // Cache hit!
```

### 2. Choose the Right Format

```typescript
// For GPT models: TOON often wins
const tokens = tens.materialize('gpt-4o');

// For Claude: CSV for flat data, TOON for nested
const tokens = tens.materialize('claude-3-5-sonnet');
```

### 3. Use Field Compression

```typescript
const tens = Tens.encode(data);
```

---

## 🐛 Error Handling

```typescript
import { Tens, ContexValidationError, ContexModelNotFoundError } from '@contex-llm/core';

try {
  const tens = Tens.encode(data);
  const tokens = tens.materialize('gpt-4o');
} catch (e) {
  if (e instanceof ContexValidationError) {
    console.log(`Invalid field: ${e.field}`);
    console.log(`Reason: ${e.reason}`);
  } else if (e instanceof ContexModelNotFoundError) {
    console.log(`Model not found. Available: ${e.availableModels.join(', ')}`);
  }
}
```

---

## 📐 TypeScript Support

Full TypeScript support with comprehensive types:

```typescript
import { 
  Tens, 
  OutputFormat,
  MaterializedTokens
} from '@contex-llm/core';

const tens = Tens.encode(data);
```

---

## 🔗 Related

- [Middleware API](./middleware.md) — OpenAI/Anthropic/Gemini integration
- [CLI Reference](../reference/cli.md) — Command-line tools
- [Architecture](../architecture.md) — Deep dive into TENS
- [Benchmarks](../benchmarks.md) — Performance benchmarks

---

## ⚡ Resource Metrics & Pipeline Profiling

Track CPU time, memory usage, throughput, and resource efficiency during every stage of the Contex pipeline.

### Inline Profiling

```typescript
import { profileSync, profileAsync } from '@contex-llm/core';

// Profile any synchronous function
const { result, snapshot } = profileSync('encode', () => encoder.encode(data), {
  inputBytes: JSON.stringify(data).length,
  rowCount: data.length,
});

console.log(snapshot.durationMs);             // Wall-clock time (ms)
console.log(snapshot.cpuUserUs);              // CPU user time (µs)
console.log(snapshot.throughputBytesPerSec);  // Throughput (B/s)
console.log(snapshot.heapDelta);              // Memory allocated (bytes)
```

### Pipeline Profiler

Track multiple stages with aggregate reporting:

```typescript
import { PipelineProfiler, formatPipelineReport } from '@contex-llm/core';
import { canonicalize, encodeIR } from '@contex-llm/core';

const profiler = new PipelineProfiler();

const canonical = profiler.stage('canonicalize', () => canonicalize(data), {
  inputBytes: JSON.stringify(data).length,
  rowCount: data.length,
});

const ir = profiler.stage('encode', () => encodeIR(data));

const report = profiler.report();
console.log(report.efficiencyScore);   // 0–100
console.log(report.efficiencyGrade);   // 'excellent' | 'good' | 'fair' | 'poor'
console.log(report.totalDurationMs);   // Total wall-clock time
console.log(report.compressionRatio);  // Output/input ratio

// Beautiful ASCII table
console.log(formatPipelineReport(report));
```

### Efficiency Scoring

The efficiency score (0–100) is computed from four weighted components:

| Component | Weight | Max Score |
|-----------|--------|-----------|
| Throughput (MB/s) | 30% | 30 pts (≥ 10 MB/s) |
| Compression ratio | 30% | 30 pts (≤ 0.4 ratio) |
| CPU time | 20% | 20 pts (< 100ms total) |
| Memory efficiency | 20% | 20 pts (< 10MB heap delta) |

| Grade | Score Range |
|-------|-------------|
| **Excellent** | 85–100 |
| **Good** | 65–84 |
| **Fair** | 40–64 |
| **Poor** | 0–39 |

---

## 🔐 Structural Fingerprint & Encoding Protection

Multi-layer complexity analysis and pipeline fingerprinting that make it computationally infeasible to replicate Contex encoding behavior without the canonical library.

### Structural Complexity Analysis

```typescript
import { analyzeComplexity, formatComplexityReport } from '@contex-llm/core';

const complexity = analyzeComplexity(data);
console.log(complexity.score);              // 0–100
console.log(complexity.complexityClass);    // 'trivial' | 'simple' | 'moderate' | 'complex' | 'extreme'
console.log(complexity.fieldEntropy);       // Shannon entropy (bits)
console.log(complexity.maxDepth);           // Nesting depth
console.log(complexity.schemaPolymorphism); // Unique shapes / total rows
console.log(complexity.sparsityRatio);      // Null/missing cell ratio

console.log(formatComplexityReport(complexity));
```

### Pipeline Fingerprint & Watermark

```typescript
import { buildHashChain, generateWatermark, verifyWatermark } from '@contex-llm/core';

// Build salted hash chain across pipeline stages
const fingerprint = buildHashChain([
  { label: 'canonicalize', data: Buffer.from(JSON.stringify(canonical)) },
  { label: 'encode',       data: binary },
  { label: 'hash',         data: Buffer.from(hash) },
], complexity);

console.log(fingerprint.fingerprint);  // Composite SHA-256 hash
console.log(fingerprint.buildTag);     // Build-specific tag

// Generate watermark for verification
const watermark = generateWatermark(irBytes, fingerprint);

// Verify watermark
const isValid = verifyWatermark(irBytes, watermark, fingerprint);
```

### Entropy-Weighted Field Ordering

```typescript
import { entropyWeightedFieldOrder } from '@contex-llm/core';

// Fields ordered by value entropy (high-entropy first)
const order = entropyWeightedFieldOrder(data, ['id', 'status', 'name']);
// → ['id', 'name', 'status'] (id/name have more unique values)
```
