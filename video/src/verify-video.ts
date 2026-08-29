import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FPS, HEIGHT, MAX_SECONDS, WIDTH } from './clips';

/**
 * `pnpm video:verify`
 *
 * Checks the rendered video the way a reviewer would: does it open, is it the
 * format claimed, is it under time, is any stretch of it blank, do the captions
 * cover what is spoken, and does anything in the sidecar files leak a path or a
 * key.
 *
 * Everything here is ffprobe and file inspection. Nothing is asserted from the
 * render script's own belief about what it produced.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(ROOT, 'output');
const SILENT = path.join(OUT, 'stateproof-walkthrough-silent.mp4');
const CAPTIONED = path.join(OUT, 'stateproof-walkthrough-captioned.mp4');
const NARRATED = path.join(OUT, 'stateproof-final-narrated.mp4');
const SRT = path.join(ROOT, 'captions.srt');
const CUES = path.join(OUT, 'cue-sheet.json');

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
}

function ffprobeJson(file: string): Record<string, unknown> {
  return JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    ),
  ) as Record<string, unknown>;
}

interface Stream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  pix_fmt?: string;
}

function rate(value: string | undefined): number {
  if (value === undefined) return 0;
  const [num, den] = value.split('/').map(Number);
  return den === 0 || den === undefined || num === undefined ? 0 : num / den;
}

/**
 * Blank-frame detection.
 *
 * A long black stretch means a clip failed to record and nobody noticed. This
 * uses FFmpeg's own blackdetect rather than sampling frames, so a two-second
 * hole cannot slip between samples.
 */
function longestBlack(file: string): number {
  const output = execFileSync(
    'ffmpeg',
    ['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.5:pix_th=0.10', '-an', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  );
  let longest = 0;
  for (const match of output.matchAll(/black_duration:([0-9.]+)/g)) {
    longest = Math.max(longest, Number.parseFloat(match[1] ?? '0'));
  }
  return longest;
}

function inspect(file: string, label: string, expectAudio: boolean): number {
  if (!existsSync(file)) {
    check(`${label}: exists`, false, file);
    return 0;
  }
  const info = ffprobeJson(file);
  const streams = (info['streams'] ?? []) as Stream[];
  const format = (info['format'] ?? {}) as { duration?: string; size?: string };
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number.parseFloat(format.duration ?? '0');
  const sizeMb = statSync(file).size / (1024 * 1024);

  check(`${label}: opens`, video !== undefined, `${sizeMb.toFixed(1)} MB`);
  check(`${label}: H.264`, video?.codec_name === 'h264', String(video?.codec_name));
  check(
    `${label}: ${String(WIDTH)}x${String(HEIGHT)}`,
    video?.width === WIDTH && video?.height === HEIGHT,
    `${String(video?.width)}x${String(video?.height)}`,
  );
  check(
    `${label}: ${String(FPS)} fps`,
    Math.abs(rate(video?.avg_frame_rate) - FPS) < 0.5,
    rate(video?.avg_frame_rate).toFixed(2),
  );
  check(`${label}: yuv420p`, video?.pix_fmt === 'yuv420p', String(video?.pix_fmt));
  check(
    `${label}: under ${String(MAX_SECONDS)}s`,
    duration > 0 && duration < MAX_SECONDS,
    `${Math.floor(duration / 60)}m ${(duration % 60).toFixed(0)}s`,
  );
  check(
    `${label}: no blank longer than 2s`,
    longestBlack(file) <= 2,
    `${longestBlack(file).toFixed(1)}s longest black run`,
  );
  if (expectAudio) {
    check(`${label}: has an audio stream`, audio !== undefined, String(audio?.codec_name));
  } else {
    check(`${label}: silent by design`, audio === undefined, audio === undefined ? '' : 'unexpected audio');
  }
  return duration;
}

interface Cue {
  index: number;
  start: number;
  end: number;
  text: string;
}

function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  const toSeconds = (stamp: string): number => {
    const [hms, ms] = stamp.split(',');
    const [h, m, s] = (hms ?? '').split(':').map(Number);
    return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0) + Number(ms ?? 0) / 1000;
  };
  for (const block of text.trim().split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const timing = lines[1] ?? '';
    const match = /([\d:,]+)\s*-->\s*([\d:,]+)/.exec(timing);
    if (match === null) continue;
    cues.push({
      index: Number(lines[0] ?? 0),
      start: toSeconds(match[1] ?? ''),
      end: toSeconds(match[2] ?? ''),
      text: lines.slice(2).join(' '),
    });
  }
  return cues;
}

function main(): void {
  process.stdout.write('StateProof — video verification\n\n');

  const silentSeconds = inspect(SILENT, 'silent', false);
  const captionedSeconds = inspect(CAPTIONED, 'captioned', false);

  if (existsSync(NARRATED)) {
    inspect(NARRATED, 'narrated', true);
  } else {
    process.stdout.write('  --    narrated: not produced yet (waiting on video/input/voiceover.wav)\n');
  }

  // --- captions -------------------------------------------------------------
  if (existsSync(SRT)) {
    const cues = parseSrt(readFileSync(SRT, 'utf8'));
    check('captions: parse', cues.length > 0, `${String(cues.length)} cues`);
    const ordered = cues.every((cue, index) => index === 0 || cue.start >= (cues[index - 1]?.start ?? 0));
    check('captions: in order', ordered);
    const overrun = cues.filter((cue) => cue.end > silentSeconds + 0.5);
    check('captions: none run past the picture', overrun.length === 0, `${String(overrun.length)} overrun`);
    const last = cues[cues.length - 1];
    check(
      'captions: cover the spoken timeline',
      last !== undefined && last.end > silentSeconds * 0.85,
      last === undefined ? 'none' : `last cue ends at ${last.end.toFixed(1)}s of ${silentSeconds.toFixed(1)}s`,
    );
    const negative = cues.filter((cue) => cue.end <= cue.start);
    check('captions: every cue has duration', negative.length === 0, `${String(negative.length)} zero-length`);
  } else {
    check('captions: exist', false, SRT);
  }

  // --- the things that must never ship ---------------------------------------
  const sidecars = [SRT, CUES, path.join(ROOT, 'voiceover-script.md'), path.join(ROOT, 'teleprompter-script.md')];
  const leaky: string[] = [];
  for (const file of sidecars) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (/sk-ant-|API_KEY\s*[:=]\s*\S|[A-Za-z]:\\Users\\|\/home\/[a-z]/i.test(text)) leaky.push(path.basename(file));
  }
  check('no secret or local path in sidecar files', leaky.length === 0, leaky.join(', '));

  // --- section durations against the plan -------------------------------------
  if (existsSync(CUES)) {
    const cueSheet = JSON.parse(readFileSync(CUES, 'utf8')) as {
      totalSeconds: number;
      segments: Array<{ id: string; kind: string; seconds: number }>;
    };
    check(
      'cue sheet matches the rendered length',
      Math.abs(cueSheet.totalSeconds - silentSeconds) < 2,
      `${cueSheet.totalSeconds.toFixed(1)}s planned vs ${silentSeconds.toFixed(1)}s rendered`,
    );
    const short = cueSheet.segments.filter((segment) => segment.kind === 'clip' && segment.seconds < 8);
    check('no clip shorter than 8s', short.length === 0, short.map((s) => s.id).join(', '));
    check(
      'captioned matches silent length',
      Math.abs(captionedSeconds - silentSeconds) < 2,
      `${captionedSeconds.toFixed(1)}s vs ${silentSeconds.toFixed(1)}s`,
    );
  }

  for (const entry of checks) {
    process.stdout.write(`  ${entry.ok ? 'ok  ' : 'FAIL'}  ${entry.name.padEnd(44)} ${entry.detail}\n`);
  }

  const failed = checks.filter((entry) => !entry.ok);
  const result = failed.length === 0 ? 'PASSED' : 'FAILED';

  const report = [
    '# Video verification',
    '',
    `Generated ${new Date().toISOString()}`,
    '',
    `**RESULT: ${result}** — ${String(checks.length - failed.length)}/${String(checks.length)} checks`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    ...checks.map((entry) => `| ${entry.name} | ${entry.ok ? 'pass' : '**FAIL**'} | ${entry.detail} |`),
    '',
    '## Files',
    '',
    ...[SILENT, CAPTIONED, NARRATED]
      .filter((file) => existsSync(file))
      .map((file) => `- \`video/output/${path.basename(file)}\` — ${(statSync(file).size / (1024 * 1024)).toFixed(1)} MB`),
    '',
  ].join('\n');

  writeFileSync(path.join(OUT, 'video-verification-report.md'), report, 'utf8');
  writeFileSync(
    path.join(OUT, 'video-verification-report.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), result, checks }, null, 2)}\n`,
    'utf8',
  );

  process.stdout.write(`\nRESULT: ${result} (${String(checks.length)} checks)\n`);
  if (failed.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
}
