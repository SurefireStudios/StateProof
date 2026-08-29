import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { SubmissionArtifactError, loadSubmissionView } from '@stateproof/submission';
import { buildDashboard } from '../src/build';
import { buildModel, evidenceTargets } from '../src/model';

/**
 * The dashboard's one job is to be trustworthy: every number on it must exist
 * in an artifact, every link must resolve, and it must refuse to render at all
 * when the artifacts it pins have changed. These tests hold it to that.
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

function buildInto(): { outDir: string; files: string[] } {
  const outDir = tempDir('stateproof-dash-');
  const files = buildDashboard(REPO_ROOT, outDir);
  return { outDir, files };
}

const built = buildInto();
const html = (fileName: string): string => readFileSync(path.join(built.outDir, fileName), 'utf8');
const allHtml = built.files
  .filter((file) => file.endsWith('.html'))
  .map((file) => html(file))
  .join('\n');

describe('the dashboard builds from artifacts alone', () => {
  it('produces every required view', () => {
    for (const file of [
      'index.html',
      'inspector.html',
      'benchmark.html',
      'changelog.html',
      'trajectories.html',
      'architecture.html',
      'styles.css',
      'app.js',
    ]) {
      expect(built.files).toContain(file);
    }
  });

  it('builds one inspector page per evaluated case', () => {
    const model = buildModel(REPO_ROOT);
    const pages = built.files.filter((file) => file.startsWith('inspector'));
    // Registry-driven: eight development cases, plus the four locked cases
    // once their one-time evaluation is on the record.
    const expected =
      model.view.manifest.replayCaseIds.length +
      (model.view.manifest.lockedReplayCaseIds ?? []).length;
    expect(pages).toHaveLength(expected);
    expect(model.cases).toHaveLength(expected);
    expect(model.view.manifest.replayCaseIds).toHaveLength(8);
  });

  it('needs no credential in the environment', () => {
    const outDir = tempDir('stateproof-dash-nocred-');
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env['STATEPROOF_ANTHROPIC_API_KEY'];
    delete env['ANTHROPIC_API_KEY'];
    const stdout = execFileSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.join(REPO_ROOT, 'apps', 'dashboard', 'src', 'build.ts'),
      ],
      { cwd: tempDir('stateproof-dash-cwd-'), env, encoding: 'utf8' },
    );
    expect(stdout).toContain('dashboard built');
    void outDir;
  });

  it('embeds no credential-shaped string and no .env content', () => {
    const bundleText = `${allHtml}\n${html('app.js')}\n${html('styles.css')}`;
    expect(bundleText).not.toMatch(/sk-ant-[A-Za-z0-9_-]{8,}/);
    expect(bundleText).not.toMatch(/STATEPROOF_ANTHROPIC_API_KEY\s*=\s*\S/);
    expect(built.files.some((file) => file.includes('.env'))).toBe(false);
  });
});

describe('displayed numbers come from report artifacts', () => {
  const model = buildModel(REPO_ROOT);

  it('shows the pinned cold and warm figures on the overview', () => {
    const overview = html('index.html');
    expect(model.cold.svr).toBe(1);
    expect(overview).toContain(`${(model.cold.svr! * 100).toFixed(1)}%`);
    expect(overview).toContain(`${model.warm.modelCalls}`);
    expect(overview).toContain(model.warm.canonicalPredictionSha256.slice(0, 16));
  });

  it('renders each comparison run with its own report metrics', () => {
    const benchmark = html('benchmark.html');
    for (const run of model.comparisonRuns) {
      expect(benchmark).toContain(run.registered.label);
      if (run.svr !== null) expect(benchmark).toContain(`${(run.svr * 100).toFixed(1)}%`);
    }
    // The two failed iterations must still be visible, marked as not met.
    expect(benchmark).toContain('NOT MET');
  });

  it('never invents a metric for a run that did not measure one', () => {
    // The Core-12 baseline predates requirement-level metrics.
    expect(model.coreBaseline?.svr ?? null).toBeNull();
    expect(model.coreBaseline?.guardrailsMet).toBe(false);
  });
});

describe('links and evidence resolve', () => {
  const model = buildModel(REPO_ROOT);

  it('resolves every evidence reference to something on the page', () => {
    for (const caseView of model.cases) {
      const fileName = caseView.caseId === model.defaultCaseId ? 'inspector.html' : `inspector-${caseView.caseId}.html`;
      const markup = html(fileName);
      const ids = new Set([...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
      for (const requirement of caseView.requirements) {
        for (const ref of requirement.evidenceRefs) {
          const targets = evidenceTargets(ref);
          expect(targets.length, `${caseView.caseId} ${ref}`).toBeGreaterThan(0);
          expect(targets.some((target) => ids.has(target)), `${caseView.caseId} ${ref}`).toBe(true);
        }
      }
    }
  });

  it('points every internal navigation link at a generated page', () => {
    const generated = new Set(built.files);
    for (const file of built.files.filter((name) => name.endsWith('.html'))) {
      const markup = html(file);
      for (const match of markup.matchAll(/href="([^"#]+)(?:#[^"]*)?"/g)) {
        const href = match[1] ?? '';
        if (href.startsWith('../../') || href.startsWith('http')) continue;
        expect(generated, `${file} → ${href}`).toContain(href);
      }
    }
  });

  it('points every artifact link at a file that exists', () => {
    for (const file of built.files.filter((name) => name.endsWith('.html'))) {
      for (const match of html(file).matchAll(/href="\.\.\/\.\.\/([^"#]+)/g)) {
        const target = path.join(REPO_ROOT, match[1] ?? '');
        expect(readdirSync(path.dirname(target)), `${file} → ${match[1]}`).toContain(
          path.basename(target),
        );
      }
    }
  });

  it('links every changelog row to a real report, manifest or prompt', () => {
    const changelog = html('changelog.html');
    const links = [...changelog.matchAll(/href="\.\.\/\.\.\/([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(links.length).toBeGreaterThanOrEqual(18);
    for (const link of links) {
      expect(readdirSync(path.join(REPO_ROOT, path.dirname(link)))).toContain(path.basename(link));
    }
  });

  it('links every trajectory to its raw response and its prompt', () => {
    const trajectories = html('trajectories.html');
    expect(trajectories).toContain('prompts/contract-agent/v3.md');
    expect(trajectories).toContain('prompts/baseline-evaluator/v2.md');
    const rawLinks = [...trajectories.matchAll(/href="\.\.\/\.\.\/(artifacts\/model-responses\/[^"]+)"/g)];
    expect(rawLinks.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the dashboard refuses tampered or missing artifacts', () => {
  /** A throwaway copy of the repository's artifact surface. */
  function scratchRepo(): string {
    const root = tempDir('stateproof-dash-tamper-');
    for (const dir of ['artifacts', 'submission', 'prompts', 'benchmarks']) {
      cpSync(path.join(REPO_ROOT, dir), path.join(root, dir), { recursive: true });
    }
    return root;
  }

  it('loads cleanly from an untouched copy', () => {
    expect(() => loadSubmissionView({ repoRoot: scratchRepo() })).not.toThrow();
  });

  it('fails visibly when a pinned report is missing', () => {
    const root = scratchRepo();
    const registry = JSON.parse(
      readFileSync(path.join(root, 'submission', 'reproduction-manifest.json'), 'utf8'),
    ) as { runs: Array<{ reportJsonPath: string }> };
    rmSync(path.join(root, registry.runs[0]?.reportJsonPath ?? ''), { force: true });
    expect(() => loadSubmissionView({ repoRoot: root })).toThrow(SubmissionArtifactError);
  });

  it('fails visibly when a prediction has been edited', () => {
    const root = scratchRepo();
    const registry = JSON.parse(
      readFileSync(path.join(root, 'submission', 'reproduction-manifest.json'), 'utf8'),
    ) as { replayTargetRunId: string; runs: Array<{ id: string; predictionPath: string }> };
    const target = registry.runs.find((run) => run.id === registry.replayTargetRunId);
    const predictionPath = path.join(root, target?.predictionPath ?? '');
    const predictions = JSON.parse(readFileSync(predictionPath, 'utf8')) as {
      predictions: Array<{ prediction: { verdict: string } }>;
    };
    const first = predictions.predictions[0];
    // Flip it to something it is not, so the edit is genuinely an edit.
    if (first !== undefined) {
      first.prediction.verdict = first.prediction.verdict === 'PASS' ? 'FAIL' : 'PASS';
    }
    writeFileSync(predictionPath, JSON.stringify(predictions, null, 2), 'utf8');

    expect(() => loadSubmissionView({ repoRoot: root })).toThrow(/predictions changed/);
  });

  it('fails visibly when a compiled contract has been rewritten', () => {
    const root = scratchRepo();
    const registry = JSON.parse(
      readFileSync(path.join(root, 'submission', 'reproduction-manifest.json'), 'utf8'),
    ) as { contractBundles: Array<{ contracts: Array<{ path: string }> }> };
    const contractPath = path.join(root, registry.contractBundles[0]?.contracts[0]?.path ?? '');
    const artifact = JSON.parse(readFileSync(contractPath, 'utf8')) as {
      contract: { taskSummary: string };
    };
    artifact.contract.taskSummary = 'quietly rewritten';
    writeFileSync(contractPath, JSON.stringify(artifact, null, 2), 'utf8');

    expect(() => loadSubmissionView({ repoRoot: root })).toThrow(/has been modified/);
  });

  it('fails visibly when a pinned prompt changes', () => {
    const root = scratchRepo();
    writeFileSync(path.join(root, 'prompts', 'contract-agent', 'v3.md'), 'edited\n', 'utf8');
    expect(() => loadSubmissionView({ repoRoot: root })).toThrow(/has changed/);
  });
});

describe('the registry never reaches a locked case', () => {
  it('registers a locked run only under a locked role', () => {
    const model = buildModel(REPO_ROOT);
    for (const run of model.view.runs) {
      const lockedRole =
        run.registered.role === 'baseline-hard-locked' ||
        run.registered.role === 'stateproof-v3-locked';
      expect(run.registered.split === 'locked').toBe(lockedRole);
    }
  });

  it('keeps locked ids out of the replay set', () => {
    const model = buildModel(REPO_ROOT);
    const locked = new Set(model.view.manifest.lockedCaseIds);
    const evaluated = new Set(model.view.manifest.lockedReplayCaseIds ?? []);
    expect(locked.size).toBeGreaterThan(0);
    for (const caseId of model.view.manifest.replayCaseIds) expect(locked.has(caseId)).toBe(false);
    for (const caseView of model.cases) {
      if (!locked.has(caseView.caseId)) continue;
      expect(evaluated.has(caseView.caseId), caseView.caseId).toBe(true);
    }
  });

  it('renders only the locked cases whose evaluation is on the record', () => {
    const model = buildModel(REPO_ROOT);
    const evaluated = new Set(model.view.manifest.lockedReplayCaseIds ?? []);
    for (const caseId of model.view.manifest.lockedCaseIds) {
      if (evaluated.has(caseId)) continue;
      // A locked case that has not been run must not appear anywhere: the site
      // would otherwise describe a measurement that never happened.
      expect(allHtml, caseId).not.toContain(caseId);
    }
  });
});
