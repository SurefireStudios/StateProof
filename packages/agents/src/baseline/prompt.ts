import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AgentVisibleCase, canonicalJson, readOnlyTools, sha256Hex, toJsonValue } from '@stateproof/core';

/**
 * Loads and hashes the frozen baseline prompt, and renders the user envelope
 * for one case.
 *
 * What the baseline is given is deliberately narrow: the task instruction, the
 * final response, the trajectory, both states, and descriptions of the
 * read-only evidence sources. It never sees a case id, a split label, a
 * requirement id, a gold contract, or the case matrix.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export const BASELINE_PROMPT_PATH = path.join(
  REPO_ROOT,
  'prompts',
  'baseline-evaluator',
  'v1.md',
);

/** Repo-relative path, so manifests stay portable across machines. */
export const BASELINE_PROMPT_REPO_PATH = 'prompts/baseline-evaluator/v1.md';

export interface BaselinePrompt {
  readonly system: string;
  readonly userTemplate: string;
  /** sha256 of the whole prompt file, recorded in the run manifest. */
  readonly hash: string;
}

export function loadBaselinePrompt(promptPath: string = BASELINE_PROMPT_PATH): BaselinePrompt {
  const raw = readFileSync(promptPath, 'utf8');
  const systemIndex = raw.indexOf('<!-- SYSTEM -->');
  const userIndex = raw.indexOf('<!-- USER -->');
  if (systemIndex === -1 || userIndex === -1 || userIndex < systemIndex) {
    throw new Error(`${promptPath} must contain a <!-- SYSTEM --> then a <!-- USER --> marker`);
  }
  return {
    system: raw.slice(systemIndex + '<!-- SYSTEM -->'.length, userIndex).trim(),
    userTemplate: raw.slice(userIndex + '<!-- USER -->'.length).trim(),
    hash: sha256Hex(raw),
  };
}

/** Read-only tools, described rather than made callable. */
export function describeEvidenceSources(agentVisible: AgentVisibleCase): string {
  const tools = readOnlyTools(agentVisible.toolRegistry);
  if (tools.length === 0) return 'No read-only evidence tools are available for this run.';
  return tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
}

function pretty(value: unknown): string {
  return JSON.stringify(toJsonValue(value), null, 2);
}

/**
 * Renders the user message. Only the six agent-visible inputs are serialized;
 * `caseId` is intentionally excluded.
 */
export function renderBaselineUserMessage(
  prompt: BaselinePrompt,
  agentVisible: AgentVisibleCase,
): string {
  return prompt.userTemplate
    .replace('{{TASK_TEXT}}', agentVisible.task.instruction)
    .replace('{{FINAL_RESPONSE}}', agentVisible.finalResponse)
    .replace('{{INITIAL_STATE_JSON}}', pretty(agentVisible.initialState.collections))
    .replace('{{TRAJECTORY_JSON}}', pretty(agentVisible.trajectory))
    .replace('{{FINAL_STATE_JSON}}', pretty(agentVisible.finalState.collections))
    .replace('{{EVIDENCE_SOURCE_DESCRIPTIONS}}', describeEvidenceSources(agentVisible));
}

/** Stable hash of exactly what was sent, for artifact cross-checking. */
export function hashRenderedPrompt(system: string, userMessage: string): string {
  return sha256Hex(canonicalJson({ system, userMessage }));
}
