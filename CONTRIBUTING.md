# Contributing to Contex

Thank you for your interest in contributing to Contex! This guide will help you get started.

## Development Setup

### Prerequisites

- **Node.js** ≥ 18.0
- **pnpm** ≥ 9.0 (`npm install -g pnpm`)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/contex/contex.git
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

## Project Structure

```
contex/
├── CONTEX_V3_MASTER.md    # ⚠️ READ THIS FIRST — The Single Source of Truth
├── docs/
│   ├── architecture.md     # (Deprecated) See Master Doc
│   └── guide/              # User guides
├── packages/
│   ├── core/               # @contex/core — Canonical IR, materializer, TokenMemory
│   ├── engine/             # @contex/engine — Budget, quick() API
│   ├── middleware/         # @contex/middleware — SDK wrappers (OpenAI, Anthropic)
│   ├── cli/                # @contex/cli — Tools & benchmarks
│   ├── server/             # @contex/server — [PAUSED]
│   └── tens-wasm/          # @contex/tens-wasm — [PAUSED]
├── website/                # Marketing website
└── README.md
```

## Package Development

Each package can be developed independently:

```bash
# Run tests for a specific package
cd packages/core && pnpm test

# Build a specific package
cd packages/engine && pnpm build
```

### Key packages:

| Package | Purpose |
|---|---|
| `@contex/core` | Canonical IR encoder, materializer, TokenMemory, token composition, tokenizer manager |
| `@contex/engine` | Budget engine, `quick()` API, model registry, predictive packer |
| `@contex/middleware` | Drop-in SDK wrappers (OpenAI, Anthropic, Gemini) with IR-backed injection |
| `@contex/cli` | CLI tools, benchmarks, cost analysis |

## Terminology

Use these terms consistently across code, docs, and comments:

| Use This | Not This |
|---|---|
| **Canonical IR** | "intermediate representation", "data blob", "serialized data" |
| **Materialize** | "tokenize", "convert", "generate tokens" |
| **Compose** | "assemble", "build", "concatenate" |
| **Inject** | "send", "pass", "transmit" |
| **TENS** | "token format", "binary format" |
| **TokenMemory** | "storage", "database", "cache" |

## Coding Standards

- **Linting & Formatting**: We use [Biome](https://biomejs.dev/). Run `pnpm lint` before committing.
- **TypeScript**: Strict mode enabled. No `any`, prefer `const`, explicit return types on public APIs.
- **Testing**: Use [Vitest](https://vitest.dev/). Tests go in `src/__tests__/` within each package.
- **JSDoc**: All public APIs must have JSDoc with `@param`, `@returns`, and `@example`. Use the terminology above.
- **Naming**: `camelCase` for variables/functions, `PascalCase` for classes/types, `SCREAMING_SNAKE` for constants.

## Pull Request Process

1. **Read `CONTEX_V3_MASTER.md` first** — every PR must align with the master architecture
2. Fork and create a feature branch from `main`
3. Write your changes with tests
4. Run `pnpm lint` and `pnpm test`
5. Submit a PR — answer: "Does this help encode, store, compose, materialize, or inject tokens?"
6. Ensure CI passes

## Architecture Decisions

If you're making significant architectural changes, please open an issue first. See `CONTEX_V3_MASTER.md` for the authoritative design and `docs/architecture.md` for the current implementation.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
