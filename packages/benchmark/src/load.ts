import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type AgentVisibleCase,
  AgentVisibleCaseSchema,
  type BenchmarkCase,
  type CaseMetadata,
  CaseMetadataSchema,
  type GoldVerdict,
  GoldVerdictSchema,
  type JsonValue,
  type SplitManifest,
  SplitManifestSchema,
  type TaskContract,
  TaskContractSchema,
  type Trajectory,
  TrajectorySchema,
  combineHashes,
  hashJson,
  sha256Hex,
  toJsonValue,
} from '@stateproof/core';
import { z } from 'zod';
import { type CaseFileReader, createAgentInputReader, createGoldReader } from './fs-guard';
import { CASES_DIR, SPLITS_DIR, caseDirFor, listCaseIds } from './paths';

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
function parseOrThrow<T>(
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
      throw new FixtureParseError(caseId, 'trajectory.jsonl', `line ${index + 1} is not valid JSON (${detail})`);
    }
  }
  return parseOrThrow(TrajectorySchema, events, caseId, 'trajectory.jsonl');
}

/**
 * Loads exactly what an evaluator may see. This function only ever touches the
 * agent input reader, so gold contract, gold verdict, failure description and
 * split label are structurally unreachable from here.
 */
export function loadAgentVisibleCase(
  caseId: string,
  reader: CaseFileReader = createAgentInputReader(caseDirFor(caseId)),
): AgentVisibleCase {
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

export interface GoldBundle {
  readonly goldContract: TaskContract;
  readonly goldVerdict: GoldVerdict;
  readonly metadata: CaseMetadata;
}

/** Human-only loader. Used by fixture validation and scoring, never by agents. */
export function loadGoldBundle(
  caseId: string,
  reader: CaseFileReader = createGoldReader(caseDirFor(caseId)),
): GoldBundle {
  return {
    goldContract: parseOrThrow(
      TaskContractSchema,
      reader.readJson('gold-contract.json'),
      caseId,
      'gold-contract.json',
    ),
    goldVerdict: parseOrThrow(
      GoldVerdictSchema,
      reader.readJson('gold-verdict.json'),
      caseId,
      'gold-verdict.json',
    ),
    metadata: parseOrThrow(
      CaseMetadataSchema,
      reader.readJson('case-metadata.json'),
      caseId,
      'case-metadata.json',
    ),
  };
}

export function loadBenchmarkCase(caseId: string): BenchmarkCase {
  const gold = loadGoldBundle(caseId);
  return {
    caseId,
    agentVisible: loadAgentVisibleCase(caseId),
    goldContract: gold.goldContract,
    goldVerdict: gold.goldVerdict,
    metadata: gold.metadata,
  };
}

export function loadAllCases(casesDir: string = CASES_DIR): BenchmarkCase[] {
  return listCaseIds(casesDir).map((caseId) => loadBenchmarkCase(caseId));
}

export function loadSplitManifest(split: 'development' | 'locked'): SplitManifest {
  const filePath = path.join(SPLITS_DIR, `${split}.json`);
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as JsonValue;
  return parseOrThrow(SplitManifestSchema, raw, split, `splits/${split}.json`);
}

/** Stable hash of the agent-visible content of one case. */
export function hashAgentVisibleCase(agentVisible: AgentVisibleCase): string {
  return hashJson(toJsonValue(agentVisible));
}

/**
 * Dataset hash over every case's agent-visible content plus its gold data, so
 * a run manifest can prove which dataset produced a metric.
 */
export function datasetHash(cases: readonly BenchmarkCase[]): string {
  const parts: Array<readonly [string, string]> = cases.map((benchmarkCase) => [
    benchmarkCase.caseId,
    sha256Hex(
      [
        hashAgentVisibleCase(benchmarkCase.agentVisible),
        hashJson(toJsonValue(benchmarkCase.goldContract)),
        hashJson(toJsonValue(benchmarkCase.goldVerdict)),
        hashJson(toJsonValue(benchmarkCase.metadata)),
      ].join('|'),
    ),
  ]);
  return combineHashes(parts);
}
