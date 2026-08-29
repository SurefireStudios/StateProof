import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '@stateproof/benchmark';
import { z } from 'zod';
import { inspectSourceTree } from './source-guard';

/**
 * The one-time protocol for the final locked evaluation.
 *
 * The locked split is the only measurement in this project that has never been
 * seen, and it is worth exactly one run. Everything that makes it worth
 * something is a constraint: the source must be frozen at a named commit, the
 * operator must say out loud that this is the final run, and a workflow that
 * has already completed can never be run again — because "run it again and keep
 * the better one" is precisely how a held-out split stops being held out.
 *
 * The ledger is append-only for the same reason. A failed attempt stays
 * visible; erasing it would leave a record that looks like a clean first try.
 */

export const FINAL_LOCKED_CONFIRM_ENV = 'STATEPROOF_FINAL_LOCKED_CONFIRM';
export const FINAL_LOCKED_CONFIRM_VALUE = 'I_UNDERSTAND_THIS_IS_THE_FINAL_LOCKED_RUN';
export const FINAL_LEDGER_REPO_PATH = 'submission/final-evaluation-ledger.jsonl';

/** Paths whose content the freeze commit must actually contain. */
export const FROZEN_PATHS = [
  'prompts/baseline-evaluator/v2.md',
  'prompts/contract-agent/v3.md',
  'packages/agents/src/baseline/hard-runner.ts',
  'packages/agents/src/stateproof/runner.ts',
  'packages/agents/src/verify/executor.ts',
  'packages/core/src/verify/assertions.ts',
  'benchmarks/phantombench-hard-12/splits/locked.json',
  'pnpm-lock.yaml',
] as const;

export type FinalLockedWorkflow = 'baseline-hard-locked' | 'stateproof-hard-locked';

export const LedgerEntrySchema = z
  .object({
    recordedAt: z.string().min(1),
    workflow: z.enum(['baseline-hard-locked', 'stateproof-hard-locked']),
    status: z.enum(['started', 'completed', 'failed']),
    freezeCommit: z.string().regex(/^[0-9a-f]{40}$/),
    split: z.literal('locked'),
    dataset: z.string().min(1),
    runId: z.string().min(1).nullable(),
    detail: z.string().min(1),
  })
  .strict();

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export class FinalLockedProtocolError extends Error {
  public readonly problems: string[];

  public constructor(problems: string[]) {
    super(
      [
        'Refusing to run the final locked evaluation.',
        '',
        ...problems.map((problem) => `  - ${problem}`),
        '',
        'The locked split is worth one run. Every check above exists so that run',
        'means something.',
        '',
      ].join('\n'),
    );
    this.name = 'FinalLockedProtocolError';
    this.problems = problems;
  }
}

export function ledgerPath(repoRoot: string = REPO_ROOT): string {
  return path.join(repoRoot, FINAL_LEDGER_REPO_PATH);
}

export function readLedger(repoRoot: string = REPO_ROOT): LedgerEntry[] {
  const filePath = ledgerPath(repoRoot);
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => LedgerEntrySchema.parse(JSON.parse(line)));
}

/** Append-only by construction: this is the only writer, and it never rewrites. */
export function appendLedger(entry: LedgerEntry, repoRoot: string = REPO_ROOT): void {
  const filePath = ledgerPath(repoRoot);
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(LedgerEntrySchema.parse(entry))}\n`, 'utf8');
}

export function hasCompleted(
  workflow: FinalLockedWorkflow,
  repoRoot: string = REPO_ROOT,
): boolean {
  return readLedger(repoRoot).some(
    (entry) => entry.workflow === workflow && entry.status === 'completed',
  );
}

function git(args: readonly string[], repoRoot: string): string | null {
  try {
    return execFileSync('git', [...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

export interface FinalLockedRequest {
  readonly workflow: FinalLockedWorkflow;
  readonly split: string;
  readonly finalLocked: boolean;
  readonly expectedFreeze: string | undefined;
  readonly dataset: string;
  readonly repoRoot?: string;
  /** Injectable so a test can assert the confirmation without setting env. */
  readonly confirmation?: string | undefined;
}

export interface FinalLockedApproval {
  readonly freezeCommit: string;
  readonly workflow: FinalLockedWorkflow;
  readonly dataset: string;
  readonly repoRoot: string;
}

/**
 * Every condition that must hold before a locked case may be loaded.
 *
 * Deliberately returns *all* problems rather than the first: an operator about
 * to spend a one-shot measurement should see the whole list, not discover the
 * next obstacle one command at a time.
 */
export function assertFinalLockedProtocol(request: FinalLockedRequest): FinalLockedApproval {
  const repoRoot = request.repoRoot ?? REPO_ROOT;
  const problems: string[] = [];

  if (request.split !== 'locked') {
    problems.push('this protocol applies to --split locked only');
  }
  if (!request.finalLocked) {
    problems.push('--final-locked is required: the locked split has no non-final mode');
  }

  const confirmation = request.confirmation ?? process.env[FINAL_LOCKED_CONFIRM_ENV];
  if (confirmation !== FINAL_LOCKED_CONFIRM_VALUE) {
    problems.push(
      `${FINAL_LOCKED_CONFIRM_ENV} must be set to exactly "${FINAL_LOCKED_CONFIRM_VALUE}"`,
    );
  }

  const expected = request.expectedFreeze;
  if (expected === undefined) {
    problems.push('--expected-freeze <full commit sha> is required');
  } else if (!/^[0-9a-f]{40}$/.test(expected)) {
    problems.push('--expected-freeze must be a full 40-character commit sha');
  }

  const head = git(['rev-parse', 'HEAD'], repoRoot)?.trim() ?? null;
  if (head === null) {
    problems.push('git HEAD could not be read');
  } else if (expected !== undefined && /^[0-9a-f]{40}$/.test(expected) && head !== expected) {
    problems.push(`HEAD is ${head.slice(0, 12)} but the freeze names ${expected.slice(0, 12)}`);
  }

  const source = inspectSourceTree(repoRoot);
  if (!source.clean) {
    problems.push(
      `the tracked source tree differs from HEAD: ${source.offending.slice(0, 5).join(', ')}`,
    );
  }

  // The freeze must genuinely contain the prompt, evaluator, verifier,
  // benchmark and lockfile being used — not merely be a commit that exists.
  if (head !== null && expected !== undefined && head === expected) {
    for (const frozenPath of FROZEN_PATHS) {
      if (git(['cat-file', '-e', `${expected}:${frozenPath}`], repoRoot) === null) {
        problems.push(`the freeze commit does not contain ${frozenPath}`);
      }
    }
  }

  if (hasCompleted(request.workflow, repoRoot)) {
    problems.push(
      `${request.workflow} has already completed in ${FINAL_LEDGER_REPO_PATH}; ` +
        'a locked evaluation is run exactly once and is never repeated for a better result',
    );
  }

  if (problems.length > 0) throw new FinalLockedProtocolError(problems);

  return {
    freezeCommit: head as string,
    workflow: request.workflow,
    dataset: request.dataset,
    repoRoot,
  };
}

export function recordStarted(approval: FinalLockedApproval, detail: string): void {
  appendLedger(
    {
      recordedAt: new Date().toISOString(),
      workflow: approval.workflow,
      status: 'started',
      freezeCommit: approval.freezeCommit,
      split: 'locked',
      dataset: approval.dataset,
      runId: null,
      detail,
    },
    approval.repoRoot,
  );
}

export function recordCompleted(
  approval: FinalLockedApproval,
  runId: string,
  detail: string,
): void {
  appendLedger(
    {
      recordedAt: new Date().toISOString(),
      workflow: approval.workflow,
      status: 'completed',
      freezeCommit: approval.freezeCommit,
      split: 'locked',
      dataset: approval.dataset,
      runId,
      detail,
    },
    approval.repoRoot,
  );
}

export function recordFailed(approval: FinalLockedApproval, detail: string): void {
  appendLedger(
    {
      recordedAt: new Date().toISOString(),
      workflow: approval.workflow,
      status: 'failed',
      freezeCommit: approval.freezeCommit,
      split: 'locked',
      dataset: approval.dataset,
      runId: null,
      detail,
    },
    approval.repoRoot,
  );
}
