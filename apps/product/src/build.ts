import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StateProof — verify what your agent actually did</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<a class="visually-hidden" href="#app">Skip to content</a>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="#/">
      <span class="brand-mark" aria-hidden="true"></span>
      <span>StateProof</span>
      <span class="brand-tag">The agent said it was done. Prove it.</span>
    </a>
    <nav class="main" id="nav" aria-label="Primary"></nav>
  </div>
</header>
<main id="app" tabindex="-1"></main>
<footer>
  <p>The final answer is a claim. State and process are the evidence.</p>
  <p>Verification is read-only and deterministic. Benchmark figures come from 12 synthetic cases and do not establish generalization.</p>
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
  writeFileSync(path.join(DIST, 'index.html'), SHELL, 'utf8');
  return ['index.html', 'client.js', 'styles.css'];
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
