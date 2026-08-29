import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ASSERTION_SCHEMA_VERSION,
  type CompiledContractV2,
  CompiledContractV2Schema,
  hashJson,
  toJsonValue,
} from '@stateproof/core';
import type { ModelConfigurationValue } from '@stateproof/model-provider';
import { z } from 'zod';

/**
 * The persisted contract bundle: what makes a later run warm.
 *
 * An in-memory cache proves reuse within one process, which is not the claim.
 * The claim is that a task compiled once can be verified again tomorrow, from
 * a different invocation, with no model and no credential. That only holds if
 * the persisted contracts can be trusted, so loading one re-derives every hash
 * rather than believing the file: a bundle whose contract text no longer
 * matches its recorded hash, or whose provenance no longer matches the current
 * task inputs, is rejected instead of silently verifying against stale rules.
 */

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a sha256 hex digest');
const NonEmpty = z.string().min(1);

export const ModelConfigurationSchema = z.record(
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const TokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  })
  .strict();

export const SemanticViolationSchema = z
  .object({
    code: NonEmpty,
    requirementId: NonEmpty,
    path: NonEmpty,
    message: NonEmpty,
  })
  .strict();

export const UngroundedLiteralSchema = z
  .object({ requirementId: NonEmpty, literal: NonEmpty, path: NonEmpty })
  .strict();

/** A compiled contract as written to disk, with everything needed to re-trust it. */
export const CompiledContractArtifactV2Schema = z
  .object({
    schemaVersion: z.literal('2.0.0'),
    taskFingerprint: Sha256Schema,
    taskSummary: NonEmpty,
    toolRegistryHash: Sha256Schema,
    domainSchemaHash: Sha256Schema,
    assertionSchemaVersion: NonEmpty,
    promptPath: NonEmpty,
    promptHash: Sha256Schema,
    modelProvider: NonEmpty,
    modelId: NonEmpty,
    modelConfiguration: ModelConfigurationSchema,
    rawResponsePaths: z.array(NonEmpty),
    contractHash: Sha256Schema,
    compiledAt: NonEmpty,
    tokenUsage: TokenUsageSchema.nullable(),
    retryCount: z.number().int().nonnegative(),
    gitCommitSha: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
    sourceTreeClean: z.boolean(),
    /** Always empty in a written artifact: a violating contract is never stored. */
    semanticViolations: z.array(SemanticViolationSchema),
    ungroundedLiterals: z.array(UngroundedLiteralSchema),
    contract: CompiledContractV2Schema,
  })
  .strict();

export type CompiledContractArtifactV2 = z.infer<typeof CompiledContractArtifactV2Schema>;

/** The manifest that binds a set of contract artifacts into one reusable bundle. */
export const ContractBundleManifestSchema = z
  .object({
    schemaVersion: z.literal('2.0.0'),
    contractRunId: NonEmpty,
    createdAt: NonEmpty,
    stage: NonEmpty,
    promptPath: NonEmpty,
    promptHash: Sha256Schema,
    assertionSchemaVersion: NonEmpty,
    contractVersion: z.literal('2'),
    modelProvider: NonEmpty,
    modelId: NonEmpty,
    modelConfiguration: ModelConfigurationSchema,
    gitCommitSha: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
    sourceTreeClean: z.boolean(),
    uniqueTaskFingerprints: z.array(Sha256Schema).min(1),
    /** Fingerprint to contract hash: tampering with an artifact breaks this link. */
    contractHashes: z.record(Sha256Schema),
    compilationCalls: z.number().int().nonnegative(),
    repairCalls: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    tokenUsage: TokenUsageSchema,
    wallClockMs: z.number().int().nonnegative(),
    contractPaths: z.array(NonEmpty),
    rawResponsePaths: z.array(NonEmpty),
  })
  .strict();

export type ContractBundleManifest = z.infer<typeof ContractBundleManifestSchema>;

/** How a StateProof run records which bundle it verified from. */
export const SourceContractReferenceSchema = z
  .object({
    contractRunId: NonEmpty,
    contractManifestPath: NonEmpty,
    contractManifestHash: Sha256Schema,
    taskFingerprints: z.array(Sha256Schema).min(1),
  })
  .strict();

export type SourceContractReference = z.infer<typeof SourceContractReferenceSchema>;

export class ContractBundleError extends Error {
  public readonly problems: string[];

  public constructor(contractRunId: string, problems: string[]) {
    super(
      [
        `contract bundle "${contractRunId}" cannot be trusted:`,
        ...problems.map((problem) => `  - ${problem}`),
      ].join('\n'),
    );
    this.name = 'ContractBundleError';
    this.problems = problems;
  }
}

export function contractBundleManifestPath(artifactsDir: string, contractRunId: string): string {
  return path.join(artifactsDir, 'run-manifests', `${contractRunId}.json`);
}

export function contractArtifactPathFor(
  artifactsDir: string,
  contractRunId: string,
  fingerprint: string,
): string {
  return path.join(artifactsDir, 'contracts', contractRunId, `${fingerprint}.json`);
}

export interface LoadedContractBundle {
  readonly manifest: ContractBundleManifest;
  readonly manifestHash: string;
  readonly artifacts: ReadonlyMap<string, CompiledContractArtifactV2>;
  readonly reference: SourceContractReference;
}

/**
 * Loads a persisted bundle and re-derives every hash it claims. Any mismatch
 * throws: a warm run must fail closed rather than verify against a contract
 * that is not what it says it is.
 */
export function loadContractBundle(
  artifactsDir: string,
  contractRunId: string,
): LoadedContractBundle {
  const manifestPath = contractBundleManifestPath(artifactsDir, contractRunId);
  if (!existsSync(manifestPath)) {
    throw new ContractBundleError(contractRunId, [`no contract manifest at ${manifestPath}`]);
  }

  const rawManifest = readFileSync(manifestPath, 'utf8');
  let manifest: ContractBundleManifest;
  try {
    manifest = ContractBundleManifestSchema.parse(JSON.parse(rawManifest));
  } catch (error) {
    throw new ContractBundleError(contractRunId, [
      `contract manifest does not match the bundle schema: ${
        error instanceof z.ZodError
          ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
          : String(error)
      }`,
    ]);
  }

  const problems: string[] = [];
  const artifacts = new Map<string, CompiledContractArtifactV2>();

  if (manifest.assertionSchemaVersion !== ASSERTION_SCHEMA_VERSION) {
    problems.push(
      `bundle was compiled against assertion schema ${manifest.assertionSchemaVersion}, ` +
        `this build speaks ${ASSERTION_SCHEMA_VERSION}`,
    );
  }

  for (const fingerprint of manifest.uniqueTaskFingerprints) {
    const artifactPath = contractArtifactPathFor(artifactsDir, contractRunId, fingerprint);
    if (!existsSync(artifactPath)) {
      problems.push(`contract ${fingerprint.slice(0, 12)} is missing at ${artifactPath}`);
      continue;
    }

    let artifact: CompiledContractArtifactV2;
    try {
      artifact = CompiledContractArtifactV2Schema.parse(
        JSON.parse(readFileSync(artifactPath, 'utf8')),
      );
    } catch (error) {
      problems.push(
        `contract ${fingerprint.slice(0, 12)} does not match the artifact schema: ${
          error instanceof z.ZodError
            ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
            : String(error)
        }`,
      );
      continue;
    }

    for (const problem of verifyArtifactIntegrity(artifact, manifest, fingerprint, artifactsDir)) {
      problems.push(problem);
    }
    artifacts.set(fingerprint, artifact);
  }

  if (problems.length > 0) throw new ContractBundleError(contractRunId, problems.sort());

  return {
    manifest,
    manifestHash: hashJson(JSON.parse(rawManifest) as never),
    artifacts,
    reference: {
      contractRunId,
      contractManifestPath: path
        .relative(artifactsDir, manifestPath)
        .split(path.sep)
        .join('/'),
      contractManifestHash: hashJson(JSON.parse(rawManifest) as never),
      taskFingerprints: [...manifest.uniqueTaskFingerprints].sort(),
    },
  };
}

/** Everything about one stored contract that must still be true to reuse it. */
function verifyArtifactIntegrity(
  artifact: CompiledContractArtifactV2,
  manifest: ContractBundleManifest,
  fingerprint: string,
  artifactsDir: string,
): string[] {
  const problems: string[] = [];
  const short = fingerprint.slice(0, 12);

  if (artifact.taskFingerprint !== fingerprint) {
    problems.push(`contract ${short} is filed under a fingerprint it does not claim`);
  }

  const recomputed = hashJson(toJsonValue(artifact.contract));
  if (recomputed !== artifact.contractHash) {
    problems.push(`contract ${short} has been modified since it was compiled`);
  }
  if (manifest.contractHashes[fingerprint] !== artifact.contractHash) {
    problems.push(`contract ${short} does not match the hash recorded in the bundle manifest`);
  }
  if (artifact.promptHash !== manifest.promptHash) {
    problems.push(`contract ${short} was compiled from a different prompt than the bundle claims`);
  }
  if (artifact.assertionSchemaVersion !== manifest.assertionSchemaVersion) {
    problems.push(`contract ${short} targets a different assertion schema than the bundle`);
  }
  if (
    artifact.modelProvider !== manifest.modelProvider ||
    artifact.modelId !== manifest.modelId
  ) {
    problems.push(`contract ${short} was produced by a different model than the bundle records`);
  }
  if (artifact.semanticViolations.length > 0) {
    problems.push(`contract ${short} carries ${artifact.semanticViolations.length} unresolved semantic violation(s)`);
  }
  for (const rawPath of artifact.rawResponsePaths) {
    if (!existsSync(path.join(artifactsDir, rawPath))) {
      problems.push(`contract ${short} cites a raw response that no longer exists: ${rawPath}`);
    }
  }

  return problems;
}

export interface ExpectedContractProvenance {
  readonly taskFingerprint: string;
  readonly toolRegistryHash: string;
  readonly domainSchemaHash: string;
  readonly promptHash: string;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly modelConfiguration: Readonly<Record<string, ModelConfigurationValue>>;
}

/**
 * Confirms a stored contract still belongs to the task in front of us. The
 * fingerprint is recomputed from the current task inputs by the caller, so a
 * changed task, tool registry, prompt or model configuration cannot silently
 * reuse yesterday's contract.
 */
export function verifyContractProvenance(
  artifact: CompiledContractArtifactV2,
  expected: ExpectedContractProvenance,
): string[] {
  const problems: string[] = [];
  if (artifact.taskFingerprint !== expected.taskFingerprint) {
    problems.push('task fingerprint recomputed from the current inputs does not match');
  }
  if (artifact.toolRegistryHash !== expected.toolRegistryHash) problems.push('tool registry changed');
  if (artifact.domainSchemaHash !== expected.domainSchemaHash) problems.push('domain schema changed');
  if (artifact.promptHash !== expected.promptHash) problems.push('contract prompt changed');
  if (artifact.modelProvider !== expected.modelProvider) problems.push('model provider changed');
  if (artifact.modelId !== expected.modelId) problems.push('model id changed');
  if (
    hashJson(toJsonValue(artifact.modelConfiguration)) !==
    hashJson(toJsonValue(expected.modelConfiguration))
  ) {
    problems.push('model configuration changed');
  }
  return problems;
}

export type { CompiledContractV2 };
