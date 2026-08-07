import { z } from "zod";

export const ProfileIntakeSourceTurnProcessingStatusSchema = z.enum([
  "journaled",
  "structuring",
  "structured",
  "partial",
  "failed",
  "superseded"
]);

export const ProfileIntakeSourceTurnExtractionStatusSchema = z.enum([
  "structured_ai",
  "structured_local",
  "partial",
  "failed"
]);

/** Safe, turn-scoped telemetry. Never put source text or provider secrets here. */
export const ProfileIntakeSourceTurnDiagnosticsSchema = z.object({
  provider: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(160).optional(),
  attempt: z.number().int().min(1).optional(),
  latencyMs: z.number().int().min(0).optional(),
  processingStatus: ProfileIntakeSourceTurnProcessingStatusSchema.optional(),
  extractionStatus: ProfileIntakeSourceTurnExtractionStatusSchema.optional(),
  safeErrorCode: z.string().min(1).max(160).optional(),
  candidateCount: z.number().int().min(0).default(0),
  quarantinedCount: z.number().int().min(0).default(0),
  quarantinedErrorCodes: z.array(z.string().min(1).max(180)).max(20).default([]),
  operationId: z.string().min(1).max(180).optional()
}).strict();

/**
 * Write-ahead record for a substantive Profile Intake answer.
 *
 * This intentionally lives in the domain contract, while the repository
 * stores it in the existing appMeta table.  The exact source is retained so
 * a provider or protocol failure never becomes the only copy of the user's
 * answer.
 */
export const ProfileIntakeSourceTurnSchema = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  turnId: z.string().min(1),
  exactSourceText: z.string().trim().min(1).max(24_000),
  sourceHash: z.string().min(8),
  capturedAt: z.string().datetime({ offset: true }),
  branchId: z.string().min(1).optional(),
  workflowStage: z.string().min(1),
  activeQuestionId: z.string().min(1).optional(),
  activeCandidateId: z.string().min(1).optional(),
  expectedAnswerDimension: z.string().min(1).optional(),
  processingStatus: ProfileIntakeSourceTurnProcessingStatusSchema,
  importId: z.string().min(1).optional(),
  candidateIds: z.array(z.string().min(1)).max(40).default([]),
  lastErrorCode: z.string().min(1).optional(),
  provider: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(160).optional(),
  attempt: z.number().int().min(1).optional(),
  latencyMs: z.number().int().min(0).optional(),
  extractionStatus: ProfileIntakeSourceTurnExtractionStatusSchema.optional(),
  safeErrorCode: z.string().min(1).max(160).optional(),
  candidateCount: z.number().int().min(0).default(0),
  quarantinedCount: z.number().int().min(0).default(0),
  operationId: z.string().min(1).max(180).optional()
}).strict();

export type ProfileIntakeSourceTurn = z.infer<typeof ProfileIntakeSourceTurnSchema>;
export type ProfileIntakeSourceTurnProcessingStatus = z.infer<typeof ProfileIntakeSourceTurnProcessingStatusSchema>;
export type ProfileIntakeSourceTurnDiagnostics = z.infer<typeof ProfileIntakeSourceTurnDiagnosticsSchema>;
