import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { HUMAN_ONLY_FILES } from '@stateproof/benchmark';

/**
 * These run the real CLIs in a child process with a scrubbed environment. The
 * point is what happens on disk, not what a mocked function returns: a run
 * without credentials must leave no artifact behind at all.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const tempRoots: string[] = [];

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a CLI with no credential in the environment and no `.env` in reach. */
function runCli(script: string, args: readonly string[], extraEnv: NodeJS.ProcessEnv = {}): CliResult {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  delete env['STATEPROOF_ANTHROPIC_API_KEY'];

  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script, ...args],
      { cwd: REPO_ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

const BASELINE_CLI = 'packages/agents/src/cli/baseline.ts';
const SMOKE_CLI = 'packages/agents/src/cli/smoke-model.ts';

const dotenvPresent = existsSync(path.join(REPO_ROOT, '.env'));

describe.skipIf(dotenvPresent)('missing credentials write no benchmark artifacts', () => {
  it('refuses the baseline and leaves the artifacts directory untouched', () => {
    const artifactsDir = tempDir('stateproof-cli-baseline-');
    const result = runCli(BASELINE_CLI, ['--split', 'development', '--out', artifactsDir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('No model credentials are configured');
    expect(result.stderr).toContain('STATEPROOF_ANTHROPIC_API_KEY');
    expect(readdirSync(artifactsDir)).toEqual([]);
  });

  it('names only the supported credential mechanism', () => {
    const artifactsDir = tempDir('stateproof-cli-message-');
    const result = runCli(BASELINE_CLI, ['--out', artifactsDir]);
    // `ant auth login` is not supported by the SDK adapter, so it must not be
    // suggested as though it were.
    expect(result.stderr).not.toContain('ant auth login');
    expect(result.stderr).toContain('.env');
    // And it must not send anyone towards Claude Code's own credential.
    expect(result.stderr).toContain('deliberately does not read ANTHROPIC_API_KEY');
  });

  it('refuses the smoke test too, without writing anything', () => {
    const result = runCli(SMOKE_CLI, []);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('No model credentials are configured');
  });
});

describe('the locked split is gated', () => {
  it('refuses without the explicit override, before any credential check', () => {
    const artifactsDir = tempDir('stateproof-cli-locked-');
    const result = runCli(BASELINE_CLI, ['--split', 'locked', '--out', artifactsDir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Refusing to run the locked challenge split');
    expect(result.stderr).toContain('STATEPROOF_ALLOW_LOCKED_RUN');
    expect(readdirSync(artifactsDir)).toEqual([]);
  });
});

describe('the smoke test touches no benchmark data', () => {
  const source = readdirSync(path.join(REPO_ROOT, 'packages', 'agents', 'src', 'cli'));

  it('exists as its own entry point', () => {
    expect(source).toContain('smoke-model.ts');
  });

  it('imports no benchmark or gold module', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(path.join(REPO_ROOT, SMOKE_CLI), 'utf8');
    expect(text).not.toContain('@stateproof/benchmark');
    expect(text).not.toContain('loadAgentVisibleCase');
    expect(text).not.toContain('loadGoldBundle');
    for (const fileName of HUMAN_ONLY_FILES) {
      expect(text).not.toContain(fileName);
    }
  });

  it('writes no prediction, report or manifest', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(path.join(REPO_ROOT, SMOKE_CLI), 'utf8');
    expect(text).not.toContain('runBaselinePredictions');
    expect(text).not.toContain('scorePredictions');
    expect(text).not.toContain('writeFileSync');
  });
});
