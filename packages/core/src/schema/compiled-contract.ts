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

/** Bumped by DSL v2, which added `mutations_limited_to` and coverage fields. */
export const ASSERTION_SCHEMA_VERSION = '2.0.0';

/** What v1 contracts were compiled against. Kept so historical artifacts parse. */
export const ASSERTION_SCHEMA_VERSION_V1 = '1.0.0';

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

// --- contract v2 -------------------------------------------------------------

/**
 * Whether a requirement's assertions actually cover everything the task asks
 * for.
 *
 * A contract that silently drops a clause it cannot express turns an
 * unverified obligation into a pass. Declaring the gap makes it visible, and
 * the executor refuses to call a partial requirement PASS.
 */
export const VerificationCoverageSchema = z.enum(['complete', 'partial']);
export type VerificationCoverage = z.infer<typeof VerificationCoverageSchema>;

export const CompiledRequirementV2Schema = z
  .object({
    id: RequirementIdSchema,
    requirementKey: RequirementKeySchema,
    category: z.enum(['outcome', 'process', 'prohibition', 'scope']),
    description: z.string().min(1),
    severity: z.literal('must_pass'),
    assertions: z.array(AssertionSchema).min(1),
    verificationCoverage: VerificationCoverageSchema,
    /** Every part of the requirement the assertions do not check. */
    limitations: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((requirement, ctx) => {
    if (requirement.verificationCoverage === 'complete' && requirement.limitations.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limitations'],
        message: 'a requirement claiming complete coverage must list no limitations',
      });
    }
    if (requirement.verificationCoverage === 'partial' && requirement.limitations.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limitations'],
        message: 'a requirement declaring partial coverage must say what it does not check',
      });
    }
  });

export type CompiledRequirementV2 = z.infer<typeof CompiledRequirementV2Schema>;

export const CompiledContractV2Schema = z
  .object({
    contractVersion: z.literal('2'),
    taskSummary: z.string().min(1),
    requirements: z.array(CompiledRequirementV2Schema).min(1),
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

export type CompiledContractV2 = z.infer<typeof CompiledContractV2Schema>;

/** Either contract generation. v1 artifacts stay readable and replayable. */
export type AnyCompiledContract = CompiledContract | CompiledContractV2;

export interface NormalizedRequirement {
  readonly id: string;
  readonly requirementKey: string;
  readonly category: string;
  readonly description: string;
  readonly assertions: CompiledRequirement['assertions'];
  readonly verificationCoverage: VerificationCoverage;
  readonly limitations: readonly string[];
}

/** v1 requirements have no coverage fields; they are treated as complete. */
export function normalizeRequirements(contract: AnyCompiledContract): NormalizedRequirement[] {
  return contract.requirements.map((requirement) => ({
    id: requirement.id,
    requirementKey: requirement.requirementKey,
    category: requirement.category,
    description: requirement.description,
    assertions: requirement.assertions,
    verificationCoverage:
      'verificationCoverage' in requirement ? requirement.verificationCoverage : 'complete',
    limitations: 'limitations' in requirement ? requirement.limitations : [],
  }));
}

export function isContractV2(contract: AnyCompiledContract): contract is CompiledContractV2 {
  return contract.contractVersion === '2';
}
