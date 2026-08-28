import { z } from 'zod';

/** Values that survive a JSON round-trip unchanged. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.lazy(() => z.record(JsonValueSchema));

/** Narrows an unknown value to a JSON object without using `any`. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a dotted path (`amount.currency`) out of a JSON object.
 * Returns `undefined` when any segment is missing, which callers treat as
 * "the data does not contain this field" rather than as an error.
 */
export function readPath(source: JsonObject, path: string): JsonValue | undefined {
  const segments = path.split('.');
  let current: JsonValue | undefined = source;
  for (const segment of segments) {
    if (!isJsonObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}
