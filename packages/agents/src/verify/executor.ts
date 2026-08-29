import {
  type AgentVisibleCase,
  type AnyCompiledContract,
  type AssertionOutcome,
  type EvaluationContext,
  type RequirementAssessment,
  type RequirementKey,
  assertionEvidenceRefs,
  evaluateAssertion,
  hashJson,
  normalizeRequirements,
  toJsonValue,
} from '@stateproof/core';
import { z } from 'zod';

/**
 * Executes a compiled contract against one run. Deterministically.
 *
 * There is no model here and no gold data. Every status comes from evaluating
 * the contract's own assertions, and every evidence reference is built from
 * the records and events those assertions actually matched — so a citation
 * cannot point at something that does not exist, and the same contract against
 * the same run always produces the same bytes.
 */

export const StateProofPredictionSchema = z
  .object({
    caseId: z.string().min(1),
    verdict: z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW']),
    requirementAssessments: z.array(
      z
        .object({
          requirementKey: z.string().min(1),
          status: z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW']),
          reason: z.string().min(1),
          evidenceRefs: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    contractHash: z.string().min(1),
    verificationDurationMs: z.number().int().nonnegative(),
  })
  .strict();

export type StateProofPrediction = z.infer<typeof StateProofPredictionSchema>;

function statusFor(outcome: AssertionOutcome): RequirementAssessment['status'] {
  switch (outcome) {
    case 'satisfied':
      return 'PASS';
    case 'violated':
      return 'FAIL';
    case 'indeterminate':
      return 'NEEDS_REVIEW';
  }
}

export function evaluationContextFor(agentVisible: AgentVisibleCase): EvaluationContext {
  return {
    initialState: agentVisible.initialState,
    finalState: agentVisible.finalState,
    trajectory: agentVisible.trajectory,
    // Present for completeness; no assertion in the vocabulary reads it, and
    // the contract is forbidden from depending on the agent's prose.
    finalResponse: agentVisible.finalResponse,
  };
}

export interface ExecuteOptions {
  readonly contract: AnyCompiledContract;
  readonly contractHash: string;
  readonly agentVisible: AgentVisibleCase;
  /** Injectable so a determinism test can hold the duration constant. */
  readonly now?: () => number;
}

/**
 * One requirement is a conjunction of its assertions: any violated assertion
 * disproves it, and a single unresolvable one withholds a pass. Missing
 * evidence never becomes PASS.
 *
 * A requirement that declared `partial` coverage is held to a stricter rule: it
 * may still FAIL on an implemented assertion, but satisfying every implemented
 * assertion only earns NEEDS_REVIEW. Otherwise a clause the contract openly
 * admits it cannot express would be reported as verified.
 */
export function executeContract(options: ExecuteOptions): StateProofPrediction {
  const clock = options.now ?? ((): number => Date.now());
  const startedMs = clock();
  const context = evaluationContextFor(options.agentVisible);

  const assessments: RequirementAssessment[] = normalizeRequirements(options.contract).map(
    (requirement) => {
      const results = requirement.assertions.map((assertion) => ({
        assertion,
        result: evaluateAssertion(assertion, context),
      }));

      const outcome: AssertionOutcome = results.some((entry) => entry.result.outcome === 'violated')
        ? 'violated'
        : results.some((entry) => entry.result.outcome === 'indeterminate')
          ? 'indeterminate'
          : 'satisfied';

      const refs = [
        ...new Set(results.flatMap((entry) => assertionEvidenceRefs(entry.assertion, context))),
      ].sort();

      const partial = requirement.verificationCoverage === 'partial';
      const status = partial && outcome !== 'violated' ? 'NEEDS_REVIEW' : statusFor(outcome);
      const coverageNote =
        partial && outcome !== 'violated'
          ? ` | coverage is partial, so this cannot pass: ${requirement.limitations.join('; ')}`
          : '';

      return {
        requirementKey: requirement.requirementKey as RequirementKey,
        status,
        reason:
          `${requirement.description} — ` +
          `${results.map((entry) => entry.result.message).join(' | ')}${coverageNote}`,
        evidenceRefs: refs,
      };
    },
  );

  const verdict = assessments.some((assessment) => assessment.status === 'FAIL')
    ? 'FAIL'
    : assessments.every((assessment) => assessment.status === 'PASS')
      ? 'PASS'
      : 'NEEDS_REVIEW';

  return {
    caseId: options.agentVisible.caseId,
    verdict,
    requirementAssessments: assessments,
    contractHash: options.contractHash,
    verificationDurationMs: Math.max(0, clock() - startedMs),
  };
}

/**
 * The prediction with runtime-dependent fields removed, for proving that two
 * executions of the same contract and run are byte-identical.
 */
export function canonicalPrediction(prediction: StateProofPrediction): string {
  const { verificationDurationMs: _excluded, ...stable } = prediction;
  return JSON.stringify(toJsonValue(stable));
}

export function predictionHash(prediction: StateProofPrediction): string {
  return hashJson(JSON.parse(canonicalPrediction(prediction)) as never);
}
