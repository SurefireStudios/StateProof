import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { platform, release, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toJsonValue } from '@stateproof/core';
import { readZip, writeZip } from '../apps/product/src/server/zip';

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
const DASHBOARD_DIST = path.join(REPO_ROOT, 'apps', 'dashboard', 'dist');
const PRODUCT_DIST = path.join(REPO_ROOT, 'apps', 'product', 'dist');

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

function readVersion(command: string): string {
  try {
    return execFileSync(command, { cwd: REPO_ROOT, encoding: 'utf8', shell: true }).trim();
  } catch {
    return 'unknown';
  }
}

interface PackageManifest {
  package: { path: string; sha256: string; sizeBytes: number; sizeMb: number; sourceCommit: string };
  environment: { os: string; node: string; pnpm: string; installDurationMs: number | null };
  contents: {
    fileCount: number;
    topLevelPaths: string[];
    dashboardPages: string[];
    productFiles: string[];
    includesSampleRunPackage: boolean;
  };
  excluded: string[];
  verification: { result: string };
}

/** `release/CONTENTS.md` — what is in the archive and how it was proved. */
function renderContents(
  manifest: PackageManifest,
  steps: ReadonlyArray<{ command: string; ok: boolean; ms: number }>,
): string {
  const lines: string[] = [
    '# StateProof — submission package',
    '',
    `| | |`,
    `| --- | --- |`,
    `| Archive | \`${manifest.package.path}\` |`,
    `| SHA-256 | \`${manifest.package.sha256}\` |`,
    `| Size | ${manifest.package.sizeMb} MB (${manifest.package.sizeBytes} bytes) |`,
    `| Files | ${manifest.contents.fileCount} |`,
    `| Source commit | \`${manifest.package.sourceCommit}\` |`,
    `| Built on | ${manifest.environment.os}, Node ${manifest.environment.node}, pnpm ${manifest.environment.pnpm} |`,
    '',
    '## What is inside',
    '',
    'The include list is `git archive` at the source commit — every tracked file,',
    'and nothing untracked — plus both prebuilt surfaces so the package runs',
    'without a build step.',
    '',
    ...manifest.contents.topLevelPaths.map((entry) => `- \`${entry}\``),
    '',
    `Prebuilt dashboard: ${manifest.contents.dashboardPages.length} file(s).`,
    `Prebuilt product: ${manifest.contents.productFiles.join(', ')}.`,
    `Sample run package: ${manifest.contents.includesSampleRunPackage ? 'included' : 'MISSING'}.`,
    '',
    '## What is excluded',
    '',
    ...manifest.excluded.map((entry) => `- ${entry}`),
    '',
    '## How this package was proved',
    '',
    'It was extracted into a fresh temporary directory outside the source tree,',
    'with `STATEPROOF_ANTHROPIC_API_KEY` and `ANTHROPIC_API_KEY` removed from the',
    'environment, and the whole offline workflow was run there:',
    '',
    '| Step | Result | Duration |',
    '| --- | --- | --- |',
    ...steps.map(
      (step) => `| \`${step.command}\` | ${step.ok ? 'passed' : 'FAILED'} | ${(step.ms / 1000).toFixed(1)} s |`,
    ),
    '',
    `Install took ${((manifest.environment.installDurationMs ?? 0) / 1000).toFixed(1)} s.`,
    '',
    `**RESULT: ${manifest.verification.result}**`,
    '',
    '## Verifying the archive',
    '',
    '```bash',
    'sha256sum -c stateproof-submission-final.sha256',
    '```',
    '',
    'Then extract it and follow `docs/judge-quick-start.md`.',
    '',
  ];
  return lines.join('\n');
}

/**
 * Archives are read and written in-process rather than by shelling out.
 *
 * `tar` on Windows is either GNU tar, which cannot read a ZIP at all, or bsdtar,
 * which reads `-f C:\path\to.zip` as a remote archive on host `C`. Both were hit
 * here. The repository already owns a defensive ZIP reader and a writer, so the
 * external binary buys nothing and costs portability.
 */
const PACKAGE_ZIP_LIMITS = {
  maxEntries: 20_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

function extractZip(zipPath: string, into: string): void {
  for (const entry of readZip(readFileSync(zipPath), PACKAGE_ZIP_LIMITS)) {
    const target = path.join(into, entry.name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.contents);
  }
}

function createZip(fromDir: string, zipPath: string): void {
  const entries = walk(fromDir).map((relative) => ({
    name: relative,
    contents: readFileSync(path.join(fromDir, relative)),
  }));
  writeFileSync(zipPath, writeZip(entries, { compress: true }));
}

async function main(): Promise<void> {
  for (const [dist, command] of [
    [DASHBOARD_DIST, 'pnpm dashboard:build'],
    [PRODUCT_DIST, 'pnpm product:build'],
  ] as const) {
    if (!existsSync(dist)) {
      throw new Error(`run \`${command}\` first: the package ships both prebuilt surfaces`);
    }
  }

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('??'));

  mkdirSync(RELEASE_DIR, { recursive: true });
  const zipPath = path.join(RELEASE_DIR, ZIP_NAME);
  rmSync(zipPath, { force: true });

  // Stage: tracked files at HEAD, plus both prebuilt surfaces for convenience.
  const staging = mkdtempSync(path.join(tmpdir(), 'stateproof-package-'));
  execFileSync('git', ['archive', '--format=zip', '-o', zipPath, head], { cwd: REPO_ROOT });
  extractZip(zipPath, staging);

  for (const [source, relative] of [
    [DASHBOARD_DIST, path.join('apps', 'dashboard', 'dist')],
    [PRODUCT_DIST, path.join('apps', 'product', 'dist')],
  ] as const) {
    const target = path.join(staging, relative);
    mkdirSync(target, { recursive: true });
    for (const file of readdirSync(source)) {
      writeFileSync(path.join(target, file), readFileSync(path.join(source, file)));
    }
  }

  rmSync(zipPath, { force: true });
  createZip(staging, zipPath);

  const digest = await sha256File(zipPath);
  const sizeBytes = statSync(zipPath).size;

  const included = walk(staging);
  const topLevel = [...new Set(included.map((entry) => entry.split('/')[0] ?? entry))].sort();

  // --- prove the package ---------------------------------------------------
  const extracted = mkdtempSync(path.join(tmpdir(), 'stateproof-extract-'));
  extractZip(zipPath, extracted);

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
    'pnpm sample:build',
    'pnpm product:build',
    'pnpm product:test',
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

  const shippedProduct = path.join(extracted, 'apps', 'product', 'dist');
  const productFiles = existsSync(shippedProduct) ? readdirSync(shippedProduct).sort() : [];
  const productOk = ['index.html', 'client.js', 'styles.css'].every((file) =>
    productFiles.includes(file),
  );

  const samplePath = path.join(extracted, 'samples', 'stateproof-sample-run.zip');
  const sampleOk = existsSync(samplePath);

  // `pnpm --dir <x> <script> <arg>` swallows the argument and prints help; the
  // cwd is already the repository, so `--dir` was redundant anyway.
  const scan = run(`pnpm scan:secrets "${extracted}"`, REPO_ROOT, env);
  if (!scan.ok) {
    // A scan failure with no detail is useless; the whole point is the finding.
    process.stdout.write(`
  secret scan findings:
${scan.tail}

`);
  }

  const passed = steps.every((step) => step.ok) && dashboardOk && productOk && sampleOk && scan.ok;

  const environment = {
    os: `${platform()} ${release()} (${arch()})`,
    node: process.version,
    pnpm: readVersion('pnpm --version'),
    installDurationMs: steps.find((step) => step.command.startsWith('pnpm install'))?.ms ?? null,
  };

  const manifest = {
    schemaVersion: '1.1.0',
    generatedAt: new Date().toISOString(),
    package: {
      path: `release/${ZIP_NAME}`,
      sha256: digest,
      sizeBytes,
      sizeMb: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
      sourceCommit: head,
      trackedTreeClean: dirty.length === 0,
    },
    environment,
    contents: {
      fileCount: included.length,
      topLevelPaths: topLevel,
      includesPrebuiltDashboard: shippedPages.length > 0,
      dashboardPages: shippedPages.sort(),
      includesPrebuiltProduct: productFiles.length > 0,
      productFiles,
      includesSampleRunPackage: sampleOk,
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
      productStructureOk: productOk,
      sampleRunPackagePresent: sampleOk,
      secretScanOk: scan.ok,
      result: passed ? 'PASSED' : 'FAILED',
    },
  };

  // The two files a reviewer checks before extracting anything.
  writeFileSync(
    path.join(RELEASE_DIR, `${ZIP_NAME.replace(/\.zip$/, '')}.sha256`),
    `${digest}  ${ZIP_NAME}\n`,
    'utf8',
  );
  writeFileSync(path.join(RELEASE_DIR, 'CONTENTS.md'), renderContents(manifest, steps), 'utf8');

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

  for (const directory of [staging, extracted]) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    } catch {
      process.stdout.write(`note: could not remove ${directory}; delete it manually.\n`);
    }
  }

  if (!passed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
