import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARD_CASES_DIR, loadAgentVisibleCase } from '@stateproof/benchmark';
import { toJsonValue } from '@stateproof/core';
import { writeZip } from '../apps/product/src/server/zip';

/**
 * `pnpm sample:build`
 *
 * Builds `samples/stateproof-sample-run.zip`, the package a judge can drop into
 * the product's import screen without assembling seven files by hand.
 *
 * It is built through `loadAgentVisibleCase`, which is the gold-isolated loader
 * the evaluation itself uses: it can only see the six files an agent could have
 * seen. `case-metadata.json`, `gold-contract.json` and `gold-verdict.json` are
 * not reachable from here, so the sample cannot leak a label even by mistake.
 *
 * `PBH-A01` rather than the demo case, so importing it exercises a different
 * task template and a different frozen contract than the built-in demo — and so
 * a judge sees a second, independent verification rather than a repeat.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SAMPLE_CASE_ID = 'PBH-A01';
const OUT_DIR = path.join(REPO_ROOT, 'samples');
const OUT_NAME = 'stateproof-sample-run.zip';

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(toJsonValue(value), null, 2)}\n`;
}

function main(): void {
  const visible = loadAgentVisibleCase(SAMPLE_CASE_ID, { casesDir: HARD_CASES_DIR });

  const entries = [
    { name: 'task.json', contents: canonicalJson(visible.task) },
    { name: 'tool-registry.json', contents: canonicalJson(visible.toolRegistry) },
    { name: 'initial-state.json', contents: canonicalJson(visible.initialState) },
    {
      name: 'trajectory.jsonl',
      contents: `${visible.trajectory.map((event) => JSON.stringify(toJsonValue(event))).join('\n')}\n`,
    },
    { name: 'final-state.json', contents: canonicalJson(visible.finalState) },
    { name: 'final-response.txt', contents: visible.finalResponse },
  ];

  // A last, explicit refusal: nothing that is not an agent-visible file may be
  // in the archive, whatever the loader might return in future.
  const permitted = new Set(entries.map((entry) => entry.name));
  for (const name of permitted) {
    if (/gold|metadata|verdict|label|split/i.test(name)) {
      throw new Error(`refusing to package ${name}: it is not an agent-visible file`);
    }
  }

  const zip = writeZip(entries);
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, OUT_NAME);
  writeFileSync(outPath, zip);

  const digest = createHash('sha256').update(zip).digest('hex');
  process.stdout.write(
    [
      `sample package: samples/${OUT_NAME}`,
      `case:           ${SAMPLE_CASE_ID} (development split)`,
      `entries:        ${entries.map((entry) => entry.name).join(', ')}`,
      `bytes:          ${zip.length}`,
      `sha256:         ${digest}`,
      '',
    ].join('\n'),
  );
}

main();
