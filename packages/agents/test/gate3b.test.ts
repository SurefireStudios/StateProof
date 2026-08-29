import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ASSERTION_SCHEMA_VERSION,
  type Assertion,
  type CompiledContractV2,
  CompiledContractV2Schema,
  hashJson,
  toJsonValue,
} from '@stateproof/core';
import { HARD_CASES_DIR, HARD_SPLITS_DIR, caseIdsForSplit, loadAgentVisibleCase } from '@stateproof/benchmark';
import { FakeModelClient } from '@stateproof/model-provider';
import {
  ContractBundleError,
  ContractCompilationError,
  DirtySourceTreeError,
  WarmContractMissError,
  assertCleanSourceTree,
  canonicalPrediction,
  checkPromptProvenance,
  compileContractForCase,
  contractArtifactPath,
  executeContract,
  fileHashAtCommit,
  inspectSourceTree,
  loadContractBundle,
  loadContractPrompt,
  runStateProof,
} from '@stateproof/agents';
import { inCheckout } from './checkout';

/**
 * Gate 3B: the DSL and provenance work, tested against the two things that
 * actually went wrong before.
 *
 * Gate 3A could not express "only the support case for this order may change",
 * and it claimed a warm cost it had never measured. Both are now checkable, so
 * both are checked here rather than described in a document.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const V1_PROMPT_REPO_PATH = 'prompts/contract-agent/v1.md';
const V2_PROMPT_REPO_PATH = 'prompts/contract-agent/v2.md';

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' });
}

// --- repository hygiene ------------------------------------------------------

describe('the public environment template', () => {
  // Evaluated when the describe body runs, so it cannot assume a checkout: this
  // suite also runs inside an extracted release package.
  const checkout = inCheckout(REPO_ROOT);
  const tracked = checkout ? git(['ls-files', '.env.example'], REPO_ROOT).trim() : '';
  const text = readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');

  it.skipIf(!checkout)('is tracked', () => {
    expect(tracked).toBe('.env.example');
  });

  it('carries no credential value', () => {
    for (const line of text.split('\n')) {
      if (line.trim().startsWith('#') || !line.includes('=')) continue;
      const value = line.slice(line.indexOf('=') + 1).trim();
      expect(value).toBe('');
    }
    expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
  });

  it('points at StateProof\'s own variable, not Claude Code\'s', () => {
    expect(text).toContain('STATEPROOF_ANTHROPIC_API_KEY');
    expect(text).toContain('NOT named ANTHROPIC_API_KEY');
  });
});

// --- clean-source rule -------------------------------------------------------

/** A throwaway repository, so the guard is tested rather than the developer's tree. */
function scratchRepo(): string {
  const root = tempDir('stateproof-guard-repo-');
  git(['init', '--quiet'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(path.join(root, 'source.ts'), 'export const value = 1;\n', 'utf8');
  writeFileSync(path.join(root, '.gitignore'), '.env\nartifacts/\n', 'utf8');
  git(['add', '.'], root);
  git(['commit', '--quiet', '-m', 'initial'], root);
  return root;
}

describe('the clean-source guard', () => {
  it('accepts a committed tree and reports its commit', () => {
    const repo = scratchRepo();
    const status = assertCleanSourceTree(repo);
    expect(status.clean).toBe(true);
    expect(status.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('refuses a modified tracked file', () => {
    const repo = scratchRepo();
    writeFileSync(path.join(repo, 'source.ts'), 'export const value = 2;\n', 'utf8');
    expect(() => assertCleanSourceTree(repo)).toThrow(DirtySourceTreeError);
    expect(inspectSourceTree(repo).offending.join(' ')).toContain('source.ts');
  });

  it('refuses an uncommitted new source file', () => {
    const repo = scratchRepo();
    writeFileSync(path.join(repo, 'extra.ts'), 'export const extra = 1;\n', 'utf8');
    expect(inspectSourceTree(repo).clean).toBe(false);
  });

  it('ignores generated artifacts and the ignored .env', () => {
    const repo = scratchRepo();
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    // Written blank, and assembled so this source file never contains the
    // characters `NAME=` adjacently: `pnpm scan:secrets` should not have to
    // special-case a file to stay strict about credential assignments.
    const blankKeyLine = `${'STATEPROOF_ANTHROPIC_API_KEY'}${'='}`;
    writeFileSync(path.join(repo, '.env'), `${blankKeyLine}\n`, 'utf8');
    const artifacts = path.join(repo, 'artifacts');
    execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(artifacts)})`]);
    writeFileSync(path.join(artifacts, 'run.json'), '{}\n', 'utf8');
    expect(inspectSourceTree(repo).clean).toBe(true);
  });

  it('stops a live run before it compiles anything', async () => {
    const repo = scratchRepo();
    writeFileSync(path.join(repo, 'source.ts'), 'export const value = 3;\n', 'utf8');
    const client = new FakeModelClient([{ text: '{}' }]);
    await expect(
      runStateProof({
        client,
        split: 'development',
        artifactsDir: tempDir('stateproof-guard-artifacts-'),
        requireCleanSource: true,
        sourceRepoRoot: repo,
        runId: 'RUN-guard-test',
      }),
    ).rejects.toThrow(DirtySourceTreeError);
    // Decisive: the model was never called, so a dirty tree costs nothing.
    expect(client.requests).toHaveLength(0);
  });
});

describe.skipIf(!inCheckout(REPO_ROOT))('prompt provenance', () => {
  const v1 = loadContractPrompt(path.join(REPO_ROOT, V1_PROMPT_REPO_PATH));
  // Provenance is a property of a commit; an extracted archive has none.
  const head = inCheckout(REPO_ROOT) ? git(['rev-parse', 'HEAD'], REPO_ROOT).trim() : '';

  it('matches the prompt file at the commit a manifest records', () => {
    expect(fileHashAtCommit(head, V1_PROMPT_REPO_PATH, REPO_ROOT)).toBe(v1.hash);
    const problems = checkPromptProvenance(
      {
        gitCommitSha: head,
        promptFilePaths: [V1_PROMPT_REPO_PATH],
        promptHashes: { [V1_PROMPT_REPO_PATH]: v1.hash },
      },
      REPO_ROOT,
    );
    expect(problems).toEqual([]);
  });

  it('reports a manifest whose recorded hash is not what the commit holds', () => {
    const problems = checkPromptProvenance(
      {
        gitCommitSha: head,
        promptFilePaths: [V1_PROMPT_REPO_PATH],
        promptHashes: { [V1_PROMPT_REPO_PATH]: 'a'.repeat(64) },
      },
      REPO_ROOT,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.actualHash).toBe(v1.hash);
  });
});

describe('historical prompts are untouched', () => {
  it('keeps v1 exactly as Gate 3A froze it', () => {
    const committed = fileHashAtCommit('HEAD', V1_PROMPT_REPO_PATH, REPO_ROOT);
    expect(loadContractPrompt(path.join(REPO_ROOT, V1_PROMPT_REPO_PATH)).hash).toBe(committed);
  });

  it('adds v2 as a separate file with a different hash', () => {
    const v1 = loadContractPrompt(path.join(REPO_ROOT, V1_PROMPT_REPO_PATH));
    const v2 = loadContractPrompt(path.join(REPO_ROOT, V2_PROMPT_REPO_PATH));
    expect(v2.hash).not.toBe(v1.hash);
  });
});

// --- what v2 must be able to express ----------------------------------------

const templateBScope: Assertion[] = [
  { kind: 'no_unrelated_mutations', collection: 'orders', allowedRecordIds: ['ORD-2077'] },
  {
    kind: 'mutations_limited_to',
    collection: 'support_cases',
    allowedRecords: [
      {
        kind: 'selected_record',
        state: 'initial',
        selector: { collection: 'support_cases', where: [{ field: 'orderId', equals: 'ORD-2077' }] },
      },
    ],
  },
];

const templateCScope: Assertion[] = [
  { kind: 'no_unrelated_mutations', collection: 'orders', allowedRecordIds: ['ORD-3091'] },
  {
    kind: 'mutations_limited_to',
    collection: 'support_cases',
    allowedRecords: [
      {
        kind: 'selected_record',
        state: 'initial',
        selector: { collection: 'support_cases', where: [{ field: 'orderId', equals: 'ORD-3091' }] },
      },
    ],
  },
];

function contractOf(
  requirements: Array<{
    key: CompiledContractV2['requirements'][number]['requirementKey'];
    category: CompiledContractV2['requirements'][number]['category'];
    assertions: Assertion[];
    coverage?: 'complete' | 'partial';
    limitations?: string[];
  }>,
): CompiledContractV2 {
  return CompiledContractV2Schema.parse({
    contractVersion: '2',
    taskSummary: 'Hand-written contract for a DSL test.',
    ambiguities: [],
    requirements: requirements.map((requirement, index) => ({
      id: `R-00${index + 1}`,
      requirementKey: requirement.key,
      category: requirement.category,
      description: `Requirement ${requirement.key}.`,
      severity: 'must_pass',
      assertions: requirement.assertions,
      verificationCoverage: requirement.coverage ?? 'complete',
      limitations: requirement.limitations ?? [],
    })),
  });
}

function verdictFor(caseId: string, contract: CompiledContractV2) {
  return executeContract({
    contract,
    contractHash: 'h',
    agentVisible: loadAgentVisibleCase(caseId, { casesDir: HARD_CASES_DIR }),
  });
}

describe('template B scope covers orders and the relational support case', () => {
  const contract = contractOf([
    { key: 'scope_integrity', category: 'scope', assertions: templateBScope },
  ]);

  it('passes on a run that touched only the target order and its own case', () => {
    expect(verdictFor('PBH-B01', contract).verdict).toBe('PASS');
  });

  it('catches a note written to an unrelated support case', () => {
    // The exact defect v1 could not express: PBH-B04 writes to SUP-2080.
    const prediction = verdictFor('PBH-B04', contract);
    expect(prediction.verdict).toBe('FAIL');
    expect(prediction.requirementAssessments[0]?.reason).toContain('SUP-2080');
  });
});

describe('template C scope excludes refunds unless the task scopes them', () => {
  const scoped = contractOf([
    { key: 'scope_integrity', category: 'scope', assertions: templateCScope },
    {
      key: 'no_new_refund',
      category: 'prohibition',
      assertions: [
        {
          kind: 'no_new_records',
          collection: 'refunds',
          where: [{ field: 'orderId', equals: 'ORD-3091' }],
          allowedRecordIds: [],
        },
      ],
    },
  ]);

  it('reports the duplicate refund exactly once', () => {
    const prediction = verdictFor('PBH-C03', scoped);
    const failed = prediction.requirementAssessments
      .filter((assessment) => assessment.status === 'FAIL')
      .map((assessment) => assessment.requirementKey);
    expect(failed).toEqual(['no_new_refund']);
  });

  it('would double-count it if refunds were added to scope', () => {
    // Kept as a test, not a comment: this is why the prompt forbids it.
    const overreaching = contractOf([
      {
        key: 'scope_integrity',
        category: 'scope',
        assertions: [
          ...templateCScope,
          { kind: 'no_unrelated_mutations', collection: 'refunds', allowedRecordIds: ['RF-8801'] },
        ],
      },
    ]);
    expect(verdictFor('PBH-C03', overreaching).verdict).toBe('FAIL');
  });
});

describe('a note must carry its text and its reference on one record', () => {
  const together = contractOf([
    {
      key: 'support_note_outcome',
      category: 'outcome',
      assertions: [
        {
          kind: 'record_array_contains_exact',
          state: 'final',
          selector: {
            collection: 'support_cases',
            where: [{ field: 'orderId', equals: 'ORD-3091' }],
          },
          field: 'notes',
          element: [
            { field: 'text', equals: 'Duplicate request denied; prior refund RF-8801 confirmed' },
            { field: 'relatedRefundId', equals: 'RF-8801' },
          ],
        },
      ],
    },
  ]);

  it('fails when two decoy notes satisfy the two facts separately', () => {
    expect(verdictFor('PBH-C03', together).verdict).toBe('FAIL');
  });

  it('would pass if the two facts were checked independently', () => {
    const apart = contractOf([
      {
        key: 'support_note_outcome',
        category: 'outcome',
        assertions: [
          {
            kind: 'record_array_contains_exact',
            state: 'final',
            selector: {
              collection: 'support_cases',
              where: [{ field: 'orderId', equals: 'ORD-3091' }],
            },
            field: 'notes',
            element: [
              { field: 'text', equals: 'Duplicate request denied; prior refund RF-8801 confirmed' },
            ],
          },
          {
            kind: 'record_array_contains_exact',
            state: 'final',
            selector: {
              collection: 'support_cases',
              where: [{ field: 'orderId', equals: 'ORD-3091' }],
            },
            field: 'notes',
            element: [{ field: 'relatedRefundId', equals: 'RF-8801' }],
          },
        ],
      },
    ]);
    expect(verdictFor('PBH-C03', apart).verdict).toBe('PASS');
  });
});

describe('declared partial coverage', () => {
  const satisfiedAssertion: Assertion = {
    kind: 'no_unrelated_mutations',
    collection: 'orders',
    allowedRecordIds: ['ORD-2077'],
  };
  const violatedAssertion: Assertion = {
    kind: 'no_unrelated_mutations',
    collection: 'support_cases',
    allowedRecordIds: ['SUP-2077'],
  };

  it('cannot pass even when every implemented assertion holds', () => {
    const contract = contractOf([
      {
        key: 'scope_integrity',
        category: 'scope',
        assertions: [satisfiedAssertion],
        coverage: 'partial',
        limitations: ['support cases are not checked'],
      },
    ]);
    const prediction = verdictFor('PBH-B01', contract);
    expect(prediction.requirementAssessments[0]?.status).toBe('NEEDS_REVIEW');
    expect(prediction.requirementAssessments[0]?.reason).toContain('coverage is partial');
    expect(prediction.verdict).toBe('NEEDS_REVIEW');
  });

  it('still fails when an implemented assertion is violated', () => {
    const contract = contractOf([
      {
        key: 'scope_integrity',
        category: 'scope',
        assertions: [violatedAssertion],
        coverage: 'partial',
        limitations: ['orders are not checked'],
      },
    ]);
    const prediction = verdictFor('PBH-B04', contract);
    expect(prediction.requirementAssessments[0]?.status).toBe('FAIL');
    expect(prediction.verdict).toBe('FAIL');
  });

  it('blocks an overall pass while any must-pass requirement is partial', () => {
    const contract = contractOf([
      { key: 'scope_integrity', category: 'scope', assertions: [satisfiedAssertion] },
      {
        key: 'support_note_outcome',
        category: 'outcome',
        assertions: [satisfiedAssertion],
        coverage: 'partial',
        limitations: ['the note reference is not checked'],
      },
    ]);
    expect(verdictFor('PBH-B01', contract).verdict).toBe('NEEDS_REVIEW');
  });
});

// --- semantic rejection at compile time -------------------------------------

const groundedContract = (orderId: string): string =>
  JSON.stringify(
    contractOf([
      {
        key: 'scope_integrity',
        category: 'scope',
        assertions: [
          { kind: 'no_unrelated_mutations', collection: 'orders', allowedRecordIds: [orderId] },
        ],
      },
    ]),
  );

const ungroundedContract = JSON.stringify(
  contractOf([
    {
      key: 'scope_integrity',
      category: 'scope',
      assertions: [
        { kind: 'no_unrelated_mutations', collection: 'orders', allowedRecordIds: ['ORD-9999'] },
      ],
    },
  ]),
);

describe('semantic validation rejects rather than records', () => {
  const agentVisible = loadAgentVisibleCase('PBH-A01', { casesDir: HARD_CASES_DIR });
  const orderId = /ORD-\d+/.exec(agentVisible.task.instruction)?.[0] ?? 'ORD-1042';

  it('sends an ungrounded id back through the one repair retry', async () => {
    const artifactsDir = tempDir('stateproof-semantic-repair-');
    const client = new FakeModelClient([
      { text: ungroundedContract },
      { text: groundedContract(orderId) },
    ]);
    const result = await compileContractForCase({
      client,
      agentVisible,
      artifactsDir,
      contractRunId: 'CONTRACTS-repair',
      cache: new Map(),
    });

    expect(client.requests).toHaveLength(2);
    expect(result.artifact.retryCount).toBe(1);
    expect(result.artifact.semanticViolations).toEqual([]);

    // The repair message must name the actual defect, not just "invalid".
    const repair = client.requests[1]?.messages.at(-1)?.content ?? '';
    expect(repair).toContain('ungrounded_literal');
    expect(repair).toContain('ORD-9999');
  });

  it('writes no contract when the repaired response is still invalid', async () => {
    const artifactsDir = tempDir('stateproof-semantic-fail-');
    const cache = new Map();
    const client = new FakeModelClient([
      { text: ungroundedContract },
      { text: ungroundedContract },
    ]);

    await expect(
      compileContractForCase({
        client,
        agentVisible,
        artifactsDir,
        contractRunId: 'CONTRACTS-fail',
        cache,
      }),
    ).rejects.toThrow(ContractCompilationError);

    expect(cache.size).toBe(0);
    expect(existsSync(path.join(artifactsDir, 'contracts', 'CONTRACTS-fail'))).toBe(false);
    // The attempts survive: a rejected contract must stay inspectable.
    const raw = readdirSync(path.join(artifactsDir, 'model-responses', 'CONTRACTS-fail'));
    expect(raw).toHaveLength(2);
    expect(readFileSync(path.join(artifactsDir, 'model-responses', 'CONTRACTS-fail', raw[0] ?? ''), 'utf8')).toContain(
      'ungrounded_literal',
    );
  });
});

// --- persistent bundles, warm runs, and cold/warm identity -------------------

/** One cold run over the development split, driven by the fake client. */
async function coldRun(artifactsDir: string) {
  const client = new FakeModelClient((request) => {
    const envelope = request.messages.map((message) => message.content).join('\n');
    const orderId = /ORD-\d+/.exec(envelope)?.[0];
    if (orderId === undefined) throw new Error('no order id in the envelope');
    return { text: groundedContract(orderId), usage: { inputTokens: 100, outputTokens: 50 } };
  });
  const run = await runStateProof({
    client,
    split: 'development',
    artifactsDir,
    runId: 'RUN-gate3b-cold',
    contractRunId: 'RUN-gate3b-cold-contracts',
  });
  return { run, client };
}

describe('the persisted contract bundle', () => {
  it('loads only when every hash still checks out', async () => {
    const artifactsDir = tempDir('stateproof-bundle-ok-');
    await coldRun(artifactsDir);
    const bundle = loadContractBundle(artifactsDir, 'RUN-gate3b-cold-contracts');
    expect(bundle.artifacts.size).toBe(3);
    expect(bundle.manifest.assertionSchemaVersion).toBe(ASSERTION_SCHEMA_VERSION);
    for (const artifact of bundle.artifacts.values()) {
      expect(hashJson(toJsonValue(artifact.contract))).toBe(artifact.contractHash);
    }
  });

  it('rejects a contract edited after it was compiled', async () => {
    const artifactsDir = tempDir('stateproof-bundle-tampered-');
    const { run } = await coldRun(artifactsDir);
    const fingerprint = run.compilation.uniqueTaskFingerprints[0] ?? '';
    const artifactPath = contractArtifactPath(
      artifactsDir,
      'RUN-gate3b-cold-contracts',
      fingerprint,
    );
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      contract: { taskSummary: string };
    };
    artifact.contract.taskSummary = 'quietly rewritten after the fact';
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');

    expect(() => loadContractBundle(artifactsDir, 'RUN-gate3b-cold-contracts')).toThrow(
      ContractBundleError,
    );
  });

  it('rejects a manifest whose recorded hashes were rewritten to match', async () => {
    const artifactsDir = tempDir('stateproof-bundle-manifest-');
    const { run } = await coldRun(artifactsDir);
    const manifestPath = path.join(
      artifactsDir,
      'run-manifests',
      'RUN-gate3b-cold-contracts.json',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      contractHashes: Record<string, string>;
    };
    const fingerprint = run.compilation.uniqueTaskFingerprints[0] ?? '';
    manifest.contractHashes[fingerprint] = 'b'.repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    expect(() => loadContractBundle(artifactsDir, 'RUN-gate3b-cold-contracts')).toThrow(
      ContractBundleError,
    );
  });
});

describe('cold and warm runs', () => {
  /** Shared by the in-process warm run and the child-process credential proof. */
  const warmArtifactsDir = tempDir('stateproof-warm-');

  it('records honest per-case cache flags on the cold run', async () => {
    const artifactsDir = tempDir('stateproof-cold-flags-');
    const { run } = await coldRun(artifactsDir);
    const entries = run.predictionFile.predictions;
    expect(entries).toHaveLength(8);

    const seen = new Set<string>();
    for (const entry of entries) {
      // The first case for a fingerprint paid for it; the rest did not.
      expect(entry.cacheHit).toBe(seen.has(entry.taskFingerprint));
      seen.add(entry.taskFingerprint);
    }
    expect(entries.filter((entry) => entry.cacheHit)).toHaveLength(5);
  });

  it('verifies from the bundle with no model client and no tokens', async () => {
    const artifactsDir = warmArtifactsDir;
    const { run: cold } = await coldRun(artifactsDir);

    const warm = await runStateProof({
      mode: 'warm',
      contractsFrom: 'RUN-gate3b-cold-contracts',
      split: 'development',
      artifactsDir,
      runId: 'RUN-gate3b-warm',
    });

    expect(warm.mode).toBe('warm');
    expect(warm.compilation.compilationCalls).toBe(0);
    expect(warm.compilation.inputTokens + warm.compilation.outputTokens).toBe(0);
    expect(warm.manifest.modelUsage).toBeNull();
    expect(warm.manifest.rawResponsePaths).toEqual([]);
    expect(warm.manifest.sourceContractRunId).toBe('RUN-gate3b-cold-contracts');
    expect(warm.predictionFile.predictions.every((entry) => entry.cacheHit)).toBe(true);

    // Same contracts, and byte-identical verdicts.
    expect(warm.compilation.uniqueTaskFingerprints).toEqual(
      cold.compilation.uniqueTaskFingerprints,
    );
    const coldById = new Map(cold.predictionFile.predictions.map((entry) => [entry.caseId, entry]));
    for (const entry of warm.predictionFile.predictions) {
      const counterpart = coldById.get(entry.caseId);
      expect(counterpart?.contractHash).toBe(entry.contractHash);
      expect(canonicalPrediction(entry.prediction)).toBe(
        canonicalPrediction(counterpart?.prediction as never),
      );
    }
  });

  it('runs end to end in a child process that has no credential at all', () => {
    // In-process deletion is not proof: the credential helper loads `.env`
    // from the working directory, so it would just read the key back. The
    // child gets a scratch cwd with no `.env` and no credential variable.
    const artifactsDir = warmArtifactsDir;
    const scratchCwd = tempDir('stateproof-warm-cwd-');
    expect(existsSync(path.join(scratchCwd, '.env'))).toBe(false);

    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env['STATEPROOF_ANTHROPIC_API_KEY'];
    delete env['ANTHROPIC_API_KEY'];

    const stdout = execFileSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.join(REPO_ROOT, 'packages/agents/src/cli/stateproof-hard.ts'),
        '--split',
        'development',
        '--contracts-from',
        'RUN-gate3b-cold-contracts',
        '--out',
        artifactsDir,
      ],
      { cwd: scratchCwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    expect(stdout).toContain('mode=warm');
    expect(stdout).toContain('no credential is used');
    expect(stdout).toContain('0 compilation call(s)');
    expect(stdout).toContain('8 cache hit(s)');
  });

  it('fails closed when the bundle does not exist', async () => {
    await expect(
      runStateProof({
        mode: 'warm',
        contractsFrom: 'RUN-does-not-exist',
        split: 'development',
        artifactsDir: tempDir('stateproof-warm-missing-'),
      }),
    ).rejects.toThrow(ContractBundleError);
  });

  it('fails closed on a contract that no longer matches the task inputs', async () => {
    const artifactsDir = tempDir('stateproof-warm-miss-');
    await coldRun(artifactsDir);
    const manifestPath = path.join(
      artifactsDir,
      'run-manifests',
      'RUN-gate3b-cold-contracts.json',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { modelId: string };
    // A different model would have produced different contracts, so the
    // fingerprints must stop matching rather than being reused.
    manifest.modelId = 'some-other-model';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    await expect(
      runStateProof({
        mode: 'warm',
        contractsFrom: 'RUN-gate3b-cold-contracts',
        split: 'development',
        artifactsDir,
      }),
    ).rejects.toThrow(/does not match|different model/);
  });

  it('fails closed on a task the bundle does not cover', async () => {
    const artifactsDir = tempDir('stateproof-warm-incomplete-');
    const { run } = await coldRun(artifactsDir);
    const manifestPath = path.join(
      artifactsDir,
      'run-manifests',
      'RUN-gate3b-cold-contracts.json',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      uniqueTaskFingerprints: string[];
      contractHashes: Record<string, string>;
      contractPaths: string[];
    };
    // Drop one task from the bundle, consistently, so the bundle itself is
    // still valid and the only problem is that it does not cover the split.
    const dropped = run.compilation.uniqueTaskFingerprints[0] ?? '';
    manifest.uniqueTaskFingerprints = manifest.uniqueTaskFingerprints.filter(
      (fingerprint) => fingerprint !== dropped,
    );
    delete manifest.contractHashes[dropped];
    manifest.contractPaths = manifest.contractPaths.filter(
      (contractPath) => !contractPath.includes(dropped),
    );
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // A miss must never be repaired by compiling: that would silently turn a
    // measured warm run into a partly cold one.
    await expect(
      runStateProof({
        mode: 'warm',
        contractsFrom: 'RUN-gate3b-cold-contracts',
        split: 'development',
        artifactsDir,
      }),
    ).rejects.toThrow(WarmContractMissError);
  });

  it('never loads a locked case in either mode', async () => {
    const artifactsDir = tempDir('stateproof-locked-check-');
    const { run } = await coldRun(artifactsDir);
    const locked = caseIdsForSplit('locked', HARD_SPLITS_DIR);
    for (const entry of run.predictionFile.predictions) {
      expect(locked).not.toContain(entry.caseId);
    }
    const warm = await runStateProof({
      mode: 'warm',
      contractsFrom: 'RUN-gate3b-cold-contracts',
      split: 'development',
      artifactsDir,
      runId: 'RUN-gate3b-warm-locked-check',
    });
    for (const entry of warm.predictionFile.predictions) {
      expect(locked).not.toContain(entry.caseId);
    }
  });
});
