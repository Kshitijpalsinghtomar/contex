import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const nodeBin = process.execPath;
const model = 'gpt-4o-mini';
const targetFloor = 35;
const targetMedian = 60;
const minDatasets = 3;

const fixedDatasets = [
  { family: 'baseline', file: 'dummy.json' },
  { family: 'synthetic-small', file: '.contex/dummy_1000.json' },
  { family: 'synthetic-large', file: '.contex/dummy_2000.json' },
];

function runCommand(args) {
  const result = spawnSync(nodeBin, ['--import', 'tsx', 'packages/cli/src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env: { ...process.env },
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    return {
      code: 1,
      stdout: result.stdout ?? '',
      stderr: (result.stderr ?? '') + `\n${String(result.error.message ?? result.error)}`,
    };
  }

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function hashFile(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function safeNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

for (const dataset of fixedDatasets) {
  if (!existsSync(dataset.file)) {
    console.error(`Missing fixed Week 4 dataset: ${dataset.file}`);
    process.exit(1);
  }
}

ensureDir('.contex');

const date = new Date().toISOString().slice(0, 10);
const runId = `${model}-week4-${Date.now().toString(36)}`;
const bundleDir = path.join('artifacts', 'scorecards', date, 'week4-fixed-set', runId);
ensureDir(bundleDir);
ensureDir(path.join('artifacts', 'scorecards'));

const analyzeOutPath = path.join(bundleDir, 'analyze-report.json');
const scorecardOutPath = path.join(bundleDir, 'scorecard-report.json');
const cadencePath = path.join('artifacts', 'scorecards', 'week4-cadence.json');

const runCommands = [];
const analyzeRuns = [];

for (const dataset of fixedDatasets) {
  const cmd = [
    'analyze',
    dataset.file,
    '--model',
    model,
    '--contex-only',
    '--semantic-guard',
    '--target-floor',
    String(targetFloor),
    '--target-median',
    String(targetMedian),
    '--out',
    analyzeOutPath,
  ];

  const result = runCommand(cmd);
  runCommands.push(`node --import tsx packages/cli/src/cli.ts ${cmd.join(' ')}`);
  analyzeRuns.push({ dataset: dataset.file, family: dataset.family, ...result });

  if (result.code !== 0) {
    console.error(`Analyze failed for dataset: ${dataset.file}`);
    console.error(result.stderr || result.stdout);
    process.exit(result.code);
  }
}

const scorecardCmd = [
  'scorecard',
  '--in',
  analyzeOutPath,
  '--out',
  scorecardOutPath,
  '--model',
  model,
  '--target-floor',
  String(targetFloor),
  '--target-median',
  String(targetMedian),
  '--min-datasets',
  String(minDatasets),
];

const scorecardRun = runCommand(scorecardCmd);
runCommands.push(`node --import tsx packages/cli/src/cli.ts ${scorecardCmd.join(' ')}`);
if (scorecardRun.code !== 0) {
  console.error('Scorecard generation failed.');
  console.error(scorecardRun.stderr || scorecardRun.stdout);
  process.exit(scorecardRun.code);
}

const validateCmd = ['validate', 'dummy.json', '--semantic-guard'];
const validateRun = runCommand(validateCmd);
runCommands.push(`node --import tsx packages/cli/src/cli.ts ${validateCmd.join(' ')}`);

const analyzeSnapshot = JSON.parse(readFileSync(analyzeOutPath, 'utf-8'));
const scorecardReport = JSON.parse(readFileSync(scorecardOutPath, 'utf-8'));

const observed = {
  datasetCount: Number(scorecardReport?.observed?.datasetCount ?? 0),
  floorReductionPct: Number(scorecardReport?.observed?.floorReductionPct ?? 0),
  medianReductionPct: Number(scorecardReport?.observed?.medianReductionPct ?? 0),
};

const history = existsSync(cadencePath)
  ? JSON.parse(readFileSync(cadencePath, 'utf-8'))
  : { version: 1, key: 'week4-fixed-set', runs: [] };

const previousRun = Array.isArray(history.runs) && history.runs.length > 0 ? history.runs[history.runs.length - 1] : null;

const drift = {
  hasBaseline: Boolean(previousRun),
  baselineRunId: previousRun?.runId ?? null,
  floorReductionPctDelta: previousRun ? safeNumber(observed.floorReductionPct - previousRun.observed.floorReductionPct) : null,
  medianReductionPctDelta: previousRun ? safeNumber(observed.medianReductionPct - previousRun.observed.medianReductionPct) : null,
  datasetCountDelta: previousRun ? observed.datasetCount - previousRun.observed.datasetCount : null,
};

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  model,
  fixedSet: 'week4-fixed-set',
  datasets: fixedDatasets.map((dataset) => ({
    family: dataset.family,
    path: dataset.file,
    sha256: hashFile(dataset.file),
  })),
};

writeFileSync(path.join(bundleDir, 'dataset-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

writeFileSync(
  path.join(bundleDir, 'question.md'),
  [
    '# Week 4 Limitation Question',
    '',
    '## Limitation',
    '- Cost/latency evidence gap and workload sensitivity in mixed real-world data.',
    '',
    '## Question to Answer',
    '- On a fixed 3-dataset set, are floor/median reduction metrics stable week-over-week under identical settings?',
    '',
    '## Hypothesis',
    '- Median remains >= 60%; floor movement is measurable and attributable by dataset family.',
    '',
    '## Decision Threshold',
    '- Publish artifacts each run; use drift deltas to decide ship/iterate/rollback.',
  ].join('\n'),
  'utf-8',
);

writeFileSync(path.join(bundleDir, 'run-command.txt'), `${runCommands.join('\n')}\n`, 'utf-8');

writeFileSync(
  path.join(bundleDir, 'raw-output.json'),
  JSON.stringify(
    {
      analyzeRuns,
      scorecardRun,
      validateRun,
      analyzeSnapshot,
      scorecardReport,
    },
    null,
    2,
  ),
  'utf-8',
);

writeFileSync(path.join(bundleDir, 'drift-report.json'), JSON.stringify(drift, null, 2), 'utf-8');

const decision = scorecardReport?.gate?.pass ? 'ship' : 'iterate';
writeFileSync(
  path.join(bundleDir, 'scorecard.md'),
  [
    '# Week 4 Scorecard Summary',
    '',
    '## Run',
    `- Date: ${date}`,
    `- Run ID: ${runId}`,
    `- Model: ${model}`,
    '- Strategy: contex-only',
    '- Dataset set: week4-fixed-set',
    '',
    '## Observed Metrics',
    `- dataset_count: ${observed.datasetCount}`,
    `- floor_reduction_pct: ${safeNumber(observed.floorReductionPct)}`,
    `- median_reduction_pct: ${safeNumber(observed.medianReductionPct)}`,
    '',
    '## Drift vs Previous Week',
    drift.hasBaseline
      ? `- floor_reduction_pct_delta: ${drift.floorReductionPctDelta} points`
      : '- floor_reduction_pct_delta: N/A (first baseline run)',
    drift.hasBaseline
      ? `- median_reduction_pct_delta: ${drift.medianReductionPctDelta} points`
      : '- median_reduction_pct_delta: N/A (first baseline run)',
    drift.hasBaseline
      ? `- dataset_count_delta: ${drift.datasetCountDelta}`
      : '- dataset_count_delta: N/A (first baseline run)',
    '',
    '## Decision',
    `- ${decision}`,
    `- Reason: scorecard gate ${scorecardReport?.gate?.pass ? 'PASS' : 'FAIL'}`,
  ].join('\n'),
  'utf-8',
);

writeFileSync(
  path.join(bundleDir, 'correctness-report.txt'),
  [
    'Correctness checks',
    `- validate_exit_code: ${validateRun.code}`,
    `- roundtrip_json: ${validateRun.stdout.includes('JSON           ✅ PASS') ? 'PASS' : 'UNKNOWN'}`,
    `- semantic_guard: ${validateRun.stdout.includes('Semantic Guard ✅ PASS') ? 'PASS' : 'UNKNOWN'}`,
    '',
    'Validate output (raw):',
    validateRun.stdout.trim(),
  ].join('\n'),
  'utf-8',
);

const cadenceEntry = {
  timestamp: new Date().toISOString(),
  date,
  runId,
  bundlePath: bundleDir.replaceAll('\\', '/'),
  observed,
  gate: {
    pass: Boolean(scorecardReport?.gate?.pass),
    checks: scorecardReport?.gate?.checks ?? null,
  },
};

history.runs = Array.isArray(history.runs) ? [...history.runs, cadenceEntry] : [cadenceEntry];
writeFileSync(cadencePath, JSON.stringify(history, null, 2), 'utf-8');

console.log(`Week 4 proof-pack artifact generated: ${bundleDir}`);
console.log(`Cadence history updated: ${cadencePath}`);
