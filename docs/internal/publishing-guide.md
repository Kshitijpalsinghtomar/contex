# Publishing Guide — Contex Packages

**Author:** Kshitij Pal Singh Tomar (@kshitijpalsinghtomar)  
**Last Updated:** 2026-02-18

---

## Package Overview

| Package | npm Name | Status | Public |
|---------|----------|--------|--------|
| Core | `@contex-llm/core` | Ready to publish | Yes |
| Engine | `@contex-llm/engine` | Ready to publish | Yes |
| CLI | `@contex-llm/cli` | Ready to publish | Yes |
| Middleware | `@contex-llm/middleware` | Ready to publish | Yes |
| Adapters | `@contex-llm/adapters` | Ready to publish | Yes |
| TENS WASM | `@contex-llm/tens-wasm` | Needs wasm-pack build | Yes |
| Server | `@contex-llm/server` | Private (not published) | No |

---

## Prerequisites

### 1. Create npm Account
```bash
npm adduser
# Follow prompts to create account at https://www.npmjs.com/signup
```

### 2. Create npm Organization
You need the `@contex` org scope on npm.
1. Go to https://www.npmjs.com/org/create
2. Create org named `contex`
3. If `@contex` is taken, use `@contex-ai` or `@contex-llm` — then update all package names

### 3. Enable 2FA
npm requires 2FA for publishing. Enable it at https://www.npmjs.com/settings/~/tfa

### 4. Login from CLI
```bash
npm login --scope=@contex
```

---

## Publishing Steps

### First-time publish (all packages)

```bash
# 1. Build everything
pnpm build

# 2. Run all tests
pnpm test

# 3. Publish in dependency order
cd packages/core    && npm publish --access public && cd ../..
cd packages/engine  && npm publish --access public && cd ../..
cd packages/middleware && npm publish --access public && cd ../..
cd packages/cli     && npm publish --access public && cd ../..
cd packages/adapters && npm publish --access public && cd ../..
```

Or use pnpm's built-in publish:
```bash
pnpm -r publish --access public --no-git-checks
```

### Version bumping

```bash
# Bump all packages to same version
pnpm -r exec -- npm version patch  # or minor/major

# Or manually edit each package.json version field
```

### Verify publication

```bash
npm info @contex-llm/core
npm info @contex-llm/engine
npm info @contex-llm/middleware
npm info @contex-llm/cli
npm info @contex-llm/adapters
```

---

## How Users Install After Publishing

### npm / pnpm / yarn

```bash
# Core only
npm install @contex-llm/core

# With middleware (OpenAI/Anthropic)
npm install @contex-llm/core @contex-llm/middleware

# Full stack
npm install @contex-llm/core @contex-llm/engine @contex-llm/middleware

# CLI tool
npm install -g @contex-llm/cli
contex --help

# With LangChain adapter
npm install @contex-llm/adapters langchain
```

### In code

```typescript
import { encode, decode, canonicalize } from '@contex-llm/core';
import { withContex } from '@contex-llm/middleware';
import { ContexLangChainTransformer } from '@contex-llm/adapters/langchain';
```

---

## LangChain Integration (via @contex-llm/adapters)

After publishing `@contex-llm/adapters`, users can:

```typescript
import { ContexLangChainTransformer } from '@contex-llm/adapters/langchain';
import { ChatOpenAI } from 'langchain/chat_models/openai';

const model = new ChatOpenAI({ modelName: 'gpt-4o' });
const transformer = new ContexLangChainTransformer();

// Use in LangChain pipeline
const chain = transformer.pipe(model);
```

---

## VS Code Extension Publishing

See `extensions/vscode-tens/README.md` for VS Code Marketplace publishing steps.

---

## Important Notes

1. **Workspace protocol**: Before publishing, `workspace:*` dependencies are automatically resolved by pnpm to actual versions. If you use `npm publish` directly, manually replace `workspace:*` with the actual version first.

2. **prepublishOnly**: Each package has a `prepublishOnly` script that runs `pnpm build` automatically before publish.

3. **Scoped packages**: All packages use `@contex-llm/` scope with `"publishConfig": { "access": "public" }` — this ensures they're published as public packages (scoped packages are private by default on npm).

4. **CI publishing**: For automated releases, set `NPM_TOKEN` as a GitHub secret and use GitHub Actions:
   ```yaml
   - run: echo "//registry.npmjs.org/:_authToken=${{ secrets.NPM_TOKEN }}" > .npmrc
   - run: pnpm -r publish --access public --no-git-checks
   ```

---

## Checklist Before First Publish

- [ ] npm account created
- [ ] `@contex` org claimed (or alternative scope chosen)
- [ ] 2FA enabled
- [ ] All tests pass (`pnpm test`)
- [ ] All builds succeed (`pnpm build`)
- [ ] README.md in each package is accurate
- [ ] Version numbers are correct (0.1.0 for initial release)
- [ ] Author field shows your name (not "Contex Team") ✅ Done
- [ ] License file has your name ✅ Done
- [ ] Repository URL points to your GitHub ✅ Already correct
