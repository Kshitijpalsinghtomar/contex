<div align="center">

# @contex-llm/middleware API Reference

> Drop-in wrappers for OpenAI, Anthropic, and Gemini with `{{CONTEX:name}}` injection.

</div>

---

## Installation

```bash
pnpm add @contex-llm/middleware
```

---

## Exports

- `createContexOpenAI(client, options?)`
- `createContexAnthropic(client, options?)`
- `createContexGemini(model, modelId, options?)`
- `ContexContext`
- `injectContexContent`
- `providerSupportsTokens`

---

## Shared Types

```ts
import type { Tens } from '@contex-llm/core';

interface ContexMiddlewareOptions {
  data?: Record<string, Record<string, unknown>[] | Tens>;
  hashes?: Record<string, string>;
  storeDir?: string;        // default: '.contex'
  defaultReserve?: number;  // default: 1000
  onInject?: (info: InjectionInfo) => void;
  onError?: (error: Error, collection: string) => void;
}

interface InjectionInfo {
  collection: string;
  model: string;
  encoding: string;
  irHash: string;
  tokenCount: number;
  cacheHit: boolean;
}
```

---

## OpenAI

```ts
import OpenAI from 'openai';
import { createContexOpenAI } from '@contex-llm/middleware';

const client = createContexOpenAI(new OpenAI(), {
  data: {
    tickets: [
      { id: 1, title: 'Login issue', priority: 'high' },
      { id: 2, title: 'Signup issue', priority: 'medium' }
    ]
  }
});

const res = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Analyze {{CONTEX:tickets}}' }
  ]
});
```

---

## Anthropic

```ts
import Anthropic from '@anthropic-ai/sdk';
import { createContexAnthropic } from '@contex-llm/middleware';

const client = createContexAnthropic(new Anthropic(), {
  data: { tickets }
});

const res = await client.messages.create({
  model: 'claude-3-5-sonnet',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'Analyze {{CONTEX:tickets}}' }
  ]
});
```

Notes:
- System prompts are also placeholder-aware.
- For larger injected payloads, middleware may attach Anthropic cache-control blocks.

---

## Gemini

```ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createContexGemini } from '@contex-llm/middleware';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
const baseModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

const model = createContexGemini(
  baseModel,
  'gemini-2-5-pro',
  {
    data: { tickets }
  }
);

const result = await model.generateContent('Analyze {{CONTEX:tickets}}');
```

Important:
- Signature order is `(model, modelId, options?)`.

---

## Runtime Behavior

1. Detect placeholders like `{{CONTEX:collection}}`.
2. Resolve collection via registered data/hash.
3. Use canonical path: `encodeIR -> TokenMemory -> materializeAndCache`.
4. Inject deterministic text content into the provider request.

Current default behavior is deterministic text injection; token-path helpers exist but are not the active default route.

---

## Related

- [Core API](./core.md)
- [Architecture](../architecture.md)
- [CLI Reference](./cli.md)
