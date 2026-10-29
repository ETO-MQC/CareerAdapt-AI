import { z } from "zod";
import type { AgentTaskState } from "@/agent/contracts/agentSession";

export const CareerSessionCheckpointSchema = z.object({
  workflowId: z.string().min(1).max(120), stage: z.string().min(1).max(120),
  profileId: z.string().min(1).max(200).optional(),
  resumeId: z.string().min(1).max(200).optional(), resumeRevisionId: z.string().min(1).max(200).optional(),
  sourceResumeId: z.string().min(1).max(200).optional(), sourceResumeRevisionId: z.string().min(1).max(200).optional(),
  jobId: z.string().min(1).max(200).optional(), jobRevision: z.union([z.string().min(1).max(200), z.number()]).optional()
}).strict();
export type CareerSessionCheckpoint = z.infer<typeof CareerSessionCheckpointSchema>;

/** ID-only Host projection. Never serialize knownSlots, source text or tool history. */
export function careerSessionCheckpoint(task?: AgentTaskState): CareerSessionCheckpoint | undefined {
  if (!task) return undefined;
  const selected = task.selectedEntities;
  return CareerSessionCheckpointSchema.parse({ workflowId: task.workflowId, stage: task.stage,
    profileId: selected.profileId, resumeId: selected.resumeId, resumeRevisionId: selected.resumeRevisionId,
    sourceResumeId: selected.sourceResumeId, sourceResumeRevisionId: selected.sourceResumeRevisionId,
    jobId: selected.jobId, jobRevision: selected.jobRevision });
}
