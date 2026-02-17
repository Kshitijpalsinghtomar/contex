import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const packageJsonPath = path.join(root, 'package.json');
const workflowPath = path.join(root, '.github/workflows/cli-reality-gate.yml');

const requiredScriptNames = [
  'check:canonical-contract',
  'check:docs-snippets',
  'check:no-legacy-tokenstream',
  'check:no-legacy-surface-claims',
  'check:structural-integrity',
  'check:claim-evidence',
  'check:config-parity',
];

const requiredWorkflowSteps = [
  'pnpm check:canonical-contract',
  'pnpm check:docs-snippets',
  'pnpm check:no-legacy-tokenstream',
  'pnpm check:no-legacy-surface-claims',
  'pnpm check:structural-integrity',
  'pnpm check:claim-evidence',
  'pnpm check:config-parity',
];

const violations = [];

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const scripts = packageJson.scripts || {};
for (const scriptName of requiredScriptNames) {
  if (!scripts[scriptName]) {
    violations.push(`package.json: missing script ${scriptName}`);
  }
}

const workflow = readFileSync(workflowPath, 'utf-8');
for (const step of requiredWorkflowSteps) {
  if (!workflow.includes(step)) {
    violations.push(`${path.relative(root, workflowPath)}: missing step \`${step}\``);
  }
}

if (violations.length > 0) {
  console.error('Stabilization freeze check failed: required gates are not fully codified.');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Stabilization freeze check passed (release gates codified in scripts + CI).');
