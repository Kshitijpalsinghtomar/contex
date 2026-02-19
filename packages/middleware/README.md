# @contex-llm/middleware

**Seamless LLM Integration for contex.**

This package provides middleware interceptors for popular AI SDKs, allowing you to inject optimized contex data directly into your prompts using `{{CONTEX:collection}}` markers.

## Installation

```bash
pnpm add @contex-llm/middleware @contex-llm/engine
```

## Supported SDKs

- **OpenAI** (`openai`)
- **Anthropic** (`@anthropic-ai/sdk`)
- **Google Generative AI** (`@google/generative-ai`)

## Usage

### OpenAI

Wraps the standard OpenAI client.

```typescript
import { OpenAI } from 'openai';
import { createContexOpenAI } from '@contex-llm/middleware';

const client = createContexOpenAI(new OpenAI(), {
  data: { 
    my_collection: [{ id: 1, text: 'Hello' }] 
  }
});

await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Analyze this data: {{CONTEX:my_collection}}' }
  ]
});
```

### Anthropic

Wraps the Anthropic client.

```typescript
import { Anthropic } from '@anthropic-ai/sdk';
import { createContexAnthropic } from '@contex-llm/middleware';

const client = createContexAnthropic(new Anthropic(), {
  data: {
    my_collection: myLargeDataset
  }
});

await client.messages.create({
  model: 'claude-3-5-sonnet-20240620',
  messages: [
    { role: 'user', content: 'Analyze this data: {{CONTEX:my_collection}}' }
  ],
  max_tokens: 1024
});

// Automatic Cache Control:
// For payloads > 3.5k chars, the middleware automatically injects
// `cache_control: { type: 'ephemeral' }` into the content block.
```

### Google Gemini

Wraps the Google Generative AI client.

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createContexGemini } from '@contex-llm/middleware';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

const model = createContexGemini(
  genAI.getGenerativeModel({ model: 'gemini-1.5-pro' }),
  {
    data: { my_collection: myData }
  },
  'gemini-1.5-pro'
);

const result = await model.generateContent(
  'Analyze this data: {{CONTEX:my_collection}}'
);
```

## How It Works

1.  ** interception:** The middleware intercepts the API call before it runs.
2.  **Detection:** It scans message content for `{{CONTEX:collection_name}}`.
3.  **Optimization:** It calls `contex.getOptimizedContext()` to:
    *   Filter data (if PQL is used in the marker, e.g. `{{CONTEX:users WHERE role='admin'}}` - *Coming Soon*)
    *   Calculate the token budget based on the model and remaining context.
    *   Format the data (JSON, TOON, CSV, etc.) to fit perfectly.
4.  **Injection:** Replaces the marker with the optimized string.
5.  **Execution:** Sends the actual request to the AI provider.
