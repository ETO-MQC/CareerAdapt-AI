import { z } from "zod";
import type { AgentTaskState } from "@/agent/contracts/agentSession";

export const CareerSessionCheckpointSchema = z.object({
  taskSummary: z.string().max(1000).optional(),
  workflowId: z.string().min(1).max(120), stage: z.string().min(1).max(120),
  profileId: z.string().min(1).max(200).optional(),
  resumeId: z.string().min(1).max(200).optional(), resumeRevisionId: z.string().min(1).max(200).optional(),
  sourceResumeId: z.string().min(1).max(200).optional(), sourceResumeRevisionId: z.string().min(1).max(200).optional(),
  jobId: z.string().min(1).max(200).optional(), jobRevision: z.union([z.string().min(1).max(200), z.number()]).optional()
}).strict();
export type CareerSessionCheckpoint = z.infer<typeof CareerSessionCheckpointSchema>;

/** Bounded Host projection. Never serialize knownSlots, source text or tool history. */
export function careerSessionCheckpoint(task?: AgentTaskState): CareerSessionCheckpoint | undefined {
  if (!task) return undefined;
  const selected = task.selectedEntities;
  return CareerSessionCheckpointSchema.parse({ taskSummary: careerTaskSummary(task), workflowId: task.workflowId, stage: task.stage,
    profileId: selected.profileId, resumeId: selected.resumeId, resumeRevisionId: selected.resumeRevisionId,
    sourceResumeId: selected.sourceResumeId, sourceResumeRevisionId: selected.sourceResumeRevisionId,
    jobId: selected.jobId, jobRevision: selected.jobRevision });
}

/** Business state for reasoning; entity identifiers stay in the tool binding. */
export function careerTaskSummary(task: AgentTaskState): string {
  const next = task.knownSlots.nextAction as { kind?: unknown } | undefined;
  return ["Current career task:",
    `- Workflow: ${task.workflowId}`,
    `- Current step: ${task.stage}`,
    `- Business status: ${task.completionStatus}`,
    `- Profile: ${task.selectedEntities.profileId ? "selected" : "not selected"}`,
    `- Job: ${task.selectedEntities.jobId ? "selected" : "not selected"}`,
    `- Resume: ${task.selectedEntities.resumeId ? "selected" : "not created"}`,
    ...(next?.kind === "job_fit" ? ["- Planned next step: job-fit analysis after verified resume commit"] : []),
    "- Runtime completion is not a business commit. Confirm writes and verify Repository receipts."
  ].join("\n");
}
