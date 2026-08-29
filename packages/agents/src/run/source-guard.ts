import { execFileSync } from 'node:child_process';
import { sha256Hex } from '@stateproof/core';
import { REPO_ROOT } from '@stateproof/benchmark';

/**
 * A live benchmark run must be reproducible from a commit.
 *
 * Gate 3A's run happened before its own source was committed, so its manifest
 * points at the previous HEAD and nothing in the repository proves which code
 * produced the numbers. That is a provenance hole, not a formatting problem:
 * a result nobody can re-derive is a claim, not a measurement. So every live
 * run from Gate 3B onwards refuses to start unless the tracked tree matches
 * HEAD exactly, and the manifest records the commit it ran from.
 *
 * Generated artifacts and the ignored `.env` are exempt — they are outputs and
 * secrets, not inputs to the result.
 */

/** Untracked paths that do not affect what the run computes. */
const EXEMPT_UNTRACKED_PREFIXES = ['artifacts/'] as const;

/**
 * Generated evaluation records, exempt whether tracked or not.
 *
 * The final-evaluation ledger is appended to *by the run itself*, so a second
 * locked workflow would otherwise find the tree dirty because the first one
 * recorded that it happened. It is an output, not an input: nothing about what
 * a run computes depends on it.
 */
const EXEMPT_PATHS = ['submission/final-evaluation-ledger.jsonl'] as const;

export interface SourceTreeStatus {
  readonly commitSha: string | null;
  readonly clean: boolean;
  /** Tracked modifications and non-exempt untracked files, sorted. */
  readonly offending: string[];
}

export class DirtySourceTreeError extends Error {
  public readonly status: SourceTreeStatus;

  public constructor(status: SourceTreeStatus) {
    super(
      [
        'Refusing to start a live run: the tracked source tree differs from HEAD.',
        '',
        'A live result must be re-derivable from a commit. Commit or stash these first:',
        ...status.offending.map((entry) => `  - ${entry}`),
        '',
      ].join('\n'),
    );
    this.name = 'DirtySourceTreeError';
    this.status = status;
  }
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' });
}

/**
 * Reads the working-tree status. `git status --porcelain` already omits files
 * matched by `.gitignore`, so an ignored `.env` can never appear here — the
 * guard never has to read or name it.
 */
export function inspectSourceTree(repoRoot: string = REPO_ROOT): SourceTreeStatus {
  let commitSha: string | null = null;
  let porcelain: string;
  try {
    commitSha = git(['rev-parse', 'HEAD'], repoRoot).trim();
    // -uall lists untracked files individually; the default collapses a new
    // directory to one entry, which would hide what is actually inside it.
    porcelain = git(['status', '--porcelain', '--untracked-files=all'], repoRoot);
  } catch {
    // No git available, or no repository: report unknown rather than clean.
    return { commitSha: null, clean: false, offending: ['git status is unavailable'] };
  }

  const offending: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (line.trim() === '') continue;
    const code = line.slice(0, 2);
    const target = line.slice(3).trim().replace(/^"|"$/g, '');
    // A rename prints "old -> new"; the destination is what matters.
    const filePath = target.includes(' -> ') ? (target.split(' -> ')[1] ?? target) : target;
    if (EXEMPT_PATHS.some((exempt) => filePath === exempt)) continue;
    if (
      code === '??' &&
      EXEMPT_UNTRACKED_PREFIXES.some((prefix) => filePath.startsWith(prefix))
    ) {
      continue;
    }
    offending.push(`${code.trim()} ${filePath}`);
  }
  offending.sort();

  return { commitSha, clean: offending.length === 0, offending };
}

export function assertCleanSourceTree(repoRoot: string = REPO_ROOT): SourceTreeStatus {
  const status = inspectSourceTree(repoRoot);
  if (!status.clean) throw new DirtySourceTreeError(status);
  return status;
}

/**
 * Hashes a file as it exists at a commit, so a manifest's prompt hash can be
 * checked against the committed prompt rather than the current one.
 */
export function fileHashAtCommit(
  commitSha: string,
  repoRelativePath: string,
  repoRoot: string = REPO_ROOT,
): string | null {
  try {
    return sha256Hex(git(['show', `${commitSha}:${repoRelativePath}`], repoRoot));
  } catch {
    return null;
  }
}

export interface PromptProvenanceProblem {
  readonly promptPath: string;
  readonly expectedHash: string;
  readonly actualHash: string | null;
}

/**
 * Proves every prompt hash in a manifest matches that prompt file at the
 * manifest's own recorded commit. An empty result is the passing case.
 */
export function checkPromptProvenance(
  manifest: {
    readonly gitCommitSha: string | null;
    readonly promptFilePaths: readonly string[];
    readonly promptHashes: Readonly<Record<string, string>>;
  },
  repoRoot: string = REPO_ROOT,
): PromptProvenanceProblem[] {
  const problems: PromptProvenanceProblem[] = [];
  const commitSha = manifest.gitCommitSha;
  for (const promptPath of manifest.promptFilePaths) {
    const expectedHash = manifest.promptHashes[promptPath];
    if (expectedHash === undefined) continue;
    const actualHash =
      commitSha === null ? null : fileHashAtCommit(commitSha, promptPath, repoRoot);
    if (actualHash !== expectedHash) problems.push({ promptPath, expectedHash, actualHash });
  }
  return problems;
}
