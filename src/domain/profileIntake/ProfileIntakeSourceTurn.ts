import { z } from "zod";

export const ProfileIntakeSourceTurnProcessingStatusSchema = z.enum([
  "journaled",
  "structuring",
  "structured",
  "partial",
  "failed",
  "superseded"
]);

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
  processingStatus: ProfileIntakeSourceTurnProcessingStatusSchema,
  importId: z.string().min(1).optional(),
  candidateIds: z.array(z.string().min(1)).max(40).default([]),
  lastErrorCode: z.string().min(1).optional()
}).strict();

export type ProfileIntakeSourceTurn = z.infer<typeof ProfileIntakeSourceTurnSchema>;
export type ProfileIntakeSourceTurnProcessingStatus = z.infer<typeof ProfileIntakeSourceTurnProcessingStatusSchema>;
