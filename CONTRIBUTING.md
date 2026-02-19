<div align="center">

# Contributing to Contex

> **Welcome to the Contex contributor guide!** We're thrilled you're interested in helping build the future of token-native data infrastructure.

</div>

---

## 🎯 Quick Links

| Resource | Link |
|----------|------|
| 📐– **Documentation** | [docs/](docs/) |
| 💬 **Discussions** | [GitHub Discussions](https://github.com/kshitijpalsinghtomar/contex-llm/discussions) |
| 🐛 **Issue Tracker** | [GitHub Issues](https://github.com/kshitijpalsinghtomar/contex-llm/issues) |
| 📐¦ **NPM Packages** | [@contex-llm/core](https://www.npmjs.com/package/@contex-llm/core) |


---

## Table of Contents

1. [Development Setup](#development-setup)
2. [Project Structure](#project-structure)
3. [Package Development](#package-development)
4. [Terminology](#terminology)
5. [Coding Standards](#coding-standards)
6. [Pull Request Process](#pull-request-process)
7. [Architecture Decisions](#architecture-decisions)

---

## 🚀 Development Setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | ≥ 18.0 | LTS recommended |
| **pnpm** | ≥ 9.0 | Package manager |

### Getting Started

```bash
# Clone the repository
git clone https://github.com/kshitijpalsinghtomar/contex-llm.git
cd contex

# Install dependencies
pnpm install

# Run all tests
pnpm test

# Run the benchmark suite
pnpm benchmark

# Run the linter
pnpm lint

# Auto-fix lint issues
pnpm lint:fix
```

---

## 📐 Project Structure

```
contex-llm/
├── CONTEX_V3_MASTER.md    # ⚠️ READ THIS FIRST — The Single Source of Truth
├── docs/
│   ├── architecture.md     # System architecture
│   ├── guide/              # User guides
│   └── reference/          # API reference
├── packages/
│   ├── core/               # @contex-llm/core — Canonical IR, materializer, TokenMemory
│   ├── engine/             # @contex-llm/engine — Budget, quick() API
│   ├── middleware/         # @contex-llm/middleware — SDK wrappers (OpenAI, Anthropic)
│   ├── cli/                # @contex-llm/cli — Tools & benchmarks
│   ├── adapters/           # @contex-llm/adapters — LangChain & LlamaIndex integrations
│   ├── server/             # @contex-llm/server — [PAUSED]
│   └── tens-wasm/          # @contex-llm/tens-wasm — [PAUSED]
├── website/                # Marketing website
└── README.md
```

---

## 📐¦ Package Development

Each package can be developed independently:

```bash
# Run tests for a specific package
cd packages/core && pnpm test

# Build a specific package
cd packages/engine && pnpm build
```

### Key Packages

| Package | Purpose | NPM |
|---|---|---|
| `@contex-llm/core` | Canonical IR encoder, materializer, TokenMemory, token composition, tokenizer manager | ✅ |
| `@contex-llm/engine` | Budget engine, `quick()` API, model registry, predictive packer | ✅ |
| `@contex-llm/middleware` | Drop-in SDK wrappers (OpenAI, Anthropic, Gemini) with IR-backed injection | ✅ |
| `@contex-llm/cli` | CLI tools, benchmarks, cost analysis | ✅ |
| `@contex-llm/adapters` | LangChain & LlamaIndex integrations | ✅ |

---

## 📐 Terminology

Use these terms consistently across code, docs, and comments:

| Use This | Not This | Description |
|---|---|---|
| **Canonical IR** | "intermediate representation", "data blob", "serialized data" | The deterministic binary format |
| **Materialize** | "tokenize", "convert", "generate tokens" | Convert IR to model-specific tokens |
| **Compose** | "assemble", "build", "concatenate" | Assemble prompts from token blocks |
| **Inject** | "send", "pass", "transmit" | Send data to LLM |
| **TENS** | "token format", "binary format" | Token Encoded Native Structure |
| **TokenMemory** | "storage", "database", "cache" | Content-addressed token storage |

---

## 🔧 Coding Standards

### Linting & Formatting

We use [Biome](https://biomejs.dev/) for linting and formatting:

```bash
# Run linter
pnpm lint

# Auto-fix issues
pnpm lint:fix
```

### TypeScript

- **Strict mode** is enabled in `tsconfig.base.json`
- No `any` types — use proper typing
- Prefer `const` over `let`
- Explicit return types on public APIs

### Testing

We use [Vitest](https://vitest.dev/) for testing:

```bash
# Tests go in: src/__tests__/
# Run tests: pnpm test
```

### JSDoc

All public APIs must have JSDoc with:
- `@param` — parameter descriptions
- `@returns` — return value description
- `@example` — usage examples

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Variables/Functions | `camelCase` | `encodeIR()`, `tokenCount` |
| Classes/Types | `PascalCase` | `Tens`, `MaterializedTokens` |
| Constants | `SCREAMING_SNAKE` | `MAX_TOKEN_COUNT` |

---

## 🔄 Pull Request Process

### Before You Start

1. **Read `CONTEX_V3_MASTER.md` first** — every PR must align with the master architecture
2. Check for existing issues or PRs that might overlap

### Making Changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes with tests
4. Run `pnpm lint` and `pnpm test`

### Submitting

When submitting a PR, answer this question:

> **"Does this help encode, store, compose, materialize, or inject tokens?"**

If yes, it's likely in scope. If no, please explain why it's needed.

### Requirements

- [ ] All tests pass (`pnpm test`)
- [ ] Linting passes (`pnpm lint`)
- [ ] New features include tests
- [ ] Documentation updated if needed

### DX Regression Checklist (PR Review)

Use this checklist for CLI/docs UX consistency before merge:

- [ ] Command naming is consistent: use `contex` (not `ctx`) in user-facing docs/help
- [ ] Flag naming is consistent: use `--contex-only` (not `--ctx-only`)
- [ ] Middleware snippets pass raw arrays or `Tens` objects in `data` (not `materialize(...)` token arrays)
- [ ] Canonical newcomer flow is preserved in docs: `analyze -> materialize -> inject`
- [ ] Docs guards pass: `pnpm check:claim-evidence` and `pnpm check:docs-snippets`

---

## 🏗️ Architecture Decisions

If you're making significant architectural changes:

1. **Open an issue first** to discuss the approach
2. Reference `CONTEX_V3_MASTER.md` for authoritative design
3. See `docs/architecture.md` for current implementation details

---

## 📐œ License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

<div align="center">

## 💖 Thank You!

**Your contributions make Contex better for everyone.**

[![GitHub Stars](https://img.shields.io/github/stars/kshitijpalsinghtomar/contex-llm?style=social)](https://github.com/kshitijpalsinghtomar/contex-llm)

</div>
