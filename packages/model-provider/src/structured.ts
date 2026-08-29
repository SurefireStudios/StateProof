import { z } from 'zod';
import type { ModelClient, ModelRequest, RawAttempt } from './types';

/**
 * One structured request, with at most one schema-repair retry.
 *
 * The repair budget is part of the fairness contract: whatever the baseline
 * gets here, the StateProof agents must get too. Every attempt is captured -
 * prompt, raw response, usage, and validation error - so a parsing failure is
 * inspectable rather than invisible.
 */

export const SEMANTIC_REPAIR_INSTRUCTION = [
  'Your previous response matched the JSON schema but is not a usable contract.',
  '',
  'Problems found:',
  '{{VALIDATION_ERRORS}}',
  '',
  'Return a corrected JSON object only. Fix exactly these problems, keep everything',
  'else as it was, and do not add markdown, explanations, or fields outside the schema.',
].join('\n');

export const REPAIR_INSTRUCTION = [
  'Your previous response did not match the required JSON schema.',
  '',
  'Validation errors:',
  '{{VALIDATION_ERRORS}}',
  '',
  'Return a corrected JSON object only. Preserve the meaning of your original',
  'analysis. Do not add markdown, explanations, or fields that are not in the schema.',
].join('\n');

export interface StructuredRequestOptions<T> {
  readonly client: ModelClient;
  readonly system: string;
  readonly userMessage: string;
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Extra repair attempts after the first response. Fixed at 1 for the benchmark. */
  readonly maxRepairAttempts?: number;
  /**
   * Checks a schema-valid response is actually usable, returning one message
   * per problem. It shares the repair budget with schema failures: a response
   * that parses but says something impossible is not a better outcome than one
   * that does not parse, so it gets the same single correction and no more.
   */
  readonly semanticValidate?: (value: T) => readonly string[];
}

export interface StructuredResult<T> {
  readonly value: T | null;
  readonly attempts: RawAttempt[];
  /** Every validation failure, in order. Empty when the first attempt parsed. */
  readonly parseErrors: string[];
}

/**
 * Extracts a JSON object from a model response. Models sometimes wrap JSON in
 * a fenced block despite instructions; tolerating that is not the same as
 * tolerating a wrong answer, so it does not consume the repair budget.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  return JSON.parse(candidate) as unknown;
}

function describeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

export async function requestStructured<T>(
  options: StructuredRequestOptions<T>,
): Promise<StructuredResult<T>> {
  const maxRepairAttempts = options.maxRepairAttempts ?? 1;
  const attempts: RawAttempt[] = [];
  const parseErrors: string[] = [];

  let messages: ModelRequest['messages'] = [{ role: 'user', content: options.userMessage }];

  for (let attempt = 1; attempt <= maxRepairAttempts + 1; attempt += 1) {
    const request: ModelRequest = { system: options.system, messages };
    const response = await options.client.complete(request);

    let value: T | null = null;
    let validationError: string | null = null;
    let failureKind: 'schema' | 'semantic' = 'schema';
    try {
      value = options.schema.parse(extractJson(response.text));
    } catch (error) {
      validationError = describeError(error);
    }

    if (value !== null && options.semanticValidate !== undefined) {
      const problems = options.semanticValidate(value);
      if (problems.length > 0) {
        failureKind = 'semantic';
        // Recorded on the attempt itself, so the raw artifact shows exactly
        // what was wrong rather than just that something was.
        validationError = `semantic validation failed: ${problems.join('; ')}`;
        value = null;
      }
    }

    attempts.push({
      attempt,
      kind: attempt === 1 ? 'initial' : 'repair',
      system: request.system,
      messages: request.messages.map((message) => ({ ...message })),
      responseText: response.text,
      stopReason: response.stopReason,
      usage: response.usage,
      validationError,
    });

    if (validationError === null && value !== null) {
      return { value, attempts, parseErrors };
    }

    parseErrors.push(validationError ?? 'unknown validation failure');
    if (attempt === maxRepairAttempts + 1) break;

    const instruction =
      failureKind === 'semantic' ? SEMANTIC_REPAIR_INSTRUCTION : REPAIR_INSTRUCTION;
    messages = [
      ...messages,
      { role: 'assistant', content: response.text },
      {
        role: 'user',
        content: instruction.replace('{{VALIDATION_ERRORS}}', validationError ?? ''),
      },
    ];
  }

  return { value: null, attempts, parseErrors };
}
