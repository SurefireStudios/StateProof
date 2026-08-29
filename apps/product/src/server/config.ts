import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runtime configuration for the hosted product.
 *
 * Everything here has a safe default, because the public deployment has no
 * secrets: it runs with an empty environment except `PORT`, and every capability
 * that could cost money or reach a network is off unless someone turns it on
 * deliberately.
 */

/**
 * Where the committed data lives — benchmarks, artifacts, prompts, submission.
 *
 * Resolved by walking up for a marker rather than by counting `../` segments,
 * because the server runs both from `src/server/` under tsx and from a bundle in
 * `dist-server/`, and those are at different depths. `STATEPROOF_ROOT` overrides
 * it for hosts that lay the tree out differently.
 */
export function resolveRoot(startDir?: string): string {
  const override = process.env['STATEPROOF_ROOT'];
  if (override !== undefined && override.trim() !== '') return path.resolve(override);

  const markers = ['pnpm-workspace.yaml', path.join('benchmarks', 'phantombench-hard-12')];
  let current = startDir ?? path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 12; depth += 1) {
    if (markers.some((marker) => existsSync(path.join(current, marker)))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(value)) return false;
  return fallback;
}

function integer(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly root: string;
  /**
   * Off by default, and off in the public deployment. When false the model
   * provider is never even imported, so no client is constructed and no
   * credential is read.
   */
  readonly liveCompilationEnabled: boolean;
  readonly maxBodyBytes: number;
  readonly maxConcurrentJobs: number;
  readonly rateLimitPerMinute: number;
}

export const LIVE_COMPILATION_ENV = 'STATEPROOF_ENABLE_LIVE_COMPILATION';

export function loadConfig(): ServerConfig {
  return {
    // 0.0.0.0 by default: a container that binds to localhost is unreachable
    // from outside itself, which is the classic way a deploy looks healthy and
    // serves nothing.
    host: process.env['HOST'] ?? '0.0.0.0',
    port: integer('PORT', 4180),
    root: resolveRoot(),
    liveCompilationEnabled: flag(LIVE_COMPILATION_ENV, false),
    maxBodyBytes: integer('STATEPROOF_MAX_BODY_BYTES', 12 * 1024 * 1024),
    maxConcurrentJobs: integer('STATEPROOF_MAX_CONCURRENT_JOBS', 4),
    rateLimitPerMinute: integer('STATEPROOF_RATE_LIMIT_PER_MINUTE', 30),
  };
}
