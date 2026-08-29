# Narration input

Record **one file** and save it here as `voiceover.wav`.

```text
48 kHz · mono or stereo · WAV
```

- Quiet room. No aggressive noise reduction — the mux normalises loudness.
- Leave **one second of silence** at the start; the mux trims it.
- One continuous take is fine. The mux does not cut on section boundaries.
- Read from `../teleprompter-script.md`; timings are in `../voiceover-script.md`.

Then:

```bash
pnpm video:mux -- --audio video/input/voiceover.wav
```

If the read is more than six seconds off the picture, the mux stops and writes
`../output/voiceover-mismatch-report.md` rather than stretching your voice to
fit. Nothing here is committed: `.wav` files are git-ignored.
