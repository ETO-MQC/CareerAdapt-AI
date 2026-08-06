import type { AgentQuickActionId } from "@/agent/contracts/agentQuickAction";
import type { QuickActionContextSnapshot } from "@/agent/contracts/quickActionContext";

const DEFAULT_TITLES: Record<AgentQuickActionId, string> = {
  build_profile_from_scratch: "整理个人经历",
  import_existing_resume: "导入现有简历",
  tailor_resume_to_job: "制作岗位简历",
  build_resume_from_profile: "从资料库组简历",
  analyze_job_fit: "分析岗位匹配",
  repair_and_export_resume: "修复导出简历"
};

export function defaultAgentTaskTitle(actionId: AgentQuickActionId) {
  return DEFAULT_TITLES[actionId];
}

export function refineAgentTaskTitle(
  actionId: AgentQuickActionId,
  snapshot: QuickActionContextSnapshot
) {
  const person = snapshot.activePerson?.displayName?.trim();
  const profileName = snapshot.activeProfile?.displayName?.trim();
  const job = snapshot.jobSummaries[0];
  const suffix = actionId === "build_profile_from_scratch"
    ? person ? `${trimChinese(person, 4)}经历` : undefined
    : actionId === "import_existing_resume"
      ? snapshot.resumeSummaries[0]?.name
        ? `导入${trimChinese(snapshot.resumeSummaries[0].name, 6)}简历`
        : undefined
      : actionId === "tailor_resume_to_job"
        ? job ? `定制${trimChinese(job.title, 6)}简历` : undefined
        : actionId === "analyze_job_fit"
          ? job ? `分析${trimChinese(job.title, 6)}岗位` : undefined
          : actionId === "build_resume_from_profile"
            ? profileName ? `从${trimChinese(profileName, 6)}组简历` : undefined
            : undefined;
  return sanitizeTitle(suffix ?? defaultAgentTaskTitle(actionId));
}

export function sanitizeTitle(value: string) {
  const compact = value
    .replace(/[\r\n\t]+/gu, "")
    .replace(/[，。！？!?、；;：:,.!?]+/gu, "")
    .replace(/\s+/gu, "")
    .trim();
  const safe = compact || "新的 AI 任务";
  return Array.from(safe).slice(0, 12).join("");
}

function trimChinese(value: string, max: number) {
  return Array.from(value.replace(/[\s·•|/\\]+/gu, "")).slice(0, max).join("");
}
