import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import {
  type AgentVisibleCase,
  type CompiledContractV2,
  CompiledContractV2Schema,
  REFUND_OPS_DOMAIN_SCHEMA,
  StateSnapshotSchema,
  TaskSpecSchema,
  ToolRegistrySchema,
  TraceEventSchema,
  TrajectorySchema,
} from '@stateproof/core';
import { computeTaskFingerprint, loadContractPrompt } from '@stateproof/agents';
import { loadReproductionManifest } from '@stateproof/submission';
import { z } from 'zod';
import type { ImportResult } from '../shared/types';
import { ZipError, readZip } from './zip';

/**
 * Importing someone else's agent run.
 *
 * Everything here treats the upload as hostile and the domain as narrow. The
 * files are validated against the same schemas the benchmark uses, the
 * collections and tools are checked against the refund-operations domain this
 * product actually supports, and nothing is written to disk — an import lives
 * in memory until the session ends.
 *
 * Validation deliberately stops short of verification. A user must ask for that
 * separately, because "we validated your file" and "we checked your agent" are
 * different claims and should not happen in one click.
 */

export const SUPPORTED_DOMAIN = 'refund-operations';
/** Shaped like a case id so downstream types are satisfied; never a real case. */
export const IMPORTED_CASE_ID = 'PBX-U01';
export const REQUIRED_FILES = [
  'task.json',
  'tool-registry.json',
  'initial-state.json',
  'trajectory.jsonl',
  'final-state.json',
  'final-response.txt',
] as const;
export const OPTIONAL_FILES = ['compiled-contract.json'] as const;

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_TRAJECTORY_EVENTS = 500;

export interface ImportProblem {
  readonly field: string;
  readonly message: string;
}

export class ImportError extends Error {
  public readonly problems: ImportProblem[];

  public constructor(problems: ImportProblem[]) {
    super(problems.map((problem) => `${problem.field}: ${problem.message}`).join('; '));
    this.name = 'ImportError';
    this.problems = problems;
  }
}

export interface ImportedRun {
  readonly importId: string;
  readonly agentVisible: AgentVisibleCase;
  readonly uploadedContract: CompiledContractV2 | null;
  /** Set when the task fingerprint matches one of the frozen sample contracts. */
  readonly matchedContractPath: string | null;
  readonly warnings: string[];
  readonly expiresAtMs: number;
}

const IMPORT_TTL_MS = 30 * 60 * 1000;
const imports = new Map<string, ImportedRun>();

export function getImport(importId: string, nowMs = Date.now()): ImportedRun | null {
  for (const [id, entry] of imports) {
    if (entry.expiresAtMs <= nowMs) imports.delete(id);
  }
  return imports.get(importId) ?? null;
}

export function clearImports(): void {
  imports.clear();
}

function describeZodError(error: unknown, field: string): ImportProblem[] {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => ({
      field: `${field}${issue.path.length > 0 ? `.${issue.path.join('.')}` : ''}`,
      message: issue.message,
    }));
  }
  return [{ field, message: error instanceof Error ? error.message : String(error) }];
}

function parseJson(field: string, text: string, problems: ImportProblem[]): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    problems.push({
      field,
      message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

/** JSONL errors name the line, because "invalid trajectory" is not actionable. */
function parseTrajectory(text: string, problems: ImportProblem[]): unknown[] {
  const events: unknown[] = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    if (events.length >= MAX_TRAJECTORY_EVENTS) {
      problems.push({
        field: 'trajectory.jsonl',
        message: `more than ${MAX_TRAJECTORY_EVENTS} events; the limit exists to bound verification time`,
      });
      break;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      problems.push({
        field: `trajectory.jsonl:${index + 1}`,
        message: `not valid JSON on line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }
    const event = TraceEventSchema.safeParse(parsed);
    if (!event.success) {
      for (const problem of describeZodError(event.error, `trajectory.jsonl:${index + 1}`)) {
        problems.push(problem);
      }
      continue;
    }
    events.push(event.data);
  }
  return events;
}

/** The product supports one domain today, and says so rather than guessing. */
function checkDomain(agentVisible: AgentVisibleCase, problems: ImportProblem[]): string[] {
  const warnings: string[] = [];
  const known = new Set(Object.keys(REFUND_OPS_DOMAIN_SCHEMA.collections));

  for (const [file, snapshot] of [
    ['initial-state.json', agentVisible.initialState],
    ['final-state.json', agentVisible.finalState],
  ] as const) {
    for (const collection of Object.keys(snapshot.collections)) {
      if (!known.has(collection)) {
        problems.push({
          field: file,
          message:
            `collection "${collection}" is not part of the refund-operations domain this ` +
            `product supports (${[...known].sort().join(', ')})`,
        });
      }
    }
  }

  const registryTools = new Set(agentVisible.toolRegistry.tools.map((tool) => tool.name));
  for (const event of agentVisible.trajectory) {
    if (event.type !== 'tool_call') continue;
    if (!registryTools.has(event.toolName)) {
      problems.push({
        field: 'trajectory.jsonl',
        message: `tool "${event.toolName}" is called but not declared in tool-registry.json`,
      });
    }
  }

  if (agentVisible.task.domain !== SUPPORTED_DOMAIN) {
    warnings.push(
      `task.json declares domain "${agentVisible.task.domain}"; this product has only been ` +
        `validated on "${SUPPORTED_DOMAIN}"`,
    );
  }
  return warnings;
}

export interface ImportInput {
  readonly zipBase64?: string | undefined;
  readonly files?: Readonly<Record<string, string | undefined>> | undefined;
}

function filesFromInput(input: ImportInput): Record<string, string> {
  const problems: ImportProblem[] = [];
  const files: Record<string, string> = {};

  if (input.zipBase64 !== undefined) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(input.zipBase64, 'base64');
    } catch {
      throw new ImportError([{ field: 'archive', message: 'the upload is not valid base64' }]);
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new ImportError([
        { field: 'archive', message: `the upload exceeds ${MAX_UPLOAD_BYTES} bytes` },
      ]);
    }
    let entries;
    try {
      entries = readZip(buffer);
    } catch (error) {
      if (error instanceof ZipError) throw new ImportError([{ field: error.field, message: error.message }]);
      throw error;
    }
    const allowed = new Set<string>([...REQUIRED_FILES, ...OPTIONAL_FILES]);
    for (const entry of entries) {
      // Flatten one wrapping directory, which is how most people zip a folder.
      const name = entry.name.includes('/') ? (entry.name.split('/').pop() ?? entry.name) : entry.name;
      if (!allowed.has(name)) {
        problems.push({
          field: 'archive',
          message: `unexpected file "${entry.name}"; a run package holds only ${[...allowed].join(', ')}`,
        });
        continue;
      }
      files[name] = entry.contents.toString('utf8');
    }
  }

  for (const [name, contents] of Object.entries(input.files ?? {})) {
    if (contents === undefined) continue;
    if (contents.length > MAX_UPLOAD_BYTES) {
      problems.push({ field: name, message: `exceeds ${MAX_UPLOAD_BYTES} bytes` });
      continue;
    }
    files[name] = contents;
  }

  for (const required of REQUIRED_FILES) {
    if (files[required] === undefined) {
      problems.push({ field: required, message: 'missing from the run package' });
    }
  }

  if (problems.length > 0) throw new ImportError(problems);
  return files;
}

export function importRun(
  input: ImportInput,
  repoRoot: string,
  nowMs = Date.now(),
): { result: ImportResult; imported: ImportedRun } {
  const files = filesFromInput(input);
  const problems: ImportProblem[] = [];

  const task = parseJson('task.json', files['task.json'] ?? '', problems);
  const toolRegistry = parseJson('tool-registry.json', files['tool-registry.json'] ?? '', problems);
  const initialState = parseJson('initial-state.json', files['initial-state.json'] ?? '', problems);
  const finalState = parseJson('final-state.json', files['final-state.json'] ?? '', problems);
  const trajectory = parseTrajectory(files['trajectory.jsonl'] ?? '', problems);
  const finalResponse = files['final-response.txt'] ?? '';

  if (finalResponse.trim() === '') {
    problems.push({ field: 'final-response.txt', message: 'the agent claim must not be empty' });
  }

  for (const [field, value, schema] of [
    ['task.json', task, TaskSpecSchema],
    ['tool-registry.json', toolRegistry, ToolRegistrySchema],
    ['initial-state.json', initialState, StateSnapshotSchema],
    ['final-state.json', finalState, StateSnapshotSchema],
  ] as const) {
    if (value === null) continue;
    const parsed = schema.safeParse(value);
    if (!parsed.success) problems.push(...describeZodError(parsed.error, field));
  }

  if (problems.length > 0) throw new ImportError(problems);

  // Assembled rather than parsed as an AgentVisibleCase: that schema requires a
  // benchmark case id, and an uploaded run is not a benchmark case. Every part
  // below has already been validated against the same schemas the benchmark
  // uses, which is the check that actually matters.
  // The whole-trajectory rules — gap-free sequence, non-decreasing timestamps —
  // are only checkable across events, so they are validated here and reported
  // as field errors rather than escaping as an unhandled exception.
  const wholeTrajectory = TrajectorySchema.safeParse(trajectory);
  if (!wholeTrajectory.success) {
    throw new ImportError(describeZodError(wholeTrajectory.error, 'trajectory.jsonl'));
  }

  const agentVisible: AgentVisibleCase = {
    caseId: IMPORTED_CASE_ID,
    task: TaskSpecSchema.parse(task),
    toolRegistry: ToolRegistrySchema.parse(toolRegistry),
    initialState: StateSnapshotSchema.parse(initialState),
    finalState: StateSnapshotSchema.parse(finalState),
    trajectory: wholeTrajectory.data,
    finalResponse,
  };
  const warnings = checkDomain(agentVisible, problems);
  if (problems.length > 0) throw new ImportError(problems);

  let uploadedContract: CompiledContractV2 | null = null;
  const contractText = files['compiled-contract.json'];
  if (contractText !== undefined) {
    const parsed = parseJson('compiled-contract.json', contractText, problems);
    if (parsed !== null) {
      // Accept either a bare contract or a full compiled-contract artifact.
      const bare = CompiledContractV2Schema.safeParse(parsed);
      const wrapped = CompiledContractV2Schema.safeParse(
        (parsed as { contract?: unknown }).contract,
      );
      if (bare.success) uploadedContract = bare.data;
      else if (wrapped.success) uploadedContract = wrapped.data;
      else problems.push(...describeZodError(bare.error, 'compiled-contract.json'));
    }
  }
  if (problems.length > 0) throw new ImportError(problems);

  // Does this task match one of the three frozen sample tasks? The fingerprint
  // is recomputed from the upload, never read from it.
  const manifest = loadReproductionManifest(repoRoot);
  const bundle = manifest.contractBundles[0];
  let matchedFingerprint: string | null = null;
  let matchedContractHash: string | null = null;
  let matchedContractPath: string | null = null;
  if (bundle !== undefined) {
    const bundleManifest = JSON.parse(
      readFileSync(pathJoin(repoRoot, bundle.manifestPath), 'utf8'),
    ) as { promptPath: string; modelProvider: string; modelId: string; modelConfiguration: Record<string, string | number | boolean | null> };
    const prompt = loadContractPrompt(pathJoin(repoRoot, bundleManifest.promptPath));
    const fingerprint = computeTaskFingerprint({
      taskText: agentVisible.task.instruction,
      toolRegistry: agentVisible.toolRegistry,
      promptHash: prompt.hash,
      modelProvider: bundleManifest.modelProvider,
      modelId: bundleManifest.modelId,
      modelConfiguration: bundleManifest.modelConfiguration,
    }).fingerprint;
    const match = bundle.contracts.find((entry) => entry.taskFingerprint === fingerprint);
    if (match !== undefined) {
      matchedFingerprint = match.taskFingerprint;
      matchedContractHash = match.contractHash;
      matchedContractPath = match.path;
    }
  }

  const imported: ImportedRun = {
    importId: `imp_${randomUUID()}`,
    agentVisible,
    uploadedContract,
    matchedContractPath,
    warnings,
    expiresAtMs: nowMs + IMPORT_TTL_MS,
  };
  imports.set(imported.importId, imported);

  const hasKey =
    (process.env['STATEPROOF_ANTHROPIC_API_KEY'] ?? '').trim() !== '';

  const contractStatus: ImportResult['contractStatus'] =
    uploadedContract !== null
      ? 'uploaded-contract'
      : matchedFingerprint !== null
        ? 'matched-frozen-contract'
        : hasKey
          ? 'compile-available'
          : 'no-contract';

  const nextAction = {
    'uploaded-contract': 'Verify this run against the contract you supplied.',
    'matched-frozen-contract':
      'This task matches a frozen sample contract. Verify deterministically against it.',
    'compile-available':
      'No contract was supplied. Compile one with Contract Agent v3 — this is the only step that calls a model.',
    'no-contract':
      'Deterministic verification needs a compiled contract. Include compiled-contract.json, or configure STATEPROOF_ANTHROPIC_API_KEY on the server to compile one. The built-in demo needs neither.',
  }[contractStatus];

  return {
    imported,
    result: {
      importId: imported.importId,
      caseLabel: agentVisible.task.title,
      task: agentVisible.task.instruction,
      agentClaim: agentVisible.finalResponse,
      eventCount: agentVisible.trajectory.length,
      collections: Object.keys(agentVisible.finalState.collections).sort(),
      contractStatus,
      contractHash: matchedContractHash,
      matchedFingerprint,
      nextAction,
      warnings,
    },
  };
}
