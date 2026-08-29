import { z } from 'zod';
import { AssertionSchema, RequirementIdSchema } from './contract';
import { RequirementKeySchema } from './requirement-keys';

/**
 * The Contract Agent's output: a task's success criteria, compiled once,
 * before any run is seen.
 *
 * This is deliberately a different type from `TaskContract`. A gold contract is
 * human-authored per case and may cite fixture ids freely; a compiled contract
 * is produced from the task text alone and must be verifiable against any run
 * of that task. The `requirementKey` on each requirement is what lets a
 * compiled contract be scored against gold expectations without either side
 * knowing the other's requirement ids.
 */

export const ASSERTION_SCHEMA_VERSION = '1.0.0';

export const CompiledRequirementSchema = z
  .object({
    id: RequirementIdSchema,
    requirementKey: RequirementKeySchema,
    category: z.enum(['outcome', 'process', 'prohibition', 'scope']),
    description: z.string().min(1),
    severity: z.literal('must_pass'),
    /** Conjunctive: the requirement holds only if every assertion holds. */
    assertions: z.array(AssertionSchema).min(1),
  })
  .strict();

export type CompiledRequirement = z.infer<typeof CompiledRequirementSchema>;

export const CompiledContractSchema = z
  .object({
    contractVersion: z.literal('1'),
    taskSummary: z.string().min(1),
    requirements: z.array(CompiledRequirementSchema).min(1),
    /**
     * Anything the task leaves genuinely undetermined. Surfacing it is required;
     * silently dropping an unprovable requirement is not allowed.
     */
    ambiguities: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((contract, ctx) => {
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    for (const [index, requirement] of contract.requirements.entries()) {
      if (seenIds.has(requirement.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requirements', index, 'id'],
          message: `duplicate requirement id "${requirement.id}"`,
        });
      }
      seenIds.add(requirement.id);

      if (seenKeys.has(requirement.requirementKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requirements', index, 'requirementKey'],
          message: `requirementKey "${requirement.requirementKey}" appears more than once; each key must appear exactly once`,
        });
      }
      seenKeys.add(requirement.requirementKey);
    }
  });

export type CompiledContract = z.infer<typeof CompiledContractSchema>;

/** Semantic keys the compiled contract claims the task imposes. */
export function compiledRequirementKeys(contract: CompiledContract): string[] {
  return contract.requirements.map((requirement) => requirement.requirementKey).sort();
}
