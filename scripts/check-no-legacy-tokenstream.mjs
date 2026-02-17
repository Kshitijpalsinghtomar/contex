import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const productionEntrypoints = [
  'packages/server/src/index.ts',
  'packages/middleware/src/core.ts',
  'packages/middleware/src/openai.ts',
  'packages/middleware/src/anthropic.ts',
  'packages/middleware/src/gemini.ts',
];

const tokenStreamPattern = /\bTokenStreamEncoder\b|\bTokenStreamDecoder\b/;
const violations = [];

for (const relativePath of productionEntrypoints) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    violations.push(`${relativePath}: missing production entrypoint`);
    continue;
  }

  const content = readFileSync(absolutePath, 'utf-8');
  if (tokenStreamPattern.test(content)) {
    violations.push(`${relativePath}: contains legacy TokenStream API usage`);
  }
}

if (violations.length > 0) {
  console.error('Legacy TokenStream guard failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Legacy TokenStream guard passed.');
