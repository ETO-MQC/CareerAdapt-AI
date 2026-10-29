import { z } from "zod";
import { SourceSpanSchema } from "./common";

export const CandidateEvidenceMatrixSchema = z.object({
  schemaVersion: z.literal("candidate-evidence-matrix-1"),
  ruleVersion: z.string(),
  analysisId: z.string(),
  binding: z.object({ profileId: z.string(), profileRevision: z.number(), resumeId: z.string(),
    resumeRevision: z.number(), revisionId: z.string().nullable(), jobId: z.string(), jobVersion: z.string(), graphHash: z.string() }).strict(),
  rows: z.array(z.object({
    requirementId: z.string(), rawSourceRef: SourceSpanSchema, normalizedRequirement: z.string(),
    priority: z.string(), relationships: z.array(z.object({ groupId: z.string(), relation: z.string(), requirementIds: z.array(z.string()) }).strict()),
    evidenceStatus: z.enum(["direct", "transferable", "partial", "unknown", "conflicting", "mismatch"]),
    candidateFactIds: z.array(z.string()), sourceIds: z.array(z.string()), evidenceUnitIds: z.array(z.string()),
    confidence: z.number().min(0).max(1), unresolvedAmbiguity: z.array(z.string()), rationale: z.string()
  }).strict())
}).strict();
export type CandidateEvidenceMatrix = z.infer<typeof CandidateEvidenceMatrixSchema>;
