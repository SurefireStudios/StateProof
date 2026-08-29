import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_JS, STYLES } from './assets';
import { buildModel } from './model';
import { renderArchitecture } from './pages/architecture';
import { renderBenchmark } from './pages/benchmark';
import { renderChangelog } from './pages/changelog';
import { inspectorFileName, renderInspector } from './pages/inspector';
import { renderOverview } from './pages/overview';
import { renderTrajectories } from './pages/trajectories';

/**
 * `pnpm dashboard:build`
 *
 * A pure function from checked-in artifacts to a static site. No credentials,
 * no network, no runtime: if the artifacts are present and consistent the build
 * succeeds, and if they are not it fails loudly rather than rendering something
 * plausible.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT_DIR = path.join(REPO_ROOT, 'apps', 'dashboard', 'dist');

export function buildDashboard(repoRoot: string = REPO_ROOT, outDir: string = OUT_DIR): string[] {
  const model = buildModel(repoRoot);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const written: string[] = [];
  const write = (fileName: string, content: string): void => {
    writeFileSync(path.join(outDir, fileName), content, 'utf8');
    written.push(fileName);
  };

  write('styles.css', STYLES);
  write('app.js', APP_JS);
  write('index.html', renderOverview(model));
  write('benchmark.html', renderBenchmark(model));
  write('changelog.html', renderChangelog(model));
  write('trajectories.html', renderTrajectories(model, repoRoot));
  write('architecture.html', renderArchitecture(model));
  for (const caseView of model.cases) {
    write(inspectorFileName(caseView.caseId, model.defaultCaseId), renderInspector(model, caseView));
  }
  return written;
}

function main(): void {
  const written = buildDashboard();
  process.stdout.write(`dashboard built: ${written.length} file(s)\n`);
  for (const file of written) process.stdout.write(`  ${file}\n`);
  process.stdout.write(`\noutput: ${path.relative(REPO_ROOT, OUT_DIR)}\n`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('build.ts')) main();
