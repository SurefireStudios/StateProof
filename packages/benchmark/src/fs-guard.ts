import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { JsonValue } from '@stateproof/core';

/**
 * The six files an evaluator is allowed to see. Anything outside this list is
 * unreachable through the agent input reader.
 */
export const AGENT_VISIBLE_FILES = [
  'task.json',
  'tool-registry.json',
  'initial-state.json',
  'trajectory.jsonl',
  'final-state.json',
  'final-response.txt',
] as const;

/**
 * Human-only files: gold contract, gold verdict, and the metadata that carries
 * the label, the failure description and the development/locked split.
 */
export const HUMAN_ONLY_FILES = [
  'gold-contract.json',
  'gold-verdict.json',
  'case-metadata.json',
] as const;

export type AgentVisibleFile = (typeof AGENT_VISIBLE_FILES)[number];
export type HumanOnlyFile = (typeof HUMAN_ONLY_FILES)[number];

/** Thrown when agent-facing code tries to reach gold or metadata files. */
export class GoldDataAccessError extends Error {
  public readonly fileName: string;

  public constructor(fileName: string) {
    super(
      `"${fileName}" is human-only benchmark data and cannot be read through the agent input reader.`,
    );
    this.name = 'GoldDataAccessError';
    this.fileName = fileName;
  }
}

export interface CaseFileReader {
  readonly caseDir: string;
  readonly readableFiles: readonly string[];
  readText(fileName: string): string;
  readJson(fileName: string): JsonValue;
}

function assertPlainFileName(fileName: string): void {
  if (fileName !== path.basename(fileName) || fileName.includes('..')) {
    throw new GoldDataAccessError(fileName);
  }
}

function createReader(caseDir: string, allowedFiles: readonly string[]): CaseFileReader {
  const allowed = new Set(allowedFiles);
  const readText = (fileName: string): string => {
    assertPlainFileName(fileName);
    if (!allowed.has(fileName)) throw new GoldDataAccessError(fileName);
    return readFileSync(path.join(caseDir, fileName), 'utf8');
  };
  return {
    caseDir,
    readableFiles: allowedFiles,
    readText,
    readJson: (fileName: string): JsonValue => JSON.parse(readText(fileName)) as JsonValue,
  };
}

/**
 * Reader used by everything that will eventually feed a model. It is an
 * allow-list, not a deny-list: a future file added to a case directory is
 * invisible here until it is explicitly declared agent-visible.
 */
export function createAgentInputReader(caseDir: string): CaseFileReader {
  return createReader(caseDir, AGENT_VISIBLE_FILES);
}

/** Reader used only by fixture validation and scoring. Never given to an agent. */
export function createGoldReader(caseDir: string): CaseFileReader {
  return createReader(caseDir, [...AGENT_VISIBLE_FILES, ...HUMAN_ONLY_FILES]);
}
