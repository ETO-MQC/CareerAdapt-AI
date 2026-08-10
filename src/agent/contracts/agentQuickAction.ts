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
  build_profile_from_scratch: "我想从零整理自己的真实经历。先听我完整说完，再用自然的方式确认真正会影响整理结果的细节，不要补充我没有确认的事实。",
  import_existing_resume: "导入现有简历：这是我现在的简历，帮我整理进去。先读取和比较已有内容，只有出现真正冲突或需要我判断的地方再问我。",
  tailor_resume_to_job: "我想用现有简历投这个岗位。先读取资料、简历、岗位和已有匹配分析，只有答案会改变定制结果时再问我。",
  build_resume_from_profile: "我想从个人资料库整理一份通用简历。先直接开始；如果目标方向会明显改变结果，再问我一次。",
  analyze_job_fit: "我想分析自己与目标岗位的匹配度。请先根据当前已确认的资料和岗位分析，只有一个模糊事实会改变结论时再问我。",
  repair_and_export_resume: "我想修复并导出一份简历。请先自行检查内容、事实和排版，再把真正需要我决定的事项集中告诉我。"
};

export type QuickActionIntent = {
  actionId: AgentQuickActionId;
  intent: string;
  source: "zero_state" | "quick_tasks";
  task: {
    rootGoal: string;
    workflowId: string;
    stage: string;
  };
};

export const AGENT_QUICK_ACTION_TASKS: Record<AgentQuickActionId, QuickActionIntent["task"]> = {
  build_profile_from_scratch: {
    rootGoal: "profile_intake",
    workflowId: "guided_profile_intake",
    stage: "resolve_profile_target"
  },
  import_existing_resume: {
    rootGoal: "import_resume",
    workflowId: "resume_import",
    stage: "select_source"
  },
  tailor_resume_to_job: {
    rootGoal: "create_tailored_resume",
    workflowId: "tailor_existing_resume",
    stage: "choose_resume_source"
  },
  build_resume_from_profile: {
    rootGoal: "create_resume_from_profile",
    workflowId: "compose_resume",
    stage: "select_profile_scope"
  },
  analyze_job_fit: {
    rootGoal: "analyze_job_fit",
    workflowId: "analyze_job_fit",
    stage: "select_assets"
  },
  repair_and_export_resume: {
    rootGoal: "export_resume",
    workflowId: "repair_and_export_resume",
    stage: "select_resume"
  }
};

export function createQuickActionIntent(
  actionId: AgentQuickActionId,
  source: QuickActionIntent["source"] = "zero_state"
): QuickActionIntent {
  return AgentQuickActionIdSchema.parse(actionId) && {
    actionId,
    intent: AGENT_QUICK_ACTION_INTENTS[actionId],
    source,
    task: AGENT_QUICK_ACTION_TASKS[actionId]
  };
}
