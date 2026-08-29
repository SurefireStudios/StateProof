import { execFileSync, execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex, toJsonValue } from '@stateproof/core';

/**
 * `pnpm test:clean-reproduction`
 *
 * Clones the repository at HEAD into a temporary directory with no `.env`, no
 * `node_modules` and no prior build output, then runs the whole offline
 * workflow there.
 *
 * The point is to catch the two failure modes a developer machine hides: a
 * result that silently depends on a credential, and one that depends on an
 * absolute path only this machine has. Both would make the submission
 * irreproducible for anyone else, and neither shows up in-place.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = path.join(REPO_ROOT, 'submission');

interface StepResult {
  readonly command: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly tail: string;
}

function run(command: string, cwd: string, env: NodeJS.ProcessEnv): StepResult {
  const startedMs = Date.now();
  try {
    const output = execSync(command, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { command, ok: true, durationMs: Date.now() - startedMs, tail: tail(output) };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return {
      command,
      ok: false,
      durationMs: Date.now() - startedMs,
      tail: tail(`${failure.stdout ?? ''}${failure.stderr ?? ''}`),
    };
  }
}

function tail(output: string, lines = 12): string {
  return output.split('\n').filter((line) => line.trim() !== '').slice(-lines).join('\n');
}

function main(): void {
  const checkout = mkdtempSync(path.join(tmpdir(), 'stateproof-clean-'));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const describe = (() => {
    try {
      return execFileSync('git', ['describe', '--tags', '--exact-match', head], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim();
    } catch {
      return null;
    }
  })();

  process.stdout.write(`clean checkout: ${checkout}\ncommit:         ${head}\n`);
  process.stdout.write(`tag:            ${describe ?? '(none at HEAD)'}\n\n`);

  // A clone, not a copy: anything untracked — including .env and node_modules —
  // is left behind by construction rather than by a filter that could be wrong.
  execFileSync('git', ['clone', '--quiet', '--no-local', REPO_ROOT, checkout], { encoding: 'utf8' });
  execFileSync('git', ['checkout', '--quiet', head], { cwd: checkout, encoding: 'utf8' });

  for (const forbidden of ['.env', 'node_modules', 'apps/dashboard/dist']) {
    if (existsSync(path.join(checkout, forbidden))) {
      throw new Error(`the clean checkout unexpectedly contains ${forbidden}`);
    }
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['STATEPROOF_ANTHROPIC_API_KEY'];
  delete env['ANTHROPIC_API_KEY'];

  const steps: StepResult[] = [];
  for (const command of [
    'pnpm install --frozen-lockfile',
    'pnpm typecheck',
    'pnpm test',
    'pnpm benchmark:validate',
    'pnpm benchmark:validate-hard',
    'pnpm reproduce',
    'pnpm dashboard:build',
  ]) {
    const result = run(command, checkout, env);
    steps.push(result);
    process.stdout.write(
      `  ${result.ok ? 'ok  ' : 'FAIL'} ${command.padEnd(32)} ${(result.durationMs / 1000).toFixed(1)}s\n`,
    );
    if (!result.ok) {
      process.stdout.write(`${result.tail}\n`);
      break;
    }
  }

  // A generated page that hardcodes this machine's paths would not open on
  // anyone else's, so the built output is searched for them directly.
  const developmentPathLeaks: string[] = [];
  const distDir = path.join(checkout, 'apps', 'dashboard', 'dist');
  if (existsSync(distDir)) {
    for (const file of readdirSync(distDir)) {
      const text = readFileSync(path.join(distDir, file), 'utf8');
      if (text.includes(REPO_ROOT.replace(/\\/g, '/')) || text.includes(REPO_ROOT)) {
        developmentPathLeaks.push(file);
      }
      if (/[A-Za-z]:\\Users\\/.test(text) || text.includes('/Users/')) {
        developmentPathLeaks.push(`${file} (absolute user path)`);
      }
    }
  }

  const predictionHashes: Record<string, string> = {};
  const registryPath = path.join(checkout, 'submission', 'reproduction-manifest.json');
  if (existsSync(registryPath)) {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      runs: Array<{ id: string; canonicalPredictionSha256: string }>;
    };
    for (const run of registry.runs) predictionHashes[run.id] = run.canonicalPredictionSha256;
  }

  const passed = steps.every((step) => step.ok) && developmentPathLeaks.length === 0;

  const report = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    result: passed ? 'PASSED' : 'FAILED',
    environment: {
      os: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
      node: process.version,
      pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8', shell: true }).trim(),
    },
    checkout: { commit: head, tag: describe, credentialsPresent: false },
    steps: steps.map((step) => ({
      command: step.command,
      ok: step.ok,
      durationMs: step.durationMs,
      tail: step.tail,
    })),
    developmentPathLeaks,
    pinnedPredictionHashes: predictionHashes,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, 'clean-reproduction-report.json'),
    `${JSON.stringify(toJsonValue(report), null, 2)}\n`,
    'utf8',
  );

  const markdownLines: string[] = [
    '# Clean-checkout reproduction',
    '',
    `**Result: ${report.result}**`,
    '',
    `- Commit: \`${head}\`${describe === null ? '' : ` (tag \`${describe}\`)`}`,
    `- OS: ${report.environment.os}`,
    `- Node: ${report.environment.node}`,
    `- pnpm: ${report.environment.pnpm}`,
    '- Credentials: `STATEPROOF_ANTHROPIC_API_KEY` and `ANTHROPIC_API_KEY` removed from the child environment',
    '- Checkout: fresh `git clone` of HEAD into a temporary directory — no `.env`, no `node_modules`, no prior build output',
    '',
    '## Commands',
    '',
    '| Command | Result | Duration |',
    '| --- | --- | --- |',
    ...steps.map(
      (step) =>
        `| \`${step.command}\` | ${step.ok ? 'ok' : 'FAILED'} | ${(step.durationMs / 1000).toFixed(1)} s |`,
    ),
    '',
    '## Absolute development paths in the built output',
    '',
    developmentPathLeaks.length === 0
      ? 'None. The generated site contains no path pointing back at the development machine.'
      : developmentPathLeaks.map((leak) => `- ${leak}`).join('\n'),
    '',
    '## Pinned canonical prediction hashes',
    '',
    '| Run | sha256 |',
    '| --- | --- |',
    ...Object.entries(predictionHashes).map(
      ([runId, hash]) => `| \`${runId}\` | \`${hash.slice(0, 32)}\` |`,
    ),
    '',
    `Report fingerprint: \`${sha256Hex(JSON.stringify(report.steps)).slice(0, 16)}\``,
    '',
  ];
  const markdown = markdownLines.join('\n');

  writeFileSync(path.join(OUT_DIR, 'clean-reproduction-report.md'), markdown, 'utf8');

  process.stdout.write(
    [
      '',
      `RESULT: ${report.result}`,
      'written: submission/clean-reproduction-report.json',
      'written: submission/clean-reproduction-report.md',
      '',
    ].join('\n'),
  );

  rmSync(checkout, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
}

main();
