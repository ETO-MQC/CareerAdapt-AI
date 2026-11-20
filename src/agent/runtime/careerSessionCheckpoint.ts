import { z } from "zod";
import type { AgentTaskState } from "@/agent/contracts/agentSession";
import type { AgentRuntimeTurnInput } from "./agentRuntime";

export const CareerSessionCheckpointSchema = z.object({
  taskSummary: z.string().max(1000).optional(),
  workflowId: z.string().min(1).max(120), stage: z.string().min(1).max(120),
  profileId: z.string().min(1).max(200).optional(),
  resumeId: z.string().min(1).max(200).optional(), resumeRevisionId: z.string().min(1).max(200).optional(),
  sourceResumeId: z.string().min(1).max(200).optional(), sourceResumeRevisionId: z.string().min(1).max(200).optional(),
  jobId: z.string().min(1).max(200).optional(), jobRevision: z.union([z.string().min(1).max(200), z.number()]).optional(),
  careerPreferences: z.object({ profileId: z.string().min(1), profileRevision: z.number().int().min(1),
    targetRoles: z.array(z.string().max(120)).max(20), targetCities: z.array(z.string().max(120)).max(20),
    industries: z.array(z.string().max(120)).max(20) }).strict().optional()
}).strict();
export type CareerSessionCheckpoint = z.infer<typeof CareerSessionCheckpointSchema>;

/** Bounded Host projection. Never serialize knownSlots, source text or tool history. */
export function careerSessionCheckpoint(task?: AgentTaskState, preferences?: AgentRuntimeTurnInput["trustedCareerPreferences"]): CareerSessionCheckpoint | undefined {
  if (!task && !preferences) return undefined;
  if (!task) return CareerSessionCheckpointSchema.parse({ workflowId: "conversation", stage: "conversation", careerPreferences: preferences });
  const selected = task.selectedEntities;
  return CareerSessionCheckpointSchema.parse({ taskSummary: careerTaskSummary(task), workflowId: task.workflowId, stage: task.stage,
    profileId: selected.profileId, resumeId: selected.resumeId, resumeRevisionId: selected.resumeRevisionId,
    sourceResumeId: selected.sourceResumeId, sourceResumeRevisionId: selected.sourceResumeRevisionId,
    jobId: selected.jobId, jobRevision: selected.jobRevision, careerPreferences: preferences });
}

/** Business state for reasoning; entity identifiers stay in the tool binding. */
export function careerTaskSummary(task: AgentTaskState): string {
  const next = task.knownSlots.nextAction as { kind?: unknown } | undefined;
  const checkpoint = task.knownSlots.facadeCheckpoint;
  const pendingImportReview = task.workflowId === "resume_import"
    && !["completed", "cancelled", "failed"].includes(task.completionStatus)
    && typeof task.knownSlots.importId === "string"
    && (task.stage === "import_review" || Boolean(checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint)
      && (checkpoint as Record<string, unknown>).kind === "resume_import_review"));
  return ["Current career task:",
    `- Workflow: ${task.workflowId}`,
    `- Current step: ${task.stage}`,
    `- Business status: ${task.completionStatus}`,
    `- Profile: ${task.selectedEntities.profileId ? "selected" : "not selected"}`,
    `- Job: ${task.selectedEntities.jobId ? "selected" : "not selected"}`,
    `- Resume: ${task.selectedEntities.resumeId ? "selected" : "not created"}`,
    ...(next?.kind === "job_fit" ? ["- Planned next step: job-fit analysis after verified resume commit"] : []),
    ...(pendingImportReview ? ["- An import draft is awaiting human review in the application. Ask the user to open the review; do not claim it is absent or committed or proceed as if it were confirmed."] : []),
    "- Runtime completion is not a business commit. Confirm writes and verify Repository receipts."
  ].join("\n");
}
