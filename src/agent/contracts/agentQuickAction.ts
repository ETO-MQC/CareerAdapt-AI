import { z } from "zod";

export const AgentQuickActionIdSchema = z.enum([
  "build_profile_from_scratch",
  "import_existing_resume",
  "tailor_resume_to_job",
  "build_resume_from_profile",
  "analyze_job_fit",
  "repair_and_export_resume"
]);

export type AgentQuickActionId = z.infer<typeof AgentQuickActionIdSchema>;

export const AGENT_QUICK_ACTION_INTENTS: Record<AgentQuickActionId, string> = {
  build_profile_from_scratch: "我想从零整理自己的真实经历。请先通过简短访谈询问第一步，不要补充我没有确认的事实。",
  import_existing_resume: "我想导入现有简历并逐项核对来源。请先告诉我可以上传什么文件，以及下一步会如何确认。",
  tailor_resume_to_job: "我想用现有简历生成岗位定制版本。请先让我选择简历并提供目标岗位。",
  build_resume_from_profile: "我想从个人资料库组装一份简历。请先询问目标方向和我希望使用的经历范围。",
  analyze_job_fit: "我想分析自己与目标岗位的匹配度。请先向我收集岗位描述和要比较的简历或资料。",
  repair_and_export_resume: "我想修复并导出一份简历。请先询问需要检查的简历和期望的导出结果。"
};

export type QuickActionIntent = {
  actionId: AgentQuickActionId;
  intent: string;
  source: "zero_state" | "quick_tasks";
};

export function createQuickActionIntent(
  actionId: AgentQuickActionId,
  source: QuickActionIntent["source"] = "zero_state"
): QuickActionIntent {
  return AgentQuickActionIdSchema.parse(actionId) && {
    actionId,
    intent: AGENT_QUICK_ACTION_INTENTS[actionId],
    source
  };
}
