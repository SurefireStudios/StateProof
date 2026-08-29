import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ASSERTION_SCHEMA_VERSION,
  type Assertion,
  type CompiledContractV2,
  CompiledContractV2Schema,
  REFUND_OPS_MESSAGE_POLICY,
  REQUIREMENT_KEYS,
  messageTaskFacts,
  validateContractSemantics,
} from '@stateproof/core';
import { HARD_CASES_DIR, loadAgentVisibleCase } from '@stateproof/benchmark';
import { FakeModelClient } from '@stateproof/model-provider';
import {
  ContractRunCollisionError,
  canonicalPrediction,
  checkContractSemantics,
  compileContractForCase,
  loadContractBundle,
  loadContractPrompt,
  runStateProof,
} from '@stateproof/agents';
import { inCheckout } from './checkout';

/**
 * Gate 3C: existential evidence matching, and the lint that makes the previous
 * failure impossible to compile.
 *
 * The v2 run produced exactly one defect class — an outbound message identified
 * by recipient alone — and it was invisible to every check in the pipeline,
 * because it is neither a schema error nor an ungrounded id. These tests cover
 * both halves of the fix: the assertion that can express the question, and the
 * lint that refuses a contract which does not use it.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROMPT_DIR = path.join(REPO_ROOT, 'prompts', 'contract-agent');

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

// --- Gate 3B and everything before it stays exactly as it was ---------------

describe.skipIf(!inCheckout(REPO_ROOT))('earlier gates are preserved', () => {
  it('leaves every historical prompt and run artifact unmodified in git', () => {
    // Adding files is how a gate records its own run; what must never happen is
    // a tracked prompt, fixture, or per-run artifact being edited or deleted.
    // A derived aggregate like the cross-run comparison is expected to change
    // whenever a new run is added, so it is excluded by name rather than by
    // quietly weakening the check.
    const touched = git([
      'status',
      '--porcelain',
      '--',
      'prompts',
      'benchmarks',
      'artifacts/predictions',
      'artifacts/run-manifests',
      'artifacts/contracts',
      'artifacts/model-responses',
      'artifacts/reports',
    ])
      .split('\n')
      .filter((line) => line.trim() !== '')
      .filter((line) => !line.startsWith('??'))
      .filter((line) => !line.includes('artifacts/reports/development-comparison.md'));
    expect(touched).toEqual([]);
  });

  it('keeps all three prompt generations on disk with distinct hashes', () => {
    const hashes = ['v1.md', 'v2.md', 'v3.md'].map(
      (name) => loadContractPrompt(path.join(PROMPT_DIR, name)).hash,
    );
    expect(new Set(hashes).size).toBe(3);
  });

  it('still holds the frozen baseline and both StateProof runs', () => {
    const manifests = readdirSync(path.join(REPO_ROOT, 'artifacts', 'run-manifests'));
    expect(manifests).toContain('RUN-baseline-hard-development-live-20260828T233139Z.json');
    expect(manifests).toContain('RUN-stateproof-hard-development-live-20260829T004039Z.json');
    expect(manifests).toContain('RUN-stateproof-hard-development-cold-20260829T013429Z.json');
  });

  it('hashes every committed prompt to what that commit holds', () => {
    // Covers v3 automatically once it is committed, which is the state every
    // live run must be in.
    for (const line of git(['ls-files', 'prompts/contract-agent']).trim().split('\n')) {
      if (line.trim() === '') continue;
      const blob = execFileSync('git', ['show', `HEAD:${line}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      expect(loadContractPrompt(path.join(REPO_ROOT, line)).hash).toBe(
        execFileSync(process.execPath, ['-e', 'const c=require("crypto");let d="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>d+=x);process.stdin.on("end",()=>process.stdout.write(c.createHash("sha256").update(d,"utf8").digest("hex")))'], {
          input: blob,
          encoding: 'utf8',
        }),
      );
    }
  });
});

// --- the lint -----------------------------------------------------------------

const TEMPLATE_B_TASK = loadAgentVisibleCase('PBH-B01', { casesDir: HARD_CASES_DIR }).task
  .instruction;
const TEMPLATE_C_TASK = loadAgentVisibleCase('PBH-C01', { casesDir: HARD_CASES_DIR }).task
  .instruction;

function messageContract(assertions: Assertion[], task: string): CompiledContractV2 {
  const contract = CompiledContractV2Schema.parse({
    contractVersion: '2',
    taskSummary: 'Message requirement under test.',
    ambiguities: [],
    requirements: [
      {
        id: 'R-001',
        requirementKey: 'customer_message_outcome',
        category: 'outcome',
        description: 'The customer was messaged.',
        severity: 'must_pass',
        assertions,
        verificationCoverage: 'complete',
        limitations: [],
      },
    ],
  });
  void task;
  return contract;
}

function lint(contract: CompiledContractV2, task: string): string[] {
  return checkContractSemantics(contract, task).map((violation) => violation.code);
}

/** The exact shape the v2 run produced, and the exact shape v3 must produce. */
const RECIPIENT_ONLY: Assertion = {
  kind: 'record_exists',
  state: 'final',
  selector: { collection: 'emails', where: [{ field: 'to', equals: 'maya@example.com' }] },
};

const FULL_TEMPLATE_B_MESSAGE: Assertion = {
  kind: 'record_exists_matching',
  state: 'final',
  collection: 'emails',
  where: [
    { field: 'to', equals: 'maya@example.com' },
    { field: 'relatedOrderId', equals: 'ORD-2077' },
    { field: 'status', equals: 'sent' },
    {
      field: 'refundId',
      equalsSelectedRecordId: {
        state: 'final',
        selector: {
          collection: 'refunds',
          where: [
            { field: 'orderId', equals: 'ORD-2077' },
            { field: 'status', equals: 'succeeded' },
          ],
        },
      },
    },
  ],
  minCount: 1,
};

describe('the output-message lint', () => {
  it('reads the task, not the run', () => {
    const facts = messageTaskFacts(TEMPLATE_B_TASK);
    expect(facts).toMatchObject({
      namesRecipient: true,
      namesOrder: true,
      requiresSending: true,
      concernsRefund: true,
    });
    expect(messageTaskFacts(TEMPLATE_C_TASK).priorRefundIds).toContain('RF-8801');
  });

  it('rejects the exact Gate 3B pattern: an exact-one selector on the message', () => {
    const codes = lint(messageContract([RECIPIENT_ONLY], TEMPLATE_B_TASK), TEMPLATE_B_TASK);
    expect(codes).toContain('message_selector_not_existential');
  });

  it('rejects a selector-first field check on the message too', () => {
    const codes = lint(
      messageContract(
        [
          {
            kind: 'record_field_equals',
            state: 'final',
            selector: {
              collection: 'emails',
              where: [{ field: 'to', equals: 'maya@example.com' }],
            },
            field: 'status',
            expected: 'sent',
          },
        ],
        TEMPLATE_B_TASK,
      ),
      TEMPLATE_B_TASK,
    );
    expect(codes).toContain('message_selector_not_existential');
  });

  it('rejects an existential match constrained by recipient alone', () => {
    const codes = lint(
      messageContract(
        [
          {
            kind: 'record_exists_matching',
            state: 'final',
            collection: 'emails',
            where: [{ field: 'to', equals: 'maya@example.com' }],
            minCount: 1,
          },
        ],
        TEMPLATE_B_TASK,
      ),
      TEMPLATE_B_TASK,
    );
    expect(codes).toContain('message_missing_order_discriminator');
    expect(codes).toContain('message_missing_sent_status');
    expect(codes).toContain('message_missing_refund_relationship');
  });

  it('requires the sent status when the task says to send', () => {
    const without = FULL_TEMPLATE_B_MESSAGE.where.filter(
      (condition) => condition.field !== 'status',
    );
    const codes = lint(
      messageContract([{ ...FULL_TEMPLATE_B_MESSAGE, where: without }], TEMPLATE_B_TASK),
      TEMPLATE_B_TASK,
    );
    expect(codes).toEqual(['message_missing_sent_status']);
  });

  it('requires the refund relationship when the task ties the message to a refund', () => {
    const without = FULL_TEMPLATE_B_MESSAGE.where.filter(
      (condition) => condition.field !== 'refundId',
    );
    const codes = lint(
      messageContract([{ ...FULL_TEMPLATE_B_MESSAGE, where: without }], TEMPLATE_B_TASK),
      TEMPLATE_B_TASK,
    );
    expect(codes).toEqual(['message_missing_refund_relationship']);
  });

  it('rejects a refund id the task never named as a prior refund', () => {
    // A generated refund has no id at compile time; matching one literally
    // would verify a recording rather than the task.
    const codes = lint(
      messageContract(
        [
          {
            ...FULL_TEMPLATE_B_MESSAGE,
            where: [
              { field: 'to', equals: 'maya@example.com' },
              { field: 'relatedOrderId', equals: 'ORD-2077' },
              { field: 'status', equals: 'sent' },
              { field: 'refundId', equals: 'ORD-2077' },
            ],
          },
        ],
        TEMPLATE_B_TASK,
      ),
      TEMPLATE_B_TASK,
    );
    expect(codes).toContain('message_missing_refund_relationship');
  });

  it('accepts a fully discriminated existential match', () => {
    expect(lint(messageContract([FULL_TEMPLATE_B_MESSAGE], TEMPLATE_B_TASK), TEMPLATE_B_TASK)).toEqual(
      [],
    );
  });

  it('accepts a literal prior refund id when the task names one', () => {
    const notice: Assertion = {
      kind: 'record_exists_matching',
      state: 'final',
      collection: 'emails',
      where: [
        { field: 'to', equals: 'lee@example.com' },
        { field: 'relatedOrderId', equals: 'ORD-3091' },
        { field: 'status', equals: 'sent' },
        { field: 'refundId', equals: 'RF-8801' },
      ],
      minCount: 1,
    };
    expect(lint(messageContract([notice], TEMPLATE_C_TASK), TEMPLATE_C_TASK)).toEqual([]);
  });

  it('rejects partial coverage on a key the vocabulary fully supports', () => {
    const contract = CompiledContractV2Schema.parse({
      contractVersion: '2',
      taskSummary: 'Message requirement under test.',
      ambiguities: [],
      requirements: [
        {
          id: 'R-001',
          requirementKey: 'customer_message_outcome',
          category: 'outcome',
          description: 'The customer was messaged.',
          severity: 'must_pass',
          assertions: [FULL_TEMPLATE_B_MESSAGE],
          verificationCoverage: 'partial',
          limitations: ['the subject and body wording are not checked'],
        },
      ],
    }) as CompiledContractV2;
    expect(lint(contract, TEMPLATE_B_TASK)).toContain('unsupported_partial_coverage');
  });

  it('covers every requirement key as fully supported', () => {
    const supported = validateContractSemantics(
      messageContract([FULL_TEMPLATE_B_MESSAGE], TEMPLATE_B_TASK),
      {
        taskText: TEMPLATE_B_TASK,
        knownCollections: new Set(['orders', 'refunds', 'emails', 'support_cases']),
        messagePolicy: REFUND_OPS_MESSAGE_POLICY,
        fullySupportedRequirementKeys: new Set<string>(REQUIREMENT_KEYS),
      },
    );
    expect(supported).toEqual([]);
    expect(REQUIREMENT_KEYS).toHaveLength(6);
  });
});

// --- unique contract run ids --------------------------------------------------

const GROUNDED_TEMPLATE_B = JSON.stringify(
  CompiledContractV2Schema.parse({
    contractVersion: '2',
    taskSummary: 'Template B under test.',
    ambiguities: [],
    requirements: [
      {
        id: 'R-001',
        requirementKey: 'customer_message_outcome',
        category: 'outcome',
        description: 'A receipt was sent.',
        severity: 'must_pass',
        assertions: [FULL_TEMPLATE_B_MESSAGE],
        verificationCoverage: 'complete',
        limitations: [],
      },
    ],
  }),
);

/** A contract grounded in whichever order id the envelope carries. */
function contractForEnvelope(envelope: string): string {
  const orderId = /ORD-\d+/.exec(envelope)?.[0];
  const recipient = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(envelope)?.[0];
  if (orderId === undefined || recipient === undefined) {
    throw new Error('no order id or recipient in the contract envelope');
  }
  const contract = JSON.parse(GROUNDED_TEMPLATE_B) as CompiledContractV2;
  const requirement = contract.requirements[0]!;
  const assertion = requirement.assertions[0] as Extract<
    Assertion,
    { kind: 'record_exists_matching' }
  >;
  return JSON.stringify({
    ...contract,
    requirements: [
      {
        ...requirement,
        assertions: [
          {
            ...assertion,
            where: [
              { field: 'to', equals: recipient },
              { field: 'relatedOrderId', equals: orderId },
              { field: 'status', equals: 'sent' },
              {
                field: 'refundId',
                equalsSelectedRecordId: {
                  state: 'final',
                  selector: {
                    collection: 'refunds',
                    where: [
                      { field: 'orderId', equals: orderId },
                      { field: 'status', equals: 'succeeded' },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  });
}

function coldClient(): FakeModelClient {
  return new FakeModelClient((request) => ({
    text: contractForEnvelope(request.messages.map((message) => message.content).join('\n')),
    usage: { inputTokens: 100, outputTokens: 50 },
  }));
}

describe('contract run ids are unique per run', () => {
  it('gives two consecutive cold runs separate contract directories', async () => {
    const artifactsDir = tempDir('stateproof-runid-');
    const first = await runStateProof({
      client: coldClient(),
      split: 'development',
      artifactsDir,
      runId: 'RUN-first',
    });
    const second = await runStateProof({
      client: coldClient(),
      split: 'development',
      artifactsDir,
      runId: 'RUN-second',
    });

    expect(first.compilation.contractRunId).toBe('RUN-first-contracts');
    expect(second.compilation.contractRunId).toBe('RUN-second-contracts');
    expect(first.manifest.contractRunId).toBe('RUN-first-contracts');
    expect(readdirSync(path.join(artifactsDir, 'contracts')).sort()).toEqual([
      'RUN-first-contracts',
      'RUN-second-contracts',
    ]);
    // Both bundles remain independently loadable, which is the point.
    expect(loadContractBundle(artifactsDir, 'RUN-first-contracts').artifacts.size).toBe(3);
    expect(loadContractBundle(artifactsDir, 'RUN-second-contracts').artifacts.size).toBe(3);
  });

  it('refuses to compile into an existing contract run directory', async () => {
    const artifactsDir = tempDir('stateproof-runid-collide-');
    await runStateProof({
      client: coldClient(),
      split: 'development',
      artifactsDir,
      runId: 'RUN-same',
    });
    await expect(
      runStateProof({
        client: coldClient(),
        split: 'development',
        artifactsDir,
        runId: 'RUN-other',
        contractRunId: 'RUN-same-contracts',
      }),
    ).rejects.toThrow(ContractRunCollisionError);
  });
});

// --- semantic rejection through the single repair -----------------------------

describe('the lint uses the one repair retry', () => {
  const agentVisible = loadAgentVisibleCase('PBH-B01', { casesDir: HARD_CASES_DIR });

  it('repairs a recipient-only contract into a discriminated one', async () => {
    const artifactsDir = tempDir('stateproof-lint-repair-');
    const bad = JSON.stringify(messageContract([RECIPIENT_ONLY], TEMPLATE_B_TASK));
    const client = new FakeModelClient([
      { text: bad },
      { text: contractForEnvelope(agentVisible.task.instruction) },
    ]);

    const result = await compileContractForCase({
      client,
      agentVisible,
      artifactsDir,
      contractRunId: 'CONTRACTS-lint-repair',
      cache: new Map(),
    });

    expect(client.requests).toHaveLength(2);
    expect(result.artifact.retryCount).toBe(1);
    expect(result.artifact.semanticViolations).toEqual([]);
    const repair = client.requests[1]?.messages.at(-1)?.content ?? '';
    expect(repair).toContain('message_selector_not_existential');
  });

  it('writes no contract when the message stays under-discriminated', async () => {
    const artifactsDir = tempDir('stateproof-lint-fail-');
    const cache = new Map();
    const bad = JSON.stringify(messageContract([RECIPIENT_ONLY], TEMPLATE_B_TASK));
    const client = new FakeModelClient([{ text: bad }, { text: bad }]);

    await expect(
      compileContractForCase({
        client,
        agentVisible,
        artifactsDir,
        contractRunId: 'CONTRACTS-lint-fail',
        cache,
      }),
    ).rejects.toThrow();

    expect(cache.size).toBe(0);
    expect(existsSync(path.join(artifactsDir, 'contracts', 'CONTRACTS-lint-fail'))).toBe(false);
    expect(readdirSync(path.join(artifactsDir, 'model-responses', 'CONTRACTS-lint-fail'))).toHaveLength(
      2,
    );
  });
});

// --- warm determinism ---------------------------------------------------------

describe('repeated warm verification is byte-identical', () => {
  it('produces the same predictions, hashes and zero usage three times', async () => {
    const artifactsDir = tempDir('stateproof-warm-repeat-');
    const cold = await runStateProof({
      client: coldClient(),
      split: 'development',
      artifactsDir,
      runId: 'RUN-repeat-cold',
    });
    const contractRunId = cold.compilation.contractRunId;

    const warms = [];
    for (const suffix of ['a', 'b', 'c']) {
      warms.push(
        await runStateProof({
          mode: 'warm',
          contractsFrom: contractRunId,
          split: 'development',
          artifactsDir,
          runId: `RUN-repeat-warm-${suffix}`,
        }),
      );
    }

    const canonical = warms.map((run) =>
      run.predictionFile.predictions.map((entry) => canonicalPrediction(entry.prediction)).join('|'),
    );
    expect(new Set(canonical).size).toBe(1);

    const hashes = warms.map((run) =>
      run.predictionFile.predictions.map((entry) => entry.contractHash).join('|'),
    );
    expect(new Set(hashes).size).toBe(1);

    for (const run of warms) {
      expect(run.compilation.compilationCalls).toBe(0);
      expect(run.compilation.inputTokens + run.compilation.outputTokens).toBe(0);
      expect(run.manifest.modelUsage).toBeNull();
      expect(run.manifest.rawResponsePaths).toEqual([]);
      expect(run.predictionFile.predictions.every((entry) => entry.cacheHit)).toBe(true);
    }

    // And identical to the cold run they came from.
    expect(canonical[0]).toBe(
      cold.predictionFile.predictions.map((entry) => canonicalPrediction(entry.prediction)).join('|'),
    );
    expect(ASSERTION_SCHEMA_VERSION).toBe('2.1.0');
  });
});
