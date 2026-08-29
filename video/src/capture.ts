import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { CLIPS, FPS, HEIGHT, WIDTH, type Clip } from './clips';

/**
 * `pnpm video:capture`
 *
 * Records one Playwright video per clip against the running product.
 *
 * Each clip gets its own browser context, which is what makes the take
 * recoverable: a clip that fails leaves the others intact and can be re-shot on
 * its own with `--only`. Playwright writes the file when the *context* closes,
 * so every context is closed explicitly rather than left to the browser.
 *
 * The viewport is recorded, not the desktop, so no browser chrome, address bar,
 * profile or bookmark ever enters the frame.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RAW_DIR = path.join(ROOT, 'output', 'raw');

interface Options {
  readonly base: string;
  readonly only: string[];
}

function parseArgs(): Options {
  const argv = process.argv.slice(2);
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const only = read('--only');
  return {
    base: (read('--base') ?? 'https://stateproof-production.up.railway.app').replace(/\/$/, ''),
    only: only === undefined ? [] : only.split(',').map((value) => value.trim()).filter(Boolean),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A visible cursor.
 *
 * Playwright's mouse leaves no trace on video, and a click that happens with no
 * pointer on screen reads as a glitch rather than an action. This draws one and
 * moves it with easing, so the viewer can follow what is being pressed.
 */
const CURSOR_SCRIPT = `
  (function () {
    var dot = null;
    // addInitScript runs at document-start, when documentElement may not exist
    // yet. Creating the element eagerly threw and took the whole script with it,
    // so the helpers below were never defined and every clip that clicks failed.
    function ensure() {
      if (dot !== null && dot.isConnected) return dot;
      var host = document.body || document.documentElement;
      if (!host) return null;
      dot = document.createElement('div');
      dot.id = '__cursor';
      dot.style.cssText = [
        'position:fixed', 'z-index:2147483647', 'left:0', 'top:0',
        'width:22px', 'height:22px', 'margin:-11px 0 0 -11px',
        'border-radius:50%', 'pointer-events:none',
        'background:rgba(255,255,255,.92)',
        'box-shadow:0 0 0 2px rgba(0,0,0,.55), 0 2px 10px rgba(0,0,0,.5)',
        'transition:transform 90ms ease-out', 'opacity:0'
      ].join(';');
      host.appendChild(dot);
      return dot;
    }
    window.__moveCursor = function (x, y) {
      var node = ensure();
      if (!node) return;
      node.style.opacity = '1';
      node.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    };
    window.__pressCursor = function () {
      var node = ensure();
      if (!node || !node.animate) return;
      var at = node.style.transform;
      node.animate(
        [{ transform: at + ' scale(1)' },
         { transform: at + ' scale(0.55)' },
         { transform: at + ' scale(1)' }],
        { duration: 260, easing: 'ease-out' }
      );
    };
  })();
`;

async function showCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(`window.__moveCursor(${String(x)}, ${String(y)})`);
}

/** A deliberate click: move, settle, press, then let the result land. */
async function humanClick(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await sleep(500);
  const box = await target.boundingBox();
  if (box === null) throw new Error(`no box for ${selector}`);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await showCursor(page, x, y);
  await sleep(650);
  await page.evaluate('window.__pressCursor()');
  await page.mouse.move(x, y);
  await target.click();
  await sleep(400);
}

/*
 * Browser-side code is passed as source strings, not as functions.
 *
 * tsx compiles with esbuild's `keepNames`, which rewrites named inner functions
 * to reference a `__name` helper. Playwright serialises the function and
 * evaluates it in the page, where that helper does not exist — every clip died
 * on `ReferenceError: __name is not defined`. A string has no such baggage.
 */
async function glide(page: Page, toY: number, ms: number): Promise<void> {
  await page.evaluate(`new Promise((resolve) => {
    var start = window.scrollY;
    var delta = ${String(Math.round(toY))} - start;
    var began = performance.now();
    var tick = function (now) {
      var t = Math.min(1, (now - began) / ${String(ms)});
      // easeInOutCubic: no snap at either end
      var eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      window.scrollTo(0, start + delta * eased);
      if (t < 1) requestAnimationFrame(tick); else resolve(null);
    };
    requestAnimationFrame(tick);
  })`);
}

async function scrollToSelector(page: Page, selector: string, ms = 1400): Promise<void> {
  const y = (await page.evaluate(
    `(function () {
      var node = document.querySelector(${JSON.stringify(selector)});
      if (node === null) return null;
      return Math.max(0, window.scrollY + node.getBoundingClientRect().top - 140);
    })()`,
  )) as number | null;
  if (y === null) throw new Error(`missing ${selector}`);
  await glide(page, y, ms);
}

/**
 * Scroll to a heading by its text.
 *
 * `h2:has-text(...)` is a Playwright selector and means nothing to
 * `document.querySelector`, which is where this code actually runs. Matching on
 * textContent keeps the lookup honest and survives copy edits that CSS
 * positional selectors would not.
 */
async function scrollToHeading(page: Page, text: string, ms = 1600): Promise<void> {
  const y = (await page.evaluate(
    `(function () {
      var wanted = ${JSON.stringify(text.toLowerCase())};
      var nodes = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3'));
      for (var i = 0; i < nodes.length; i += 1) {
        var label = (nodes[i].textContent || '').toLowerCase();
        if (label.indexOf(wanted) !== -1) {
          return Math.max(0, window.scrollY + nodes[i].getBoundingClientRect().top - 140);
        }
      }
      return null;
    })()`,
  )) as number | null;
  if (y === null) throw new Error(`no heading containing "${text}"`);
  await glide(page, y, ms);
}

/** What each clip does once its page is loaded. */
async function performClip(page: Page, clip: Clip): Promise<void> {
  switch (clip.id) {
    case 'problem':
      await sleep(4500);
      await scrollToSelector(page, '.proof', 1600);
      await sleep(8000);
      await scrollToSelector(page, '.proof-reality .findings', 1200);
      await sleep(10000);
      await scrollToSelector(page, '.grid-2 .card', 1500);
      await sleep(7000);
      break;

    case 'baseline':
      await sleep(3500);
      await scrollToHeading(page, 'Quality, by split', 1500);
      await sleep(9000);
      await scrollToSelector(page, '.table-wrap:last-of-type', 1600);
      await sleep(16000);
      break;

    case 'demo-setup':
      await sleep(3000);
      await scrollToSelector(page, '.grid-2', 1400);
      await sleep(9000);
      await scrollToSelector(page, '.grid-3', 1400);
      await sleep(5000);
      break;

    case 'demo-verify':
      await sleep(2000);
      await humanClick(page, '#verify-button');
      await page.waitForSelector('.run-title .pill', { timeout: 30_000 });
      await sleep(4500);
      await scrollToSelector(page, '.contrast', 1400);
      await sleep(9000);
      await scrollToSelector(page, '.kv.card', 1300);
      await sleep(8000);
      break;

    case 'demo-findings':
      await page.waitForSelector('.req', { timeout: 30_000 });
      await scrollToSelector(page, '#requirements', 1400);
      await sleep(5000);
      await scrollToSelector(page, '.req.r-fail', 1200);
      await sleep(12000);
      break;

    case 'demo-timeline':
      await page.waitForSelector('#timeline', { timeout: 30_000 });
      await scrollToSelector(page, '#timeline', 1500);
      await sleep(4000);
      await scrollToSelector(page, '.event.k-approval', 1400);
      await sleep(10000);
      break;

    case 'architecture':
      await sleep(3000);
      await glide(page, 420, 1800);
      await sleep(9000);
      await glide(page, 1100, 2000);
      await sleep(13000);
      break;

    case 'comparison':
      await sleep(2500);
      await scrollToHeading(page, 'Model usage', 1600);
      await sleep(12000);
      await scrollToHeading(page, 'What this does not show', 1800);
      await sleep(11000);
      break;

    case 'changelog':
      await sleep(2500);
      await glide(page, 500, 1800);
      await sleep(9000);
      await glide(page, 1300, 2200);
      await sleep(9000);
      await glide(page, 2100, 2200);
      await sleep(11000);
      break;

    case 'reproduce':
      await page.waitForSelector('#import-output .card', { timeout: 30_000 });
      await scrollToSelector(page, '#import-output', 1400);
      await sleep(5000);
      await humanClick(page, '#import-output button');
      await page.waitForSelector('.run-title .pill', { timeout: 30_000 });
      await sleep(9000);
      break;

    case 'traces':
      await sleep(2500);
      await glide(page, 600, 1800);
      await sleep(11000);
      break;

    case 'closing':
      await sleep(3000);
      await scrollToSelector(page, '.hot-take', 1600);
      await sleep(7000);
      break;

    default:
      await sleep(clip.seconds * 1000);
  }
}

/**
 * Clips 5 and 6 continue from the verification in clip 4, so they navigate to
 * the demo and re-verify rather than assuming a run id survives.
 */
async function prepare(page: Page, clip: Clip, base: string): Promise<void> {
  if (clip.id === 'demo-findings' || clip.id === 'demo-timeline') {
    await page.goto(`${base}/demo`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#verify-button', { timeout: 30_000 });
    await page.click('#verify-button');
    await page.waitForSelector('.req', { timeout: 30_000 });
    return;
  }
  await page.goto(`${base}${clip.route}`, { waitUntil: 'networkidle' });
  if (clip.id === 'reproduce') {
    await page.waitForSelector('#import-output .card', { timeout: 30_000 });
  }
}

async function captureClip(browser: Browser, clip: Clip, base: string): Promise<string> {
  const dir = path.join(RAW_DIR, clip.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: WIDTH, height: HEIGHT } },
    // No profile, no storage, no credentials: a clean context every time.
    storageState: undefined,
    colorScheme: 'dark',
  });
  // The reveal animations are part of the product; the *scroll* easing is ours.
  await context.addInitScript(CURSOR_SCRIPT);

  const page = await context.newPage();
  try {
    await prepare(page, clip, base);
    await sleep(900);
    await performClip(page, clip);
    await sleep(700);
  } finally {
    // Playwright flushes the video on context close, not on page close.
    await context.close();
  }

  const written = readdirSync(dir).filter((file) => file.endsWith('.webm'));
  const source = written[0];
  if (source === undefined) throw new Error(`${clip.id}: playwright wrote no video`);
  const target = path.join(RAW_DIR, `${clip.id}.webm`);
  rmSync(target, { force: true });
  renameSync(path.join(dir, source), target);
  rmSync(dir, { recursive: true, force: true });
  return target;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const wanted = options.only.length === 0 ? CLIPS : CLIPS.filter((clip) => options.only.includes(clip.id));
  if (wanted.length === 0) throw new Error('no clips matched --only');

  process.stdout.write(`capturing ${String(wanted.length)} clip(s) from ${options.base}\n`);
  process.stdout.write(`viewport ${String(WIDTH)}x${String(HEIGHT)} at ${String(FPS)} fps\n\n`);

  // Fail early and clearly rather than recording twelve clips of an error page.
  const probe = await fetch(`${options.base}/healthz`).catch(() => null);
  if (probe === null || !probe.ok) {
    throw new Error(
      `${options.base}/healthz did not answer. Start a local server and pass ` +
        '--base http://localhost:4180, or wait for the deployment.',
    );
  }

  mkdirSync(RAW_DIR, { recursive: true });
  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--hide-scrollbars'],
  });

  const results: Array<{ id: string; file: string; ok: boolean; error?: string }> = [];
  try {
    for (const clip of wanted) {
      const started = Date.now();
      try {
        const file = await captureClip(browser, clip, options.base);
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        process.stdout.write(`  ok    ${clip.id.padEnd(16)} ${seconds}s  ${path.basename(file)}\n`);
        results.push({ id: clip.id, file, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(`  FAIL  ${clip.id.padEnd(16)} ${message}\n`);
        results.push({ id: clip.id, file: '', ok: false, error: message });
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(
    path.join(RAW_DIR, 'capture-manifest.json'),
    `${JSON.stringify({ base: options.base, capturedAt: new Date().toISOString(), results }, null, 2)}\n`,
    'utf8',
  );

  const failed = results.filter((result) => !result.ok);
  process.stdout.write(
    `\n${String(results.length - failed.length)}/${String(results.length)} captured\n`,
  );
  if (failed.length > 0) {
    process.stdout.write(`re-shoot with: pnpm video:capture -- --only ${failed.map((f) => f.id).join(',')}\n`);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});

export { RAW_DIR };
void existsSync;
