import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ASSERTION_SCHEMA_VERSION,
  type AgentVisibleCase,
  type AnyCompiledContract,
  type CompiledContract,
  CompiledContractSchema,
  type CompiledContractV2,
  CompiledContractV2Schema,
  REFUND_OPS_DOMAIN_SCHEMA,
  REFUND_OPS_MESSAGE_POLICY,
  REQUIREMENT_KEYS,
  type SemanticViolation,
  type ToolRegistry,
  canonicalJson,
  findUngroundedLiterals,
  formatSemanticViolations,
  hashJson,
  sha256Hex,
  toJsonValue,
  validateContractSemantics,
} from '@stateproof/core';
import { REPO_ROOT } from '@stateproof/benchmark';
import {
  type ModelClient,
  type ModelConfigurationValue,
  type RawAttempt,
  requestStructured,
} from '@stateproof/model-provider';
import { loadBaselinePrompt, type BaselinePrompt } from '../baseline/prompt';
import { inspectSourceTree } from '../run/source-guard';
import {
  type CompiledContractArtifactV2,
  CompiledContractArtifactV2Schema,
} from './bundle';

/**
 * Compiles a task's success criteria once, then reuses them.
 *
 * The cache key covers everything that could change what a correct contract
 * looks like: the task text, the tools, the domain schema, the assertion
 * vocabulary version, the prompt, and the model configuration. Change any of
 * them and the contract is recompiled; change none and no model is called at
 * all. That reuse is the whole efficiency claim, so the key is deliberately
 * strict rather than convenient.
 *
 * A compiled contract is accepted only if it also survives semantic validation.
 * Gate 3A recorded those defects and carried on, which meant a contract naming
 * an id the task never stated could still be cached and used. Now the defects
 * are sent back through the one repair retry, and a contract that fails twice
 * produces no artifact at all.
 */

export const CONTRACT_PROMPT_V1_REPO_PATH = 'prompts/contract-agent/v1.md';
export const CONTRACT_PROMPT_V2_REPO_PATH = 'prompts/contract-agent/v2.md';
export const CONTRACT_PROMPT_V3_REPO_PATH = 'prompts/contract-agent/v3.md';
export const CONTRACT_PROMPT_V1_PATH = path.join(REPO_ROOT, 'prompts', 'contract-agent', 'v1.md');
export const CONTRACT_PROMPT_V2_PATH = path.join(REPO_ROOT, 'prompts', 'contract-agent', 'v2.md');
export const CONTRACT_PROMPT_PATH = path.join(REPO_ROOT, 'prompts', 'contract-agent', 'v3.md');
/** The current generation's repo-relative path. */
export const CONTRACT_PROMPT_REPO_PATH = CONTRACT_PROMPT_V3_REPO_PATH;
export const CONTRACT_MAX_REPAIR_ATTEMPTS = 1;

export type ContractVersion = '1' | '2';

export interface ContractPromptInputs {
  readonly taskText: string;
  readonly toolRegistry: ToolRegistry;
}

export function loadContractPrompt(promptPath: string = CONTRACT_PROMPT_PATH): BaselinePrompt {
  return loadBaselinePrompt(promptPath);
}

/** Repo-relative, so a manifest records the prompt that was actually used. */
export function contractPromptRepoPath(promptPath: string = CONTRACT_PROMPT_PATH): string {
  return path.relative(REPO_ROOT, promptPath).split(path.sep).join('/');
}

/** Tools are described, never made callable. The agent only writes selectors. */
export function renderContractUserMessage(
  prompt: BaselinePrompt,
  inputs: ContractPromptInputs,
): string {
  return prompt.userTemplate
    .replace('{{TASK_TEXT}}', inputs.taskText)
    .replace(
      '{{TOOL_DEFINITIONS_JSON}}',
      JSON.stringify(toJsonValue(inputs.toolRegistry.tools), null, 2),
    )
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

/** The shape Gate 3A wrote. Read-only now; nothing new is written in it. */
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

/** Either generation, for code that only reads shared provenance fields. */
export type AnyContractArtifact = CompiledContractArtifact | CompiledContractArtifactV2;

export interface SourceProvenance {
  readonly commitSha: string | null;
  readonly clean: boolean;
}

export interface CompileOptions {
  readonly client: ModelClient;
  readonly agentVisible: AgentVisibleCase;
  readonly artifactsDir: string;
  readonly contractRunId: string;
  readonly promptPath?: string;
  /** Existing artifacts, so a warm cache costs nothing. */
  readonly cache: Map<string, CompiledContractArtifactV2>;
  /** Measured once per run rather than per contract. */
  readonly source?: SourceProvenance;
  readonly onProgress?: (message: string) => void;
}

export interface CompileResult {
  readonly artifact: CompiledContractArtifactV2;
  readonly cacheHit: boolean;
  readonly attempts: RawAttempt[];
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(toJsonValue(value), null, 2)}\n`, 'utf8');
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

export function contractRunDirectory(artifactsDir: string, contractRunId: string): string {
  return path.join(artifactsDir, 'contracts', contractRunId);
}

export class ContractRunCollisionError extends Error {
  public constructor(contractRunId: string, directory: string) {
    super(
      [
        `Refusing to compile into the existing contract run "${contractRunId}".`,
        '',
        `${directory} already holds contracts from an earlier run. Writing into it would`,
        'silently mix two runs\' contracts under one id and destroy the link between a',
        'verdict and the contract that produced it.',
        '',
      ].join('\n'),
    );
    this.name = 'ContractRunCollisionError';
  }
}

/**
 * A contract run id must name exactly one compilation.
 *
 * The previous gate derived it from a run id that had not been generated yet,
 * so every run wrote into `contracts/RUN-contracts/`. Nothing was lost, because
 * only one run existed — but a second would have overwritten the first, and the
 * manifests would still have looked correct.
 */
export function assertContractRunIsNew(artifactsDir: string, contractRunId: string): void {
  const directory = contractRunDirectory(artifactsDir, contractRunId);
  if (existsSync(directory)) throw new ContractRunCollisionError(contractRunId, directory);
}

/**
 * Identifiers a contract may legitimately contain that are not entity ids:
 * collection names, field names, and the requirement vocabulary.
 */
export function schemaIdentifiers(): Set<string> {
  const identifiers = new Set<string>();
  for (const [collection, definition] of Object.entries(REFUND_OPS_DOMAIN_SCHEMA.collections)) {
    identifiers.add(collection);
    for (const field of Object.keys(definition.fields)) identifiers.add(field);
  }
  return identifiers;
}

export function domainCollections(): Set<string> {
  return new Set(Object.keys(REFUND_OPS_DOMAIN_SCHEMA.collections));
}

/**
 * Semantic validation as the compiler applies it: same inputs, every time.
 *
 * The message policy and the supported-key set are both read from the domain
 * schema and the requirement vocabulary — the same material the Contract Agent
 * is shown. Nothing here consults a case, a run, or a gold file.
 */
export function checkContractSemantics(
  contract: AnyCompiledContract,
  taskText: string,
): SemanticViolation[] {
  return validateContractSemantics(contract, {
    taskText,
    knownCollections: domainCollections(),
    allowedIdentifiers: schemaIdentifiers(),
    messagePolicy: REFUND_OPS_MESSAGE_POLICY,
    fullySupportedRequirementKeys: new Set<string>(REQUIREMENT_KEYS),
  });
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
  const promptPath = options.promptPath ?? CONTRACT_PROMPT_PATH;
  const prompt = loadContractPrompt(promptPath);
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
    schema: CompiledContractV2Schema,
    maxRepairAttempts: CONTRACT_MAX_REPAIR_ATTEMPTS,
    // Shares the single repair budget with schema failures, deliberately: a
    // contract that names an invented id is as unusable as one that will not
    // parse, and both deserve exactly one corrected attempt.
    semanticValidate: (contract: CompiledContractV2) =>
      formatSemanticViolations(checkContractSemantics(contract, taskText)),
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

  // No contract artifact and no cache entry on failure: the raw attempts stay
  // for inspection, but nothing downstream may treat this task as compiled.
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

  const source = options.source ?? inspectSourceTree();
  const artifact = CompiledContractArtifactV2Schema.parse({
    schemaVersion: '2.0.0',
    taskFingerprint: fingerprint.fingerprint,
    taskSummary: result.value.taskSummary,
    toolRegistryHash: fingerprint.toolRegistryHash,
    domainSchemaHash: fingerprint.domainSchemaHash,
    assertionSchemaVersion: fingerprint.assertionSchemaVersion,
    promptPath: contractPromptRepoPath(promptPath),
    promptHash: prompt.hash,
    modelProvider: options.client.provider,
    modelId: options.client.modelId,
    modelConfiguration: options.client.configuration,
    rawResponsePaths,
    contractHash: hashJson(toJsonValue(result.value)),
    compiledAt: new Date().toISOString(),
    tokenUsage,
    retryCount: Math.max(0, result.attempts.length - 1),
    gitCommitSha: source.commitSha,
    sourceTreeClean: source.clean,
    // Empty by construction: the accepted response passed semantic validation.
    semanticViolations: checkContractSemantics(result.value, taskText),
    ungroundedLiterals: findUngroundedLiterals(result.value, taskText, {
      allowedIdentifiers: schemaIdentifiers(),
    }),
    contract: result.value,
  });

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

/**
 * Loads previously persisted v1 contracts. Superseded by `loadContractBundle`,
 * which verifies what it loads; kept so a Gate 3A artifact can still be read
 * and replayed exactly as it was written.
 */
export function loadContractCache(
  artifactsDir: string,
  contractRunId: string,
  fingerprints: readonly string[],
): Map<string, CompiledContractArtifact> {
  const cache = new Map<string, CompiledContractArtifact>();
  for (const fingerprint of fingerprints) {
    const filePath = contractArtifactPath(artifactsDir, contractRunId, fingerprint);
    if (!existsSync(filePath)) continue;
    const artifact = JSON.parse(readFileSync(filePath, 'utf8')) as CompiledContractArtifact;
    // Historical artifacts are v1; parsing proves the contract still validates.
    CompiledContractSchema.parse(artifact.contract);
    cache.set(fingerprint, artifact);
  }
  return cache;
}
