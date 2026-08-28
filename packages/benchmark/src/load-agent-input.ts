import {
  type AgentVisibleCase,
  AgentVisibleCaseSchema,
  type JsonValue,
  type Trajectory,
  TrajectorySchema,
  hashJson,
  toJsonValue,
} from '@stateproof/core';
import { z } from 'zod';
import { type CaseFileReader, createAgentInputReader } from './fs-guard';
import { CASES_DIR, caseDirFor, listCaseIds } from './paths';

/**
 * Everything an evaluator is allowed to see, and nothing else.
 *
 * This module deliberately does not import the gold loader. Agent-facing code
 * imports from here, so gold data is out of reach by module graph, not by
 * convention.
 */

export class FixtureParseError extends Error {
  public readonly caseId: string;
  public readonly fileName: string;

  public constructor(caseId: string, fileName: string, detail: string) {
    super(`[${caseId}] ${fileName}: ${detail}`);
    this.name = 'FixtureParseError';
    this.caseId = caseId;
    this.fileName = fileName;
  }
}

/**
 * `unknown` as the schema input type matters: schemas that apply defaults have
 * an input type that differs from their output type, and pinning both to `T`
 * would silently exclude them.
 */
export function parseOrThrow<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  caseId: string,
  fileName: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new FixtureParseError(caseId, fileName, detail);
  }
  return result.data;
}

/** One JSON object per line; blank lines are ignored. */
export function parseTrajectoryJsonl(raw: string, caseId: string): Trajectory {
  const events: JsonValue[] = [];
  const lines = raw.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      events.push(JSON.parse(trimmed) as JsonValue);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new FixtureParseError(
        caseId,
        'trajectory.jsonl',
        `line ${index + 1} is not valid JSON (${detail})`,
      );
    }
  }
  return parseOrThrow(TrajectorySchema, events, caseId, 'trajectory.jsonl');
}

export interface AgentInputLoadOptions {
  /** Case root, threaded through so temporary fixture trees really are used. */
  readonly casesDir?: string;
  readonly reader?: CaseFileReader;
}

/**
 * Loads exactly what an evaluator may see. Only the guarded agent reader is
 * used, so gold contract, gold verdict, failure description and split label
 * are structurally unreachable from here.
 */
export function loadAgentVisibleCase(
  caseId: string,
  options: AgentInputLoadOptions = {},
): AgentVisibleCase {
  const reader =
    options.reader ?? createAgentInputReader(caseDirFor(caseId, options.casesDir ?? CASES_DIR));

  const candidate = {
    caseId,
    task: reader.readJson('task.json'),
    toolRegistry: reader.readJson('tool-registry.json'),
    initialState: reader.readJson('initial-state.json'),
    finalState: reader.readJson('final-state.json'),
    trajectory: parseTrajectoryJsonl(reader.readText('trajectory.jsonl'), caseId),
    finalResponse: reader.readText('final-response.txt').trim(),
  };
  return parseOrThrow(AgentVisibleCaseSchema, candidate, caseId, '<agent-visible files>');
}

/** Loads every case in a directory, agent-visible content only. */
export function loadAgentVisibleCases(
  caseIds: readonly string[],
  options: AgentInputLoadOptions = {},
): AgentVisibleCase[] {
  return [...caseIds].sort().map((caseId) => loadAgentVisibleCase(caseId, options));
}

export function listAgentVisibleCaseIds(casesDir: string = CASES_DIR): string[] {
  return listCaseIds(casesDir);
}

/** Stable hash of the agent-visible content of one case. */
export function hashAgentVisibleCase(agentVisible: AgentVisibleCase): string {
  return hashJson(toJsonValue(agentVisible));
}
