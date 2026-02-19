import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cliPath = path.resolve('src/cli.ts');
const fixturePath = path.resolve('fixtures/my_test_data.json');
const unstableFixturePath = fixturePath; // Use same fixture (root copy was removed)

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    cwd: path.resolve('.'),
    encoding: 'utf-8',
    env: {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'test-key',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'test-key',
    },
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runCliAsync(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliPath, ...args], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'test-key',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'test-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function extractTokenCount(output: string, label: string): number {
  const regex = new RegExp(`${label}:\\s*([0-9,]+)`, 'i');
  const match = output.match(regex);
  if (!match) return -1;
  return Number(match[1].replaceAll(',', ''));
}

test('inject --strategy auto + --dry-run returns success and prints strategy', () => {
  const result = runCli([
    'inject',
    fixturePath,
    '--provider',
    'openai',
    '--strategy',
    'auto',
    '--dry-run',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Strategy:\s+(contex|csv|toon|markdown)/i);
  assert.match(result.stdout, /Best Found:/i);
  assert.match(result.stdout, /Dry Run:\s+YES/i);
});

test('inject --max-input-tokens fails fast before provider call', () => {
  const result = runCli([
    'inject',
    fixturePath,
    '--provider',
    'openai',
    '--strategy',
    'contex',
    '--max-input-tokens',
    '1',
    '--dry-run',
  ]);

  assert.notEqual(result.code, 0, 'Expected non-zero exit code for cap overflow.');
  assert.match(result.stderr + result.stdout, /exceeding token cap|--max-input-tokens/i);
});

test('inject uses provider/model token cap preset when flag is not provided', () => {
  const result = runCli([
    'inject',
    fixturePath,
    '--provider',
    'anthropic',
    '--model',
    'claude-3-5-sonnet',
    '--dry-run',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Token Cap:\s+[0-9,]+ tokens \((preset|derived)\)/i);
});

test('inject --contex-only forces contex strategy even when auto is requested', () => {
  const result = runCli([
    'inject',
    fixturePath,
    '--provider',
    'openai',
    '--strategy',
    'auto',
    '--contex-only',
    '--dry-run',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Strategy:\s+contex/i);
  assert.match(result.stdout, /Policy:\s+Contex-only/i);
});

test('analyze contex token count is consistent with stats token count', () => {
  const stats = runCli(['stats', fixturePath, '--encoding', 'o200k_base']);
  const analyze = runCli([
    'analyze',
    fixturePath,
    '--model',
    'gpt-4o-mini',
    '--strategy',
    'contex',
  ]);

  assert.equal(stats.code, 0, stats.stderr || stats.stdout);
  assert.equal(analyze.code, 0, analyze.stderr || analyze.stdout);

  const statsTokens = extractTokenCount(stats.stdout, 'Contex tokens');
  const analyzeTokens = extractTokenCount(analyze.stdout, 'Contex Tokens');

  assert.ok(statsTokens > 0, `Failed to parse stats tokens from output:\n${stats.stdout}`);
  assert.ok(analyzeTokens > 0, `Failed to parse analyze tokens from output:\n${analyze.stdout}`);
  assert.equal(
    analyzeTokens,
    statsTokens,
    `Analyze/Stats mismatch: analyze=${analyzeTokens}, stats=${statsTokens}`,
  );
});

test('analyze --strict-auto-gate fails when auto confidence is below threshold', () => {
  const result = runCli([
    'analyze',
    fixturePath,
    '--model',
    'gpt-4o-mini',
    '--strategy',
    'auto',
    '--strict-auto-gate',
    '--auto-confidence-floor',
    '101',
  ]);

  assert.equal(result.code, 2, result.stderr || result.stdout);
  assert.match(result.stdout + result.stderr, /Auto Confidence Gate/i);
  assert.match(result.stdout + result.stderr, /Strict Gate: FAIL/i);
});

test('validate --semantic-guard passes on canonicalized fixture relation checks', () => {
  const result = runCli(['validate', unstableFixturePath, '--semantic-guard']);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(
    result.stdout + result.stderr,
    /Semantic Guard\s+✅ PASS|Semantic relation integrity preserved/i,
  );
});

test('guard command outputs semantic diagnostics and passes on canonicalized fixture', () => {
  const result = runCli(['guard', unstableFixturePath]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout + result.stderr, /Semantic Relation Guard/i);
  assert.match(
    result.stdout + result.stderr,
    /Status:\s+PASS|Semantic relation integrity preserved/i,
  );
});

test('scorecard command computes gate from latest analyze snapshots', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'contex-scorecard-'));
  const inPath = path.join(tempDir, 'analyze_report.json');
  const outPath = path.join(tempDir, 'scorecard_report.json');

  writeFileSync(
    inPath,
    JSON.stringify(
      {
        version: 1,
        runs: [
          {
            timestamp: '2026-02-16T09:00:00.000Z',
            command: 'analyze',
            inputPath: '/dataset/a.json',
            model: 'gpt-4o-mini',
            metrics: { tokenReductionPct: 10, bestStrategy: 'contex', bestTokens: 900 },
          },
          {
            timestamp: '2026-02-16T10:00:00.000Z',
            command: 'analyze',
            inputPath: '/dataset/a.json',
            model: 'gpt-4o-mini',
            metrics: { tokenReductionPct: 40, bestStrategy: 'toon', bestTokens: 700 },
          },
          {
            timestamp: '2026-02-16T10:05:00.000Z',
            command: 'analyze',
            inputPath: '/dataset/b.json',
            model: 'gpt-4o-mini',
            metrics: { tokenReductionPct: 62, bestStrategy: 'toon', bestTokens: 500 },
          },
          {
            timestamp: '2026-02-16T10:10:00.000Z',
            command: 'analyze',
            inputPath: '/dataset/c.json',
            model: 'gpt-4o-mini',
            metrics: { tokenReductionPct: 70, bestStrategy: 'csv', bestTokens: 450 },
          },
        ],
      },
      null,
      2,
    ),
    'utf-8',
  );

  const result = runCli([
    'scorecard',
    '--in',
    inPath,
    '--out',
    outPath,
    '--model',
    'gpt-4o-mini',
    '--target-floor',
    '35',
    '--target-median',
    '60',
    '--min-datasets',
    '3',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Scorecard Gate/i);
  assert.match(result.stdout, /Datasets:\s+3 \(PASS/i);
  assert.match(result.stdout, /Gate:\s+PASS/i);
});

test('scorecard --strict-gate exits non-zero when targets fail', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'contex-scorecard-fail-'));
  const inPath = path.join(tempDir, 'analyze_report.json');

  writeFileSync(
    inPath,
    JSON.stringify(
      {
        version: 1,
        runs: [
          {
            timestamp: '2026-02-16T10:00:00.000Z',
            command: 'analyze',
            inputPath: '/dataset/a.json',
            model: 'gpt-4o-mini',
            metrics: { tokenReductionPct: 10, bestStrategy: 'contex', bestTokens: 900 },
          },
          {
            timestamp: '2026-02-16T10:05:00.000Z',
            command: 'analyze',
            inputPath: '/dataset/b.json',
            model: 'gpt-4o-mini',
            metrics: { tokenReductionPct: 12, bestStrategy: 'contex', bestTokens: 870 },
          },
          {
            timestamp: '2026-02-16T10:10:00.000Z',
            command: 'analyze',
            inputPath: '/dataset/c.json',
            model: 'gpt-4o-mini',
            metrics: { tokenReductionPct: 14, bestStrategy: 'contex', bestTokens: 840 },
          },
        ],
      },
      null,
      2,
    ),
    'utf-8',
  );

  const result = runCli([
    'scorecard',
    '--in',
    inPath,
    '--model',
    'gpt-4o-mini',
    '--target-floor',
    '35',
    '--target-median',
    '60',
    '--min-datasets',
    '3',
    '--strict-gate',
  ]);

  assert.equal(result.code, 2, result.stderr || result.stdout);
  assert.match(result.stdout + result.stderr, /Strict Gate: FAIL/i);
});

// ============================================================================
// Cache Commands Regression Tests
// ============================================================================

test('cache-diagnose requires input file', () => {
  const result = runCli(['cache-diagnose']);

  assert.notEqual(result.code, 0, 'Expected non-zero exit code for missing input');
  assert.match(result.stderr + result.stdout, /Error: missing input file/i);
});

test('cache-diagnose shows cache readiness for fixture', () => {
  const result = runCli(['cache-diagnose', fixturePath, '--model', 'gpt-4o-mini']);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Cache Diagnostics/i);
  assert.match(result.stdout, /Input:/i);
  assert.match(result.stdout, /Model:/i);
  assert.match(result.stdout, /IR Hash:/i);
  assert.match(result.stdout, /Readiness:/i);
});

test('cache-diagnose handles invalid JSON file', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'contex-cache-'));
  const invalidPath = path.join(tempDir, 'invalid.json');
  writeFileSync(invalidPath, '{ invalid json }', 'utf-8');

  const result = runCli(['cache-diagnose', invalidPath, '--model', 'gpt-4o-mini']);

  assert.notEqual(result.code, 0, 'Expected non-zero exit code for invalid JSON');
  assert.match(result.stderr + result.stdout, /Invalid JSON/i);
});

test('cache-warm requires input file', () => {
  const result = runCli(['cache-warm']);

  assert.notEqual(result.code, 0, 'Expected non-zero exit code for missing input');
  assert.match(result.stderr + result.stdout, /Error: missing input file/i);
});

test('cache-warm requires --models flag', () => {
  const result = runCli(['cache-warm', fixturePath]);

  assert.notEqual(result.code, 0, 'Expected non-zero exit code for missing --models');
  assert.match(result.stderr + result.stdout, /Error: missing --models flag/i);
});

test('cache-warm pre-materializes for multiple models', () => {
  const result = runCli([
    'cache-warm',
    fixturePath,
    '--models',
    'gpt-4o-mini,claude-3-5-sonnet',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Cache Warm/i);
  assert.match(result.stdout, /IR Hash:/i);
  assert.match(result.stdout, /gpt-4o-mini:/i);
  assert.match(result.stdout, /claude-3-5-sonnet:/i);
});

test('cache-warm handles unknown model gracefully', () => {
  const result = runCli([
    'cache-warm',
    fixturePath,
    '--models',
    'unknown-model-xyz',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Unknown model/i);
});

test('cache-stats shows aggregate telemetry', () => {
  const result = runCli(['cache-stats']);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Cache Telemetry/i);
  assert.match(result.stdout, /Total requests:/i);
  assert.match(result.stdout, /Hits:/i);
  assert.match(result.stdout, /Misses:/i);
  assert.match(result.stdout, /Hit rate:/i);
});

test('cache-diagnose output contains expected metrics', () => {
  const result = runCli(['cache-diagnose', fixturePath, '--model', 'gpt-4o-mini']);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  // Should contain both readiness status and recommendation
  assert.match(result.stdout, /(READY|NOT READY)/i);
  assert.match(result.stdout, /Recommendation:/i);
});

test('status command reports server and provider readiness from /health', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      const body = JSON.stringify({
        status: 'ok',
        service: 'contex-api',
        version: '0.1.0',
        providerGateway: {
          middlewareConnected: true,
          openaiConfigured: true,
          anthropicConfigured: false,
          geminiConfigured: true,
        },
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && 'port' in address, 'Server should expose a port');
  const port = address.port;

  try {
    const result = await runCliAsync(['status', '--url', `http://127.0.0.1:${port}`]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Server Status/i);
    assert.match(result.stdout, /Gateway:\s+Connected/i);
    assert.match(result.stdout, /OpenAI:\s+Configured/i);
    assert.match(result.stdout, /Anthropic:\s+Missing ANTHROPIC_API_KEY/i);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test('status command exits non-zero when server is unreachable', () => {
  const result = runCli(['status', '--url', 'http://127.0.0.1:65535', '--timeout-ms', '500']);

  assert.notEqual(result.code, 0, 'Expected non-zero exit code when API is unreachable');
  assert.match(result.stderr + result.stdout, /unable to reach Contex API/i);
});

test('status --json returns parseable readiness payload', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      const body = JSON.stringify({
        status: 'ok',
        service: 'contex-api',
        version: '0.1.0',
        providerGateway: {
          middlewareConnected: true,
          openaiConfigured: true,
          anthropicConfigured: true,
          geminiConfigured: true,
        },
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object' && 'port' in address, 'Server should expose a port');
  const port = address.port;

  try {
    const result = await runCliAsync(['status', '--json', '--url', `http://127.0.0.1:${port}`]);
    assert.equal(result.code, 0, result.stderr || result.stdout);

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      service: string;
      status: string;
      providerGateway: { middlewareConnected: boolean };
      missingProviders: string[];
    };

    assert.equal(payload.ok, true);
    assert.equal(payload.service, 'contex-api');
    assert.equal(payload.status, 'ok');
    assert.equal(payload.providerGateway.middlewareConnected, true);
    assert.equal(payload.missingProviders.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test('status --json emits machine-readable error when server is unreachable', () => {
  const result = runCli(['status', '--json', '--url', 'http://127.0.0.1:65535', '--timeout-ms', '500']);
  assert.notEqual(result.code, 0, 'Expected non-zero exit code when API is unreachable');

  const payload = JSON.parse(result.stderr) as {
    ok: boolean;
    error: string;
    details?: string;
  };

  assert.equal(payload.ok, false);
  assert.match(payload.error, /unable to reach Contex API/i);
});
