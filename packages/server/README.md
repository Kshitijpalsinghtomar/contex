# @contex/server

**High-performance REST API for contex.**

Powered by [Hono](https://hono.dev), designed for Docker and Node.js environments.

## Endpoints

### `POST /v1/encode`
Encodes JSON data into TENS binary format.

**Request:**
```json
{
  "data": [...],
  "encoding": "cl100k_base"
}
```

**Response:**
```json
{
  "tens": "base64_encoded_string",
  "stats": { ... }
}
```

### `POST /v1/decode`
Decodes TENS binary data back to JSON.

**Request:**
```json
{
  "tens": "base64_encoded_string"
}
```

**Response:**
```json
{
  "data": [...]
}
```

### `POST /v1/optimize`
RAG-optimized context packing. Filters data, fits it into a specific model's context window, and formats it optimally.

**Request:**
```json
{
  "data": [...],
  "model": "gpt-4o",
  "systemPromptTokens": 500,
  "userPromptTokens": 200,
  "responseReserve": 1000
}
```

**Response:**
```json
{
  "budget": { ... },
  "context": "Formatted string or token stream",
  "usedRows": 50
}
```

### `GET /health`
Returns service status.

## Development

```bash
pnpm dev
# Runs on port 3000
```

## Docker

```bash
docker build -t contex .
docker run -p 3000:3000 contex
```
