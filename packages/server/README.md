# @contex-llm/server

REST API for Contex canonical IR and engine operations.

---

## Endpoints

### `POST /v1/encode`

Encodes data through the canonical IR path and stores it in `TokenMemory`.

Request:

```json
{
  "data": [{ "id": 1, "name": "Alice" }]
}
```

Response:

```json
{
  "hash": "...",
  "ir": "base64_ir_bytes",
  "rowCount": 1,
  "irByteSize": 123,
  "isNew": true,
  "irVersion": "1.0",
  "canonicalizationVersion": "1.0"
}
```

### `POST /v1/decode`

Loads canonicalized data by IR hash.

Request:

```json
{
  "hash": "..."
}
```

Response:

```json
{
  "hash": "...",
  "data": [{ "id": 1, "name": "Alice" }],
  "rowCount": 1,
  "irVersion": "1.0",
  "canonicalizationVersion": "1.0"
}
```

### `POST /v1/optimize`

Engine context optimization endpoint.

### `GET /v1/collections`

Lists in-memory engine collections.

### `POST /v1/collections/:name`

Inserts rows into a named collection.

### `POST /v1/query`

Runs PQL query through the engine.

### `GET /v1/formats/:collection`

Returns format analyses for a collection.

### `POST /v1/providers/openai/chat`

Calls OpenAI Chat Completions through `@contex-llm/middleware` injection.

### `POST /v1/providers/anthropic/messages`

Calls Anthropic Messages API through `@contex-llm/middleware` injection.

### `POST /v1/providers/gemini/generate`

Calls Gemini `generateContent` through `@contex-llm/middleware` injection.

### `GET /health`

Health and basic runtime metadata.

---

## Development

```bash
pnpm dev
```

## Provider Gateway Setup

Set provider keys before using provider routes:

```bash
OPENAI_API_KEY=... \
ANTHROPIC_API_KEY=... \
GOOGLE_API_KEY=... \
pnpm dev
```

## Provider Gateway Examples

### OpenAI

Request:

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "user", "content": "Summarize {{CONTEX:tickets}}" }
  ],
  "data": {
    "tickets": [
      { "id": 1, "status": "open", "priority": "high" },
      { "id": 2, "status": "closed", "priority": "low" }
    ]
  }
}
```

Success response shape:

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "response": { "id": "...", "choices": [] }
}
```

### Anthropic

Request:

```json
{
  "model": "claude-3-5-sonnet",
  "max_tokens": 256,
  "messages": [
    { "role": "user", "content": "Summarize {{CONTEX:tickets}}" }
  ],
  "data": {
    "tickets": [
      { "id": 1, "status": "open" }
    ]
  }
}
```

Success response shape:

```json
{
  "provider": "anthropic",
  "model": "claude-3-5-sonnet",
  "response": { "id": "...", "content": [] }
}
```

### Gemini

Request:

```json
{
  "model": "gemini-2.5-pro",
  "prompt": "Summarize {{CONTEX:tickets}}",
  "data": {
    "tickets": [
      { "id": 1, "status": "open" }
    ]
  }
}
```

Success response shape:

```json
{
  "provider": "gemini",
  "model": "gemini-2.5-pro",
  "text": "..."
}
```

If a key is missing, provider routes return:

```json
{
  "error": {
    "code": "PROVIDER_CONFIG_ERROR",
    "message": "<PROVIDER>_API_KEY is not configured"
  }
}
```
