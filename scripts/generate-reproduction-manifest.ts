import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvaluationRunManifestSchema, sha256Hex, toJsonValue } from '@stateproof/core';
import {
  ReproductionManifestSchema,
  canonicalPredictionFileHash,
  type ReproductionManifest,
} from '@stateproof/submission';
import { caseIdsForSplit, HARD_SPLITS_DIR, SPLITS_DIR } from '@stateproof/benchmark';

/**
 * `pnpm submission:manifest`
 *
 * Builds the pinned artifact registry *from the artifacts*.
 *
 * Writing this by hand would defeat its purpose: the registry exists so a judge
 * can tell that the dashboard's numbers came from real runs, and a
 * hand-maintained pin drifts from reality the first time anyone forgets to
 * update it. Everything here — hashes, paths, contract lists — is read off disk.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

const RUNS: Array<{
  id: string;
  label: string;
  role: ReproductionManifest['runs'][number]['role'];
  system: 'baseline' | 'stateproof';
  promptId: string | null;
  provenance: 'verified' | 'known-defect';
}> = [
  {
    id: 'RUN-baseline-development-live-20260828T222134Z',
    label: 'Core-12 diagnostic baseline',
    role: 'baseline-core',
    system: 'baseline',
    promptId: 'baseline-evaluator-v1',
    provenance: 'verified',
  },
  {
    id: 'RUN-baseline-hard-development-live-20260828T233139Z',
    label: 'Frontier baseline (Hard-12)',
    role: 'baseline-hard',
    system: 'baseline',
    promptId: 'baseline-evaluator-v2',
    provenance: 'verified',
  },
  {
    id: 'RUN-stateproof-hard-development-live-20260829T004039Z',
    label: 'StateProof v1 cold',
    role: 'stateproof-v1-cold',
    system: 'stateproof',
    promptId: 'contract-agent-v1',
    // Documented Gate 3A defect: this run happened before its own commit, so
    // the prompt it names is not present at the commit it records.
    provenance: 'known-defect',
  },
  {
    id: 'RUN-stateproof-hard-development-cold-20260829T013429Z',
    label: 'StateProof v2 cold',
    role: 'stateproof-v2-cold',
    system: 'stateproof',
    promptId: 'contract-agent-v2',
    provenance: 'verified',
  },
  {
    id: 'RUN-stateproof-hard-development-cold-20260829T022133Z',
    label: 'StateProof v3 cold',
    role: 'stateproof-v3-cold',
    system: 'stateproof',
    promptId: 'contract-agent-v3',
    provenance: 'verified',
  },
  {
    id: 'RUN-stateproof-hard-development-warm-20260829T022344Z',
    label: 'StateProof v3 warm (measured)',
    role: 'stateproof-v3-warm',
    system: 'stateproof',
    promptId: 'contract-agent-v3',
    provenance: 'verified',
  },
  {
    id: 'RUN-stateproof-hard-development-warm-20260829T022354Z',
    label: 'StateProof v3 warm repeat 1',
    role: 'stateproof-v3-warm-repeat',
    system: 'stateproof',
    promptId: 'contract-agent-v3',
    provenance: 'verified',
  },
  {
    id: 'RUN-stateproof-hard-development-warm-20260829T022355Z',
    label: 'StateProof v3 warm repeat 2',
    role: 'stateproof-v3-warm-repeat',
    system: 'stateproof',
    promptId: 'contract-agent-v3',
    provenance: 'verified',
  },
];

const PROMPTS: Array<{ id: string; label: string; path: string }> = [
  { id: 'baseline-evaluator-v1', label: 'Baseline evaluator v1', path: 'prompts/baseline-evaluator/v1.md' },
  { id: 'baseline-evaluator-v2', label: 'Baseline evaluator v2', path: 'prompts/baseline-evaluator/v2.md' },
  { id: 'contract-agent-v1', label: 'Contract Agent v1', path: 'prompts/contract-agent/v1.md' },
  { id: 'contract-agent-v2', label: 'Contract Agent v2', path: 'prompts/contract-agent/v2.md' },
  { id: 'contract-agent-v3', label: 'Contract Agent v3', path: 'prompts/contract-agent/v3.md' },
];

const V3_CONTRACT_RUN_ID = 'RUN-stateproof-hard-development-cold-20260829T022133Z-contracts';

/**
 * Locked runs join the registry only once they exist on disk.
 *
 * Before the one-time locked evaluation there is nothing to pin, and pinning a
 * placeholder would let the dashboard and the reports describe a measurement
 * that had not happened.
 */
function discoverLockedRuns(): Array<{
  id: string;
  label: string;
  role: 'baseline-hard-locked' | 'stateproof-v3-locked';
  system: 'baseline' | 'stateproof';
  promptId: string;
  provenance: 'verified' | 'known-defect';
}> {
  const dir = path.join(REPO_ROOT, 'artifacts', 'run-manifests');
  if (!existsSync(dir)) return [];
  const found: Array<{
    id: string;
    label: string;
    role: 'baseline-hard-locked' | 'stateproof-v3-locked';
    system: 'baseline' | 'stateproof';
    promptId: string;
    provenance: 'verified' | 'known-defect';
  }> = [];

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const runId = file.replace(/\.json$/, '');
    if (!runId.includes('-locked-')) continue;
    const manifest = EvaluationRunManifestSchema.parse(
      readJson(relative('artifacts', 'run-manifests', file)),
    );
    if (!manifest.splits.includes('locked')) continue;
    if (manifest.datasetName !== 'phantombench-hard-12') {
      throw new Error(`${runId} is a locked run on ${manifest.datasetName}, which must not exist`);
    }
    found.push(
      manifest.system === 'baseline'
        ? {
            id: runId,
            label: 'Frontier baseline (locked)',
            role: 'baseline-hard-locked',
            system: 'baseline',
            promptId: 'baseline-evaluator-v2',
            provenance: 'verified',
          }
        : {
            id: runId,
            label: 'StateProof v3 (locked)',
            role: 'stateproof-v3-locked',
            system: 'stateproof',
            promptId: 'contract-agent-v3',
            provenance: 'verified',
          },
    );
  }
  return found;
}

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')) as unknown;
}

function relative(...parts: string[]): string {
  return parts.join('/');
}

function main(): void {
  const prompts = PROMPTS.map((prompt) => ({
    ...prompt,
    sha256: sha256Hex(readFileSync(path.join(REPO_ROOT, prompt.path), 'utf8')),
  }));

  const lockedRuns = discoverLockedRuns();
  const runs = [...RUNS, ...lockedRuns].map((run) => {
    const manifestPath = relative('artifacts', 'run-manifests', `${run.id}.json`);
    const manifest = EvaluationRunManifestSchema.parse(readJson(manifestPath));
    const predictionPath = relative('artifacts', 'predictions', `${run.id}.json`);

    return {
      id: run.id,
      label: run.label,
      role: run.role,
      system: run.system,
      dataset: manifest.datasetName,
      split: manifest.splits[0] === 'locked' ? ('locked' as const) : ('development' as const),
      manifestPath,
      predictionPath,
      reportJsonPath: relative('artifacts', 'reports', `${run.id}.json`),
      reportMarkdownPath: relative('artifacts', 'reports', `${run.id}.md`),
      canonicalPredictionSha256: canonicalPredictionFileHash(readJson(predictionPath)),
      contractRunId: manifest.contractRunId ?? manifest.sourceContractRunId ?? null,
      promptId: run.promptId,
      provenance: run.provenance,
    };
  });

  const bundleManifestPath = relative('artifacts', 'run-manifests', `${V3_CONTRACT_RUN_ID}.json`);
  const bundleManifest = readJson(bundleManifestPath) as {
    promptHash: string;
    assertionSchemaVersion: string;
    uniqueTaskFingerprints: string[];
  };
  const contractsDir = relative('artifacts', 'contracts', V3_CONTRACT_RUN_ID);
  const contracts = readdirSync(path.join(REPO_ROOT, contractsDir))
    .sort()
    .map((file) => {
      const artifactPath = relative(contractsDir, file);
      const artifact = readJson(artifactPath) as {
        taskFingerprint: string;
        contractHash: string;
        rawResponsePaths: string[];
      };
      return {
        taskFingerprint: artifact.taskFingerprint,
        contractHash: artifact.contractHash,
        path: artifactPath,
        rawResponsePaths: artifact.rawResponsePaths.map((raw) => relative('artifacts', raw)),
      };
    });

  const lockedStateProofRunId =
    lockedRuns.find((run) => run.role === 'stateproof-v3-locked')?.id ?? null;

  const coreCases = readdirSync(path.join(REPO_ROOT, 'benchmarks', 'phantombench-12', 'cases')).length;
  const hardCases = readdirSync(
    path.join(REPO_ROOT, 'benchmarks', 'phantombench-hard-12', 'cases'),
  ).length;

  const registry: ReproductionManifest = ReproductionManifestSchema.parse({
    schemaVersion: '1.0.0',
    generatedFor: 'gate-4a',
    generatedAt: new Date().toISOString(),
    sourceCommits: {
      gate3cSource: '42135267c23841b7c8bb960c01749f58bb53481a',
      gate3cResult: '57b8c59',
    },
    datasets: [
      {
        name: 'phantombench-12',
        casesDir: 'benchmarks/phantombench-12/cases',
        splitsDir: 'benchmarks/phantombench-12/splits',
        caseCount: coreCases,
      },
      {
        name: 'phantombench-hard-12',
        casesDir: 'benchmarks/phantombench-hard-12/cases',
        splitsDir: 'benchmarks/phantombench-hard-12/splits',
        caseCount: hardCases,
      },
    ],
    prompts,
    runs,
    contractBundles: [
      {
        contractRunId: V3_CONTRACT_RUN_ID,
        manifestPath: bundleManifestPath,
        promptId: 'contract-agent-v3',
        assertionSchemaVersion: bundleManifest.assertionSchemaVersion,
        contracts,
      },
    ],
    replayTargetRunId: 'RUN-stateproof-hard-development-warm-20260829T022344Z',
    replayCaseIds: caseIdsForSplit('development', HARD_SPLITS_DIR),
    lockedCaseIds: [
      ...caseIdsForSplit('locked', HARD_SPLITS_DIR),
      ...caseIdsForSplit('locked', SPLITS_DIR),
    ],
    ...(lockedStateProofRunId === null
      ? {}
      : {
          lockedReplayCaseIds: caseIdsForSplit('locked', HARD_SPLITS_DIR),
          lockedReplayTargetRunId: lockedStateProofRunId,
        }),
  });

  const outPath = path.join(REPO_ROOT, 'submission', 'reproduction-manifest.json');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(toJsonValue(registry), null, 2)}\n`, 'utf8');

  process.stdout.write(
    [
      `runs pinned:      ${registry.runs.length}`,
      `prompts pinned:   ${registry.prompts.length}`,
      `contracts pinned: ${contracts.length} (${V3_CONTRACT_RUN_ID})`,
      `replay cases:     ${registry.replayCaseIds.join(', ')}`,
    `locked replay:    ${(registry.lockedReplayCaseIds ?? []).join(', ') || 'not yet evaluated'}`,
      `locked excluded:  ${registry.lockedCaseIds.join(', ')}`,
      `written:          submission/reproduction-manifest.json`,
      '',
    ].join('\n'),
  );

  if (!existsSync(outPath)) throw new Error('the registry was not written');
}

main();
