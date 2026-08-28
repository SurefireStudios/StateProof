import { z } from 'zod';

/** Configuration values recorded verbatim in every run manifest. */
export type ModelConfigurationValue = string | number | boolean | null;

export interface ModelMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ModelRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
}

export interface ModelUsageReport {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelResponse {
  readonly text: string;
  readonly usage: ModelUsageReport | null;
  readonly stopReason: string | null;
  readonly modelId: string;
}

/**
 * The only surface the agents depend on. Baseline and (later) StateProof
 * agents share it, so a fairness constraint applied here applies to both.
 */
export interface ModelClient {
  readonly provider: string;
  readonly modelId: string;
  /** Frozen, recorded settings: temperature, max tokens, effort, timeout. */
  readonly configuration: Readonly<Record<string, ModelConfigurationValue>>;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export const RawAttemptSchema = z
  .object({
    attempt: z.number().int().positive(),
    kind: z.enum(['initial', 'repair']),
    system: z.string(),
    messages: z.array(
      z.object({ role: z.enum(['user', 'assistant']), content: z.string() }).strict(),
    ),
    responseText: z.string(),
    stopReason: z.string().nullable(),
    usage: z
      .object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() })
      .strict()
      .nullable(),
    /** Null when this attempt parsed and validated cleanly. */
    validationError: z.string().nullable(),
  })
  .strict();

export type RawAttempt = z.infer<typeof RawAttemptSchema>;

export class ModelCredentialsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ModelCredentialsError';
  }
}
