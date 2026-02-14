# Contex Examples

## Anthropic Cache Demo

This demo demonstrates how **Contex TENS** protocol accelerates LLM interactions by enabling deterministic Prompt Caching with Anthropic.

### Prerequisites

1.  **Anthropic API Key**: You must have `ANTHROPIC_API_KEY` set in your environment.
2.  **Dependencies**: Run inside the `packages/cli` directory where dependencies are installed.

### Running the Demo

```bash
# From packages/cli directory
npx tsx src/examples/anthropic_cache_demo.ts
```

### What to Expect

1.  **Generation**: A heavy dataset (~500 tickets) is generated.
2.  **Encoding**: Data is encoded into Canonical IR (Template Encoded Structured Data).
3.  **Run 1 (Cold)**:
    - The IR is materialized to canonical text.
    - Sent to Anthropic with `cache_control` enabled.
    - **Result**: Higher latency, `cache_creation_input_tokens` > 0.
4.  **Run 2 (Warm)**:
    - The same IR is used (deterministic hash -> same text).
    - Sent to Anthropic.
    - **Result**: Lower latency (~50% faster), `cache_read_input_tokens` > 0.

### Why Contex?

By using `Tens.encode(data)`, Contex guarantees that the output text is **bit-for-bit identical** for the same data, regardless of key order or formatting quirks. This strictly guarantees a cache hit, maximizing your savings.
