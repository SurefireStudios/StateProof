import {
  type BenchmarkCase,
  type EvaluationContext,
  type RunVerdict,
  canonicalJson,
  toJsonValue,
  verifyContract,
} from '@stateproof/core';
import type { ValidationIssue } from './types';

function issue(caseId: string, check: string, message: string): ValidationIssue {
  return { caseId, check, severity: 'error', message };
}

export function evaluationContextFor(benchmarkCase: BenchmarkCase): EvaluationContext {
  return {
    initialState: benchmarkCase.agentVisible.initialState,
    finalState: benchmarkCase.agentVisible.finalState,
    trajectory: benchmarkCase.agentVisible.trajectory,
    finalResponse: benchmarkCase.agentVisible.finalResponse,
  };
}

/** Replays the gold contract against the fixture with the deterministic verifier. */
export function computeVerdict(benchmarkCase: BenchmarkCase): RunVerdict {
  return verifyContract(
    benchmarkCase.goldContract,
    evaluationContextFor(benchmarkCase),
    benchmarkCase.caseId,
  );
}

export interface SemanticValidationResult {
  readonly issues: ValidationIssue[];
  readonly computedVerdict: RunVerdict;
}

/**
 * Proves that the fixture actually exhibits the failure its gold data claims:
 * every requirement resolves to the expected status, the overall verdict
 * matches the gold label, and (unless explicitly approved) exactly one
 * must-pass requirement is violated.
 */
export function validateSemantics(benchmarkCase: BenchmarkCase): SemanticValidationResult {
  const { caseId, goldVerdict, metadata } = benchmarkCase;
  const issues: ValidationIssue[] = [];
  const computedVerdict = computeVerdict(benchmarkCase);

  const computedByRequirement = new Map(
    computedVerdict.requirementVerdicts.map((verdict) => [verdict.requirementId, verdict]),
  );

  for (const expectation of goldVerdict.requirementExpectations) {
    const computed = computedByRequirement.get(expectation.requirementId);
    if (computed === undefined) {
      issues.push(
        issue(
          caseId,
          'requirement-expectation',
          `${expectation.requirementId} was never evaluated`,
        ),
      );
      continue;
    }
    if (computed.status !== expectation.expectedStatus) {
      issues.push(
        issue(
          caseId,
          'requirement-expectation',
          `${expectation.requirementId}: gold expects "${expectation.expectedStatus}" but the verifier computed "${computed.status}" (${computed.rationale})`,
        ),
      );
    }
  }

  if (computedVerdict.overall !== goldVerdict.overall) {
    issues.push(
      issue(
        caseId,
        'overall-verdict',
        `gold verdict is ${goldVerdict.overall} but the verifier computed ${computedVerdict.overall}`,
      ),
    );
  }

  const expectedOverall = metadata.goldLabel === 'valid' ? 'PASS' : 'FAIL';
  if (goldVerdict.overall !== expectedOverall) {
    issues.push(
      issue(
        caseId,
        'label-consistency',
        `case is labelled "${metadata.goldLabel}" so the gold verdict must be ${expectedOverall}, not ${goldVerdict.overall}`,
      ),
    );
  }

  const disprovenMustPass = computedVerdict.requirementVerdicts.filter(
    (verdict) => verdict.mustPass && verdict.status === 'disproven',
  );

  if (metadata.goldLabel === 'invalid' && !metadata.multiFault) {
    if (disprovenMustPass.length !== 1) {
      issues.push(
        issue(
          caseId,
          'isolated-failure',
          `single-fault case violates ${disprovenMustPass.length} must-pass requirements (${disprovenMustPass
            .map((verdict) => verdict.requirementId)
            .join(', ')}); expected exactly 1`,
        ),
      );
    } else if (disprovenMustPass[0]?.requirementId !== metadata.isolatedFailureRequirementId) {
      issues.push(
        issue(
          caseId,
          'isolated-failure',
          `metadata names ${String(metadata.isolatedFailureRequirementId)} as the isolated failure but ${String(
            disprovenMustPass[0]?.requirementId,
          )} is violated`,
        ),
      );
    }
  }

  if (metadata.goldLabel === 'valid' && disprovenMustPass.length > 0) {
    issues.push(
      issue(
        caseId,
        'isolated-failure',
        `case is labelled valid but ${disprovenMustPass.length} must-pass requirement(s) are violated`,
      ),
    );
  }

  // Verification must be a pure function of the fixture.
  const secondPass = computeVerdict(benchmarkCase);
  if (canonicalJson(toJsonValue(secondPass)) !== canonicalJson(toJsonValue(computedVerdict))) {
    issues.push(
      issue(caseId, 'determinism', 're-running the verifier produced a different verdict'),
    );
  }

  return { issues, computedVerdict };
}
