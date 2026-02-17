import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const violations = [];

const targets = [
  'README.md',
  'docs',
];

const blockedPatterns = [
  { regex: /\bTens\.wrap(OpenAI|Anthropic|Gemini)\b/g, reason: 'Use middleware wrappers (createContex*) instead of Tens.wrap*' },
  { regex: /\bTens\.store\b/g, reason: 'Use TokenMemory.store or Tens.encode + memory flow' },
  { regex: /\bTens\.encodeIR\b/g, reason: 'Use encodeIR(...) function directly (not Tens.encodeIR)' },
  { regex: /\bTens\.materialize\s*\(\s*hash\s*,/g, reason: 'Use TokenMemory.materializeAndCache(hash, model)' },
  { regex: /\btoString\(\s*['"]toon['"]\s*\)/g, reason: 'Use formatOutput(data, "toon") instead of toString("toon")' },
];

const ignoredFilePatterns = [
  /^docs\/release-readiness-.*\.md$/,
];

const allowedContextPatterns = [
  /\bavoid\b/i,
  /\binvalid\b/i,
  /\bdeprecated\b/i,
  /\bdo\s+not\b/i,
  /\bmethod\s+does\s+not\s+exist\b/i,
  /\buse\b.*\binstead\b/i,
];

function listMarkdownFiles(startPath) {
  const absolute = path.join(root, startPath);
  if (!existsSync(absolute)) return [];

  const stats = statSync(absolute);
  if (!stats.isDirectory()) {
    return absolute.endsWith('.md') ? [absolute] : [];
  }

  const files = [];
  const stack = [absolute];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const s = statSync(fullPath);
      if (s.isDirectory()) {
        stack.push(fullPath);
      } else if (fullPath.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

const files = targets.flatMap(listMarkdownFiles);

for (const file of files) {
  const relativePath = path.relative(root, file).replace(/\\/g, '/');
  if (ignoredFilePatterns.some((pattern) => pattern.test(relativePath))) {
    continue;
  }

  const content = readFileSync(file, 'utf-8');
  const lines = content.split(/\r?\n/);

  for (const { regex, reason } of blockedPatterns) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hasAllowedContext = allowedContextPatterns.some((pattern) => pattern.test(line));

      if (regex.test(line) && !hasAllowedContext) {
        violations.push(`${relativePath}:${i + 1} -> ${reason}`);
      }
      regex.lastIndex = 0;
    }
  }
}

if (violations.length > 0) {
  console.error('Legacy public API surface claim check failed:');
  for (const v of violations) {
    console.error(`- ${v}`);
  }
  process.exit(1);
}

console.log('Legacy public API surface claim check passed.');
