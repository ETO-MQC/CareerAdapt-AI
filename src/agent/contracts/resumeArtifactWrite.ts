import { z } from "zod";

export const ResumeArtifactWriteStatusSchema = z.enum([
  "write_pending",
  "write_completed",
  "write_failed",
  "visibility_verification_failed"
]);

export const ResumeArtifactWriteCheckpointSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  operationId: z.string().min(1).max(160),
  checkpointId: z.string().min(1).max(220),
  workflowId: z.string().min(1).max(120),
  profileId: z.string().min(1),
  expectedProfileRevision: z.number().int().min(0),
  sourceResumeId: z.string().min(1),
  sourceResumeRevisionId: z.string().min(1).optional(),
  jobId: z.string().min(1),
  targetSourceType: z.string().min(1).optional(),
  targetSnapshotId: z.string().min(1).optional(),
  targetSnapshotVersion: z.number().int().min(1).optional(),
  targetSnapshotHash: z.string().min(8).optional(),
  savedJobId: z.string().min(1).optional(),
  jobPersistenceDecision: z.enum(["ask", "save", "session_only"]).optional(),
  workflowFacade: z.string().min(1).optional(),
  acceptedDiffIds: z.array(z.string().min(1)).max(128),
  changedFieldPaths: z.array(z.string().min(1)).max(128),
  status: ResumeArtifactWriteStatusSchema,
  resultResumeId: z.string().min(1).optional(),
  resultResumeRevisionId: z.string().min(1).optional(),
  safeErrorCode: z.string().min(1).max(160).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export const ResumeArtifactReceiptSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  operationId: z.string().min(1).max(160),
  status: z.literal("completed"),
  profileId: z.string().min(1),
  expectedProfileRevision: z.number().int().min(0),
  jobId: z.string().min(1),
  sourceResumeId: z.string().min(1),
  sourceResumeRevisionId: z.string().min(1).optional(),
  resultResumeId: z.string().min(1),
  resultResumeRevisionId: z.string().min(1),
  targetSourceType: z.string().min(1).optional(),
  targetSnapshotId: z.string().min(1).optional(),
  targetSnapshotVersion: z.number().int().min(1).optional(),
  targetSnapshotHash: z.string().min(8).optional(),
  savedJobId: z.string().min(1).optional(),
  jobPersistenceDecision: z.enum(["ask", "save", "session_only"]).optional(),
  workflowFacade: z.string().min(1).optional(),
  acceptedDiffIds: z.array(z.string().min(1)).min(1).max(128),
  acceptedDiffCount: z.number().int().min(1),
  changedFieldPaths: z.array(z.string().min(1)).min(1).max(128),
  beforeContentHash: z.string().min(1),
  afterContentHash: z.string().min(1),
  completedAt: z.string().datetime({ offset: true })
}).strict();

export type ResumeArtifactWriteCheckpoint = z.infer<typeof ResumeArtifactWriteCheckpointSchema>;
export type ResumeArtifactReceipt = z.infer<typeof ResumeArtifactReceiptSchema>;

export function resumeArtifactWriteCheckpointId(operationId: string) {
  return `resume-artifact-write:${operationId}`;
}
