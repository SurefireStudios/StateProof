import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIPS, TITLE_CARD, plannedSeconds } from './clips';
import { NARRATION, NOTES, wordCount } from './narration';

/**
 * `pnpm video:script`
 *
 * Writes the voiceover script and the teleprompter from `narration.ts`, using
 * the *measured* cue sheet when one exists and the planned durations otherwise.
 *
 * Two documents from one source, because a teleprompter that has drifted from
 * the script is worse than no teleprompter.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CUES = path.join(ROOT, 'output', 'cue-sheet.json');

/** ~140 wpm is an unhurried read; the picture is paced for it. */
const WORDS_PER_SECOND = 140 / 60;

interface Window {
  readonly id: string;
  readonly start: number;
  readonly seconds: number;
}

function windows(): Window[] {
  if (existsSync(CUES)) {
    const sheet = JSON.parse(readFileSync(CUES, 'utf8')) as {
      segments: Array<{ id: string; kind: string; seconds: number }>;
    };
    const result: Window[] = [];
    let cursor = 0;
    for (const segment of sheet.segments) {
      if (segment.kind !== 'card') {
        const key = segment.kind === 'title' ? 'title' : segment.id;
        const existing = result.find((entry) => entry.id === key);
        if (existing === undefined) result.push({ id: key, start: cursor, seconds: segment.seconds });
      }
      cursor += segment.seconds;
    }
    return result;
  }

  // No render yet: fall back to the plan so the script can be written first.
  const result: Window[] = [{ id: 'title', start: 0, seconds: TITLE_CARD.seconds }];
  let cursor = TITLE_CARD.seconds;
  for (const clip of CLIPS) {
    cursor += clip.card?.seconds ?? 0;
    result.push({ id: clip.id, start: cursor, seconds: clip.seconds });
    cursor += clip.seconds;
  }
  return result;
}

function stamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m)}:${String(s).padStart(2, '0')}`;
}

function main(): void {
  const measured = existsSync(CUES);
  const cues = windows();
  const total = cues.length === 0 ? plannedSeconds() : cues[cues.length - 1]!.start + cues[cues.length - 1]!.seconds;

  const purpose = new Map(CLIPS.map((clip) => [clip.id, clip.purpose]));
  purpose.set('title', 'Title card');

  // --- voiceover script -----------------------------------------------------
  const script: string[] = [
    '# Voiceover script',
    '',
    `${measured ? 'Timings are **measured** from the rendered cut' : 'Timings are **planned**; re-run after `pnpm video:render` to measure them'}.`,
    `Total picture: **${stamp(total)}**. Script: **${String(wordCount())} words**, about ` +
      `${stamp(wordCount() / WORDS_PER_SECOND)} at 140 words per minute.`,
    '',
    'Read it unhurried. The picture has room, and the three number pairs are the',
    'whole point — slow down on those.',
    '',
    '---',
    '',
  ];

  for (const window of cues) {
    const lines = NARRATION.filter((line) => line.at === window.id);
    if (lines.length === 0) continue;
    const words = lines.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0);
    const needed = words / WORDS_PER_SECOND;
    const room = window.seconds - needed;
    script.push(
      `## ${stamp(window.start)} – ${stamp(window.start + window.seconds)} · ${purpose.get(window.id) ?? window.id}`,
      '',
      `*${String(words)} words in ${window.seconds.toFixed(0)} s — ` +
        `${room >= 0 ? `${room.toFixed(0)} s of headroom` : `**${Math.abs(room).toFixed(0)} s over, trim this one**`}*`,
      '',
      ...lines.map((line) => `> ${line.text}`),
      '',
    );
  }

  script.push(
    '---',
    '',
    '## Pronunciation and delivery',
    '',
    '| | |',
    '| --- | --- |',
    ...NOTES.map(([term, note]) => `| \`${term}\` | ${note} |`),
    '',
    '## Recording',
    '',
    '- 48 kHz WAV, mono or stereo',
    '- Quiet room; no aggressive noise reduction — the mux normalises loudness',
    '- Leave **one second of silence** at the start; the mux trims it',
    '- One continuous take is fine: the mux does not cut on section boundaries',
    '- Save as `video/input/voiceover.wav`',
    '',
    '```bash',
    'pnpm video:mux -- --audio video/input/voiceover.wav',
    '```',
    '',
    'If the read is more than six seconds off the picture, the mux stops and',
    'writes `video/output/voiceover-mismatch-report.md` rather than quietly',
    'stretching your voice to fit.',
    '',
  );
  writeFileSync(path.join(ROOT, 'voiceover-script.md'), script.join('\n'), 'utf8');

  // --- teleprompter ---------------------------------------------------------
  const prompter: string[] = [
    '# Teleprompter',
    '',
    'Large type, short lines, one idea per line. Section headings are cues, not',
    'spoken. Blank lines are breaths.',
    '',
    '---',
    '',
  ];
  for (const window of cues) {
    const lines = NARRATION.filter((line) => line.at === window.id);
    if (lines.length === 0) continue;
    prompter.push(`### [ ${stamp(window.start)} ]`, '');
    for (const line of lines) {
      // Break on sentence boundaries: a prompter line should never wrap.
      for (const sentence of line.text.split(/(?<=[.?!—])\s+/)) {
        if (sentence.trim() !== '') prompter.push(sentence.trim(), '');
      }
    }
    prompter.push('');
  }
  writeFileSync(path.join(ROOT, 'teleprompter-script.md'), prompter.join('\n'), 'utf8');

  process.stdout.write(
    [
      `voiceover-script.md      ${String(wordCount())} words, ${measured ? 'measured' : 'planned'} timings`,
      `teleprompter-script.md   written`,
      `picture                  ${stamp(total)}`,
      `spoken estimate          ${stamp(wordCount() / WORDS_PER_SECOND)}`,
      '',
    ].join('\n'),
  );

  if (wordCount() > 650) {
    process.stdout.write(`warning: ${String(wordCount())} words is over the 650-word budget\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
}
