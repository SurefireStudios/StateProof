/**
 * The page shell: one nav, one stylesheet, one script.
 *
 * The dashboard is generated rather than served by a framework. That is a
 * deliberate trade: the whole product is a *view over checked-in artifacts*, so
 * the build is a pure function from artifacts to HTML, it needs no runtime, no
 * credentials and no network, and a judge can open the output straight from
 * disk. It also means there is nowhere for a hardcoded number to hide.
 */

export const PITCH = 'The agent said it was done. Prove it.';
export const INSIGHT = 'For action-taking agents, the final response is a claim—not evidence.';

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export const NAV: NavItem[] = [
  { href: 'index.html', label: 'Overview' },
  { href: 'inspector.html', label: 'Run Inspector' },
  { href: 'benchmark.html', label: 'Benchmark' },
  { href: 'changelog.html', label: 'Changelog' },
  { href: 'trajectories.html', label: 'Trajectories' },
  { href: 'architecture.html', label: 'Architecture & Replay' },
];

/** HTML-escapes text. Every artifact string goes through this. */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safe to place inside a <script> block. */
export function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function integer(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-US');
}

export function seconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function verdictClass(verdict: string): string {
  if (verdict === 'PASS') return 'v-pass';
  if (verdict === 'FAIL') return 'v-fail';
  return 'v-review';
}

export interface PageOptions {
  readonly title: string;
  readonly active: string;
  readonly subtitle?: string;
  readonly body: string;
  /** Inlined at the end of body, after the shared script. */
  readonly pageScript?: string;
}

export function page(options: PageOptions): string {
  const nav = NAV.map(
    (item) =>
      `<a class="nav-link${item.href === options.active ? ' is-active' : ''}" href="${item.href}">${esc(item.label)}</a>`,
  ).join('');

  return `<!doctype html>
<html lang="en" data-page="${esc(options.active)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)} · StateProof</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="index.html">
    <span class="brand-mark" aria-hidden="true"></span>
    <span class="brand-name">StateProof</span>
    <span class="brand-tag">${esc(PITCH)}</span>
  </a>
  <nav class="nav">${nav}</nav>
</header>
<main class="page">
  <div class="page-head">
    <h1>${esc(options.title)}</h1>
    ${options.subtitle === undefined ? '' : `<p class="page-sub">${esc(options.subtitle)}</p>`}
  </div>
  ${options.body}
</main>
<footer class="footer">
  <p>Every figure on this page is read from a checked-in run artifact pinned in
  <code>submission/reproduction-manifest.json</code>. Nothing is hardcoded, and the build makes no network or model calls.</p>
  <p>PhantomBench-Hard-12 is the final benchmark; PhantomBench-12 (Core-12) is the diagnostic suite that
  established the harness. Eight cases were <strong>developed against</strong>; four were <strong>held out</strong>
  and evaluated exactly once after the source freeze. Deterministic verification is code, not an agent.</p>
  <div class="colophon">
    <img class="colophon-mark" src="logo.svg" alt="" width="26" height="26">
    <p class="colophon-credit">Designed and built by <strong>Stephen Fitzgerald</strong><br>
    for the micro1 Agentic Workflows Hackathon &middot; 2026</p>
    <nav class="colophon-links" aria-label="Project links"><a href="https://github.com/SurefireStudios/StateProof" rel="noreferrer noopener">GitHub</a><span aria-hidden="true"> &middot; </span><a href="https://github.com/SurefireStudios/StateProof/blob/main/REPRODUCTION.md" rel="noreferrer noopener">Reproduction guide</a><span aria-hidden="true"> &middot; </span><a href="index.html">Evidence dashboard</a><span aria-hidden="true"> &middot; </span><a href="https://github.com/SurefireStudios/StateProof/blob/main/LICENSE" rel="noreferrer noopener">License</a></nav>
  </div>
</footer>
<script src="app.js"></script>
${options.pageScript === undefined ? '' : `<script>${options.pageScript}</script>`}
</body>
</html>
`;
}
