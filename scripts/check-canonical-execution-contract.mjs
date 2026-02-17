import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const violations = [];

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!existsSync(absolute)) {
    violations.push(`${relativePath}: missing file`);
    return '';
  }
  return readFileSync(absolute, 'utf-8');
}

const serverIndex = read('packages/server/src/index.ts');
const middlewareCore = read('packages/middleware/src/core.ts');
const openaiWrapper = read('packages/middleware/src/openai.ts');
const anthropicWrapper = read('packages/middleware/src/anthropic.ts');
const geminiWrapper = read('packages/middleware/src/gemini.ts');

if (serverIndex) {
  if (!/\bencodeIR\b/.test(serverIndex)) {
    violations.push('packages/server/src/index.ts: must use encodeIR for canonical encode path');
  }
  if (!/\bTokenMemory\b/.test(serverIndex)) {
    violations.push('packages/server/src/index.ts: must use TokenMemory for canonical storage/materialization path');
  }
  if (/\bTokenStreamEncoder\b|\bTokenStreamDecoder\b/.test(serverIndex)) {
    violations.push('packages/server/src/index.ts: legacy TokenStream APIs are not allowed in canonical contract');
  }
}

if (middlewareCore) {
  if (!/JSON\.stringify\(ir\.data\)|\.toString\(\)/.test(middlewareCore)) {
    violations.push('packages/middleware/src/core.ts: must inject deterministic canonical text (JSON.stringify(ir.data) or Tens.toString())');
  }
  if (!/\bmaterializeAndCache\b/.test(middlewareCore)) {
    violations.push('packages/middleware/src/core.ts: must use TokenMemory.materializeAndCache in middleware path');
  }
}

if (openaiWrapper && !/createContexOpenAI/.test(openaiWrapper)) {
  violations.push('packages/middleware/src/openai.ts: createContexOpenAI entrypoint missing');
}
if (anthropicWrapper && !/createContexAnthropic/.test(anthropicWrapper)) {
  violations.push('packages/middleware/src/anthropic.ts: createContexAnthropic entrypoint missing');
}
if (geminiWrapper && !/createContexGemini/.test(geminiWrapper)) {
  violations.push('packages/middleware/src/gemini.ts: createContexGemini entrypoint missing');
}

if (violations.length > 0) {
  console.error('Canonical execution contract check failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Canonical execution contract check passed.');
