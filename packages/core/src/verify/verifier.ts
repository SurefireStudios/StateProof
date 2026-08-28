import type { ContractRequirement, TaskContract } from '../schema/contract';
import type { EvidenceRecord } from '../schema/evidence';
import type {
  OverallVerdict,
  RequirementStatus,
  RequirementVerdict,
  RunVerdict,
} from '../schema/verdict';
import { CURRENT_SCHEMA_VERSION } from '../common';
import { type EvaluationContext, evaluateAssertion } from './assertions';

/**
 * Maps an assertion outcome onto a requirement status.
 * `indeterminate` deliberately becomes `insufficient_evidence`, never a pass.
 */
function statusForOutcome(outcome: 'satisfied' | 'violated' | 'indeterminate'): RequirementStatus {
  switch (outcome) {
    case 'satisfied':
      return 'verified';
    case 'violated':
      return 'disproven';
    case 'indeterminate':
      return 'insufficient_evidence';
  }
}

/**
 * PASS when every must-pass requirement is verified, FAIL when any must-pass
 * requirement is disproven, otherwise NEEDS_REVIEW. Requirements that are not
 * must-pass are reported but never change the overall verdict.
 */
export function rollUpVerdict(verdicts: readonly RequirementVerdict[]): OverallVerdict {
  const mustPass = verdicts.filter((verdict) => verdict.mustPass);
  if (mustPass.some((verdict) => verdict.status === 'disproven')) return 'FAIL';
  if (mustPass.every((verdict) => verdict.status === 'verified')) return 'PASS';
  return 'NEEDS_REVIEW';
}

function verifyRequirement(
  requirement: ContractRequirement,
  context: EvaluationContext,
  evidenceSink: EvidenceRecord[],
): RequirementVerdict {
  if (requirement.assertions.length === 0) {
    return {
      requirementId: requirement.requirementId,
      status: 'insufficient_evidence',
      mustPass: requirement.mustPass,
      severity: requirement.severity,
      assertionOutcome: null,
      rationale:
        'No machine-checkable assertion is attached to this requirement, so the deterministic verifier cannot confirm or disprove it.',
      evidenceIds: [],
    };
  }

  const results = requirement.assertions.map((assertion) => evaluateAssertion(assertion, context));
  const evidenceIds: string[] = [];

  for (const evidence of results.flatMap((result) => result.evidence)) {
    const evidenceId = `${requirement.requirementId}#E${String(evidenceIds.length + 1).padStart(2, '0')}`;
    evidenceIds.push(evidenceId);
    evidenceSink.push({
      evidenceId,
      requirementId: requirement.requirementId,
      source: evidence.source,
      locator: evidence.locator,
      observed: evidence.observed,
      collectedBy: 'deterministic_verifier',
      summary: evidence.summary,
    });
  }

  // A requirement is a conjunction: one violated assertion disproves it, and a
  // single unresolvable assertion is enough to withhold a pass.
  const outcome = results.some((result) => result.outcome === 'violated')
    ? 'violated'
    : results.some((result) => result.outcome === 'indeterminate')
      ? 'indeterminate'
      : 'satisfied';

  return {
    requirementId: requirement.requirementId,
    status: statusForOutcome(outcome),
    mustPass: requirement.mustPass,
    severity: requirement.severity,
    assertionOutcome: outcome,
    rationale: results.map((result) => result.message).join(' | '),
    evidenceIds,
  };
}

/**
 * Runs every machine-checkable requirement of a contract against a case.
 * Output is deterministic: no timestamps, no ids derived from anything but the
 * requirement ids, and stable ordering.
 */
export function verifyContract(
  contract: TaskContract,
  context: EvaluationContext,
  caseId: string,
): RunVerdict {
  const evidence: EvidenceRecord[] = [];
  const requirementVerdicts = contract.requirements.map((requirement) =>
    verifyRequirement(requirement, context, evidence),
  );
  const overall = rollUpVerdict(requirementVerdicts);

  const disproven = requirementVerdicts.filter((verdict) => verdict.status === 'disproven');
  const unresolved = requirementVerdicts.filter(
    (verdict) => verdict.mustPass && verdict.status === 'insufficient_evidence',
  );

  const summaryParts = [
    `${requirementVerdicts.length} requirement(s) evaluated`,
    `${disproven.length} disproven`,
    `${unresolved.length} must-pass requirement(s) without sufficient evidence`,
  ];

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    caseId,
    contractId: contract.contractId,
    overall,
    requirementVerdicts,
    evidence,
    summary: `${overall}: ${summaryParts.join('; ')}.`,
  };
}
