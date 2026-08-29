import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboard } from './build';

/**
 * `pnpm dev` — build, then serve the generated site.
 *
 * Deliberately dumb: no watcher, no bundler, no live reload. The dashboard is a
 * view over artifacts that only change when a run happens, so a rebuild is a
 * command, not a background process.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DIST = path.join(REPO_ROOT, 'apps', 'dashboard', 'dist');
const PORT = Number.parseInt(process.env['PORT'] ?? '4173', 10);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

buildDashboard();

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  // Serving the repository root as well lets artifact links resolve.
  const candidates = [path.join(DIST, relative), path.join(REPO_ROOT, relative)];
  for (const candidate of candidates) {
    if (!candidate.startsWith(DIST) && !candidate.startsWith(REPO_ROOT)) continue;
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    response.writeHead(200, { 'content-type': TYPES[path.extname(candidate)] ?? 'text/plain; charset=utf-8' });
    response.end(readFileSync(candidate));
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(`not found: ${relative}\n`);
}).listen(PORT, () => {
  process.stdout.write(`StateProof dashboard: http://localhost:${PORT}/\n`);
});
