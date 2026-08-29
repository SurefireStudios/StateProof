import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FINAL_LEDGER_REPO_PATH,
  FINAL_LOCKED_CONFIRM_ENV,
  FINAL_LOCKED_CONFIRM_VALUE,
  FROZEN_PATHS,
  FinalLockedProtocolError,
  appendLedger,
  assertFinalLockedProtocol,
  readLedger,
} from '@stateproof/agents';
import { inCheckout } from './checkout';

/**
 * The locked split is worth exactly one run, and everything here exists to make
 * that one run mean something: it cannot happen by accident, it cannot happen
 * twice, and it cannot happen from a tree nobody can reconstruct.
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

function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' });
}

/** A throwaway repository shaped like this one, so the guard is what is tested. */
function scratchRepo(): { root: string; head: string } {
  const root = tempDir('stateproof-freeze-');
  git(['init', '--quiet'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(path.join(root, '.gitignore'), '.env\nartifacts/\n', 'utf8');
  for (const frozen of FROZEN_PATHS) {
    const full = path.join(root, frozen);
    execFileSync(process.execPath, [
      '-e',
      `require('fs').mkdirSync(${JSON.stringify(path.dirname(full))},{recursive:true})`,
    ]);
    writeFileSync(full, `frozen content for ${frozen}\n`, 'utf8');
  }
  git(['add', '.'], root);
  git(['commit', '--quiet', '-m', 'freeze'], root);
  return { root, head: git(['rev-parse', 'HEAD'], root).trim() };
}

function request(overrides: Partial<Parameters<typeof assertFinalLockedProtocol>[0]>) {
  return {
    workflow: 'baseline-hard-locked' as const,
    split: 'locked',
    finalLocked: true,
    expectedFreeze: undefined as string | undefined,
    dataset: 'phantombench-hard-12',
    confirmation: FINAL_LOCKED_CONFIRM_VALUE,
    ...overrides,
  };
}

function problemsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof FinalLockedProtocolError) return error.problems;
    throw error;
  }
  return [];
}

describe('the one-time locked protocol', () => {
  it('accepts a clean tree at the named freeze with the confirmation set', () => {
    const repo = scratchRepo();
    const approval = assertFinalLockedProtocol(
      request({ repoRoot: repo.root, expectedFreeze: repo.head }),
    );
    expect(approval.freezeCommit).toBe(repo.head);
  });

  it('requires --final-locked', () => {
    const repo = scratchRepo();
    const problems = problemsOf(() =>
      assertFinalLockedProtocol(
        request({ repoRoot: repo.root, expectedFreeze: repo.head, finalLocked: false }),
      ),
    );
    expect(problems.join(' ')).toContain('--final-locked is required');
  });

  it('requires the exact confirmation phrase', () => {
    const repo = scratchRepo();
    for (const confirmation of [undefined, '', 'yes', FINAL_LOCKED_CONFIRM_VALUE.toLowerCase()]) {
      const problems = problemsOf(() =>
        assertFinalLockedProtocol(
          request({ repoRoot: repo.root, expectedFreeze: repo.head, confirmation }),
        ),
      );
      expect(problems.join(' ')).toContain(FINAL_LOCKED_CONFIRM_ENV);
    }
  });

  it('requires a full expected-freeze sha equal to HEAD', () => {
    const repo = scratchRepo();
    expect(
      problemsOf(() =>
        assertFinalLockedProtocol(request({ repoRoot: repo.root, expectedFreeze: undefined })),
      ).join(' '),
    ).toContain('--expected-freeze');

    expect(
      problemsOf(() =>
        assertFinalLockedProtocol(
          request({ repoRoot: repo.root, expectedFreeze: repo.head.slice(0, 12) }),
        ),
      ).join(' '),
    ).toContain('full 40-character');

    expect(
      problemsOf(() =>
        assertFinalLockedProtocol(request({ repoRoot: repo.root, expectedFreeze: 'a'.repeat(40) })),
      ).join(' '),
    ).toContain('HEAD is');
  });

  it('refuses a dirty tracked source tree', () => {
    const repo = scratchRepo();
    writeFileSync(path.join(repo.root, 'pnpm-lock.yaml'), 'edited after the freeze\n', 'utf8');
    expect(
      problemsOf(() =>
        assertFinalLockedProtocol(request({ repoRoot: repo.root, expectedFreeze: repo.head })),
      ).join(' '),
    ).toContain('differs from HEAD');
  });

  it('refuses a freeze commit that does not contain the frozen files', () => {
    const root = tempDir('stateproof-freeze-empty-');
    git(['init', '--quiet'], root);
    git(['config', 'user.email', 'test@example.com'], root);
    git(['config', 'user.name', 'Test'], root);
    writeFileSync(path.join(root, 'README.md'), 'nothing frozen here\n', 'utf8');
    git(['add', '.'], root);
    git(['commit', '--quiet', '-m', 'not a freeze'], root);
    const head = git(['rev-parse', 'HEAD'], root).trim();

    const problems = problemsOf(() =>
      assertFinalLockedProtocol(request({ repoRoot: root, expectedFreeze: head })),
    );
    expect(problems.join(' ')).toContain('does not contain prompts/contract-agent/v3.md');
  });

  it('refuses a workflow that has already completed', () => {
    const repo = scratchRepo();
    appendLedger(
      {
        recordedAt: new Date().toISOString(),
        workflow: 'baseline-hard-locked',
        status: 'completed',
        freezeCommit: repo.head,
        split: 'locked',
        dataset: 'phantombench-hard-12',
        runId: 'RUN-already-done',
        detail: 'first and only locked baseline',
      },
      repo.root,
    );
    expect(
      problemsOf(() =>
        assertFinalLockedProtocol(request({ repoRoot: repo.root, expectedFreeze: repo.head })),
      ).join(' '),
    ).toContain('has already completed');
  });

  it('allows the other workflow after one completes', () => {
    const repo = scratchRepo();
    appendLedger(
      {
        recordedAt: new Date().toISOString(),
        workflow: 'baseline-hard-locked',
        status: 'completed',
        freezeCommit: repo.head,
        split: 'locked',
        dataset: 'phantombench-hard-12',
        runId: 'RUN-baseline',
        detail: 'baseline done',
      },
      repo.root,
    );
    expect(() =>
      assertFinalLockedProtocol(
        request({
          repoRoot: repo.root,
          expectedFreeze: repo.head,
          workflow: 'stateproof-hard-locked',
        }),
      ),
    ).not.toThrow();
  });

  it('keeps a failed attempt visible rather than erasing it', () => {
    const repo = scratchRepo();
    const base = {
      recordedAt: new Date().toISOString(),
      freezeCommit: repo.head,
      split: 'locked' as const,
      dataset: 'phantombench-hard-12',
      detail: 'attempt',
    };
    appendLedger({ ...base, workflow: 'stateproof-hard-locked', status: 'started', runId: null }, repo.root);
    appendLedger({ ...base, workflow: 'stateproof-hard-locked', status: 'failed', runId: null }, repo.root);
    appendLedger(
      { ...base, workflow: 'stateproof-hard-locked', status: 'started', runId: null },
      repo.root,
    );

    const ledger = readLedger(repo.root);
    expect(ledger.map((entry) => entry.status)).toEqual(['started', 'failed', 'started']);
    // A failure does not block the retry of a workflow that never completed,
    // but it stays on the record permanently.
    expect(() =>
      assertFinalLockedProtocol(
        request({
          repoRoot: repo.root,
          expectedFreeze: repo.head,
          workflow: 'stateproof-hard-locked',
        }),
      ),
    ).not.toThrow();
  });
});

describe.skipIf(!inCheckout(REPO_ROOT))('the locked CLIs refuse without the protocol', () => {
  const HEAD = git(['rev-parse', 'HEAD'], REPO_ROOT).trim();

  function runCli(script: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): string {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    delete childEnv['STATEPROOF_ANTHROPIC_API_KEY'];
    delete childEnv['ANTHROPIC_API_KEY'];
    try {
      return execFileSync(
        process.execPath,
        [
          path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          path.join(REPO_ROOT, script),
          ...args,
        ],
        { cwd: tempDir('stateproof-cli-cwd-'), env: childEnv, encoding: 'utf8' },
      );
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }
  }

  const BASELINE = 'packages/agents/src/cli/baseline-hard.ts';
  const STATEPROOF = 'packages/agents/src/cli/stateproof-hard.ts';
  const OUT = ['--out'];

  it('refuses the locked baseline without --final-locked', () => {
    const output = runCli(BASELINE, ['--split', 'locked', ...OUT, tempDir('sp-')]);
    expect(output).toContain('--final-locked is required');
  });

  it('refuses the locked baseline without the confirmation', () => {
    const output = runCli(BASELINE, [
      '--split',
      'locked',
      '--final-locked',
      '--expected-freeze',
      HEAD,
      ...OUT,
      tempDir('sp-'),
    ]);
    expect(output).toContain(FINAL_LOCKED_CONFIRM_ENV);
  });

  it('refuses the locked baseline when the freeze sha is not HEAD', () => {
    const output = runCli(
      BASELINE,
      ['--split', 'locked', '--final-locked', '--expected-freeze', 'b'.repeat(40), ...OUT, tempDir('sp-')],
      { [FINAL_LOCKED_CONFIRM_ENV]: FINAL_LOCKED_CONFIRM_VALUE },
    );
    expect(output).toContain('HEAD is');
  });

  it('refuses the locked StateProof run in cold mode', () => {
    const output = runCli(
      STATEPROOF,
      ['--split', 'locked', '--final-locked', '--expected-freeze', HEAD, ...OUT, tempDir('sp-')],
      { [FINAL_LOCKED_CONFIRM_ENV]: FINAL_LOCKED_CONFIRM_VALUE },
    );
    expect(output).toContain('Refusing to run the locked split in cold mode');
  });

  it('refuses the locked StateProof run without the confirmation', () => {
    const output = runCli(STATEPROOF, [
      '--split',
      'locked',
      '--final-locked',
      '--expected-freeze',
      HEAD,
      '--contracts-from',
      'RUN-stateproof-hard-development-cold-20260829T022133Z-contracts',
      ...OUT,
      tempDir('sp-'),
    ]);
    expect(output).toContain(FINAL_LOCKED_CONFIRM_ENV);
  });

  it('still refuses the Core-12 locked split outright', () => {
    const output = runCli('packages/agents/src/cli/baseline.ts', [
      '--split',
      'locked',
      ...OUT,
      tempDir('sp-'),
    ]);
    expect(output).toContain('Refusing to run the locked challenge split');
  });
});

describe('the ledger', () => {
  it('lives in the submission directory and parses as JSONL', () => {
    expect(FINAL_LEDGER_REPO_PATH).toBe('submission/final-evaluation-ledger.jsonl');
    const filePath = path.join(REPO_ROOT, FINAL_LEDGER_REPO_PATH);
    if (!existsSync(filePath)) return;
    const lines = readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim() !== '');
    expect(readLedger(REPO_ROOT)).toHaveLength(lines.length);
  });
});
