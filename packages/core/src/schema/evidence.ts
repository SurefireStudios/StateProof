import { z } from 'zod';
import { JsonValueSchema } from '../json';
import { NonEmptyStringSchema } from '../common';
import { EvidenceSourceSchema, RequirementIdSchema } from './contract';

/**
 * One observation tied to one requirement. Evidence records carry no
 * timestamps: verifier output must be byte-identical across runs of the same
 * inputs so run artifacts can be hashed and compared.
 */
export const EvidenceRecordSchema = z
  .object({
    evidenceId: NonEmptyStringSchema,
    requirementId: RequirementIdSchema,
    source: EvidenceSourceSchema,
    /** Human-readable pointer, e.g. `final_state.collections.orders[ORD-1042]`. */
    locator: NonEmptyStringSchema,
    observed: JsonValueSchema,
    collectedBy: z.enum(['deterministic_verifier', 'evidence_agent']),
    summary: NonEmptyStringSchema,
  })
  .strict();

export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
