import { z } from "zod";

/**
 * Provenance for the conversation draft only.  It deliberately stores
 * references to source evidence, never the corrected private value itself.
 */
export const ProfileIntakeProvenanceSchema = z.object({
  kind: z.enum(["source_turn", "ai_proposal", "user_correction"]),
  sourceCandidateId: z.string().min(1).optional(),
  sourceTurnId: z.string().min(1).optional(),
  supersededSourceTurnId: z.string().min(1).optional(),
  supersededFieldEvidence: z.array(z.object({
    field: z.string().min(1),
    sourceTurnId: z.string().min(1),
    sourceQuote: z.string().min(1)
  }).strict()).default([]),
  fieldNames: z.array(z.string().min(1)).default([]),
  confirmedAt: z.string().datetime({ offset: true }).optional(),
  operationId: z.string().min(1).optional()
}).strict();

export type ProfileIntakeProvenance = z.infer<typeof ProfileIntakeProvenanceSchema>;
