import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `pnpm video:mux -- --audio video/input/voiceover.wav`
 *
 * Puts Stephen's narration onto the finished cut.
 *
 * The rule that matters here: the voice is never time-stretched. If the reading
 * is materially longer or shorter than the picture, this reports the mismatch
 * with a cue sheet and stops, because silently resampling a human voice to fit
 * an edit sounds wrong in a way nobody can place afterwards.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(ROOT, 'output');
const SILENT = path.join(OUT, 'stateproof-walkthrough-silent.mp4');
const CAPTIONED = path.join(OUT, 'stateproof-walkthrough-captioned.mp4');
const FINAL = path.join(OUT, 'stateproof-final-narrated.mp4');
const REPORT = path.join(OUT, 'voiceover-mismatch-report.md');

/** Beyond this, synchronisation is a judgement call, not a correction. */
const TOLERANCE_SECONDS = 6;

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function seconds(file: string): number {
  return Number.parseFloat(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
      encoding: 'utf8',
    }).trim(),
  );
}

function arg(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function main(): void {
  const audio = arg('--audio') ?? path.join(ROOT, 'input', 'voiceover.wav');
  const useCaptioned = process.argv.includes('--captioned');
  const video = useCaptioned ? CAPTIONED : SILENT;
  const force = process.argv.includes('--force');

  if (!existsSync(audio)) {
    throw new Error(
      `no narration at ${audio}\n` +
        'Record one file at 48 kHz with a second of silence at the top, then re-run.',
    );
  }
  if (!existsSync(video)) throw new Error(`no rendered video at ${video}; run \`pnpm video:render\` first`);

  const videoSeconds = seconds(video);
  const audioSeconds = seconds(audio);
  const drift = audioSeconds - videoSeconds;

  process.stdout.write(`video     ${videoSeconds.toFixed(1)}s  (${path.basename(video)})\n`);
  process.stdout.write(`narration ${audioSeconds.toFixed(1)}s  (${path.basename(audio)})\n`);
  process.stdout.write(`drift     ${drift >= 0 ? '+' : ''}${drift.toFixed(1)}s\n\n`);

  if (Math.abs(drift) > TOLERANCE_SECONDS && !force) {
    const longer = drift > 0 ? 'narration' : 'picture';
    const body = [
      '# Voiceover cue-sheet mismatch',
      '',
      `The narration and the cut differ by **${Math.abs(drift).toFixed(1)} s** — the ${longer} is longer.`,
      `The tolerance is ${String(TOLERANCE_SECONDS)} s. Nothing was muxed.`,
      '',
      '| | Seconds |',
      '| --- | --- |',
      `| Picture (\`${path.basename(video)}\`) | ${videoSeconds.toFixed(1)} |`,
      `| Narration (\`${path.basename(audio)}\`) | ${audioSeconds.toFixed(1)} |`,
      `| Drift | ${drift >= 0 ? '+' : ''}${drift.toFixed(1)} |`,
      '',
      '## What to do',
      '',
      drift > 0
        ? [
            'The reading is longer than the picture. Either:',
            '',
            '- trim words from `video/voiceover-script.md` and re-record; or',
            '- lengthen the clips that need more room in `video/src/clips.ts`, then',
            '  `pnpm video:capture` and `pnpm video:render` again.',
          ].join('\n')
        : [
            'The picture is longer than the reading. Either:',
            '',
            '- add a sentence where the script feels thin; or',
            '- shorten the clip durations in `video/src/clips.ts` and re-render.',
          ].join('\n'),
      '',
      'The voice is deliberately never time-stretched to close a gap this size.',
      'To mux anyway and accept the drift, re-run with `--force`.',
      '',
    ].join('\n');
    writeFileSync(REPORT, body, 'utf8');
    process.stdout.write(`RESULT: MISMATCH — wrote ${path.relative(ROOT, REPORT)}\n`);
    process.exitCode = 1;
    return;
  }

  /*
   * Conservative treatment only:
   *  - silenceremove trims leading silence, not pauses inside the read
   *  - loudnorm to -16 LUFS, the usual target for spoken web video
   *  - apad + -shortest lets a slightly short read end against picture
   */
  const filters = [
    'silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB:detection=peak',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    'apad',
  ].join(',');

  ffmpeg([
    '-i', video,
    '-i', audio,
    '-filter_complex', `[1:a]${filters}[a]`,
    '-map', '0:v:0', '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-shortest', '-movflags', '+faststart',
    FINAL,
  ]);

  const finalSeconds = seconds(FINAL);
  process.stdout.write(`wrote ${path.relative(ROOT, FINAL)}  ${finalSeconds.toFixed(1)}s\n`);
  process.stdout.write('RESULT: MUXED\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
}
