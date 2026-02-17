import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targets = [path.join(root, 'README.md'), path.join(root, 'docs')];

const allowedArtifactPatterns = [/artifacts\/scorecards\//i, /\.contex\//i, /scorecard_report\.json/i];
const claimPattern = /^\s*(?:[-*]\s*)?Claim:\s+/i;
const skipPattern = /claim-evidence:skip/i;

function listMarkdownFiles(startPath) {
  const files = [];
  if (!statSync(startPath).isDirectory()) {
    if (startPath.endsWith('.md')) files.push(startPath);
    return files;
  }

  const stack = [startPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        stack.push(fullPath);
      } else if (fullPath.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function hasArtifactReference(lines, startLine) {
  const windowEnd = Math.min(lines.length, startLine + 8);
  for (let i = startLine; i < windowEnd; i++) {
    const line = lines[i];
    if (!/Artifact:\s+/i.test(line)) continue;
    if (allowedArtifactPatterns.some((pattern) => pattern.test(line))) {
      return true;
    }
  }
  return false;
}

const markdownFiles = targets.flatMap((target) => listMarkdownFiles(target));
const violations = [];

for (const filePath of markdownFiles) {
  const content = readFileSync(filePath, 'utf-8');
  if (skipPattern.test(content)) continue;

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!claimPattern.test(line)) continue;

    if (!hasArtifactReference(lines, i + 1)) {
      const relativePath = path.relative(root, filePath).replaceAll('\\', '/');
      violations.push(`${relativePath}:${i + 1} -> Claim is missing nearby Artifact reference`);
    }
  }
}

if (violations.length > 0) {
  console.error('Claim evidence check failed. Add an Artifact reference near each Claim:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Claim evidence check passed.');
