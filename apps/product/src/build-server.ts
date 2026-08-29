import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * `pnpm product:server:build`
 *
 * Bundles the server to one runnable JavaScript file so production runs on
 * `node`, not on `tsx`. A dev-mode TypeScript loader in a container is a
 * needless dependency, a slower boot and a larger image.
 *
 * The output goes to `dist-server/` rather than `dist/`, because the client
 * build wipes `dist/` and the two must not race.
 *
 * `@stateproof/model-provider` is deliberately *not* excluded — the server
 * imports it dynamically and only when live compilation is enabled, so bundling
 * it costs nothing at runtime and keeps the image self-contained.
 */

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = path.join(APP_ROOT, 'dist-server');

export async function buildProductServer(): Promise<string> {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const outfile = path.join(OUT_DIR, 'index.js');
  await build({
    entryPoints: [path.join(APP_ROOT, 'src', 'server', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node20'],
    outfile,
    minify: false,
    sourcemap: false,
    logLevel: 'silent',
    // esbuild cannot see through `createRequire`-style dynamic requires in some
    // dependencies; leaving Node built-ins external is enough here.
    external: ['node:*'],
    banner: {
      // A few dependencies reach for CommonJS globals even in ESM output.
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
  });

  return path.relative(process.cwd(), outfile);
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('src/build-server.ts');
if (invokedDirectly) {
  buildProductServer()
    .then((outfile) => {
      process.stdout.write(`product server built: ${outfile}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
