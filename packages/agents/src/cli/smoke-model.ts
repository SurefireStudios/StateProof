import { z } from 'zod';
import {
  AnthropicModelClient,
  MISSING_CREDENTIALS_MESSAGE,
  ModelCredentialsError,
  hasAnthropicCredentials,
  requestStructured,
} from '@stateproof/model-provider';

/**
 * `pnpm benchmark:smoke-model`
 *
 * One tiny structured request against the exact configured provider and model,
 * so an invalid API configuration is discovered in seconds rather than eight
 * cases into a real run.
 *
 * It reads no benchmark case and no gold file, and writes no prediction,
 * score, report or manifest. It never prints a credential.
 */

const SmokeResponseSchema = z
  .object({
    ok: z.literal(true),
    echo: z.string().min(1),
  })
  .strict();

const SYSTEM = [
  'You are a configuration smoke test. Return only a JSON object matching:',
  '{ "ok": true, "echo": string }',
  'No markdown fence, no commentary.',
].join('\n');

const USER = 'Set "echo" to the exact word: stateproof';

async function main(): Promise<void> {
  if (!hasAnthropicCredentials()) {
    process.stderr.write(`${MISSING_CREDENTIALS_MESSAGE}\n`);
    process.exitCode = 2;
    return;
  }

  let client: AnthropicModelClient;
  try {
    client = new AnthropicModelClient();
  } catch (error) {
    if (error instanceof ModelCredentialsError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  process.stdout.write('StateProof provider smoke test\n');
  process.stdout.write(`provider: ${client.provider}\n`);
  process.stdout.write(`model:    ${client.modelId}\n`);
  process.stdout.write(`config:   ${JSON.stringify(client.configuration)}\n\n`);

  const startedMs = Date.now();
  const result = await requestStructured({
    client,
    system: SYSTEM,
    userMessage: USER,
    schema: SmokeResponseSchema,
    maxRepairAttempts: 1,
  });
  const elapsedMs = Date.now() - startedMs;

  const inputTokens = result.attempts.reduce(
    (total, attempt) => total + (attempt.usage?.inputTokens ?? 0),
    0,
  );
  const outputTokens = result.attempts.reduce(
    (total, attempt) => total + (attempt.usage?.outputTokens ?? 0),
    0,
  );

  process.stdout.write(`attempts:     ${result.attempts.length}\n`);
  process.stdout.write(`input tokens: ${inputTokens}\n`);
  process.stdout.write(`output tokens:${outputTokens}\n`);
  process.stdout.write(`wall clock:   ${elapsedMs} ms\n`);

  if (result.value === null) {
    process.stderr.write('\nFAILED: the model did not return schema-valid JSON.\n');
    for (const error of result.parseErrors) process.stderr.write(`  - ${error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`echo:         ${result.value.echo}\n`);
  process.stdout.write('\nRESULT: PASSED - provider and model configuration are usable.\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
