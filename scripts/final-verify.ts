import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `pnpm final:verify`
 *
 * One command that runs everything a reviewer would run, with both credential
 * variables removed from the environment so no step can reach a model even by
 * accident. Each underlying command is still available on its own; this only
 * sequences them and fails on the first thing that breaks.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

interface Step {
  readonly name: string;
  readonly command: string;
  readonly what: string;
}

const STEPS: Step[] = [
  { name: 'typecheck', command: 'pnpm typecheck', what: 'TypeScript strict, workspace and product client' },
  { name: 'tests', command: 'pnpm test', what: 'unit and integration suites' },
  { name: 'core-12', command: 'pnpm benchmark:validate', what: 'Core-12 fixture validation' },
  { name: 'hard-12', command: 'pnpm benchmark:validate-hard', what: 'Hard-12 fixture validation' },
  { name: 'reproduce', command: 'pnpm reproduce', what: 'credential-free replay of all 12 cases' },
  { name: 'artifacts', command: 'pnpm reproduce:check', what: 'submission artifact integrity and provenance' },
  { name: 'dashboard', command: 'pnpm dashboard:build', what: 'static evidence dashboard build' },
  { name: 'sample', command: 'pnpm sample:build', what: 'sample run package' },
  { name: 'product-build', command: 'pnpm product:build', what: 'interactive product build' },
  { name: 'product-tests', command: 'pnpm product:test', what: 'product test suite' },
  { name: 'secrets', command: 'pnpm scan:secrets', what: 'credential, key and local-path scan' },
];

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['STATEPROOF_ANTHROPIC_API_KEY'];
  delete env['ANTHROPIC_API_KEY'];
  return env;
}

function lastLines(text: string, lines = 12): string {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-lines)
    .join('\n');
}

function run(command: string): { ok: boolean; ms: number; tail: string } {
  const startedMs = Date.now();
  try {
    const output = execFileSync(command, {
      cwd: REPO_ROOT,
      env: cleanEnv(),
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
      tail: lastLines(`${failure.stdout ?? ''}\n${failure.stderr ?? ''}`),
    };
  }
}

// --- link and path checks ---------------------------------------------------

/** Markdown files a reader is actually pointed at. Reports are historical. */
function documentationFiles(): string[] {
  return execFileSync('git', ['ls-files', '*.md'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((file) => !file.startsWith('artifacts/'));
}

const LINK_PATTERN = /\[[^\]]*\]\(([^)]+)\)/g;

interface LinkProblem {
  readonly file: string;
  readonly target: string;
  readonly reason: string;
}

function checkLinks(): LinkProblem[] {
  const problems: LinkProblem[] = [];
  for (const file of documentationFiles()) {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    for (const match of text.matchAll(LINK_PATTERN)) {
      const raw = (match[1] ?? '').trim();
      if (raw === '' || /^(?:https?:|mailto:|#)/.test(raw)) continue;
      const target = (raw.split('#')[0] ?? '').trim();
      if (target === '') continue;
      const resolved = path.resolve(path.dirname(path.join(REPO_ROOT, file)), target);
      if (!resolved.startsWith(REPO_ROOT)) {
        problems.push({ file, target: raw, reason: 'points outside the repository' });
        continue;
      }
      if (!existsSync(resolved)) {
        problems.push({ file, target: raw, reason: 'does not exist' });
        continue;
      }
      // A link to a directory must name it as one, or a static host resolves it
      // differently from a local Markdown viewer.
      if (statSync(resolved).isDirectory() && !target.endsWith('/')) {
        problems.push({ file, target: raw, reason: 'is a directory but has no trailing slash' });
      }
    }
  }
  return problems;
}

/** The documentation set the gate requires, at the paths it requires. */
const REQUIRED_DOCS = [
  'README.md',
  'REPRODUCTION.md',
  'IMPROVEMENT_CHANGELOG.md',
  'PREEXISTING_WORK.md',
  'LICENSE',
  'docs/project-brief.md',
  'docs/evaluation-plan.md',
  'docs/architecture.md',
  'docs/product-application.md',
  'docs/limitations.md',
  'docs/security-and-data.md',
  'docs/claims-evidence-map.md',
  'docs/agent-prompts.md',
  'docs/judge-quick-start.md',
  'docs/video-script.md',
  'docs/video-shot-list.md',
];

function checkRequiredDocs(): string[] {
  return REQUIRED_DOCS.filter((file) => !existsSync(path.join(REPO_ROOT, file)));
}

function main(): void {
  process.stdout.write('StateProof — final verification\n');
  process.stdout.write('no credential is present in this environment; no step contacts a model\n\n');

  const results: Array<{ step: Step; ok: boolean; ms: number; tail: string }> = [];
  let failed = false;

  for (const step of STEPS) {
    process.stdout.write(`  ${step.name.padEnd(14)} ${step.what}\n`);
    const result = run(step.command);
    results.push({ step, ...result });
    process.stdout.write(
      `  ${result.ok ? 'ok  ' : 'FAIL'} ${step.name.padEnd(14)} ${(result.ms / 1000).toFixed(1)}s\n\n`,
    );
    if (!result.ok) {
      process.stdout.write(`${result.tail}\n\n`);
      failed = true;
      break;
    }
  }

  let linkProblems: LinkProblem[] = [];
  let missingDocs: string[] = [];
  if (!failed) {
    process.stdout.write('  links          documentation links and required documents\n');
    linkProblems = checkLinks();
    missingDocs = checkRequiredDocs();
    const linksOk = linkProblems.length === 0 && missingDocs.length === 0;
    process.stdout.write(`  ${linksOk ? 'ok  ' : 'FAIL'} links\n\n`);
    for (const problem of linkProblems) {
      process.stdout.write(`      ${problem.file} -> ${problem.target} ${problem.reason}\n`);
    }
    for (const missing of missingDocs) {
      process.stdout.write(`      missing required document: ${missing}\n`);
    }
    if (!linksOk) {
      process.stdout.write('\n');
      failed = true;
    }
  }

  process.stdout.write('\n');
  for (const result of results) {
    process.stdout.write(
      `  ${result.ok ? 'PASS' : 'FAIL'}  ${result.step.name.padEnd(14)} ${(result.ms / 1000).toFixed(1)}s\n`,
    );
  }
  if (results.length === STEPS.length) {
    process.stdout.write(
      `  ${linkProblems.length === 0 && missingDocs.length === 0 ? 'PASS' : 'FAIL'}  ${'links'.padEnd(14)}\n`,
    );
  }

  const totalMs = results.reduce((sum, result) => sum + result.ms, 0);
  process.stdout.write(`\n  total ${(totalMs / 1000).toFixed(1)}s\n`);
  process.stdout.write(`\nRESULT: ${failed ? 'FAILED' : 'PASSED'}\n`);
  if (failed) process.exitCode = 1;
}

main();
