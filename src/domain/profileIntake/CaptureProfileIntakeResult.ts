import { z } from "zod";
import {
  ProfileIntakeProviderStatusSchema,
  ProfileIntakeReviewCandidateSchema,
  ProfileIntakeReviewProjectionSchema
} from "./ProfileIntakeReviewProjection";
import { ProfileIntakeNextTurnPlanSchema } from "./ProfileIntakeNextTurnPlan";
import { CareerInteractionPlanSchema } from "@/domain/careerInteraction/CareerInteractionPlan";

export const ProfileIntakePersistenceStatusSchema = z.enum([
  "saved",
  "already_saved"
]);

export const ProfileIntakeSafeDiagnosticsSchema = z.object({
  semanticTask: z.string().min(1).max(120).optional(),
  patchStage: z.enum(["provider", "local_normalize", "schema_validate", "grounding_validate", "repository_merge", "completed"]).optional(),
  schemaStage: z.enum(["passed", "partial", "failed"]).optional(),
  groundingStage: z.string().min(1).max(80).optional(),
  repositoryStage: z.enum(["pending", "passed", "failed"]).optional(),
  code: z.string().min(1).optional(),
  safeErrorCode: z.string().min(1).optional(),
  provider: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(160).optional(),
  attempt: z.number().int().min(1).optional(),
  latencyMs: z.number().int().min(0).optional(),
  processingStatus: z.string().min(1).max(40).optional(),
  extractionStatus: z.enum(["structured_ai", "structured_local", "partial", "failed"]).optional(),
  candidateCount: z.number().int().min(0).default(0),
  quarantinedCount: z.number().int().min(0).default(0),
  quarantinedCandidateCount: z.number().int().min(0).default(0),
  quarantinedErrorCodes: z.array(z.string().min(1).max(180)).max(20).default([]),
  quarantinedFields: z.array(z.string().min(1).max(180)).max(40).default([]),
  operationId: z.string().min(1).max(180).optional()
}).strict();

/** Stable boundary returned by the capture tool and consumed by the agent UI. */
export const CaptureProfileIntakeResultSchema = z.object({
  importId: z.string().min(1),
  expectedDraftRevision: z.number().int().min(0),
  targetProfileId: z.string().min(1),
  expectedProfileVersion: z.number().int().min(0),
  persistenceStatus: ProfileIntakePersistenceStatusSchema,
  providerStatus: ProfileIntakeProviderStatusSchema,
  extractionStatus: z.enum(["structured_ai", "structured_local", "partial", "failed"]),
  candidateCount: z.number().int().min(0),
  usableCandidateCount: z.number().int().min(0),
  quarantinedCandidateCount: z.number().int().min(0),
  needsConfirmationCount: z.number().int().min(0),
  candidates: z.array(ProfileIntakeReviewCandidateSchema).max(40),
  reviewProjection: ProfileIntakeReviewProjectionSchema,
  artifactPayload: z.unknown(),
  interviewPlan: z.unknown(),
  followUpQuestion: z.string().min(1).optional(),
  nextTurnPlan: ProfileIntakeNextTurnPlanSchema.optional(),
  interactionPlan: CareerInteractionPlanSchema.optional(),
  persistenceReceipt: z.object({
    autosavedAt: z.string().datetime(),
    resumeToken: z.string().min(8)
  }).strict().optional(),
  intakeSession: z.unknown().optional(),
  safeDiagnostics: ProfileIntakeSafeDiagnosticsSchema,
  idempotent: z.boolean()
}).strict();

export type CaptureProfileIntakeResult = z.infer<typeof CaptureProfileIntakeResultSchema>;
