import type { BenchmarkView, DemoSummary, HeroProof, ImportResult, RunView } from '../shared/types';
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const body: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    const failure = body as ApiFailure;
    const error = new Error(failure.error ?? 'The request failed.');
    (error as Error & { details?: ApiFailure['details'] }).details = failure.details ?? [];
    throw error;
  }
  return body as T;
}

function detailsOf(error: unknown): Array<{ field: string; message: string }> {
  const details = (error as Error & { details?: Array<{ field: string; message: string }> }).details;
  return details ?? [];
}

function main(): HTMLElement {
  const node = document.getElementById('app');
  if (node === null) throw new Error('missing #app');
  return node as HTMLElement;
}

function renderNav(active: string): void {
  const nav = document.getElementById('nav');
  if (nav === null) return;
  clear(nav);
  for (const route of ROUTES) {
    const isActive = active === route.href || (active === '' && route.href === '#/');
    nav.appendChild(
      el('a', { href: route.href, ...(isActive ? { 'aria-current': 'page' } : {}) }, route.label),
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
  const [benchmark, hero] = await Promise.all([
    api<BenchmarkView>('/api/benchmark').catch(() => null),
    api<HeroProof>('/api/hero').catch(() => null),
  ]);
  show([homeView(benchmark, hero)]);
}

async function renderDemo(): Promise<void> {
  show([el('section', {}, el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }))]);
  let summary: DemoSummary;
  try {
    summary = await api<DemoSummary>('/api/demo');
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
      const run = await api<RunView>('/api/verify/demo', { method: 'POST', body: '{}' });
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
    const run = await api<RunView>(`/api/runs/${encodeURIComponent(runId)}`);
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

async function renderImport(): Promise<void> {
  const status = await api<{ available: boolean; reason: string }>('/api/compile-status').catch(
    () => ({ available: false, reason: 'compile status unavailable' }),
  );

  const output = el('div', { id: 'import-output' });
  const submit = el('button', { type: 'button' }, 'Validate run package');

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
        const result = await api<ImportResult>('/api/import', {
          method: 'POST',
          body: JSON.stringify(body),
        });
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
                const run = await api<RunView>('/api/verify', {
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
        } else if (result.contractStatus === 'compile-available') {
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
                const run = await api<RunView>('/api/contracts/compile', {
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
        } else {
          output.appendChild(
            el(
              'div',
              { class: 'actions mt-3' },
              el('a', { class: 'btn ghost', href: '#/demo' }, 'Try the built-in demo instead'),
            ),
          );
        }
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
        el('p', { class: 'small muted' }, 'A .zip containing task.json, tool-registry.json, initial-state.json, trajectory.jsonl, final-state.json, final-response.txt and optionally compiled-contract.json.'),
        el('div', { class: 'field mt-2' }, zipInput),
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
}

async function renderBenchmark(): Promise<void> {
  show([el('section', {}, el('div', { class: 'skeleton' }))]);
  try {
    const benchmark = await api<BenchmarkView>('/api/benchmark');
    show([benchmarkPage(benchmark)]);
  } catch (error) {
    show([errorPanel('The benchmark could not load.', detailsOf(error))]);
  }
}

function route(): void {
  const hash = window.location.hash === '' ? '#/' : window.location.hash;
  renderNav(hash.startsWith('#/runs/') ? '#/demo' : hash);

  const runMatch = /^#\/runs\/([A-Za-z0-9_-]+)$/.exec(hash);
  if (runMatch !== null) {
    void renderRun(runMatch[1] ?? '');
    return;
  }
  if (hash === '#/demo') return void renderDemo();
  if (hash === '#/import') return void renderImport();
  if (hash === '#/benchmark') return void renderBenchmark();
  void renderHome();
}

installEvidenceDelegation(main());
window.addEventListener('hashchange', route);
route();
