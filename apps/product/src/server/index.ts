import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARD_CASES_DIR, loadAgentVisibleCase } from '@stateproof/benchmark';
import { z } from 'zod';
import {
  CompileRequestSchema,
  ImportRequestSchema,
  VerifyRequestSchema,
} from '../shared/types';
import { benchmarkView } from './benchmark';
import { compileForImport, compileStatus } from './compile';
import { DEMO_CASE_ID, demoContext, demoSummary, heroProof, verifyDemo } from './demo';
import { buildEvidencePack, renderEvidenceMarkdown } from './evidence';
import { ImportError, getImport, importRun } from './importer';
import { buildRunView, getRun, readContractArtifact, storeRun } from './runs';

/**
 * The product server.
 *
 * A plain Node HTTP server rather than a framework: every route here either
 * reads a committed artifact or runs the existing verifier, so a router, a
 * renderer and a build pipeline would be three dependencies buying nothing. The
 * browser gets JSON and a static bundle; it never gets a credential, a
 * filesystem path, or gold data.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DIST_DIR = path.join(REPO_ROOT, 'apps', 'product', 'dist');
/** The static evidence dashboard, served rather than reimplemented. */
const DASHBOARD_DIR = path.join(REPO_ROOT, 'apps', 'dashboard', 'dist');
const SAMPLE_PACKAGE = path.join(REPO_ROOT, 'samples', 'stateproof-sample-run.zip');
const PORT = Number.parseInt(process.env['PORT'] ?? '4180', 10);
const MAX_BODY_BYTES = 12 * 1024 * 1024;

/** Non-secret, committed metadata the client uses to build its links. */
function appInfo(): {
  repositoryUrl: string | null;
  dashboardAvailable: boolean;
  samplePackageAvailable: boolean;
} {
  let repositoryUrl: string | null = null;
  try {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      repository?: { url?: string };
    };
    const url = manifest.repository?.url ?? null;
    // Only an https remote is a link. A local path or an ssh remote is neither
    // useful to a reader nor safe to put on a page.
    repositoryUrl = url !== null && url.startsWith('https://') ? url : null;
  } catch {
    repositoryUrl = null;
  }
  return {
    repositoryUrl,
    dashboardAvailable: existsSync(path.join(DASHBOARD_DIR, 'index.html')),
    samplePackageAvailable: existsSync(SAMPLE_PACKAGE),
  };
}

/** No inline script or style, no remote origin, nothing embeddable. */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The evidence dashboard is a separate application being hosted here, and its
 * generator writes `style` attributes. It renders committed artifacts only —
 * no request data reaches it — so it gets its own policy rather than forcing
 * the product's routes to relax theirs. Scripts stay restricted to same-origin.
 */
const DASHBOARD_CSP = CSP.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");

function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': contentType,
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extraHeaders,
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

function sendError(
  response: ServerResponse,
  status: number,
  error: string,
  details: Array<{ field: string; message: string }> = [],
): void {
  sendJson(response, status, { error, details });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** A very small local rate limit, so the optional compile route cannot be hammered. */
const compileHits: number[] = [];
const COMPILE_WINDOW_MS = 60_000;
const COMPILE_LIMIT = 3;

function compileRateLimited(nowMs = Date.now()): boolean {
  while (compileHits.length > 0 && (compileHits[0] ?? 0) < nowMs - COMPILE_WINDOW_MS) {
    compileHits.shift();
  }
  if (compileHits.length >= COMPILE_LIMIT) return true;
  compileHits.push(nowMs);
  return false;
}

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  const method = request.method ?? 'GET';
  const route = url.pathname;

  // --- API ----------------------------------------------------------------
  if (route === '/api/demo' && method === 'GET') {
    sendJson(response, 200, demoSummary(REPO_ROOT));
    return;
  }

  if (route === '/api/app' && method === 'GET') {
    sendJson(response, 200, appInfo());
    return;
  }

  if (route === '/api/sample-package' && method === 'GET') {
    if (!existsSync(SAMPLE_PACKAGE)) {
      sendError(response, 404, 'The sample run package has not been built.', [
        { field: 'samples', message: 'Run `pnpm sample:build` to generate it.' },
      ]);
      return;
    }
    send(response, 200, 'application/zip', readFileSync(SAMPLE_PACKAGE), {
      'content-disposition': 'attachment; filename="stateproof-sample-run.zip"',
    });
    return;
  }

  if (route === '/api/hero' && method === 'GET') {
    sendJson(response, 200, heroProof(REPO_ROOT));
    return;
  }

  if (route === '/api/verify/demo' && method === 'POST') {
    const run = verifyDemo(REPO_ROOT);
    sendJson(response, 200, run);
    return;
  }

  if (route === '/api/import' && method === 'POST') {
    let parsed;
    try {
      parsed = ImportRequestSchema.parse(JSON.parse(await readBody(request)));
    } catch (error) {
      sendError(
        response,
        400,
        'The upload could not be read.',
        error instanceof z.ZodError
          ? error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))
          : [{ field: 'request', message: error instanceof Error ? error.message : 'unreadable' }],
      );
      return;
    }
    try {
      const { result } = importRun(parsed, REPO_ROOT);
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof ImportError) {
        sendError(response, 422, 'This run package did not validate.', error.problems);
        return;
      }
      sendError(response, 500, 'The import failed unexpectedly.');
    }
    return;
  }

  if (route === '/api/verify' && method === 'POST') {
    let parsed;
    try {
      parsed = VerifyRequestSchema.parse(JSON.parse(await readBody(request)));
    } catch (error) {
      sendError(response, 400, 'Invalid verification request.', [
        { field: 'request', message: error instanceof Error ? error.message : 'unreadable' },
      ]);
      return;
    }
    const imported = getImport(parsed.importId);
    if (imported === null) {
      sendError(response, 404, 'That import has expired. Upload the run package again.');
      return;
    }
    // Two legitimate sources: a contract shipped with the package, or the
    // frozen sample contract whose task fingerprint this run reproduces.
    if (parsed.contractSource === 'frozen') {
      if (imported.matchedContractPath === null) {
        sendError(response, 409, 'This run does not match any frozen sample contract.', [
          { field: 'contract', message: 'Its task fingerprint is not one of the three frozen tasks.' },
        ]);
        return;
      }
      const artifact = readContractArtifact(REPO_ROOT, imported.matchedContractPath);
      const run = storeRun(
        buildRunView({
          label: imported.agentVisible.task.title,
          caseId: null,
          agentVisible: imported.agentVisible,
          contract: artifact.contract,
          contractHash: artifact.contractHash,
          taskFingerprint: artifact.taskFingerprint,
          promptPath: artifact.promptPath,
          promptHash: artifact.promptHash,
          assertionSchemaVersion: artifact.assertionSchemaVersion,
          contractSource: 'frozen-bundle',
          imported: true,
        }),
      );
      sendJson(response, 200, run);
      return;
    }

    const contract = imported.uploadedContract;
    if (contract === null) {
      sendError(response, 409, 'No compiled contract is available for this run yet.', [
        {
          field: 'contract',
          message:
            'Include compiled-contract.json in the package, or compile one if the server has a key configured.',
        },
      ]);
      return;
    }
    const run = storeRun(
      buildRunView({
        label: imported.agentVisible.task.title,
        caseId: null,
        agentVisible: imported.agentVisible,
        contract,
        contractHash: 'uploaded-contract',
        taskFingerprint: 'not-computed-for-uploaded-contracts',
        promptPath: 'supplied with the run package',
        promptHash: 'not applicable',
        assertionSchemaVersion: '2.1.0',
        contractSource: 'uploaded',
        imported: true,
      }),
    );
    sendJson(response, 200, run);
    return;
  }

  if (route === '/api/contracts/compile' && method === 'POST') {
    const status = compileStatus();
    if (!status.available) {
      sendError(response, 501, status.reason, []);
      return;
    }
    if (compileRateLimited()) {
      sendError(response, 429, 'Compilation is rate-limited locally. Wait a minute and retry.');
      return;
    }
    let parsed;
    try {
      parsed = CompileRequestSchema.parse(JSON.parse(await readBody(request)));
    } catch {
      sendError(response, 400, 'Invalid compile request.');
      return;
    }
    const imported = getImport(parsed.importId);
    if (imported === null) {
      sendError(response, 404, 'That import has expired. Upload the run package again.');
      return;
    }
    try {
      const run = await compileForImport(REPO_ROOT, imported);
      sendJson(response, 200, run);
    } catch (error) {
      sendError(response, 502, 'Contract compilation failed.', [
        { field: 'compile', message: error instanceof Error ? error.message : 'unknown failure' },
      ]);
    }
    return;
  }

  if (route === '/api/compile-status' && method === 'GET') {
    sendJson(response, 200, compileStatus());
    return;
  }

  const runMatch = /^\/api\/runs\/([A-Za-z0-9_-]+)$/.exec(route);
  if (runMatch !== null && method === 'GET') {
    const run = getRun(runMatch[1] ?? '');
    if (run === null) {
      sendError(response, 404, 'That run has expired. Runs are kept in memory only.');
      return;
    }
    sendJson(response, 200, run);
    return;
  }

  const exportMatch = /^\/api\/runs\/([A-Za-z0-9_-]+)\/export$/.exec(route);
  if (exportMatch !== null && method === 'GET') {
    const run = getRun(exportMatch[1] ?? '');
    if (run === null) {
      sendError(response, 404, 'That run has expired. Runs are kept in memory only.');
      return;
    }
    const pack = buildEvidencePack(run);
    const format = url.searchParams.get('format') ?? 'json';
    if (format === 'md') {
      send(
        response,
        200,
        'text/markdown; charset=utf-8',
        renderEvidenceMarkdown(pack),
        { 'content-disposition': `attachment; filename="evidence-${run.runId}.md"` },
      );
      return;
    }
    send(response, 200, 'application/json; charset=utf-8', JSON.stringify(pack, null, 2), {
      'content-disposition': `attachment; filename="evidence-${run.runId}.json"`,
    });
    return;
  }

  if (route === '/api/benchmark' && method === 'GET') {
    try {
      sendJson(response, 200, benchmarkView(REPO_ROOT));
    } catch (error) {
      sendError(response, 503, error instanceof Error ? error.message : 'benchmark unavailable');
    }
    return;
  }

  // --- the static evidence dashboard, hosted rather than reimplemented -----
  if (route === '/dashboard' && method === 'GET') {
    response.writeHead(302, { location: '/dashboard/' });
    response.end();
    return;
  }
  if (route.startsWith('/dashboard/') && method === 'GET') {
    const relative = route.slice('/dashboard/'.length);
    const page = relative === '' ? 'index.html' : relative;
    const candidate = path.join(DASHBOARD_DIR, page);
    if (!candidate.startsWith(DASHBOARD_DIR) || !existsSync(candidate) || candidate.endsWith(path.sep)) {
      send(
        response,
        404,
        'text/plain; charset=utf-8',
        'The evidence dashboard is not built. Run `pnpm dashboard:build`.\n',
      );
      return;
    }
    send(
      response,
      200,
      STATIC_TYPES[path.extname(candidate)] ?? 'text/plain; charset=utf-8',
      readFileSync(candidate),
      { 'content-security-policy': DASHBOARD_CSP },
    );
    return;
  }

  // --- static -------------------------------------------------------------
  const asset = route === '/' ? 'index.html' : route.replace(/^\/+/, '');
  const candidate = path.join(DIST_DIR, asset);
  if (candidate.startsWith(DIST_DIR) && existsSync(candidate) && !candidate.endsWith(path.sep)) {
    send(response, 200, STATIC_TYPES[path.extname(candidate)] ?? 'text/plain; charset=utf-8', readFileSync(candidate));
    return;
  }

  // Client-side routes all resolve to the shell.
  const shell = path.join(DIST_DIR, 'index.html');
  if (existsSync(shell)) {
    send(response, 200, 'text/html; charset=utf-8', readFileSync(shell));
    return;
  }

  send(response, 404, 'text/plain; charset=utf-8', 'Run `pnpm product:build` first.\n');
}

export function startServer(port: number = PORT): ReturnType<typeof createServer> {
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      sendError(response, 500, 'Something went wrong handling that request.');
    });
  });
  server.listen(port, () => {
    process.stdout.write(`StateProof product: http://localhost:${port}/\n`);
    process.stdout.write(`demo case: ${DEMO_CASE_ID} (verified offline, zero model calls)\n`);
    const status = compileStatus();
    process.stdout.write(
      `custom contract compilation: ${status.available ? 'available' : `unavailable — ${status.reason}`}\n`,
    );
  });
  return server;
}

// Exported for tests; started when run directly.
export { demoContext, loadAgentVisibleCase, HARD_CASES_DIR, readContractArtifact };

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('server/index.ts');
if (invokedDirectly) startServer();
