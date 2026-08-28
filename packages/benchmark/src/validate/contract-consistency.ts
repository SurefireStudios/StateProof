import type { BenchmarkCase, ContractRequirement } from '@stateproof/core';
import { approvedCase } from './approved-cases';
import type { ValidationIssue } from './types';

/**
 * Cases built from the same task template must share a contract shape.
 *
 * The canonical matrix states one set of gold requirements per template, so
 * every case of that template should carry the same requirement ids and the
 * same assertion kinds in the same order. Only the fixture-specific values
 * inside an assertion may differ.
 *
 * This exists because of a real drift: `PB-A03` was hand-authored before the
 * relational refund reference existed and kept a hardcoded refund id in
 * `A-OUT-02` while the other Template A cases moved on. Nothing caught it.
 */

/** The comparable shape of one requirement, ignoring fixture values. */
function requirementShape(requirement: ContractRequirement): string {
  const kinds = requirement.assertions.map((assertion) => assertion.kind).join(',');
  return [
    requirement.category,
    requirement.mustPass ? 'must-pass' : 'advisory',
    requirement.severity,
    `[${kinds}]`,
  ].join(' ');
}

function shapeOf(benchmarkCase: BenchmarkCase): Map<string, string> {
  return new Map(
    benchmarkCase.goldContract.requirements.map((requirement) => [
      requirement.requirementId,
      requirementShape(requirement),
    ]),
  );
}

export function validateContractConsistency(cases: readonly BenchmarkCase[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const byTemplate = new Map<string, BenchmarkCase[]>();
  for (const benchmarkCase of cases) {
    const approved = approvedCase(benchmarkCase.caseId);
    if (approved === undefined) continue;
    byTemplate.set(approved.template, [...(byTemplate.get(approved.template) ?? []), benchmarkCase]);
  }

  for (const [template, group] of [...byTemplate].sort()) {
    const sorted = [...group].sort((left, right) => left.caseId.localeCompare(right.caseId));
    const reference = sorted[0];
    if (reference === undefined || sorted.length < 2) continue;

    const referenceShape = shapeOf(reference);

    for (const benchmarkCase of sorted.slice(1)) {
      const shape = shapeOf(benchmarkCase);

      for (const requirementId of referenceShape.keys()) {
        if (!shape.has(requirementId)) {
          issues.push({
            caseId: benchmarkCase.caseId,
            check: 'contract-consistency',
            severity: 'error',
            message: `template ${template} requires ${requirementId}, which this case's gold contract does not define (reference: ${reference.caseId})`,
          });
        }
      }
      for (const requirementId of shape.keys()) {
        if (!referenceShape.has(requirementId)) {
          issues.push({
            caseId: benchmarkCase.caseId,
            check: 'contract-consistency',
            severity: 'error',
            message: `${requirementId} is not part of template ${template} (reference: ${reference.caseId})`,
          });
        }
      }
      for (const [requirementId, expected] of referenceShape) {
        const actual = shape.get(requirementId);
        if (actual !== undefined && actual !== expected) {
          issues.push({
            caseId: benchmarkCase.caseId,
            check: 'contract-consistency',
            severity: 'error',
            message: `${requirementId} has shape "${actual}" but template ${template} uses "${expected}" (reference: ${reference.caseId})`,
          });
        }
      }
    }
  }

  return issues;
}
