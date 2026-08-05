import { z } from "zod";
import {
  ProfileIntakeProviderStatusSchema,
  ProfileIntakeReviewCandidateSchema,
  ProfileIntakeReviewProjectionSchema
} from "./ProfileIntakeReviewProjection";

export const ProfileIntakePersistenceStatusSchema = z.enum([
  "saved",
  "already_saved"
]);

export const ProfileIntakeSafeDiagnosticsSchema = z.object({
  code: z.string().min(1).optional(),
  provider: z.enum(["available", "failed", "invalid"]),
  quarantinedCandidateCount: z.number().int().min(0),
  latencyMs: z.number().int().min(0).optional()
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
  persistenceReceipt: z.object({
    autosavedAt: z.string().datetime(),
    resumeToken: z.string().min(8)
  }).strict().optional(),
  intakeSession: z.unknown().optional(),
  safeDiagnostics: ProfileIntakeSafeDiagnosticsSchema,
  idempotent: z.boolean()
}).strict();

export type CaptureProfileIntakeResult = z.infer<typeof CaptureProfileIntakeResultSchema>;
