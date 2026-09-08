import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

/**
 * `pnpm media:capture [--base http://localhost:4180]`
 *
 * Regenerates the screenshots and the walkthrough GIF under `docs/media/` from
 * a running product server. Nothing here is mocked: every frame is the real
 * application rendering the real verifier's output.
 *
 * Requires Playwright's Chromium (`pnpm exec playwright install chromium`).
 * The GIF step additionally needs `ffmpeg` on PATH and is skipped otherwise.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MEDIA_DIR = path.join(REPO_ROOT, 'docs', 'media');

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

const BASE = argValue('--base', 'http://localhost:4180').replace(/\/$/, '');

async function settle(page: Page, ms = 600): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(ms);
}

async function verifyDemo(page: Page): Promise<void> {
  await page.goto(`${BASE}/#/demo`);
  await settle(page);
  await page.getByRole('button', { name: 'Verify this run' }).click();
  await page.waitForURL(/#\/runs\//, { timeout: 30_000 });
  await settle(page, 900);
}

async function screenshots(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    colorScheme: 'light',
  });
  const page = await context.newPage();

  const shot = async (name: string, fullPage: boolean): Promise<void> => {
    await page.screenshot({ path: path.join(MEDIA_DIR, `${name}.png`), fullPage });
    process.stdout.write(`  ${name}.png\n`);
  };

  await page.goto(`${BASE}/#/`);
  await settle(page);
  await shot('home', false);
  await shot('home-full', true);

  await page.goto(`${BASE}/#/demo`);
  await settle(page);
  await shot('demo', false);

  await verifyDemo(page);
  await shot('inspector', false);
  await shot('inspector-full', true);

  await page.goto(`${BASE}/#/import`);
  await settle(page);
  await shot('import', false);

  await page.goto(`${BASE}/#/benchmark`);
  await settle(page);
  await shot('benchmark', false);
  await shot('benchmark-full', true);

  await page.goto(`${BASE}/evidence/`);
  await settle(page);
  await shot('evidence-dashboard', false);

  await context.close();
  await browser.close();
}

async function walkthrough(): Promise<string> {
  const videoDir = path.join(MEDIA_DIR, '.video');
  rmSync(videoDir, { recursive: true, force: true });
  mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/#/`);
  await settle(page, 1800);
  await page.getByRole('link', { name: 'Run the verification demo' }).click();
  await settle(page, 1800);
  await page.getByRole('button', { name: 'Verify this run' }).click();
  await page.waitForURL(/#\/runs\//, { timeout: 30_000 });
  await settle(page, 2400);

  const timeline = page.getByRole('heading', { name: 'Event timeline' });
  await timeline.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(2200);

  await context.close();
  await browser.close();

  const recorded = readdirSync(videoDir).find((file) => file.endsWith('.webm'));
  if (recorded === undefined) throw new Error('Playwright recorded no video');
  const webm = path.join(MEDIA_DIR, 'walkthrough.webm');
  renameSync(path.join(videoDir, recorded), webm);
  rmSync(videoDir, { recursive: true, force: true });
  return webm;
}

function toGif(webm: string): void {
  const gif = path.join(MEDIA_DIR, 'walkthrough.gif');
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    process.stdout.write('  ffmpeg not found; leaving walkthrough.webm without a GIF\n');
    return;
  }
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      webm,
      '-vf',
      'fps=12,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
      '-loop',
      '0',
      gif,
    ],
    { stdio: 'ignore' },
  );
  rmSync(webm, { force: true });
  process.stdout.write('  walkthrough.gif\n');
}

async function main(): Promise<void> {
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });
  process.stdout.write(`capturing from ${BASE}\n`);
  await screenshots();
  const webm = await walkthrough();
  toGif(webm);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
