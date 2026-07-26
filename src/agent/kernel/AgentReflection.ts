import { z } from "zod";
import type { AgentTrajectorySnapshot } from "./AgentTrajectory";

export const AgentReflectionSchema = z.object({
  summary: z.string().max(1000),
  whatWorked: z.array(z.string().max(300)).max(8),
  failures: z.array(z.string().max(300)).max(8),
  userCorrections: z.array(z.string().max(300)).max(8),
  reusableProcedureCandidate: z.string().max(500).optional()
}).strict();

export type AgentReflectionResult = z.infer<typeof AgentReflectionSchema>;

export class AgentReflection {
  create(trajectory: AgentTrajectorySnapshot): AgentReflectionResult | undefined {
    if (trajectory.outcome !== "completed") return undefined;
    return AgentReflectionSchema.parse({
      summary: `任务完成；执行 ${trajectory.toolCalls.length} 次工具调用，加载 ${trajectory.skillsLoaded.length} 个 Skill。`,
      whatWorked: trajectory.toolCalls.filter((call) => call.ok).map((call) => call.toolName).slice(0, 8),
      failures: trajectory.errors.map((error) => error.code).slice(0, 8),
      userCorrections: []
    });
  }
}
