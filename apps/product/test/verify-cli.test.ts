import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `pnpm verify` end to end, as a shell caller experiences it.
 *
 * The point of the command is that an evaluation pipeline can trust its exit code and
 * its evidence pack without driving the import screen, so these run the real binary
 * rather than calling into the module: an exit code is only worth asserting if the
 * process actually produced it.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SAMPLE = path.join(REPO_ROOT, 'samples', 'stateproof-sample-run.zip');

function runVerify(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/verify.ts', ...args],
    { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env } },
  );
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('pnpm verify', () => {

  it('verifies the sample package and writes both evidence files', () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'stateproof-verify-')), 'evidence');
    const result = runVerify([SAMPLE, '--out', out]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('verdict:  PASS');
    // The contract is not in the package; it is matched by task fingerprint, which is
    // the path a pipeline hits when it verifies a run of one of the frozen tasks.
    expect(result.stdout).toContain('contract: frozen');

    const written = result.stdout.match(/evidence-(\S+)\.json/);
    expect(written).not.toBeNull();
    const runId = written?.[1] ?? '';
    const jsonPath = path.join(out, `evidence-${runId}.json`);
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(path.join(out, `evidence-${runId}.md`))).toBe(true);

    // The same pack the product exports, not a second rendering of the same idea.
    const pack = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
      schemaVersion: string;
      verdict: string;
      usage: { verificationModelCalls: number };
      requirements: unknown[];
    };
    expect(pack.schemaVersion).toBe('1.0.0');
    expect(pack.verdict).toBe('PASS');
    expect(pack.requirements).toHaveLength(4);
    // The product's central claim: verification itself calls no model.
    expect(pack.usage.verificationModelCalls).toBe(0);
  });

  it('reports an unreadable package field by field and exits 2', () => {
    const broken = path.join(mkdtempSync(path.join(tmpdir(), 'stateproof-verify-')), 'broken.zip');
    writeFileSync(broken, 'not an archive', 'utf8');

    const result = runVerify([broken]);

    // 2, not 1: a caller has to be able to tell a bad invocation from a failed run.
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('This run package did not validate.');
    expect(result.stderr).toContain('archive:');
  });

  it('refuses to compile a missing contract rather than reaching for a model', () => {
    // A contract path that does not resolve is the closest reachable stand-in for a
    // package with no contract and no fingerprint match; either way the command must
    // stop rather than fall back to compilation.
    const result = runVerify([SAMPLE, '--contract', path.join(REPO_ROOT, 'no-such-contract.json')]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('no-such-contract.json');
  });

  it('prints usage and exits cleanly for --help', () => {
    const result = runVerify(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pnpm verify <run-package.zip>');
    expect(result.stdout).toContain('--fail-on-needs-review');
  });

  it('rejects an unknown option instead of ignoring it', () => {
    const result = runVerify([SAMPLE, '--not-an-option']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown option --not-an-option');
  });
});
