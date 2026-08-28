import Anthropic from '@anthropic-ai/sdk';
import {
  ModelCredentialsError,
  type ModelClient,
  type ModelConfigurationValue,
  type ModelRequest,
  type ModelResponse,
} from './types';

/**
 * The one configured live provider adapter.
 *
 * Settings are fixed here rather than per call, so the run manifest records
 * exactly what produced a number and the same configuration applies to the
 * baseline and to the StateProof agents.
 *
 * Note on temperature: the current Claude models do not accept a sampling
 * temperature - sending one is rejected - so the fairness requirement to "fix
 * temperature" is satisfied by recording it as null and fixing reasoning
 * effort instead, which is the knob these models actually expose.
 */
export interface AnthropicClientOptions {
  readonly apiKey?: string | undefined;
  readonly modelId?: string;
  readonly maxTokens?: number;
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly timeoutMs?: number;
  readonly maxTransportRetries?: number;
}

export const DEFAULT_MODEL_ID = 'claude-opus-5';
export const DEFAULT_MAX_TOKENS = 16000;
export const DEFAULT_EFFORT = 'high';
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_TRANSPORT_RETRIES = 2;

export const MISSING_CREDENTIALS_MESSAGE = [
  'No model credentials are configured, so no live run can be made.',
  '',
  'Set ANTHROPIC_API_KEY in your shell or in a local .env (see .env.example),',
  'or sign in with `ant auth login`, then re-run the command.',
  '',
  'Nothing has been written. A baseline run is never simulated: a report with',
  'no real model behind it would be worse than no report.',
].join('\n');

export class AnthropicModelClient implements ModelClient {
  public readonly provider = 'anthropic';
  public readonly modelId: string;
  public readonly configuration: Readonly<Record<string, ModelConfigurationValue>>;

  private readonly client: Anthropic;
  private readonly maxTokens: number;
  private readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';

  public constructor(options: AnthropicClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    if (apiKey === undefined || apiKey.trim() === '') {
      throw new ModelCredentialsError(MISSING_CREDENTIALS_MESSAGE);
    }

    this.modelId = options.modelId ?? DEFAULT_MODEL_ID;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.effort = options.effort ?? DEFAULT_EFFORT;

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = options.maxTransportRetries ?? DEFAULT_TRANSPORT_RETRIES;

    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries });

    this.configuration = {
      maxTokens: this.maxTokens,
      effort: this.effort,
      // Not supported by the current Claude models; recorded so the manifest
      // says so explicitly rather than leaving it unstated.
      temperature: null,
      timeoutMs,
      transportMaxRetries: maxRetries,
    };
  }

  public async complete(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.messages.create({
      model: this.modelId,
      max_tokens: this.maxTokens,
      system: request.system,
      output_config: { effort: this.effort },
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason,
      modelId: response.model,
    };
  }
}

/** True when a live client can be constructed without prompting for anything. */
export function hasAnthropicCredentials(): boolean {
  const key = process.env['ANTHROPIC_API_KEY'];
  return key !== undefined && key.trim() !== '';
}
