import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const docTargets = [
  'docs/guide/quickstart.md',
  'docs/guide/migration-from-json.md',
  'docs/guide/examples.md',
];

const cliHelpTarget = 'packages/cli/src/cli.ts';

const violations = [];

function checkDocFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const content = readFileSync(absolutePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!/\bdata\s*:/.test(line)) continue;

    const window = lines.slice(i, Math.min(i + 8, lines.length)).join('\n');

    if (/\bmaterialize\s*\(/.test(window)) {
      violations.push(`${relativePath}:${i + 1} -> middleware data uses materialize(...) token array; pass Tens object instead`);
    }

    if (/:\s*tokens\b/.test(window)) {
      violations.push(`${relativePath}:${i + 1} -> middleware data uses tokens variable; pass Tens object instead`);
    }
  }
}

function checkCliHelp(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const content = readFileSync(absolutePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const patterns = [
    { regex: /\bctx\s+(encode|decode|stats|formats|convert|validate|guard|savings|analyze|scorecard|bench|cache-|ir-|compose|inject|materialize)/, reason: 'CLI help must use contex command name' },
    { regex: /--ctx-only/, reason: 'CLI help must use --contex-only' },
    { regex: /--strategy\s+ctx,/, reason: 'CLI help strategy list must use contex label' },
    { regex: /Usage:\s*ctx\s+/, reason: 'Usage text must use contex command name' },
    { regex: /`ctx\s+materialize`/, reason: 'Inline recommendation must use contex command name' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        violations.push(`${relativePath}:${i + 1} -> ${pattern.reason}`);
      }
    }
  }
}

for (const target of docTargets) {
  checkDocFile(target);
}
checkCliHelp(cliHelpTarget);

if (violations.length > 0) {
  console.error('Docs snippet validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Docs snippet validation passed.');
