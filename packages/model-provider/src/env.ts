import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/**
 * Loads a local `.env` so the documented credential path actually works.
 *
 * `.env` is git-ignored. Nothing here prints or persists a credential: the key
 * is read from the environment at client construction and never enters the
 * recorded configuration, the run manifest, or any artifact.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const DOTENV_PATH = path.join(REPO_ROOT, '.env');

let loaded = false;

/** Idempotent. Existing environment variables always win over `.env`. */
export function loadLocalEnv(dotenvPath: string = DOTENV_PATH): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(dotenvPath)) return;
  loadDotenv({ path: dotenvPath, override: false });
}

function readNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }
  return value;
}

const EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ModelEffort = (typeof EFFORT_VALUES)[number];

function readEffort(name: string): ModelEffort | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const match = EFFORT_VALUES.find((value) => value === raw);
  if (match === undefined) {
    throw new Error(`${name} must be one of ${EFFORT_VALUES.join(', ')}, received "${raw}"`);
  }
  return match;
}

export interface ModelEnvOverrides {
  readonly modelId?: string | undefined;
  readonly effort?: ModelEffort | undefined;
  readonly maxTokens?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * Optional overrides, recorded at their actual values in the run manifest so a
 * result can never be attributed to the wrong configuration.
 */
export function readModelEnvOverrides(): ModelEnvOverrides {
  loadLocalEnv();
  const modelId = process.env['STATEPROOF_MODEL_ID'];
  return {
    modelId: modelId === undefined || modelId.trim() === '' ? undefined : modelId,
    effort: readEffort('STATEPROOF_MODEL_EFFORT'),
    maxTokens: readNumber('STATEPROOF_MODEL_MAX_TOKENS'),
    timeoutMs: readNumber('STATEPROOF_MODEL_TIMEOUT_MS'),
  };
}
