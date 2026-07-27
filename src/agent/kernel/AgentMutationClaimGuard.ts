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

const MUTATION_CLAIM = /(已|已经)(保存|记录|修改|创建|删除|归档|导入|导出|写入|同步|更新)/;

export function groundMutationClaims(input: {
  text: string;
  userMessage: string;
  observations: AuthoritativeTurnObservation[];
}) {
  const text = input.text.trim();
  if (!MUTATION_CLAIM.test(text)) return text;
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
