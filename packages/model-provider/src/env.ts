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

/**
 * `.env` is resolved from the working directory, the way dotenv itself does.
 *
 * Commands are documented as being run from the repository root, so this is
 * the same file either way. Resolving from cwd rather than from this module's
 * location is what lets a test run a CLI in a scratch directory and genuinely
 * observe the no-credentials path, instead of skipping itself whenever the
 * developer happens to have a real `.env`.
 */
export function dotenvPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.env');
}

/** Exported for documentation and tests; not used to resolve at load time. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let loadedFrom: string | null = null;

/** Idempotent per path. Existing environment variables always win over `.env`. */
export function loadLocalEnv(envFilePath: string = dotenvPath()): void {
  if (loadedFrom === envFilePath) return;
  loadedFrom = envFilePath;
  if (!existsSync(envFilePath)) return;
  loadDotenv({ path: envFilePath, override: false });
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
