import type { Assertion, RecordSelector } from '../schema/contract';
import { type AnyCompiledContract, normalizeRequirements } from '../schema/compiled-contract';
import { REQUIREMENT_KEYS } from '../schema/requirement-keys';
import { findUngroundedLiterals } from './contract-literals';

/**
 * Defects a compiled contract can have while still being schema-valid.
 *
 * Zod proves the shape. It cannot prove that a scope assertion selects from the
 * collection it constrains, that every named id came from the task, or that a
 * requirement claiming full coverage really has no gaps. Those are the failures
 * that would otherwise reach the verifier and quietly produce a wrong verdict,
 * so they are rejected here — before the contract is cached, written, or used —
 * and the exact messages are fed back through the single repair retry.
 */

export type SemanticViolationCode =
  | 'ungrounded_literal'
  | 'unknown_requirement_key'
  | 'duplicate_requirement_key'
  | 'duplicate_requirement_id'
  | 'no_executable_assertion'
  | 'unknown_collection'
  | 'invalid_mutation_scope'
  | 'coverage_complete_with_limitations'
  | 'coverage_partial_without_limitations';

export interface SemanticViolation {
  readonly code: SemanticViolationCode;
  readonly requirementId: string;
  readonly path: string;
  readonly message: string;
}

export interface ContractSemanticsOptions {
  readonly taskText: string;
  /** Collection names the domain actually has. An unknown one can never match. */
  readonly knownCollections: ReadonlySet<string>;
  /** Non-entity identifiers a contract may name: collections, fields, keys. */
  readonly allowedIdentifiers?: ReadonlySet<string>;
}

/** Every collection an assertion reads or constrains. */
export function assertionCollections(assertion: Assertion): string[] {
  const selectors: RecordSelector[] = [];
  const collections: string[] = [];

  switch (assertion.kind) {
    case 'record_exists':
    case 'record_absent':
    case 'record_field_equals':
    case 'record_money_equals':
    case 'record_array_contains_exact':
      selectors.push(assertion.selector);
      break;
    case 'record_field_equals_selected_record_id':
      selectors.push(assertion.leftSelector, assertion.rightSelector);
      break;
    case 'no_new_records':
    case 'no_unrelated_mutations':
      collections.push(assertion.collection);
      break;
    case 'mutations_limited_to':
      collections.push(assertion.collection);
      for (const allowed of assertion.allowedRecords) {
        if (allowed.kind === 'selected_record') selectors.push(allowed.selector);
      }
      break;
    case 'event_order':
      break;
  }

  return [...new Set([...collections, ...selectors.map((selector) => selector.collection)])];
}

/**
 * Returns every semantic defect in a compiled contract. An empty array is the
 * only result that lets the contract be accepted.
 */
export function validateContractSemantics(
  contract: AnyCompiledContract,
  options: ContractSemanticsOptions,
): SemanticViolation[] {
  const violations: SemanticViolation[] = [];
  const requirements = normalizeRequirements(contract);

  for (const literal of findUngroundedLiterals(contract, options.taskText, {
    ...(options.allowedIdentifiers === undefined
      ? {}
      : { allowedIdentifiers: options.allowedIdentifiers }),
  })) {
    violations.push({
      code: 'ungrounded_literal',
      requirementId: literal.requirementId,
      path: literal.path,
      message:
        `"${literal.literal}" is an identifier the task never states, so a contract naming it ` +
        'verifies one recording rather than the task; identify the record relationally instead',
    });
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();

  for (const [index, requirement] of requirements.entries()) {
    const base = `requirements[${index}]`;

    if (seenIds.has(requirement.id)) {
      violations.push({
        code: 'duplicate_requirement_id',
        requirementId: requirement.id,
        path: `${base}.id`,
        message: `requirement id "${requirement.id}" is used more than once`,
      });
    }
    seenIds.add(requirement.id);

    if (!(REQUIREMENT_KEYS as readonly string[]).includes(requirement.requirementKey)) {
      violations.push({
        code: 'unknown_requirement_key',
        requirementId: requirement.id,
        path: `${base}.requirementKey`,
        message:
          `"${requirement.requirementKey}" is not one of the permitted requirement keys: ` +
          REQUIREMENT_KEYS.join(', '),
      });
    }
    if (seenKeys.has(requirement.requirementKey)) {
      violations.push({
        code: 'duplicate_requirement_key',
        requirementId: requirement.id,
        path: `${base}.requirementKey`,
        message: `requirementKey "${requirement.requirementKey}" appears on more than one requirement`,
      });
    }
    seenKeys.add(requirement.requirementKey);

    if (requirement.assertions.length === 0) {
      violations.push({
        code: 'no_executable_assertion',
        requirementId: requirement.id,
        path: `${base}.assertions`,
        message: 'a must-pass requirement with no assertion can never be checked',
      });
    }

    if (requirement.verificationCoverage === 'complete' && requirement.limitations.length > 0) {
      violations.push({
        code: 'coverage_complete_with_limitations',
        requirementId: requirement.id,
        path: `${base}.limitations`,
        message: 'verificationCoverage "complete" contradicts a non-empty limitations list',
      });
    }
    if (requirement.verificationCoverage === 'partial' && requirement.limitations.length === 0) {
      violations.push({
        code: 'coverage_partial_without_limitations',
        requirementId: requirement.id,
        path: `${base}.limitations`,
        message: 'verificationCoverage "partial" must state what the assertions do not check',
      });
    }

    for (const [assertionIndex, assertion] of requirement.assertions.entries()) {
      const at = `${base}.assertions[${assertionIndex}]`;

      for (const collection of assertionCollections(assertion)) {
        if (options.knownCollections.has(collection)) continue;
        violations.push({
          code: 'unknown_collection',
          requirementId: requirement.id,
          path: at,
          message: `collection "${collection}" does not exist in the domain schema`,
        });
      }

      if (assertion.kind !== 'mutations_limited_to') continue;
      for (const [allowedIndex, allowed] of assertion.allowedRecords.entries()) {
        if (allowed.kind !== 'selected_record') continue;
        if (allowed.selector.collection === assertion.collection) continue;
        violations.push({
          code: 'invalid_mutation_scope',
          requirementId: requirement.id,
          path: `${at}.allowedRecords[${allowedIndex}].selector.collection`,
          message:
            `a mutations_limited_to assertion over "${assertion.collection}" must select its ` +
            `allowed records from "${assertion.collection}", not "${allowed.selector.collection}"`,
        });
      }
    }
  }

  return violations;
}

/** One line per defect, in the form the repair message sends back. */
export function formatSemanticViolations(violations: readonly SemanticViolation[]): string[] {
  return violations.map((violation) => `${violation.path} (${violation.code}): ${violation.message}`);
}
