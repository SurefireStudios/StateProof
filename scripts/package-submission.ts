import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toJsonValue } from '@stateproof/core';

/**
 * `pnpm package:submission`
 *
 * Builds `release/stateproof-submission-final.zip` from the *tracked* tree plus
 * the prebuilt dashboard, hashes it, records what went in, and then proves the
 * package by extracting it somewhere else and running the whole offline
 * workflow there.
 *
 * `git archive` is the include-list: anything untracked — `.env`, node_modules,
 * scratch directories, local editor settings — is excluded by construction
 * rather than by a filter that could be one pattern short.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const RELEASE_DIR = path.join(REPO_ROOT, 'release');
const ZIP_NAME = 'stateproof-submission-final.zip';
const DIST_DIR = path.join(REPO_ROOT, 'apps', 'dashboard', 'dist');

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function walk(root: string, prefix = ''): string[] {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.name === '.git') return [];
    return entry.isDirectory() ? walk(root, relative) : [relative];
  });
}

function run(command: string, cwd: string, env: NodeJS.ProcessEnv): { ok: boolean; ms: number; tail: string } {
  const startedMs = Date.now();
  try {
    const output = execFileSync(command, {
      cwd,
      env,
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, ms: Date.now() - startedMs, tail: lastLines(output) };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return {
      ok: false,
      ms: Date.now() - startedMs,
      tail: lastLines(`${failure.stdout ?? ''}${failure.stderr ?? ''}`),
    };
  }
}

function lastLines(text: string, lines = 10): string {
  return text.split('\n').filter((line) => line.trim() !== '').slice(-lines).join('\n');
}

async function main(): Promise<void> {
  if (!existsSync(DIST_DIR)) {
    throw new Error('run `pnpm dashboard:build` first: the package ships the prebuilt dashboard');
  }

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('??'));

  mkdirSync(RELEASE_DIR, { recursive: true });
  const zipPath = path.join(RELEASE_DIR, ZIP_NAME);
  rmSync(zipPath, { force: true });

  // Stage: tracked files at HEAD, plus the prebuilt dashboard for convenience.
  const staging = mkdtempSync(path.join(tmpdir(), 'stateproof-package-'));
  execFileSync('git', ['archive', '--format=zip', '-o', zipPath, head], { cwd: REPO_ROOT });
  execFileSync('tar', ['-xf', zipPath, '-C', staging], { cwd: REPO_ROOT });

  const distTarget = path.join(staging, 'apps', 'dashboard', 'dist');
  mkdirSync(distTarget, { recursive: true });
  for (const file of readdirSync(DIST_DIR)) {
    writeFileSync(path.join(distTarget, file), readFileSync(path.join(DIST_DIR, file)));
  }

  rmSync(zipPath, { force: true });
  execFileSync('tar', ['-a', '-c', '-f', zipPath, '.'], { cwd: staging });

  const digest = await sha256File(zipPath);
  const sizeBytes = statSync(zipPath).size;

  const included = walk(staging);
  const topLevel = [...new Set(included.map((entry) => entry.split('/')[0] ?? entry))].sort();

  // --- prove the package ---------------------------------------------------
  const extracted = mkdtempSync(path.join(tmpdir(), 'stateproof-extract-'));
  execFileSync('tar', ['-xf', zipPath, '-C', extracted]);

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['STATEPROOF_ANTHROPIC_API_KEY'];
  delete env['ANTHROPIC_API_KEY'];

  const steps: Array<{ command: string; ok: boolean; ms: number; tail: string }> = [];
  for (const command of [
    'pnpm install --frozen-lockfile',
    'pnpm typecheck',
    'pnpm test',
    'pnpm benchmark:validate',
    'pnpm benchmark:validate-hard',
    'pnpm reproduce',
    'pnpm dashboard:build',
  ]) {
    const result = run(command, extracted, env);
    steps.push({ command, ...result });
    process.stdout.write(
      `  ${result.ok ? 'ok  ' : 'FAIL'} ${command.padEnd(32)} ${(result.ms / 1000).toFixed(1)}s\n`,
    );
    if (!result.ok) {
      process.stdout.write(`${result.tail}\n`);
      break;
    }
  }

  // The shipped dashboard must be a real, self-contained site.
  const shippedDist = path.join(extracted, 'apps', 'dashboard', 'dist');
  const shippedPages = existsSync(shippedDist) ? readdirSync(shippedDist) : [];
  const requiredPages = [
    'index.html',
    'inspector.html',
    'benchmark.html',
    'changelog.html',
    'trajectories.html',
    'architecture.html',
    'styles.css',
    'app.js',
  ];
  const missingPages = requiredPages.filter((page) => !shippedPages.includes(page));
  const dashboardOk =
    missingPages.length === 0 &&
    readFileSync(path.join(shippedDist, 'index.html'), 'utf8').includes('StateProof');

  const scan = run(`pnpm --dir "${REPO_ROOT}" scan:secrets "${extracted}"`, REPO_ROOT, env);

  const passed = steps.every((step) => step.ok) && dashboardOk && scan.ok;

  const manifest = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    package: {
      path: `release/${ZIP_NAME}`,
      sha256: digest,
      sizeBytes,
      sizeMb: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
      sourceCommit: head,
      trackedTreeClean: dirty.length === 0,
    },
    contents: {
      fileCount: included.length,
      topLevelPaths: topLevel,
      includesPrebuiltDashboard: shippedPages.length > 0,
      dashboardPages: shippedPages.sort(),
    },
    excluded: [
      '.env',
      '.env - Copy.example',
      'node_modules',
      'release/',
      'temporary clean-checkout directories',
      '.claude/ local settings',
      'untracked files of any kind (git archive is the include list)',
    ],
    verification: {
      extractedTo: 'a fresh temporary directory outside the source tree',
      credentialsRemoved: ['STATEPROOF_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
      steps: steps.map((step) => ({ command: step.command, ok: step.ok, durationMs: step.ms })),
      dashboardStructureOk: dashboardOk,
      missingDashboardPages: missingPages,
      secretScanOk: scan.ok,
      result: passed ? 'PASSED' : 'FAILED',
    },
  };

  writeFileSync(
    path.join(REPO_ROOT, 'submission', 'final-package-manifest.json'),
    `${JSON.stringify(toJsonValue(manifest), null, 2)}\n`,
    'utf8',
  );

  process.stdout.write(
    [
      '',
      `package:  release/${ZIP_NAME}`,
      `sha256:   ${digest}`,
      `size:     ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB (${sizeBytes} bytes)`,
      `files:    ${included.length}`,
      `top-level: ${topLevel.join(', ')}`,
      `dashboard: ${shippedPages.length} file(s) shipped prebuilt`,
      `secrets:   ${scan.ok ? 'CLEAN' : 'FINDINGS'}`,
      '',
      `RESULT: ${passed ? 'PASSED' : 'FAILED'}`,
      'written: submission/final-package-manifest.json',
      '',
    ].join('\n'),
  );

  for (const scratch of [staging, extracted]) {
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    } catch {
      process.stdout.write(`note: could not remove ${scratch}; delete it manually.\n`);
    }
  }

  if (!passed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
