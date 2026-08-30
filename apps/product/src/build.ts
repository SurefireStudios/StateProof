import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * `pnpm product:build`
 *
 * Bundles the TypeScript client and emits the shell. No inline script or style,
 * so the server's Content-Security-Policy can stay strict without exceptions.
 */

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = path.join(APP_ROOT, 'dist');

/**
 * Repository links are inlined at build time rather than fetched by the client,
 * so the colophon is present in the shell itself and survives a page with no
 * JavaScript. A non-https remote produces no link rather than a broken one.
 */
function repositoryUrl(): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(APP_ROOT, '..', '..', 'package.json'), 'utf8'),
    ) as { repository?: { url?: string } };
    const url = manifest.repository?.url ?? '';
    return url.startsWith('https://') ? url : null;
  } catch {
    return null;
  }
}

function colophon(): string {
  const repository = repositoryUrl();
  const links = [
    repository === null ? null : `<a href="${repository}" rel="noreferrer noopener">GitHub</a>`,
    repository === null
      ? null
      : `<a href="${repository}/blob/main/REPRODUCTION.md" rel="noreferrer noopener">Reproduction guide</a>`,
    `<a href="/evidence/">Evidence dashboard</a>`,
    repository === null
      ? null
      : `<a href="${repository}/blob/main/LICENSE" rel="noreferrer noopener">License</a>`,
  ].filter((link): link is string => link !== null);

  return `<div class="colophon">
    <img class="colophon-mark" src="/logo.svg" alt="" width="26" height="26">
    <p class="colophon-credit">Designed and built by <strong>Stephen Fitzgerald</strong><br>
    for the micro1 Agentic Workflows Hackathon · 2026</p>
    <nav class="colophon-links" aria-label="Project links">${links.join('<span aria-hidden="true"> · </span>')}</nav>
  </div>`;
}

const SHELL = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StateProof — verify what your agent actually did</title>
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<a class="visually-hidden" href="#app">Skip to content</a>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="#/">
      <span class="brand-mark" aria-hidden="true"></span>
      <span>StateProof</span>
      <span class="brand-tag">The agent said it was done. <em>Prove it.</em></span>
    </a>
    <nav class="main" id="nav" aria-label="Primary"></nav>
  </div>
</header>
<main id="app" tabindex="-1"></main>
<footer>
  <p>The final answer is a claim. State and process are the evidence.</p>
  <p>Verification is read-only and deterministic. Benchmark figures come from 12 synthetic cases and do not establish generalization.</p>
  ${colophon()}
</footer>
<script src="/client.js"></script>
</body>
</html>
`;

export async function buildProduct(): Promise<string[]> {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  await build({
    entryPoints: [path.join(APP_ROOT, 'src', 'client', 'main.ts')],
    bundle: true,
    format: 'iife',
    target: ['es2022'],
    minify: true,
    sourcemap: false,
    outfile: path.join(DIST, 'client.js'),
    logLevel: 'silent',
  });

  copyFileSync(path.join(APP_ROOT, 'src', 'client', 'styles.css'), path.join(DIST, 'styles.css'));
  copyFileSync(path.join(APP_ROOT, 'src', 'client', 'logo.svg'), path.join(DIST, 'logo.svg'));
  writeFileSync(path.join(DIST, 'index.html'), SHELL(), 'utf8');
  return ['index.html', 'client.js', 'styles.css', 'logo.svg'];
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('src/build.ts');
if (invokedDirectly) {
  buildProduct()
    .then((files) => {
      process.stdout.write(`product built: ${files.join(', ')}\n`);
      process.stdout.write(`output: ${path.relative(process.cwd(), DIST)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
