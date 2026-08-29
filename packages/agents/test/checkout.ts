import { execFileSync } from 'node:child_process';

/**
 * Whether these tests are running inside a git checkout.
 *
 * The suite also runs inside an *extracted release package*, which is a plain
 * directory: `pnpm test` there is part of proving the archive. Assertions about
 * a clean tree, tracked files, or a blob at a commit have nothing to compare
 * against in that context — and the archive was built from a clean tree at a
 * named commit in the first place, so the property they guard was already
 * established before the files got there.
 *
 * They are skipped rather than made to pass, so the reason is visible in the
 * run output instead of hidden behind an exception handler.
 */
export function inCheckout(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
