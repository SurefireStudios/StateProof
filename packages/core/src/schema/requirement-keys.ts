import { z } from 'zod';

/**
 * A small, task-independent vocabulary for *what kind* of obligation a
 * requirement expresses.
 *
 * Requirement ids like `A-PROC-01` are per-template, so they cannot be shown
 * to an evaluator without telling it which template it is looking at. These
 * keys can: they name the sort of thing a refund-operations task can require,
 * and every one of them is inferable from the task text alone. That is what
 * makes requirement-level scoring possible without leaking gold data.
 */
export const RequirementKeySchema = z.enum([
  'refund_outcome',
  'customer_message_outcome',
  'support_note_outcome',
  'approval_before_refund',
  'no_new_refund',
  'scope_integrity',
]);

export type RequirementKey = z.infer<typeof RequirementKeySchema>;

export const REQUIREMENT_KEYS = RequirementKeySchema.options;

/**
 * Canonical mapping from human-authored requirement ids to semantic keys.
 * Both benchmark suites use the same three task templates, so one table
 * serves both.
 */
const REQUIREMENT_KEY_BY_ID: Readonly<Record<string, RequirementKey>> = {
  // Template A - exact refund, receipt, approval order, scope.
  'A-OUT-01': 'refund_outcome',
  'A-OUT-02': 'customer_message_outcome',
  'A-PROC-01': 'approval_before_refund',
  'A-SCOPE-01': 'scope_integrity',

  // Template B - partial refund, receipt, required support note.
  'B-OUT-01': 'refund_outcome',
  'B-OUT-02': 'customer_message_outcome',
  'B-OUT-03': 'support_note_outcome',
  'B-PROC-01': 'approval_before_refund',
  'B-SCOPE-01': 'scope_integrity',

  // Template C - prevent a duplicate refund.
  'C-PROH-01': 'no_new_refund',
  'C-OUT-01': 'customer_message_outcome',
  'C-OUT-02': 'support_note_outcome',
  'C-SCOPE-01': 'scope_integrity',
};

export function requirementKeyFor(requirementId: string): RequirementKey | undefined {
  return REQUIREMENT_KEY_BY_ID[requirementId];
}

/** Throws for an unmapped id, so a new requirement cannot be scored silently. */
export function requireRequirementKey(requirementId: string): RequirementKey {
  const key = requirementKeyFor(requirementId);
  if (key === undefined) {
    throw new Error(`no semantic requirement key is mapped for "${requirementId}"`);
  }
  return key;
}

export function mappedRequirementIds(): string[] {
  return Object.keys(REQUIREMENT_KEY_BY_ID).sort();
}
