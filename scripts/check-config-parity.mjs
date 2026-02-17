import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const parityGroups = [
  {
    name: 'tsconfig parity',
    files: ['packages/core/tsconfig.json', 'packages/engine/tsconfig.json'],
  },
  {
    name: 'vitest config parity',
    files: [
      'packages/core/vitest.config.ts',
      'packages/engine/vitest.config.ts',
      'packages/middleware/vitest.config.ts',
    ],
  },
];

function sha256ForFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const content = readFileSync(absolutePath);
  const hash = createHash('sha256').update(content).digest('hex');
  return { relativePath, hash };
}

let hasMismatch = false;

for (const group of parityGroups) {
  const hashes = group.files.map(sha256ForFile);
  const baselineHash = hashes[0].hash;
  const mismatches = hashes.filter((file) => file.hash !== baselineHash);

  if (mismatches.length === 0) {
    console.log(`✅ ${group.name}: in sync`);
    continue;
  }

  hasMismatch = true;
  console.error(`❌ ${group.name}: mismatch detected`);
  for (const file of hashes) {
    console.error(`   - ${file.relativePath}: ${file.hash}`);
  }
}

if (hasMismatch) {
  process.exitCode = 1;
} else {
  console.log('Config parity check passed.');
}
