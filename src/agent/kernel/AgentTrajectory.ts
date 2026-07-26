import { z } from "zod";

export const AgentTrajectorySchema = z.object({
  taskId: z.string().min(1),
  workflowId: z.string().min(1),
  turns: z.number().int().min(1),
  skillsLoaded: z.array(z.string()).max(16),
  toolCalls: z.array(z.object({
    toolName: z.string(),
    operationId: z.string(),
    ok: z.boolean().optional(),
    startedAt: z.string(),
    completedAt: z.string().optional()
  }).strict()).max(12),
  confirmations: z.array(z.object({
    toolName: z.string(),
    operationId: z.string(),
    status: z.enum(["pending", "confirmed", "rejected"])
  }).strict()).max(12),
  artifacts: z.array(z.string()).max(64),
  outcome: z.enum(["running", "waiting_for_user", "waiting_for_confirmation", "completed", "failed", "aborted"]),
  errors: z.array(z.object({ code: z.string(), message: z.string().max(1000) }).strict()).max(24)
}).strict();

export type AgentTrajectorySnapshot = z.infer<typeof AgentTrajectorySchema>;

export class AgentTrajectory {
  private readonly snapshot: AgentTrajectorySnapshot;

  constructor(taskId: string, workflowId: string) {
    this.snapshot = {
      taskId,
      workflowId,
      turns: 1,
      skillsLoaded: [],
      toolCalls: [],
      confirmations: [],
      artifacts: [],
      outcome: "running",
      errors: []
    };
  }

  skill(skillId: string) {
    if (!this.snapshot.skillsLoaded.includes(skillId)) this.snapshot.skillsLoaded.push(skillId);
  }

  toolStarted(toolName: string, operationId: string) {
    this.snapshot.toolCalls.push({ toolName, operationId, startedAt: new Date().toISOString() });
  }

  toolCompleted(operationId: string, ok: boolean, artifactIds: string[] = []) {
    const call = this.snapshot.toolCalls.findLast((item) => item.operationId === operationId);
    if (call) {
      call.ok = ok;
      call.completedAt = new Date().toISOString();
    }
    this.snapshot.artifacts.push(...artifactIds.filter((id) => !this.snapshot.artifacts.includes(id)));
  }

  confirmation(toolName: string, operationId: string) {
    this.snapshot.confirmations.push({ toolName, operationId, status: "pending" });
    this.snapshot.outcome = "waiting_for_confirmation";
  }

  error(code: string, message: string) {
    this.snapshot.errors.push({ code, message });
  }

  finish(outcome: AgentTrajectorySnapshot["outcome"]) {
    this.snapshot.outcome = outcome;
  }

  value() {
    return AgentTrajectorySchema.parse(structuredClone(this.snapshot));
  }
}
