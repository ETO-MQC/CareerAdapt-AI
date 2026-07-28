export type AuthoritativeTurnObservation = {
  toolName: string;
  value: unknown;
};

const PERSISTED_MUTATION_TOOLS = new Set([
  "commit_profile_intake",
  "ensure_general_resume_from_profile",
  "commit_resume_import",
  "commit_job",
  "create_job_resume_from_profile",
  "apply_tailoring_changes",
  "archive_resume",
  "restore_resume"
]);

const MUTATION_CLAIM = /(已|已经)(?:成功)?(保存|记录|修改|创建|删除|归档|导入|导出|写入|同步|更新)/;

export function groundMutationClaims(input: {
  text: string;
  userMessage: string;
  observations: AuthoritativeTurnObservation[];
}) {
  const text = input.text.trim();
  if (!MUTATION_CLAIM.test(text)) return text;
  const profileCommit = input.observations.find((observation) =>
    observation.toolName === "commit_profile_intake"
  );
  if (profileCommit) {
    const result = objectValue(profileCommit.value);
    const profileId = stringValue(result.profileId);
    const profileVersion = numberValue(result.profileVersion);
    const committedItemCount = numberValue(result.committedItemCount);
    if (profileId && profileVersion !== undefined && committedItemCount !== undefined) {
      return committedItemCount > 0
        ? `已将 ${committedItemCount} 项确认经历保存到个人资料库。`
        : "资料库对账已完成，本次没有新增经历；现有资料未被重复写入。";
    }
    return "写入步骤返回的信息不完整，暂不能确认资料已保存。请重试当前步骤；系统不会重复写入已成功提交的内容。";
  }
  if (input.observations.some((observation) => PERSISTED_MUTATION_TOOLS.has(observation.toolName))) {
    return text;
  }
  if (input.observations.some((observation) => observation.toolName === "export_resume")
    && /(已|已经)导出/.test(text)) {
    return "PDF 导出入口已准备好，请在预览页确认并下载。";
  }
  if (/(我)?(已|已经)(修改|改成|改为|保存|更新)/.test(input.userMessage)) {
    return "好的，我会先读取当前资料库确认后继续。";
  }
  return "我还没有获得对应的权威写入结果；我会先确认当前资料库状态再继续。";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
