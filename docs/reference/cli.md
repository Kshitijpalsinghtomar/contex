# CLI Reference

The Contex CLI provides commands for compiling, injecting, and analyzing structured data for LLMs.

## Installation

```bash
pnpm add -g @contex/cli
```

---

## Commands

### `contex materialize <file>`

Compiles a JSON file into model-specific tokens and caches them.

```bash
contex materialize data.json --model gpt-4o
```

**Options:**
- `--model <id>`: Target model ID (e.g., `gpt-4o`, `claude-3-5-sonnet`). Required.

---

### `contex inject <file>`

Injects cached tokens (or raw data) into a prompt template and sends it to a provider.

```bash
contex inject data.json --provider anthropic
```

**Options:**
- `--provider <name>`: LLM provider (`anthropic`, `openai`). Required.

---

### `contex compose <config>`

Composes multiple data blocks into a single context window, validating against the token budget.

```bash
contex compose contex.json
```

**Config File (`contex.json`):**
```json
{
  "model": "gpt-4o",
  "context_window": 128000,
  "reserve": 4096,
  "blocks": [
    { "file": "users.json", "priority": 1 },
    { "file": "logs.json", "priority": 2 }
  ]
}
```

---

### `contex savings <file>`

Analyzes a file and reports potential token and cost savings vs JSON.

```bash
contex savings data.json
```

**Output:**
- Savings percentage (e.g., "59% fewer tokens")
- Annual cost projection

---

### `contex encode <file>`

Encodes JSON to TENS binary (Canonical IR).

```bash
contex encode data.json
```

---

### `contex decode <file>`

Decodes TENS binary to JSON.

```bash
contex decode data.tens
```

---

### `contex bench`

Runs the full research benchmark suite.

```bash
contex bench
```