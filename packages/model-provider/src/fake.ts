import type { ModelClient, ModelRequest, ModelResponse } from './types';

/**
 * A deterministic in-process client for tests.
 *
 * It never touches the network and never reads a credential. Responses are
 * scripted per call, so repair-retry behaviour and parse-error capture can be
 * exercised without a provider. It is deliberately not reachable from the
 * baseline CLI: a run with no credentials must fail, not quietly succeed.
 */
export interface FakeScriptEntry {
  readonly text: string;
  readonly usage?: { inputTokens: number; outputTokens: number } | null;
  readonly stopReason?: string | null;
}

export type FakeResponder = (request: ModelRequest, callIndex: number) => FakeScriptEntry;

export class FakeModelClient implements ModelClient {
  public readonly provider = 'fake';
  public readonly modelId: string;
  public readonly configuration: Readonly<Record<string, string | number | boolean | null>>;

  /** Every request this client received, in order. */
  public readonly requests: ModelRequest[] = [];

  private readonly responder: FakeResponder;
  private callIndex = 0;

  public constructor(responder: FakeResponder | readonly FakeScriptEntry[], modelId = 'fake-model') {
    this.modelId = modelId;
    this.configuration = { maxTokens: 0, temperature: null, deterministic: true };
    this.responder =
      typeof responder === 'function'
        ? responder
        : (_request, index): FakeScriptEntry => {
            const entry = responder[Math.min(index, responder.length - 1)];
            if (entry === undefined) throw new Error('FakeModelClient script is empty');
            return entry;
          };
  }

  public async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const entry = this.responder(request, this.callIndex);
    this.callIndex += 1;
    return Promise.resolve({
      text: entry.text,
      usage: entry.usage ?? { inputTokens: 0, outputTokens: 0 },
      stopReason: entry.stopReason ?? 'end_turn',
      modelId: this.modelId,
    });
  }
}
