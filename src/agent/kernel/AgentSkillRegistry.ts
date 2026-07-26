export type AgentSkillSummary = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  applicableWorkflows: string[];
  license: string;
  source: string;
};

export type AgentSkill = AgentSkillSummary & {
  inputs: string[];
  relevantTools: string[];
  procedure: string[];
  confirmationBoundaries: string[];
  factRules: string[];
  failureRecovery: string[];
  completionCriteria: string[];
  references: Record<string, string>;
};

export type AgentLoadedSkill = AgentSkill & { content: string };

const skills: AgentSkill[] = [
  skill("career-profile-intake", "职业资料建档", "建立或核对真实、可溯源的职业资料。", ["资料库", "建档", "身份", "profile"], ["guided_profile_intake"], ["get_active_profile", "get_profile", "search_profile_facts", "list_profiles"], [
    "确认当前资料库与建档目标。", "读取现有资料，避免重复创建。", "缺失事实逐项询问并保留来源。", "写入前展示核对范围并请求确认。"
  ]),
  skill("career-experience-digging", "经历深挖", "从现有事实中发现可补充的职责、方法、规模和结果。", ["经历", "项目", "丰富", "缺口", "AI"], ["guided_profile_intake", "build_resume_from_profile", "analyze_job_fit"], ["get_active_profile", "get_profile", "search_profile_facts"], [
    "读取已有经历与事实证据。", "区分已知事实、合理问题和未知信息。", "总结代表经历、优势与空白。", "只把用户明确确认的信息交给写入流程。"
  ]),
  skill("jd-analysis", "岗位分析", "解析岗位要求并与真实资料、简历进行匹配。", ["JD", "岗位", "匹配", "适合"], ["job_ingestion", "analyze_job_fit", "tailor_existing_resume"], ["list_jobs", "get_job", "parse_job_description", "commit_job", "get_active_profile", "get_profile", "get_resume", "analyze_job_fit"], [
    "确定岗位是否已保存；缺失时解析用户提供的 JD。", "读取所选资料和简历。", "识别硬门槛、核心职责与加分项。", "给出有证据的匹配、缺口和下一步。"
  ]),
  skill("resume-from-profile", "从资料库生成简历", "从 CareerProfile 选择真实事实并生成岗位或通用简历计划。", ["生成简历", "组装简历", "资料库"], ["build_resume_from_profile"], ["get_active_profile", "get_profile", "search_profile_facts", "get_job", "list_resumes"], [
    "读取目标资料与用途。", "筛选有证据的相关事实。", "形成章节与叙事计划。", "预览并确认后才创建版本。"
  ]),
  skill("resume-tailoring", "岗位简历定制", "在分支隔离和 Fact Guard 下定制现有简历。", ["定制", "改简历", "岗位简历"], ["tailor_existing_resume"], ["get_resume", "get_job", "analyze_job_fit", "create_tailoring_session", "answer_tailoring_question", "preview_tailoring_changes", "apply_tailoring_changes"], [
    "读取所选简历。", "读取目标岗位。", "分析匹配。", "识别有支持的证据。", "询问缺失且可由用户确认的信息。", "创建改写计划。", "预览差异。", "请求用户确认。", "应用新 Revision。", "运行质量检查。"
  ], {
    "quality-checklist.md": "核对事实证据、岗位相关性、未确认声明、Revision 目标、分支隔离和导出前阻塞项。"
  }),
  skill("resume-quality-gate", "简历质量门禁", "检查事实支持、ATS 可读性、内容完整性与变更安全。", ["质量", "ATS", "够不够", "检查"], ["tailor_existing_resume", "analyze_job_fit", "repair_and_export_resume"], ["get_resume", "get_resume_revision", "get_job", "search_profile_facts"], [
    "读取目标 Revision 与相关岗位。", "检查事实支持和未确认信息。", "检查关键词覆盖、结构与可读性。", "区分阻塞问题与改进建议。"
  ]),
  skill("resume-export", "简历导出", "在质量和确认边界通过后准备 PDF 导出。", ["导出", "PDF"], ["repair_and_export_resume"], ["get_resume", "get_resume_revision", "export_resume"], [
    "确认目标简历与 Revision。", "检查导出前阻塞项。", "准备预览。", "由用户在现有 PDF 流程完成导出。"
  ])
];

export class AgentSkillRegistry {
  list(): AgentSkillSummary[] {
    return skills.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      tags: candidate.tags,
      applicableWorkflows: candidate.applicableWorkflows,
      license: candidate.license,
      source: candidate.source
    }));
  }

  discover(input: {
    workflowId: string;
    step?: string;
    userMessage: string;
    selectedEntities?: { profileId?: string; resumeId?: string; jobId?: string };
  }) {
    const text = input.userMessage.toLowerCase();
    const explicitSignals = (candidate: AgentSkill) =>
      candidate.tags.reduce((sum, tag) => sum + Number(text.includes(tag.toLowerCase())), 0);
    return skills
      .map((candidate) => ({
        candidate,
        score: explicitSignals(candidate) * 5
          + Number(explicitSignals(candidate) > 0 && candidate.applicableWorkflows.includes(input.workflowId)) * 2
          + Number(explicitSignals(candidate) > 0 && Boolean(input.step))
          + Number(explicitSignals(candidate) > 0 && Object.values(input.selectedEntities ?? {}).some(Boolean))
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 2)
      .map((entry) => entry.candidate);
  }

  view(skillId: string): AgentLoadedSkill;
  view(skillId: string, referencePath: string): { skillId: string; referencePath: string; content: string };
  view(skillId: string, referencePath?: string): AgentLoadedSkill | { skillId: string; referencePath: string; content: string } {
    const selected = skills.find((candidate) => candidate.id === skillId);
    if (!selected) throw Object.assign(new Error("Skill not found."), { code: "skill_not_found" });
    if (!referencePath) return { ...selected, content: renderSkillMarkdown(selected) };
    const content = selected.references[normalizeReferencePath(referencePath)];
    if (!content) throw Object.assign(new Error("Skill reference is not available."), { code: "skill_reference_not_found" });
    return { skillId, referencePath: normalizeReferencePath(referencePath), content };
  }
}

function renderSkillMarkdown(value: AgentSkill) {
  return [
    `# ${value.name}`,
    "",
    "## When to use",
    value.description,
    "",
    "## Goal",
    value.description,
    "",
    "## Inputs",
    value.inputs.map((item) => `- ${item}`).join("\n"),
    "",
    "## Relevant tools",
    value.relevantTools.map((item) => `- ${item}`).join("\n"),
    "",
    "## Procedure",
    value.procedure.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    "",
    "## Confirmation boundaries",
    value.confirmationBoundaries.map((item) => `- ${item}`).join("\n"),
    "",
    "## Fact rules",
    value.factRules.map((item) => `- ${item}`).join("\n"),
    "",
    "## Failure recovery",
    value.failureRecovery.map((item) => `- ${item}`).join("\n"),
    "",
    "## Completion criteria",
    value.completionCriteria.map((item) => `- ${item}`).join("\n")
  ].join("\n");
}

function skill(
  id: string,
  name: string,
  description: string,
  tags: string[],
  applicableWorkflows: string[],
  relevantTools: string[],
  procedure: string[],
  references: Record<string, string> = {}
): AgentSkill {
  return {
    id,
    name,
    description,
    tags,
    applicableWorkflows,
    license: "CareerAdapt internal",
    source: `src/agent/skills/${id}/SKILL.md`,
    inputs: ["current workflow state", "selected entity pointers", "latest user turn"],
    relevantTools,
    procedure,
    confirmationBoundaries: ["All writes use the tool metadata confirmation policy.", "New user-declared facts require explicit confirmation."],
    factRules: ["CareerProfile and FactProvenance are authoritative.", "Never infer facts, metrics, dates, proficiency, salary, or years of experience.", "Skills never write repositories directly."],
    failureRecovery: ["Keep the current task recoverable.", "Report the missing authoritative input.", "Ask one concrete question when no safe tool can continue."],
    completionCriteria: ["The requested result is grounded in tool observations.", "Required confirmations are resolved.", "No unsupported fact entered preview or output."],
    references
  };
}

function normalizeReferencePath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.?\//, "");
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw Object.assign(new Error("Invalid skill reference path."), { code: "invalid_skill_reference_path" });
  }
  return normalized;
}

export const agentSkillRegistry = new AgentSkillRegistry();
