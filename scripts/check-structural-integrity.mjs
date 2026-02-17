import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const violations = [];

const removedPaths = [
  'packages/engine/src/index/btree.ts',
  'packages/engine/src/schema/registry.ts',
  'packages/engine/src/test_persistence.ts',
  'packages/engine/src/test_rag.ts',
];

for (const removedPath of removedPaths) {
  if (existsSync(path.join(root, removedPath))) {
    violations.push(`${removedPath}: expected to be removed from src`);
  }
}

const indexFiles = [
  'packages/core/src/index.ts',
  'packages/engine/src/index.ts',
  'packages/middleware/src/index.ts',
  'packages/adapters/src/index.ts',
];

function exportTargets(content) {
  const targets = [];
  const regex = /from\s+['\"](.+?)['\"]/g;
  let match = regex.exec(content);
  while (match) {
    targets.push(match[1]);
    match = regex.exec(content);
  }
  return targets;
}

function hasResolvableModule(baseDir, specifier) {
  const normalized = specifier.replace(/\.js$/, '');
  const direct = path.resolve(baseDir, `${normalized}.ts`);
  const nested = path.resolve(baseDir, normalized, 'index.ts');
  return existsSync(direct) || existsSync(nested);
}

for (const indexFile of indexFiles) {
  const absolutePath = path.join(root, indexFile);
  if (!existsSync(absolutePath)) {
    violations.push(`${indexFile}: missing index file`);
    continue;
  }

  const content = readFileSync(absolutePath, 'utf-8');
  const dir = path.dirname(absolutePath);
  for (const target of exportTargets(content)) {
    if (!target.startsWith('.')) continue;
    if (!hasResolvableModule(dir, target)) {
      violations.push(`${indexFile}: unresolved export target ${target}`);
    }
  }
}

function collectTsFiles(dir, output = []) {
  if (!existsSync(dir)) return output;

  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    const stats = statSync(absolute);

    if (stats.isDirectory()) {
      collectTsFiles(absolute, output);
      continue;
    }

    if (absolute.endsWith('.ts')) {
      output.push(absolute);
    }
  }

  return output;
}

const sourceFiles = collectTsFiles(path.join(root, 'packages'))
  .filter((file) => file.includes(`${path.sep}src${path.sep}`));

for (const absolutePath of sourceFiles) {
  const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
  const content = readFileSync(absolutePath, 'utf-8');

  if (/index\/btree|schema\/registry/.test(content)) {
    violations.push(`${relativePath}: references archived/disconnected engine internals`);
  }

  if (/from\s+['\"][^'\"]*\/archive\//.test(content)) {
    violations.push(`${relativePath}: imports from archive path`);
  }
}

if (violations.length > 0) {
  console.error('Structural integrity check failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Structural integrity check passed.');
