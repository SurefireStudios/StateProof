import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ASSERTION_SCHEMA_VERSION,
  type AgentVisibleCase,
  type CompiledContract,
  CompiledContractSchema,
  REFUND_OPS_DOMAIN_SCHEMA,
  type ToolRegistry,
  canonicalJson,
  findUngroundedLiterals,
  hashJson,
  sha256Hex,
  toJsonValue,
} from '@stateproof/core';
import { REPO_ROOT } from '@stateproof/benchmark';
import {
  type ModelClient,
  type ModelConfigurationValue,
  type RawAttempt,
  requestStructured,
} from '@stateproof/model-provider';
import { loadBaselinePrompt, type BaselinePrompt } from '../baseline/prompt';

/**
 * Compiles a task's success criteria once, then reuses them.
 *
 * The cache key covers everything that could change what a correct contract
 * looks like: the task text, the tools, the domain schema, the assertion
 * vocabulary version, the prompt, and the model configuration. Change any of
 * them and the contract is recompiled; change none and no model is called at
 * all. That reuse is the whole efficiency claim, so the key is deliberately
 * strict rather than convenient.
 */

export const CONTRACT_PROMPT_REPO_PATH = 'prompts/contract-agent/v1.md';
export const CONTRACT_PROMPT_PATH = path.join(REPO_ROOT, 'prompts', 'contract-agent', 'v1.md');
export const CONTRACT_MAX_REPAIR_ATTEMPTS = 1;

export interface ContractPromptInputs {
  readonly taskText: string;
  readonly toolRegistry: ToolRegistry;
}

export function loadContractPrompt(promptPath: string = CONTRACT_PROMPT_PATH): BaselinePrompt {
  return loadBaselinePrompt(promptPath);
}

/** Tools are described, never made callable. The agent only writes selectors. */
export function renderContractUserMessage(
  prompt: BaselinePrompt,
  inputs: ContractPromptInputs,
): string {
  return prompt.userTemplate
    .replace('{{TASK_TEXT}}', inputs.taskText)
    .replace('{{TOOL_DEFINITIONS_JSON}}', JSON.stringify(toJsonValue(inputs.toolRegistry.tools), null, 2))
    .replace('{{DOMAIN_SCHEMA_JSON}}', JSON.stringify(toJsonValue(REFUND_OPS_DOMAIN_SCHEMA), null, 2));
}

export interface TaskFingerprintInputs {
  readonly taskText: string;
  readonly toolRegistry: ToolRegistry;
  readonly promptHash: string;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly modelConfiguration: Readonly<Record<string, ModelConfigurationValue>>;
}

export interface TaskFingerprint {
  readonly fingerprint: string;
  readonly toolRegistryHash: string;
  readonly domainSchemaHash: string;
  readonly assertionSchemaVersion: string;
}

/**
 * The cache key. Canonical JSON, so key order can never make two identical
 * inputs look different.
 */
export function computeTaskFingerprint(inputs: TaskFingerprintInputs): TaskFingerprint {
  const toolRegistryHash = hashJson(toJsonValue(inputs.toolRegistry));
  const domainSchemaHash = hashJson(toJsonValue(REFUND_OPS_DOMAIN_SCHEMA));

  const fingerprint = sha256Hex(
    canonicalJson({
      taskText: inputs.taskText,
      toolRegistryHash,
      domainSchemaHash,
      assertionSchemaVersion: ASSERTION_SCHEMA_VERSION,
      promptHash: inputs.promptHash,
      modelProvider: inputs.modelProvider,
      modelId: inputs.modelId,
      modelConfiguration: toJsonValue(inputs.modelConfiguration),
    }),
  );

  return {
    fingerprint,
    toolRegistryHash,
    domainSchemaHash,
    assertionSchemaVersion: ASSERTION_SCHEMA_VERSION,
  };
}

export interface CompiledContractArtifact {
  readonly schemaVersion: '1.0.0';
  readonly taskFingerprint: string;
  readonly taskSummary: string;
  readonly toolRegistryHash: string;
  readonly domainSchemaHash: string;
  readonly assertionSchemaVersion: string;
  readonly promptPath: string;
  readonly promptHash: string;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly modelConfiguration: Readonly<Record<string, ModelConfigurationValue>>;
  readonly rawResponsePaths: string[];
  readonly contractHash: string;
  readonly compiledAt: string;
  readonly tokenUsage: { inputTokens: number; outputTokens: number } | null;
  readonly retryCount: number;
  readonly gitCommitSha: string | null;
  readonly ungroundedLiterals: Array<{ requirementId: string; literal: string; path: string }>;
  readonly contract: CompiledContract;
}

export interface CompileOptions {
  readonly client: ModelClient;
  readonly agentVisible: AgentVisibleCase;
  readonly artifactsDir: string;
  readonly contractRunId: string;
  readonly promptPath?: string;
  /** Existing artifacts, so a warm cache costs nothing. */
  readonly cache: Map<string, CompiledContractArtifact>;
  readonly onProgress?: (message: string) => void;
}

export interface CompileResult {
  readonly artifact: CompiledContractArtifact;
  readonly cacheHit: boolean;
  readonly attempts: RawAttempt[];
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(toJsonValue(value), null, 2)}\n`, 'utf8');
}

function gitCommitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function relative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

export function contractArtifactPath(
  artifactsDir: string,
  contractRunId: string,
  fingerprint: string,
): string {
  return path.join(artifactsDir, 'contracts', contractRunId, `${fingerprint}.json`);
}

/**
 * Identifiers a contract may legitimately contain that are not entity ids:
 * collection names, field names, and the requirement vocabulary.
 */
function schemaIdentifiers(): Set<string> {
  const identifiers = new Set<string>();
  for (const [collection, definition] of Object.entries(REFUND_OPS_DOMAIN_SCHEMA.collections)) {
    identifiers.add(collection);
    for (const field of Object.keys(definition.fields)) identifiers.add(field);
  }
  return identifiers;
}

export class ContractCompilationError extends Error {
  public readonly attempts: RawAttempt[];
  public readonly parseErrors: string[];

  public constructor(fingerprint: string, parseErrors: string[], attempts: RawAttempt[]) {
    super(
      `contract compilation failed for task fingerprint ${fingerprint.slice(0, 12)}:\n  - ${parseErrors.join('\n  - ')}`,
    );
    this.name = 'ContractCompilationError';
    this.attempts = attempts;
    this.parseErrors = parseErrors;
  }
}

/**
 * Compiles the contract for one case's task, or returns the cached one.
 *
 * Only the agent-visible task and tool registry are read. Nothing here can
 * reach a state snapshot, a trajectory, a final response, or gold data.
 */
export async function compileContractForCase(options: CompileOptions): Promise<CompileResult> {
  const prompt = loadContractPrompt(options.promptPath);
  const taskText = options.agentVisible.task.instruction;
  const toolRegistry = options.agentVisible.toolRegistry;

  const fingerprint = computeTaskFingerprint({
    taskText,
    toolRegistry,
    promptHash: prompt.hash,
    modelProvider: options.client.provider,
    modelId: options.client.modelId,
    modelConfiguration: options.client.configuration,
  });

  const cached = options.cache.get(fingerprint.fingerprint);
  if (cached !== undefined) {
    options.onProgress?.(`contract cache hit ${fingerprint.fingerprint.slice(0, 12)}`);
    return { artifact: cached, cacheHit: true, attempts: [] };
  }

  const userMessage = renderContractUserMessage(prompt, { taskText, toolRegistry });
  const result = await requestStructured({
    client: options.client,
    system: prompt.system,
    userMessage,
    schema: CompiledContractSchema,
    maxRepairAttempts: CONTRACT_MAX_REPAIR_ATTEMPTS,
  });

  const rawResponsePaths: string[] = [];
  for (const attempt of result.attempts) {
    const attemptPath = path.join(
      options.artifactsDir,
      'model-responses',
      options.contractRunId,
      `${fingerprint.fingerprint}-attempt-${attempt.attempt}.json`,
    );
    writeJson(attemptPath, attempt);
    rawResponsePaths.push(relative(options.artifactsDir, attemptPath));
  }

  if (result.value === null) {
    throw new ContractCompilationError(fingerprint.fingerprint, result.parseErrors, result.attempts);
  }

  const tokenUsage = result.attempts.reduce<{ inputTokens: number; outputTokens: number } | null>(
    (total, attempt) =>
      attempt.usage === null
        ? total
        : {
            inputTokens: (total?.inputTokens ?? 0) + attempt.usage.inputTokens,
            outputTokens: (total?.outputTokens ?? 0) + attempt.usage.outputTokens,
          },
    null,
  );

  const artifact: CompiledContractArtifact = {
    schemaVersion: '1.0.0',
    taskFingerprint: fingerprint.fingerprint,
    taskSummary: result.value.taskSummary,
    toolRegistryHash: fingerprint.toolRegistryHash,
    domainSchemaHash: fingerprint.domainSchemaHash,
    assertionSchemaVersion: fingerprint.assertionSchemaVersion,
    promptPath: CONTRACT_PROMPT_REPO_PATH,
    promptHash: prompt.hash,
    modelProvider: options.client.provider,
    modelId: options.client.modelId,
    modelConfiguration: options.client.configuration,
    rawResponsePaths,
    contractHash: hashJson(toJsonValue(result.value)),
    compiledAt: new Date().toISOString(),
    tokenUsage,
    retryCount: Math.max(0, result.attempts.length - 1),
    gitCommitSha: gitCommitSha(),
    // Recorded, not silently repaired: a contract naming an id the task never
    // stated is a real defect and the run should say so.
    ungroundedLiterals: findUngroundedLiterals(result.value, taskText, {
      allowedIdentifiers: schemaIdentifiers(),
    }),
    contract: result.value,
  };

  writeJson(
    contractArtifactPath(options.artifactsDir, options.contractRunId, fingerprint.fingerprint),
    artifact,
  );
  options.cache.set(fingerprint.fingerprint, artifact);
  options.onProgress?.(
    `compiled contract ${fingerprint.fingerprint.slice(0, 12)} ` +
      `(${artifact.contract.requirements.length} requirements, ${result.attempts.length} attempt(s))`,
  );

  return { artifact, cacheHit: false, attempts: result.attempts };
}

/** Loads previously persisted contracts so a later run can reuse them. */
export function loadContractCache(
  artifactsDir: string,
  contractRunId: string,
  fingerprints: readonly string[],
): Map<string, CompiledContractArtifact> {
  const cache = new Map<string, CompiledContractArtifact>();
  for (const fingerprint of fingerprints) {
    const filePath = contractArtifactPath(artifactsDir, contractRunId, fingerprint);
    if (!existsSync(filePath)) continue;
    cache.set(fingerprint, JSON.parse(readFileSync(filePath, 'utf8')) as CompiledContractArtifact);
  }
  return cache;
}
