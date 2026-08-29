import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CREDENTIAL_ENV_VAR, hasAnthropicCredentials } from '@stateproof/model-provider';
import {
  CONTRACT_PROMPT_PATH,
  compileContractForCase,
  contractPromptRepoPath,
  loadContractPrompt,
} from '@stateproof/agents';
import type { RunView } from '../shared/types';
import { LIVE_COMPILATION_ENV, loadConfig } from './config';
import type { ImportedRun } from './importer';
import { buildRunView, storeRun } from './runs';

/**
 * The one optional path in this product that calls a model.
 *
 * It exists because an imported run with no contract cannot be verified, and
 * compiling one is the only way forward. Everything about it is deliberately
 * grudging: it is server-side only, it never accepts or returns a key, it is
 * rate-limited, it runs only on an explicit user action, it writes to a
 * temporary directory that is deleted immediately, and it uses Contract Agent
 * v3 exactly as frozen.
 *
 * The built-in demo never touches it.
 */

export interface CompileStatus {
  readonly available: boolean;
  readonly reason: string;
  readonly promptPath: string;
  readonly credentialVariable: string;
}

export function compileStatus(): CompileStatus {
  const promptPath = contractPromptRepoPath(CONTRACT_PROMPT_PATH);

  // The public deployment runs with this off. It is checked before the
  // credential so that a host which somehow has a key still cannot spend it.
  if (!loadConfig().liveCompilationEnabled) {
    return {
      available: false,
      reason:
        'Live contract compilation is disabled on this server. The public demo uses frozen ' +
        'task contracts and deterministic verification, and no model API key is present. ' +
        `Set ${LIVE_COMPILATION_ENV}=true on your own instance to enable it.`,
      promptPath,
      credentialVariable: CREDENTIAL_ENV_VAR,
    };
  }

  // Only ever this variable. ANTHROPIC_API_KEY belongs to the operator's own
  // tooling and is never read, here or anywhere in the repository.
  if (!hasAnthropicCredentials()) {
    return {
      available: false,
      reason:
        `Custom contract compilation is disabled because ${CREDENTIAL_ENV_VAR} is not configured ` +
        'on the server. The built-in demo and all deterministic verification work without it.',
      promptPath,
      credentialVariable: CREDENTIAL_ENV_VAR,
    };
  }
  return {
    available: true,
    reason: 'One model-assisted compilation per request, rate-limited locally.',
    promptPath,
    credentialVariable: CREDENTIAL_ENV_VAR,
  };
}

/**
 * Compiles a contract for an imported run and verifies it in one step.
 *
 * The compiled artifact goes to a temporary directory that is removed before
 * this function returns: the frozen bundle and the submitted artifacts are
 * never written to.
 */
export async function compileForImport(repoRoot: string, imported: ImportedRun): Promise<RunView> {
  const status = compileStatus();
  if (!status.available) throw new Error(status.reason);

  const prompt = loadContractPrompt(CONTRACT_PROMPT_PATH);
  const scratch = mkdtempSync(path.join(tmpdir(), 'stateproof-product-compile-'));
  // Imported here, not at module load: with compilation disabled the provider
  // is never constructed, and on the public deployment it is never even
  // evaluated.
  const { AnthropicModelClient } = await import('@stateproof/model-provider');
  const client = new AnthropicModelClient();

  try {
    const result = await compileContractForCase({
      client,
      agentVisible: imported.agentVisible,
      artifactsDir: scratch,
      contractRunId: 'session-compile',
      promptPath: CONTRACT_PROMPT_PATH,
      cache: new Map(),
    });

    const artifact = result.artifact;
    return storeRun(
      buildRunView({
        label: `${imported.agentVisible.task.title} (contract compiled this session)`,
        caseId: null,
        agentVisible: imported.agentVisible,
        contract: artifact.contract,
        contractHash: artifact.contractHash,
        taskFingerprint: artifact.taskFingerprint,
        promptPath: contractPromptRepoPath(CONTRACT_PROMPT_PATH),
        promptHash: prompt.hash,
        assertionSchemaVersion: artifact.assertionSchemaVersion,
        contractSource: 'compiled-this-session',
        imported: true,
        compilationModelCalls: artifact.retryCount + 1,
        compilationModelTokens:
          (artifact.tokenUsage?.inputTokens ?? 0) + (artifact.tokenUsage?.outputTokens ?? 0),
      }),
    );
  } finally {
    // Nothing compiled here survives the request.
    rmSync(scratch, { recursive: true, force: true });
    void repoRoot;
  }
}
