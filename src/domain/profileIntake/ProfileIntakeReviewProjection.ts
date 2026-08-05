import { z } from "zod";
import { ResumeItemV2Schema, ResumeSectionTypeV2Schema } from "@/domain/schemas";

export const ProfileIntakeExtractionStatusSchema = z.enum([
  "structured_ai",
  "structured_local",
  "structured",
  "partial",
  "failed",
  "manual_review",
  "preserved"
]);

export const ProfileIntakeProviderStatusSchema = z.enum([
  "available",
  "failed",
  "invalid"
]);

export const ProfileIntakeReviewCandidateStatusSchema = z.enum([
  "proposed",
  "uncertain",
  "accepted",
  "ignored",
  "failed"
]);

const SourceSpanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0)
}).strict().refine((span) => span.end > span.start, {
  message: "profile intake source span must have positive length"
});

export const ProfileIntakeReviewCandidateSchema = z.object({
  id: z.string().min(1),
  candidateKey: z.string().min(1).optional(),
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics", "summary"]),
  sourceSpan: SourceSpanSchema,
  sourceQuote: z.string().min(1),
  structuredItem: ResumeItemV2Schema.optional(),
  professionalText: z.string().min(1),
  uncertainFields: z.array(z.string().min(1)).max(80).default([]),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
  status: ProfileIntakeReviewCandidateStatusSchema,
  decision: z.enum(["accept", "reject"]).optional(),
  canAccept: z.boolean(),
  reason: z.string().min(1).optional(),
  fieldEvidence: z.array(z.object({
    field: z.string().min(1),
    sourceQuote: z.string().min(1),
    support: z.enum(["explicit", "derived", "uncertain"]),
    confidence: z.number().min(0).max(1),
    needsConfirmation: z.boolean()
  }).strict()).default([])
}).strict();

export const ProfileIntakeReviewProgressSchema = z.object({
  total: z.number().int().min(0),
  proposed: z.number().int().min(0),
  valid: z.number().int().min(0),
  uncertain: z.number().int().min(0),
  accepted: z.number().int().min(0),
  ignored: z.number().int().min(0),
  rejected: z.number().int().min(0),
  reviewed: z.number().int().min(0)
}).strict();

export const ProfileIntakeFailedExtractionSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  actions: z.array(z.enum(["retry", "manual", "preserve"])).min(1).max(3)
}).strict();

export const ProfileIntakeReviewProjectionSchema = z.object({
  importId: z.string().min(1),
  draftRevision: z.number().int().min(0),
  finalReviewRevision: z.number().int().min(0).optional(),
  sourceMessageId: z.string().min(1),
  sourceTurnId: z.string().min(1),
  sourceContentHash: z.string().min(8),
  providerStatus: ProfileIntakeProviderStatusSchema.default("available"),
  extractionStatus: ProfileIntakeExtractionStatusSchema,
  candidates: z.array(ProfileIntakeReviewCandidateSchema).max(40),
  reviewProgress: ProfileIntakeReviewProgressSchema,
  followUpQuestions: z.array(z.string().min(1).max(500)).max(3).default([]),
  followUpQuestion: z.string().min(1).max(500).optional(),
  failedExtraction: ProfileIntakeFailedExtractionSchema.optional()
}).strict();

export type ProfileIntakeReviewCandidate = z.infer<typeof ProfileIntakeReviewCandidateSchema>;
export type ProfileIntakeReviewProgress = z.infer<typeof ProfileIntakeReviewProgressSchema>;
export type ProfileIntakeReviewProjection = z.infer<typeof ProfileIntakeReviewProjectionSchema>;
export type ProfileIntakeExtractionStatus = z.infer<typeof ProfileIntakeExtractionStatusSchema>;
export type ProfileIntakeProviderStatus = z.infer<typeof ProfileIntakeProviderStatusSchema>;

export function isProfileIntakeReviewProjection(value: unknown): value is ProfileIntakeReviewProjection {
  return ProfileIntakeReviewProjectionSchema.safeParse(value).success;
}

export function profileIntakeReviewProgress(
  candidates: Array<Pick<ProfileIntakeReviewCandidate, "status" | "structuredItem" | "needsConfirmation"> & { decision?: "accept" | "reject" }>
): ProfileIntakeReviewProgress {
  const accepted = candidates.filter((candidate) => candidate.status === "accepted").length;
  const ignored = candidates.filter((candidate) => candidate.status === "ignored").length;
  const rejected = candidates.filter((candidate) => candidate.decision === "reject").length;
  const uncertain = candidates.filter((candidate) => candidate.status === "uncertain").length;
  const proposed = candidates.filter((candidate) => candidate.status === "proposed" || candidate.status === "uncertain").length;
  const valid = candidates.filter((candidate) => Boolean(candidate.structuredItem)).length;
  return {
    total: candidates.length,
    proposed,
    valid,
    uncertain,
    accepted,
    ignored,
    rejected,
    // A rejected candidate is represented as status=ignored plus
    // decision=reject.  Keep rejected as a diagnostic subset, but count each
    // candidate only once for completion; otherwise a single ignore produces
    // impossible progress such as 9/8 and blocks deterministic finalization.
    reviewed: accepted + ignored
  };
}
