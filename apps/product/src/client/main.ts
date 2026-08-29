import { z } from 'zod';
import type {
  AppInfo,
  BenchmarkView,
  DemoSummary,
  HeroProof,
  ImportResult,
  RunView,
} from '../shared/types';
import {
  AppInfoSchema,
  BenchmarkViewSchema,
  DemoSummarySchema,
  HeroProofSchema,
  ImportResultSchema,
  RunViewSchema,
} from '../shared/types';

import { clear, el, frag } from './dom';
import {
  benchmarkPage,
  demoIntro,
  errorPanel,
  homeView,
  importSummary,
  installEvidenceDelegation,
  runInspector,
  skeleton,
} from './views';

/** The one payload with no shared schema: it exists only for this screen. */
const CompileStatusSchema = z
  .object({ available: z.boolean(), reason: z.string() })
  .strict();

/**
 * Hash routing over a single shell.
 *
 * The product has five screens and no state worth a framework: each route
 * fetches its own JSON and renders it. Keeping it this small means the whole
 * client is auditable in one sitting, which matters for a tool whose pitch is
 * that you should not have to take its word for anything.
 */

const ROUTES = [
  { href: '#/', label: 'Home' },
  { href: '#/demo', label: 'Demo' },
  { href: '#/import', label: 'Import a run' },
  { href: '#/benchmark', label: 'Benchmark' },
];

interface ApiFailure {
  readonly error: string;
  readonly details: Array<{ field: string; message: string }>;
}

function failure(message: string, details: Array<{ field: string; message: string }>): Error {
  const error = new Error(message);
  (error as Error & { details?: ApiFailure['details'] }).details = details;
  return error;
}

/**
 * Every response is parsed through the shared schema before it is rendered.
 *
 * The client used to cast instead. A server one version behind then returned a
 * payload missing a field the page dereferenced, the render threw, and the page
 * came out blank — the worst possible failure for a tool whose argument is that
 * you should be able to see what happened. A mismatch is now a visible error
 * with the offending field named.
 */
async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();

  let body: unknown;
  try {
    body = text === '' ? {} : JSON.parse(text);
  } catch {
    throw failure('The server did not return JSON.', [
      { field: path, message: 'Is an older server still running on this port?' },
    ]);
  }

  if (!response.ok) {
    const problem = body as ApiFailure;
    throw failure(problem.error ?? 'The request failed.', problem.details ?? []);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw failure('The server sent a response this page cannot read.', [
      ...parsed.error.issues.slice(0, 4).map((issue) => ({
        field: `${path}${issue.path.length === 0 ? '' : ` → ${issue.path.join('.')}`}`,
        message: issue.message,
      })),
      { field: 'likely cause', message: 'A server from an earlier build is still running. Restart it.' },
    ]);
  }
  return parsed.data;
}

function detailsOf(error: unknown): Array<{ field: string; message: string }> {
  const details = (error as Error & { details?: Array<{ field: string; message: string }> }).details;
  return details ?? [];
}

/**
 * Fetched once. Which links exist is a property of the deployment, not of the
 * route, and re-asking on every hash change would be noise.
 */
let appInfo: AppInfo | null = null;

async function loadAppInfo(): Promise<AppInfo | null> {
  if (appInfo !== null) return appInfo;
  appInfo = await api<AppInfo>('/api/app', AppInfoSchema).catch(() => null);
  return appInfo;
}

function main(): HTMLElement {
  const node = document.getElementById('app');
  if (node === null) throw new Error('missing #app');
  return node as HTMLElement;
}

/**
 * Links out of the product. The dashboard is served by this same server under a
 * predictable path; the rest depend on what the repository actually declares,
 * so a missing remote produces no link rather than a broken one.
 */
function externalLinks(app: AppInfo | null): Array<{ href: string; label: string }> {
  if (app === null) return [];
  const links: Array<{ href: string; label: string }> = [];
  if (app.dashboardAvailable) links.push({ href: '/evidence/', label: 'Evidence dashboard' });
  if (app.repositoryUrl !== null) {
    links.push({
      href: `${app.repositoryUrl}/blob/main/REPRODUCTION.md`,
      label: 'Reproduction guide',
    });
    links.push({ href: app.repositoryUrl, label: 'GitHub' });
  }
  return links;
}

function renderNav(active: string, app: AppInfo | null): void {
  const nav = document.getElementById('nav');
  if (nav === null) return;
  clear(nav);
  // `#/import?sample` is still the import route as far as the nav is concerned.
  const base = active.split('?')[0] ?? active;
  for (const route of ROUTES) {
    const isActive = base === route.href || (base === '' && route.href === '#/');
    nav.appendChild(
      el('a', { href: route.href, ...(isActive ? { 'aria-current': 'page' } : {}) }, route.label),
    );
  }
  const links = externalLinks(app);
  if (links.length === 0) return;
  nav.appendChild(el('span', { class: 'nav-rule', 'aria-hidden': 'true' }));
  for (const link of links) {
    const external = link.href.startsWith('http');
    nav.appendChild(
      el(
        'a',
        {
          href: link.href,
          class: 'nav-out',
          ...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {}),
        },
        link.label,
      ),
    );
  }
}

function show(children: Parameters<typeof frag>): void {
  const root = main();
  clear(root);
  root.appendChild(frag(...children));
  root.focus({ preventScroll: true });
}

async function renderHome(): Promise<void> {
  // Both are committed artifacts and either can be missing without the page
  // losing its point, so neither failure blocks the other.
  const [benchmark, hero, app] = await Promise.all([
    api<BenchmarkView>('/api/benchmark', BenchmarkViewSchema).catch(() => null),
    api<HeroProof>('/api/hero', HeroProofSchema).catch(() => null),
    loadAppInfo(),
  ]);
  show([homeView(benchmark, hero, app)]);
}

async function renderDemo(): Promise<void> {
  show([el('section', {}, el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }))]);
  let summary: DemoSummary;
  try {
    summary = await api<DemoSummary>('/api/demo', DemoSummarySchema);
  } catch (error) {
    show([errorPanel('The demo could not load.', detailsOf(error))]);
    return;
  }

  const verify = async (): Promise<void> => {
    const button = document.getElementById('verify-button');
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      clear(button);
      button.appendChild(el('span', { class: 'spinner' }));
      button.appendChild(document.createTextNode('Verifying…'));
    }
    const root = main();
    root.appendChild(skeleton());
    try {
      const run = await api<RunView>('/api/verify/demo', RunViewSchema, { method: 'POST', body: '{}' });
      window.location.hash = `#/runs/${run.runId}`;
    } catch (error) {
      root.appendChild(errorPanel('Verification failed.', detailsOf(error)));
    }
  };

  show([demoIntro(summary, () => void verify())]);
}

async function renderRun(runId: string): Promise<void> {
  show([el('section', {}, el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }))]);
  try {
    const run = await api<RunView>(`/api/runs/${encodeURIComponent(runId)}`, RunViewSchema);
    show([runInspector(run)]);
  } catch (error) {
    show([
      errorPanel('That run is not available.', detailsOf(error)),
      el(
        'p',
        { class: 'empty' },
        'Runs are kept in memory for the session only. ',
        el('a', { href: '#/demo' }, 'Run the demo again'),
        '.',
      ),
    ]);
  }
}

function fileField(name: string): HTMLElement {
  return el(
    'div',
    { class: 'field' },
    el('label', { for: `file-${name}` }, name),
    el('input', { type: 'file', id: `file-${name}`, 'data-file': name }),
  );
}

async function readFileInput(input: HTMLInputElement): Promise<string | undefined> {
  const file = input.files?.[0];
  if (file === undefined) return undefined;
  return await file.text();
}

async function renderImport(sample = false): Promise<void> {
  await loadAppInfo();
  const status = await api('/api/compile-status', CompileStatusSchema).catch(() => ({
    available: false,
    reason: 'compile status unavailable',
  }));

  const output = el('div', { id: 'import-output' });
  const submit = el('button', { type: 'button' }, 'Validate run package');

  /**
   * Renders whatever the importer returned, and offers the next step it allows.
   * Shared by the upload path and the preloaded sample so there is exactly one
   * place where an import result turns into a verdict.
   */
  const present = (result: ImportResult): void => {
    output.appendChild(importSummary(result));

    if (
      result.contractStatus === 'uploaded-contract' ||
      result.contractStatus === 'matched-frozen-contract'
    ) {
      const usesFrozen = result.contractStatus === 'matched-frozen-contract';
      const verifyButton = el(
        'button',
        { type: 'button' },
        usesFrozen ? 'Verify against the matching frozen contract' : 'Verify this run',
      );
      verifyButton.addEventListener('click', () => {
        void (async () => {
          verifyButton.setAttribute('disabled', '');
          try {
            const run = await api<RunView>('/api/verify', RunViewSchema, {
              method: 'POST',
              body: JSON.stringify({
                importId: result.importId,
                contractSource: usesFrozen ? 'frozen' : 'uploaded',
              }),
            });
            window.location.hash = `#/runs/${run.runId}`;
          } catch (error) {
            output.appendChild(errorPanel('Verification failed.', detailsOf(error)));
          }
        })();
      });
      output.appendChild(el('div', { class: 'actions mt-3' }, verifyButton));
      return;
    }

    if (result.contractStatus === 'compile-available') {
      const compileButton = el(
        'button',
        { type: 'button', class: 'ghost' },
        'Compile a contract (one model call)',
      );
      compileButton.addEventListener('click', () => {
        void (async () => {
          compileButton.setAttribute('disabled', '');
          output.appendChild(
            el(
              'p',
              { class: 'mt-2' },
              el(
                'span',
                { class: 'pill v-model', 'data-glyph': '◆' },
                'Model-assisted compilation in progress',
              ),
            ),
          );
          try {
            const run = await api<RunView>('/api/contracts/compile', RunViewSchema, {
              method: 'POST',
              body: JSON.stringify({ importId: result.importId }),
            });
            window.location.hash = `#/runs/${run.runId}`;
          } catch (error) {
            output.appendChild(errorPanel('Compilation failed.', detailsOf(error)));
          }
        })();
      });
      output.appendChild(el('div', { class: 'actions mt-3' }, compileButton));
      return;
    }

    output.appendChild(
      el(
        'div',
        { class: 'actions mt-3' },
        el('a', { class: 'btn ghost', href: '#/demo' }, 'Try the built-in demo instead'),
      ),
    );
  };

  /** The committed sample, imported server-side through the same validator. */
  const loadSample = async (): Promise<void> => {
    clear(output);
    output.appendChild(el('p', { class: 'muted' }, 'Validating the sample run package…'));
    try {
      const result = await api<ImportResult>('/api/import/sample', ImportResultSchema, {
        method: 'POST',
        body: '{}',
      });
      clear(output);
      present(result);
    } catch (error) {
      clear(output);
      output.appendChild(errorPanel('The sample import failed.', detailsOf(error)));
    }
  };

  const zipInput = el('input', { type: 'file', id: 'zip-input', accept: '.zip' });

  submit.addEventListener('click', () => {
    void (async () => {
      clear(output);
      submit.setAttribute('disabled', '');
      try {
        const zipFile = (zipInput as HTMLInputElement).files?.[0];
        let body: Record<string, unknown>;
        if (zipFile !== undefined) {
          const buffer = new Uint8Array(await zipFile.arrayBuffer());
          let binary = '';
          for (const byte of buffer) binary += String.fromCharCode(byte);
          body = { zipBase64: btoa(binary) };
        } else {
          const files: Record<string, string> = {};
          for (const input of document.querySelectorAll('input[data-file]')) {
            const name = input.getAttribute('data-file') ?? '';
            const contents = await readFileInput(input as HTMLInputElement);
            if (contents !== undefined) files[name] = contents;
          }
          body = { files };
        }
        const result = await api<ImportResult>('/api/import', ImportResultSchema, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        present(result);
      } catch (error) {
        output.appendChild(
          errorPanel(
            error instanceof Error ? error.message : 'The import failed.',
            detailsOf(error),
          ),
        );
      } finally {
        submit.removeAttribute('disabled');
      }
    })();
  });

  const sampleButton = el(
    'button',
    { type: 'button', class: 'ghost' },
    'Import the sample package',
  );
  sampleButton.addEventListener('click', () => {
    sampleButton.setAttribute('disabled', '');
    void loadSample().finally(() => sampleButton.removeAttribute('disabled'));
  });

  show([
    el(
      'section',
      {},
      el('h1', {}, 'Import an agent run'),
      el(
        'p',
        { class: 'lede' },
        'Upload a run package and StateProof will validate it against the refund-operations domain. Validation is not verification: you choose when to verify.',
      ),
      appInfo?.samplePackageAvailable === true
        ? el(
            'div',
            { class: 'callout mt-3' },
            el(
              'p',
              {},
              'No package to hand? The committed sample goes through the same validator, the same archive limits and the same domain check as an upload.',
            ),
            el('div', { class: 'actions mt-2' }, sampleButton),
          )
        : null,
      el(
        'div',
        { class: 'callout warn' },
        el(
          'p',
          {},
          'Upload synthetic or approved data only. Files are held in memory for this session and never written to disk. The only domain currently supported is refund operations: orders, refunds, emails and support cases.',
        ),
      ),
    ),
    el(
      'section',
      { class: 'grid grid-2' },
      el(
        'div',
        { class: 'card' },
        el('h3', {}, 'Option A — run package'),
        el('p', { class: 'small muted' }, 'A .zip containing the six agent-visible files below, and optionally a compiled contract.'),
        el(
          'ul',
          { class: 'manifest small mono' },
          ...['task.json', 'tool-registry.json', 'initial-state.json', 'trajectory.jsonl', 'final-state.json', 'final-response.txt'].map(
            (name) => el('li', {}, name),
          ),
          el('li', { class: 'faint' }, 'compiled-contract.json  (optional)'),
        ),
        el('div', { class: 'field mt-2' }, zipInput),
        appInfo?.samplePackageAvailable === true
          ? el(
              'p',
              { class: 'small mt-2' },
              el('a', { href: '/api/sample-package' }, 'Download a sample run package'),
              el(
                'span',
                { class: 'faint' },
                ' — PBH-A01, a development case, built from the same gold-isolated loader the evaluation uses.',
              ),
            )
          : null,
      ),
      el(
        'div',
        { class: 'card' },
        el('h3', {}, 'Option B — individual files'),
        fileField('task.json'),
        fileField('tool-registry.json'),
        fileField('initial-state.json'),
        fileField('trajectory.jsonl'),
        fileField('final-state.json'),
        fileField('final-response.txt'),
        fileField('compiled-contract.json'),
      ),
    ),
    el('section', {}, el('div', { class: 'actions' }, submit), el('div', { class: 'mt-3' }, output)),
    el(
      'section',
      {},
      el(
        'p',
        { class: 'faint small' },
        status.available
          ? 'This server can compile a contract for a run that has none. That is the only action in this product that calls a model.'
          : status.reason,
      ),
    ),
  ]);

  // Arrived from the home page's "Try sample import": run it straight away,
  // through exactly the path the button above uses.
  if (sample && appInfo?.samplePackageAvailable === true) {
    sampleButton.setAttribute('disabled', '');
    void loadSample().finally(() => sampleButton.removeAttribute('disabled'));
  }
}

async function renderBenchmark(): Promise<void> {
  show([el('section', {}, el('div', { class: 'skeleton' }))]);
  try {
    const benchmark = await api<BenchmarkView>('/api/benchmark', BenchmarkViewSchema);
    show([benchmarkPage(benchmark)]);
  } catch (error) {
    show([errorPanel('The benchmark could not load.', detailsOf(error))]);
  }
}

/**
 * An error boundary for a route.
 *
 * Rendering happens after the fetch resolves, so anything that throws in a view
 * leaves `#app` empty — a blank page, with the reason only in the console. Every
 * route goes through here so a failure is something you can read.
 */
function safely(render: () => Promise<void>): void {
  void render().catch((error: unknown) => {
    show([
      errorPanel(
        error instanceof Error ? error.message : 'This page could not be rendered.',
        detailsOf(error),
      ),
    ]);
  });
}

/**
 * The route to render.
 *
 * Navigation inside the app is hash-based, but the deployment publishes real
 * paths — `/demo`, `/import`, `/benchmark` — and the server serves the shell for
 * each. A judge opening a shared link must land where the link says, so on a
 * cold load with no hash the pathname decides.
 */
const PATH_ROUTES: Record<string, string> = {
  '/demo': '#/demo',
  '/import': '#/import',
  '/benchmark': '#/benchmark',
};

function currentRoute(): string {
  if (window.location.hash !== '') return window.location.hash;
  const byPath = PATH_ROUTES[window.location.pathname];
  // `/import?sample` must reach the client as `#/import?sample`; dropping the
  // query would silently turn a preloaded sample into an empty upload form.
  if (byPath !== undefined) {
    return window.location.search === '' ? byPath : `${byPath}${window.location.search}`;
  }
  const run = /^\/runs\/([A-Za-z0-9_-]+)$/.exec(window.location.pathname);
  return run === null ? '#/' : `#/runs/${run[1] ?? ''}`;
}

function route(): void {
  const hash = currentRoute();
  renderNav(hash.startsWith('#/runs/') ? '#/demo' : hash, appInfo);
  void loadAppInfo().then((info) => {
    renderNav(hash.startsWith('#/runs/') ? '#/demo' : hash, info);
  });

  const runMatch = /^#\/runs\/([A-Za-z0-9_-]+)$/.exec(hash);
  if (runMatch !== null) {
    const runId = runMatch[1] ?? '';
    safely(() => renderRun(runId));
    return;
  }
  if (hash === '#/demo') return safely(renderDemo);
  if (hash.startsWith('#/import')) {
    const wantsSample = hash.includes('sample');
    return safely(() => renderImport(wantsSample));
  }
  if (hash === '#/benchmark') return safely(renderBenchmark);
  safely(renderHome);
}

installEvidenceDelegation(main());
window.addEventListener('hashchange', route);
route();
