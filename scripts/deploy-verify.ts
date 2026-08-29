import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `pnpm deploy:verify`
 *
 * Builds the production application, starts it exactly the way the container
 * does — `node` on the bundle, no TypeScript loader — with both credential
 * variables removed, and exercises every route a judge will touch.
 *
 * It is the difference between "the code looks deployable" and "the deployed
 * thing answers". Everything it asserts is something a visitor would notice.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number.parseInt(process.env['STATEPROOF_VERIFY_PORT'] ?? '4199', 10);
const BASE = `http://127.0.0.1:${String(PORT)}`;

let failures = 0;
let checks = 0;

function ok(label: string, detail = ''): void {
  checks += 1;
  process.stdout.write(`  ok    ${label.padEnd(44)} ${detail}\n`);
}

function fail(label: string, detail: string): void {
  checks += 1;
  failures += 1;
  process.stdout.write(`  FAIL  ${label.padEnd(44)} ${detail}\n`);
}

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) ok(label, detail);
  else fail(label, detail === '' ? 'condition not met' : detail);
}

function run(command: string): void {
  execFileSync(command, {
    cwd: REPO_ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The environment the public deployment actually has: no credential at all. */
function productionEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['STATEPROOF_ANTHROPIC_API_KEY'];
  delete env['ANTHROPIC_API_KEY'];
  return {
    ...env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    STATEPROOF_ENABLE_LIVE_COMPILATION: 'false',
  };
}

async function waitForHealth(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

interface Json {
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
  readonly contentType: string;
}

async function get(pathname: string, init?: RequestInit): Promise<Json> {
  const response = await fetch(`${BASE}${pathname}`, { redirect: 'manual', ...init });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return {
    status: response.status,
    body,
    text,
    contentType: response.headers.get('content-type') ?? '',
  };
}

async function post(pathname: string, payload: unknown = {}): Promise<Json> {
  return get(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function main(): Promise<void> {
  process.stdout.write('StateProof — deployment verification\n');
  process.stdout.write('production build, started on node with no Anthropic credential\n\n');

  process.stdout.write('  building\n');
  for (const command of [
    'pnpm product:build',
    'pnpm dashboard:build',
    'pnpm sample:build',
    'pnpm product:server:build',
  ]) {
    run(command);
    process.stdout.write(`  ok    ${command}\n`);
  }
  process.stdout.write('\n');

  const bundle = path.join(REPO_ROOT, 'apps', 'product', 'dist-server', 'index.js');
  check('server bundle exists', existsSync(bundle), 'apps/product/dist-server/index.js');

  const child: ChildProcess = spawn(process.execPath, [bundle], {
    cwd: REPO_ROOT,
    env: productionEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString('utf8')));

  try {
    check('server becomes healthy', await waitForHealth(), `${BASE}/healthz`);

    // --- health -------------------------------------------------------------
    const health = await get('/healthz');
    const healthBody = health.body as Record<string, unknown> | null;
    check('/healthz returns 200', health.status === 200, String(health.status));
    check(
      '/healthz reports deterministic mode',
      healthBody?.['status'] === 'ok' &&
        healthBody?.['service'] === 'stateproof' &&
        healthBody?.['mode'] === 'deterministic',
      JSON.stringify(healthBody),
    );
    check(
      '/healthz reports live compilation off',
      healthBody?.['liveCompilation'] === false,
      'liveCompilation must be false on a public deployment',
    );
    check(
      '/healthz leaks no path or environment',
      !/[A-Za-z]:\\|\/home\/|\/Users\/|API_KEY/.test(health.text),
      health.text,
    );

    // --- pages --------------------------------------------------------------
    for (const route of ['/', '/demo', '/import', '/benchmark']) {
      const page = await get(route);
      check(
        `${route} serves the application shell`,
        page.status === 200 && page.text.includes('id="app"'),
        String(page.status),
      );
    }

    const evidence = await get('/evidence/');
    check(
      '/evidence/ serves the dashboard',
      evidence.status === 200 && evidence.text.includes('StateProof'),
      String(evidence.status),
    );
    check(
      '/evidence/ keeps its relative assets',
      evidence.text.includes('href="styles.css"') && evidence.text.includes('logo.svg'),
      'stylesheet and mark must resolve under the mount point',
    );
    check(
      '/evidence/ navigates back to the product',
      evidence.text.includes('<a class="brand" href="../">'),
      'the wordmark must lead to the product home',
    );
    const evidenceAsset = await get('/evidence/styles.css');
    check('/evidence/styles.css resolves', evidenceAsset.status === 200, String(evidenceAsset.status));

    // --- api ----------------------------------------------------------------
    const demo = await get('/api/demo');
    const demoBody = demo.body as Record<string, unknown> | null;
    check('/api/demo returns the demo case', demo.status === 200 && demoBody?.['caseId'] === 'PBH-B03');

    const verified = await post('/api/verify/demo');
    const run = verified.body as Record<string, unknown> | null;
    check('demo verification succeeds', verified.status === 200, String(verified.status));
    check(
      'demo verification is deterministic',
      run?.['mode'] === 'deterministic',
      String(run?.['mode']),
    );
    check(
      'demo verification makes zero model calls',
      run?.['modelCalls'] === 0 && run?.['modelTokens'] === 0,
      `calls ${String(run?.['modelCalls'])}, tokens ${String(run?.['modelTokens'])}`,
    );
    // The verdict is whatever the verifier produced; the check is that it ran.
    check(
      'demo verification produced requirements',
      Array.isArray(run?.['requirements']) && (run?.['requirements'] as unknown[]).length > 0,
      `verdict ${String(run?.['verdict'])}`,
    );

    const runId = String(run?.['runId'] ?? '');
    const json = await get(`/api/runs/${runId}/export?format=json`);
    check('JSON evidence export downloads', json.status === 200 && json.text.length > 1000);
    const markdown = await get(`/api/runs/${runId}/export?format=md`);
    check(
      'Markdown evidence export downloads',
      markdown.status === 200 && markdown.text.includes('#'),
      String(markdown.status),
    );
    check(
      'exports carry no credential or local path',
      !/sk-ant-|API_KEY|[A-Za-z]:\\Users\\|\/home\//.test(`${json.text}${markdown.text}`),
      'export contents',
    );

    // --- the sample import a judge can click ---------------------------------
    const sample = await post('/api/import/sample');
    const imported = sample.body as Record<string, unknown> | null;
    check('sample import validates', sample.status === 200, String(sample.status));
    check(
      'sample import matches a frozen contract',
      imported?.['contractStatus'] === 'matched-frozen-contract',
      String(imported?.['contractStatus']),
    );
    const sampleRun = await post('/api/verify', {
      importId: String(imported?.['importId'] ?? ''),
      contractSource: 'frozen',
    });
    const sampleView = sampleRun.body as Record<string, unknown> | null;
    check('sample run verifies', sampleRun.status === 200, String(sampleRun.status));
    check(
      'sample verification makes zero model calls',
      sampleView?.['modelCalls'] === 0 && sampleView?.['modelTokens'] === 0,
      `verdict ${String(sampleView?.['verdict'])}`,
    );

    // --- the capability that must stay off -----------------------------------
    const status = await get('/api/compile-status');
    const compile = status.body as Record<string, unknown> | null;
    check('live compilation reports unavailable', compile?.['available'] === false);
    const attempt = await post('/api/contracts/compile', { importId: 'anything' });
    check(
      'live compilation refuses with a clear reason',
      attempt.status === 501 && /disabled/i.test(attempt.text),
      `${String(attempt.status)} ${attempt.text.slice(0, 80)}`,
    );

    // --- headers and error shape ---------------------------------------------
    const home = await fetch(`${BASE}/`);
    check(
      'security headers survive the production build',
      (home.headers.get('content-security-policy') ?? '').includes("default-src 'none'") &&
        home.headers.get('x-content-type-options') === 'nosniff' &&
        home.headers.get('referrer-policy') === 'no-referrer',
    );
    const missing = await get('/api/definitely-not-a-route');
    check('unknown API paths 404 as JSON', missing.status === 404 && missing.body !== null);
    const notFound = await get('/definitely-not-a-page');
    check(
      '404s carry no stack trace',
      notFound.status === 404 && !/at \w+ \(|Error:/.test(notFound.text),
      notFound.text.trim().slice(0, 40),
    );

    // --- logs -----------------------------------------------------------------
    check(
      'startup logs no secret, environment or local path',
      !/sk-ant-|API_KEY|[A-Za-z]:\\Users\\|\/home\//.test(log),
      log.split('\n')[0] ?? '',
    );
    check('startup reports live compilation disabled', /live contract compilation: disabled/.test(log));
  } finally {
    // The container gets SIGTERM on every redeploy; so does this.
    child.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000)),
    ]);
    check('server shuts down cleanly on SIGTERM', exited, exited ? '' : 'did not exit within 8s');
    if (!exited) child.kill('SIGKILL');
  }

  // --- Docker, when it is available -------------------------------------------
  let docker = 'not attempted';
  try {
    execFileSync('docker', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      execFileSync('docker', ['build', '-t', 'stateproof:submission', '.'], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 128 * 1024 * 1024,
      });
      docker = 'image built: stateproof:submission';
      ok('docker image builds', docker);
    } catch (error) {
      docker = `build failed: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}`;
      fail('docker image builds', docker);
    }
  } catch {
    // Not a failure of the application. Reported separately, as the gate asks.
    docker = 'Docker is not available on this machine; the image was not built here.';
    process.stdout.write(`  --    docker image                                 ${docker}\n`);
  }

  const dockerfile = readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf8');
  check(
    'Dockerfile runs as a non-root user',
    /^USER\s+(?!root)/m.test(dockerfile),
    'USER node',
  );
  check(
    'Dockerfile defaults live compilation to false',
    /STATEPROOF_ENABLE_LIVE_COMPILATION=false/.test(dockerfile),
  );
  check(
    'Dockerfile copies no environment file',
    !/COPY[^\n]*\.env/.test(dockerfile),
    'no .env may enter the image',
  );

  process.stdout.write(`\n  docker: ${docker}\n`);
  process.stdout.write(`\nRESULT: ${failures === 0 ? 'PASSED' : 'FAILED'} (${String(checks)} checks)\n`);
  if (failures > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
