import type { JsonValue } from '../json';
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
  | 'coverage_partial_without_limitations'
  | 'message_selector_not_existential'
  | 'message_missing_recipient'
  | 'message_missing_sent_status'
  | 'message_missing_order_discriminator'
  | 'message_missing_refund_relationship'
  | 'unsupported_partial_coverage';

export interface SemanticViolation {
  readonly code: SemanticViolationCode;
  readonly requirementId: string;
  readonly path: string;
  readonly message: string;
}

/**
 * Which fields on the outbound-message collection carry which meaning.
 *
 * This is domain capability data, not gold data: it comes from the same schema
 * the Contract Agent is shown, and says nothing about any run or expected
 * verdict. It is what lets the lint ask "did the contract use the
 * discriminators the domain offers and the task states?" without knowing the
 * answer to the requirement itself.
 */
export interface MessageRecordPolicy {
  readonly collection: string;
  readonly recipientField: string;
  readonly statusField: string;
  readonly sentValue: string;
  readonly orderField: string;
  readonly refundField: string;
}

export interface ContractSemanticsOptions {
  readonly taskText: string;
  /** Collection names the domain actually has. An unknown one can never match. */
  readonly knownCollections: ReadonlySet<string>;
  /** Non-entity identifiers a contract may name: collections, fields, keys. */
  readonly allowedIdentifiers?: ReadonlySet<string>;
  /** Enables the output-message lint. Omit to skip it. */
  readonly messagePolicy?: MessageRecordPolicy;
  /**
   * Requirement keys the assertion vocabulary can express in full. Declaring
   * one of these `partial` is a modelling failure, not a vocabulary limit.
   */
  readonly fullySupportedRequirementKeys?: ReadonlySet<string>;
}

// Deliberately not global: a /g regex carries `lastIndex` between `.test()`
// calls, which would make the same task text alternate between naming an order
// and not naming one.
const ORDER_ID = /\bORD-[A-Z0-9][A-Z0-9-]*/;
const REFUND_ID = /\bRF[A-Z]?-[A-Z0-9][A-Z0-9-]*/g;
const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/** What the task text itself demands of an outbound message. */
export interface MessageTaskFacts {
  readonly namesRecipient: boolean;
  readonly namesOrder: boolean;
  readonly requiresSending: boolean;
  readonly concernsRefund: boolean;
  readonly priorRefundIds: string[];
}

export function messageTaskFacts(taskText: string): MessageTaskFacts {
  return {
    namesRecipient: EMAIL_ADDRESS.test(taskText),
    namesOrder: ORDER_ID.test(taskText),
    requiresSending: /\bsend\b|\bsent\b|\bnotice\b|\breceipt\b/i.test(taskText),
    concernsRefund: /refund/i.test(taskText),
    priorRefundIds: [...new Set(taskText.match(REFUND_ID) ?? [])],
  };
}

/** Every field an existential assertion constrains, and how. */
function existentialFields(
  assertion: Extract<Assertion, { kind: 'record_exists_matching' }>,
): Map<string, { literal: JsonValue | null; relational: boolean }> {
  const fields = new Map<string, { literal: JsonValue | null; relational: boolean }>();
  for (const condition of assertion.where) {
    if ('equals' in condition) fields.set(condition.field, { literal: condition.equals, relational: false });
    else fields.set(condition.field, { literal: null, relational: true });
  }
  return fields;
}

/**
 * The output-message lint.
 *
 * The previous iteration's only failure was a contract that identified the
 * outbound message by recipient alone. Every fixture holds an older message to
 * the same person, so the assertion could not tell which message it meant and
 * withheld a verdict — correctly, but uselessly. Nothing in the pipeline could
 * see that coming, because it is not a schema error and not an ungrounded id:
 * it is a contract that under-uses the discriminators the task handed it.
 *
 * So that is what this checks, from the task text and the domain schema alone.
 */
function lintMessageRequirement(
  requirement: { id: string; assertions: readonly Assertion[] },
  path: string,
  policy: MessageRecordPolicy,
  facts: MessageTaskFacts,
): SemanticViolation[] {
  const violations: SemanticViolation[] = [];
  const touchesMessages = (selector: RecordSelector): boolean =>
    selector.collection === policy.collection;

  for (const [index, assertion] of requirement.assertions.entries()) {
    const at = `${path}.assertions[${index}]`;
    const selectorFirst =
      (('selector' in assertion) && touchesMessages(assertion.selector)) ||
      (assertion.kind === 'record_field_equals_selected_record_id' &&
        touchesMessages(assertion.leftSelector));
    if (!selectorFirst) continue;
    violations.push({
      code: 'message_selector_not_existential',
      requirementId: requirement.id,
      path: at,
      message:
        `a ${assertion.kind} assertion picks one "${policy.collection}" record before checking it, ` +
        'so an unrelated message that shares one field makes the requirement unresolvable; ' +
        'use record_exists_matching with every condition on the same record instead',
    });
  }

  const existential = requirement.assertions.filter(
    (assertion): assertion is Extract<Assertion, { kind: 'record_exists_matching' }> =>
      assertion.kind === 'record_exists_matching' && assertion.collection === policy.collection,
  );

  if (existential.length === 0) {
    violations.push({
      code: 'message_selector_not_existential',
      requirementId: requirement.id,
      path: `${path}.assertions`,
      message:
        `this requirement must prove a "${policy.collection}" record exists that satisfies every ` +
        'condition at once; express it with a record_exists_matching assertion',
    });
    return violations;
  }

  // The conditions must hold on one record, so one assertion must carry them
  // all. The best candidate is reported, so a repair knows what to add where.
  const required: Array<{ code: SemanticViolationCode; field: string; message: string }> = [];
  if (facts.namesRecipient) {
    required.push({
      code: 'message_missing_recipient',
      field: policy.recipientField,
      message: `the task states the recipient, so "${policy.recipientField}" must be one of the conditions`,
    });
  }
  if (facts.requiresSending) {
    required.push({
      code: 'message_missing_sent_status',
      field: policy.statusField,
      message:
        `the task requires the message to be sent, so "${policy.statusField}" must be constrained to ` +
        `"${policy.sentValue}"; a draft has reached nobody`,
    });
  }
  if (facts.namesOrder) {
    required.push({
      code: 'message_missing_order_discriminator',
      field: policy.orderField,
      message:
        `the task names the order, so "${policy.orderField}" must be one of the conditions; ` +
        'recipient alone does not distinguish this message from an earlier one to the same person',
    });
  }
  if (facts.concernsRefund) {
    required.push({
      code: 'message_missing_refund_relationship',
      field: policy.refundField,
      message:
        `the message must be tied to the refund it concerns, so "${policy.refundField}" must equal ` +
        'either the refund id the task names, or the id of the refund a selector resolves to',
    });
  }

  let best: { missing: typeof required; assertionIndex: number } | null = null;
  for (const assertion of existential) {
    const index = requirement.assertions.indexOf(assertion);
    const fields = existentialFields(assertion);
    const missing = required.filter((entry) => !fields.has(entry.field));
    if (best === null || missing.length < best.missing.length) {
      best = { missing, assertionIndex: index };
    }
  }
  if (best === null) return violations;

  for (const entry of best.missing) {
    violations.push({
      code: entry.code,
      requirementId: requirement.id,
      path: `${path}.assertions[${best.assertionIndex}].where`,
      message: entry.message,
    });
  }

  // A named prior refund must be matched literally; a refund the run creates
  // has no id yet and must be matched relationally.
  const chosen = requirement.assertions[best.assertionIndex];
  if (chosen !== undefined && chosen.kind === 'record_exists_matching' && facts.concernsRefund) {
    const refund = existentialFields(chosen).get(policy.refundField);
    if (refund !== undefined && !refund.relational) {
      const literal = typeof refund.literal === 'string' ? refund.literal : '';
      if (!facts.priorRefundIds.includes(literal)) {
        violations.push({
          code: 'message_missing_refund_relationship',
          requirementId: requirement.id,
          path: `${path}.assertions[${best.assertionIndex}].where`,
          message:
            `"${policy.refundField}" is matched against a literal the task does not name as a prior ` +
            'refund; a refund created during the run must be identified with equalsSelectedRecordId',
        });
      }
    }
  }

  return violations;
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
    case 'record_exists_matching':
      collections.push(assertion.collection);
      for (const condition of assertion.where) {
        if ('equalsSelectedRecordId' in condition) {
          selectors.push(condition.equalsSelectedRecordId.selector);
        }
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
  const facts = messageTaskFacts(options.taskText);

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

    // Declaring a gap is the right move when one exists. For these keys none
    // does: the vocabulary expresses every one of them in full, so "partial"
    // here means the contract stopped short, not that the DSL ran out.
    if (
      requirement.verificationCoverage === 'partial' &&
      options.fullySupportedRequirementKeys?.has(requirement.requirementKey) === true
    ) {
      violations.push({
        code: 'unsupported_partial_coverage',
        requirementId: requirement.id,
        path: `${base}.verificationCoverage`,
        message:
          `the assertion vocabulary expresses "${requirement.requirementKey}" completely, so this ` +
          'requirement must declare complete coverage; unstated prose or subject wording is not a ' +
          'clause of the task and is not a reason to withhold verification',
      });
    }

    if (options.messagePolicy !== undefined && requirement.requirementKey === 'customer_message_outcome') {
      violations.push(
        ...lintMessageRequirement(
          { id: requirement.id, assertions: requirement.assertions },
          base,
          options.messagePolicy,
          facts,
        ),
      );
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
