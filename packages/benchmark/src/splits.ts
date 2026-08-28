import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type JsonValue, type Split, type SplitManifest, SplitManifestSchema } from '@stateproof/core';
import { parseOrThrow } from './load-agent-input';
import { SPLITS_DIR } from './paths';

/**
 * Split membership is orchestration metadata, not case content: a runner needs
 * to know which cases to run, but no split label may ever reach a model.
 * It lives in its own module so the baseline runner can read it without
 * importing anything that can load gold data.
 */
export function loadSplitManifest(split: Split, splitsDir: string = SPLITS_DIR): SplitManifest {
  const filePath = path.join(splitsDir, `${split}.json`);
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as JsonValue;
  return parseOrThrow(SplitManifestSchema, raw, split, `splits/${split}.json`);
}

export function caseIdsForSplit(split: Split, splitsDir: string = SPLITS_DIR): string[] {
  return [...loadSplitManifest(split, splitsDir).caseIds].sort();
}
