import { createHash } from 'node:crypto';
import { type JsonValue, isJsonObject } from '../json';

/** Recursively sorts object keys so serialization is order independent. */
export function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isJsonObject(value)) {
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined) continue;
      sorted[key] = canonicalize(child);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashJson(value: JsonValue): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Converts parsed data (which may contain class instances only through JSON
 * round-trippable values) into a plain JsonValue for hashing/serialization.
 */
export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** Combines named part hashes into one stable hash (e.g. a dataset hash). */
export function combineHashes(parts: ReadonlyArray<readonly [string, string]>): string {
  const sorted = [...parts].sort(([leftName], [rightName]) => (leftName < rightName ? -1 : leftName > rightName ? 1 : 0));
  return sha256Hex(sorted.map(([name, hash]) => `${name}:${hash}`).join('\n'));
}
