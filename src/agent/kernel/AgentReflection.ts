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
  create(
    trajectory: AgentTrajectorySnapshot,
    context: { userMessage?: string; goal?: string } = {}
  ): AgentReflectionResult | undefined {
    if (trajectory.outcome !== "completed") return undefined;
    const corrections = extractExplicitCorrections(context.userMessage ?? "");
    const successfulTools = trajectory.toolCalls.filter((call) => call.ok).map((call) => call.toolName);
    const failedTools = trajectory.toolCalls.filter((call) => call.ok === false).map((call) => call.toolName);
    return AgentReflectionSchema.parse({
      summary: `${context.goal || "当前 Agent 任务"}已完成；执行 ${trajectory.toolCalls.length} 次工具调用，产出 ${trajectory.artifacts.length} 个可核对产物。`,
      whatWorked: successfulTools.slice(0, 8),
      failures: [
        ...failedTools.map((tool) => `工具失败：${tool}`),
        ...trajectory.errors.map((error) => `${error.code}: ${error.message}`)
      ].slice(0, 8),
      userCorrections: corrections,
      reusableProcedureCandidate: successfulTools.length > 1
        ? `可复用顺序：${successfulTools.join(" → ")}`
        : undefined
    });
  }
}

function extractExplicitCorrections(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return [];
  if (/(?:不要|别).{0,30}(?:，|,|\s)+(?:我的)?(?:姓名|名字|称呼)?(?:是|应该是)/u.test(trimmed)) {
    return [`用户明确纠正：${trimmed.slice(0, 300)}`];
  }
  if (/(?:不是|不对|错了).{0,80}(?:而是|应该是|正确的是)/u.test(trimmed)) {
    return [`用户明确纠正：${trimmed.slice(0, 300)}`];
  }
  return [];
}
