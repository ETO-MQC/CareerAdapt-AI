import type { AgentToolRegistry } from "@/agent/tools/registry";

/**
 * V4-P2-C：Agent 能力矩阵。
 *
 * 矩阵**不在此手写工具的读写性、确认要求、幂等与可恢复性**——这些全部从真实
 * `AgentToolRegistry.manifest()` 读取。本文件只补 Registry 元数据本身不携带的
 * 语义：所属领域、对应用户意图、产生的业务记录与失败恢复方式。
 *
 * `buildAgentCapabilityMatrix()` 对 Registry 与描述表做双向全覆盖校验，
 * 任何一侧漂移都直接抛错，而不是静默少一行或多一行。
 */

export type AgentCapabilityIntent =
  | "record_profile_facts"
  | "import_or_record_resume"
  | "record_job"
  | "analyze_job_fit"
  | "create_job_specific_resume"
  | "edit_and_export_resume"
  | "manage_application_record"
  | "assist_ats_application"
  | "mock_interview"
  | "read_career_context"
  | "read_resume_and_job"
  | "runtime_diagnostics";

/** 用户核心意图与标签。缺失的工具意图在 `UNIMPLEMENTED_CAPABILITY_INTENTS` 中显式登记。 */
export const AGENT_CAPABILITY_INTENTS: Record<AgentCapabilityIntent, { label: string; implemented: boolean }> = {
  record_profile_facts: { label: "记录个人资料 / 简历事实", implemented: true },
  import_or_record_resume: { label: "导入或记录简历", implemented: true },
  record_job: { label: "记录岗位", implemented: true },
  analyze_job_fit: { label: "分析岗位与简历匹配", implemented: true },
  create_job_specific_resume: { label: "创建岗位定制简历", implemented: true },
  edit_and_export_resume: { label: "修改并导出简历", implemented: true },
  manage_application_record: { label: "管理投递记录", implemented: false },
  assist_ats_application: { label: "ATS 半自动填写", implemented: false },
  mock_interview: { label: "模拟面试", implemented: false },
  read_career_context: { label: "读取职业上下文", implemented: true },
  read_resume_and_job: { label: "读取简历与岗位", implemented: true },
  runtime_diagnostics: { label: "运行时诊断", implemented: true }
};

/**
 * Registry 元数据可客观推出的写入类别。`assertCapabilityMatrixIntegrity()` 会
 * 用真实 `risk`/`requiresConfirmation` 校验它，因此这一列不能被随意标注。
 */
export type AgentCapabilityWriteKind =
  | "none"
  | "safe_write"
  | "confirmation_write"
  | "declaration_write";

/**
 * 能力结果是否跨刷新 / 重启存活。
 *
 * `none` 用于只读工具（不写任何东西，持久性问题不适用）；`session_only`
 * 表示写入只落在内存会话状态（岗位定制会话、导出入口），刷新后必须重建。
 * 它与 Registry 的 `resumable` 不同：`resumable` 是工具契约声明，
 * `persistence` 描述实际落盘事实，两者都会进入认证报告。
 */
export type AgentCapabilityPersistence = "none" | "session_only" | "persistent";

export type AgentCapabilityDescriptor = {
  /** 必须与 Registry 工具名完全一致。 */
  tool: string;
  domain: string;
  intents: AgentCapabilityIntent[];
  /**
   * 产生的业务记录（Dexie 领域表）。只读工具必须为空——`buildAgentCapabilityMatrix`
   * 会强制这一点，因为业务事实是本项目唯一不可绕过写入路径的保护对象。
   */
  businessRecords: string[];
  /**
   * 产生的工作流状态记录（appMeta 中的 checkpoint / plan / 草稿）。这类写入
   * 允许出现在 `risk: "read"` 工具上：它们承载可恢复进度而不是用户事实，
   * 但必须被显式登记，不得当作「无副作用」。
   */
  workflowStateRecords: string[];
  /** 失败后的恢复方式。必须是可执行动作，不是「重试」这类空话。 */
  recovery: string;
};

export type AgentCapabilityMatrixRow = {
  /** 工具名称（来自真实 Registry）。 */
  tool: string;
  /** 所属领域（描述表）。 */
  domain: string;
  /** Registry `category`。 */
  category: string;
  /** Registry `dataScope`。 */
  dataScope: string;
  /** Registry `risk`。 */
  risk: string;
  /** 读写权限（由 risk 派生）。 */
  access: "read" | "write";
  /** 是否需要用户确认（来自 Registry）。 */
  requiresConfirmation: boolean;
  /** 写入类别（由 risk + requiresConfirmation 派生）。 */
  writeKind: AgentCapabilityWriteKind;
  /** 是否幂等（来自 Registry）。 */
  idempotent: boolean;
  /** 是否可恢复（来自 Registry）。 */
  resumable: boolean;
  /** 是否产出 artifact（来自 Registry）。 */
  producesArtifact: boolean;
  /** 输入 Schema（来自真实 Registry 的 JSON Schema）。 */
  inputSchema: Record<string, unknown>;
  /** 输出 Schema（来自真实 Registry 的 JSON Schema）。 */
  outputSchema: Record<string, unknown>;
  /** 产生的业务记录。 */
  businessRecords: string[];
  /** 产生的工作流状态记录（可出现在只读工具上）。 */
  workflowStateRecords: string[];
  /** 结果是否跨刷新 / 重启存活。 */
  persistence: AgentCapabilityPersistence;
  /** 失败后的恢复方式。 */
  recovery: string;
  /** 对应的用户核心意图。 */
  intents: AgentCapabilityIntent[];
};

export type AgentCapabilityMatrix = {
  rows: AgentCapabilityMatrixRow[];
  writeRows: AgentCapabilityMatrixRow[];
  confirmationWriteRows: AgentCapabilityMatrixRow[];
  /** 结果不落盘、刷新后必须重建的能力。 */
  sessionOnlyRows: AgentCapabilityMatrixRow[];
  intents: Record<AgentCapabilityIntent, string[]>;
  unimplementedIntents: AgentCapabilityIntent[];
};

const DESCRIPTORS: AgentCapabilityDescriptor[] = [
  // ── 只读：职业上下文 ────────────────────────────────────────────────────
  { tool: "list_profiles", domain: "个人资料库", intents: ["read_career_context"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "get_active_profile", domain: "个人资料库", intents: ["read_career_context"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "get_profile", domain: "个人资料库", intents: ["read_career_context"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "search_profile_facts", domain: "个人资料库", intents: ["read_career_context"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "retrieve_career_context", domain: "个人资料库", intents: ["read_career_context"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },

  // ── 只读：简历与岗位 ────────────────────────────────────────────────────
  { tool: "list_resumes", domain: "简历", intents: ["read_resume_and_job"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "get_resume", domain: "简历", intents: ["read_resume_and_job"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "get_resume_revision", domain: "简历", intents: ["read_resume_and_job"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "list_jobs", domain: "岗位", intents: ["read_resume_and_job"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "get_job", domain: "岗位", intents: ["read_resume_and_job"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },

  // ── 只读：运行时诊断 ────────────────────────────────────────────────────
  { tool: "get_agent_task_context", domain: "运行时诊断", intents: ["runtime_diagnostics"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "get_agent_runtime_status", domain: "运行时诊断", intents: ["runtime_diagnostics"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "get_agent_current_task", domain: "运行时诊断", intents: ["runtime_diagnostics"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "get_agent_last_failure", domain: "运行时诊断", intents: ["runtime_diagnostics"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },
  { tool: "search_agent_sessions", domain: "运行时诊断", intents: ["runtime_diagnostics"], businessRecords: [], workflowStateRecords: [], recovery: "只读，无需恢复；重读即可" },

  // ── 记录个人资料 / 简历事实 ────────────────────────────────────────────
  {
    tool: "capture_profile_intake",
    domain: "个人资料库",
    intents: ["record_profile_facts"],
    businessRecords: [], workflowStateRecords: ["appMeta:importedResumeDraft", "appMeta:profile-intake-source-turn"],
    recovery: "按 (sessionId, messageId, turnId) 幂等重放同一 capture；retry=true 走独立 capture 不新增用户轮次"
  },
  {
    tool: "synthesize_profile_intake",
    domain: "个人资料库",
    intents: ["record_profile_facts"],
    businessRecords: [], workflowStateRecords: ["appMeta:importedResumeDraft"],
    recovery: "以同一 importId + expectedDraftRevision 重试；Provider 失败保留原始 Draft 与 needsNormalization"
  },
  {
    tool: "review_profile_intake",
    domain: "个人资料库",
    intents: ["record_profile_facts"],
    businessRecords: [], workflowStateRecords: ["appMeta:importedResumeDraft"],
    recovery: "按 candidateId + draftRevision 幂等；过期 revision 返回 stale 且不覆盖既有候选"
  },
  {
    tool: "reconcile_profile_intake",
    domain: "个人资料库",
    intents: ["record_profile_facts"],
    businessRecords: [],
    workflowStateRecords: ["appMeta:profile-reconciliation-plan"],
    recovery: "V4-P2-C 发现：risk=read 但会持久化对账计划；这是工作流状态而非业务事实，重跑覆盖同键即可"
  },
  {
    tool: "resolve_profile_intake_conflict",
    domain: "个人资料库",
    intents: ["record_profile_facts"],
    businessRecords: [],
    workflowStateRecords: ["appMeta:profile-reconciliation-plan"],
    recovery: "按 incomingItemId 幂等；stale 计划需重新对账后再解决"
  },
  {
    tool: "commit_profile_intake",
    domain: "个人资料库",
    intents: ["record_profile_facts"],
    businessRecords: ["profiles"],
    workflowStateRecords: ["appMeta:profile-reconciliation-plan", "appMeta:importedResumeDraft"],
    recovery: "expectedProfileVersion 不匹配返回 stale 且零写入；重取版本后以新 operationId 重试"
  },

  // ── 导入或记录简历 ──────────────────────────────────────────────────────
  {
    tool: "prepare_resume_import",
    domain: "简历导入",
    intents: ["import_or_record_resume"],
    businessRecords: [], workflowStateRecords: ["appMeta:importedResumeDraft"],
    recovery: "同一附件 attachmentId 重放复用既有草稿；附件在草稿前丢失需重新选择文件"
  },
  {
    tool: "review_resume_import",
    domain: "简历导入",
    intents: ["import_or_record_resume"],
    businessRecords: [], workflowStateRecords: ["appMeta:importedResumeDraft"],
    recovery: "expectedDraftRevision 幂等；过期时重读草稿后重放"
  },
  {
    tool: "reconcile_resume_import",
    domain: "简历导入",
    intents: ["import_or_record_resume"],
    businessRecords: [],
    workflowStateRecords: ["appMeta:profile-reconciliation-plan"],
    recovery: "只读计划；resumable=false 表示计划本身不可跨暂停续跑，需重跑对账"
  },
  {
    tool: "resolve_resume_reconciliation",
    domain: "简历导入",
    intents: ["import_or_record_resume"],
    businessRecords: [],
    workflowStateRecords: ["appMeta:profile-reconciliation-plan"],
    recovery: "按 expectedPlanRevision 幂等；stale 计划需重新对账"
  },
  {
    tool: "parse_resume_file",
    domain: "简历导入（兼容）",
    intents: ["import_or_record_resume"],
    businessRecords: [], workflowStateRecords: [], recovery: "只读解析；失败保留原始文本供改用 canonical 导入"
  },
  {
    tool: "create_resume_import_draft",
    domain: "简历导入（兼容）",
    intents: ["import_or_record_resume"],
    businessRecords: [], workflowStateRecords: ["appMeta:importedResumeDraft"],
    recovery: "兼容路径；正式导入应改用 prepare_resume_import"
  },
  {
    tool: "commit_resume_import",
    domain: "简历导入",
    intents: ["import_or_record_resume"],
    businessRecords: ["profiles", "resumeBranches", "resumeRevisions", "resumeBranchOperations"],
    workflowStateRecords: ["appMeta:importedResumeDraft", "appMeta:resume-import-operation"],
    recovery: "同一 operationId 幂等返回既有结果；未决对账抛 profile_reconciliation_unresolved 且整事务回滚，草稿保持 reviewing；无分支结果必须给出 branchDisposition"
  },

  // ── 记录岗位 ────────────────────────────────────────────────────────────
  {
    tool: "parse_job_description",
    domain: "岗位",
    intents: ["record_job"],
    businessRecords: [], workflowStateRecords: [], recovery: "只读解析；AI 无效输出保留原始 JD 并生成可提交本地草稿"
  },
  {
    tool: "commit_job",
    domain: "岗位",
    intents: ["record_job"],
    businessRecords: ["jobListings", "jobSnapshots", "jobDescriptions"],
    workflowStateRecords: ["appMeta:raw-input", "appMeta:job-analysis-draft", "appMeta:conversion-confirmation"],
    recovery: "未确认时返回 agent_confirmation_required 且零写入；缺 Agent 绑定快速失败 agent_confirmation_binding_missing；重复岗位返回 duplicate_decision_required 等待用户决策；同 operationId 重放幂等"
  },

  // ── 分析岗位与简历匹配 ──────────────────────────────────────────────────
  {
    tool: "recommend_resume_source",
    domain: "岗位匹配",
    intents: ["analyze_job_fit"],
    businessRecords: [], workflowStateRecords: [], recovery: "只读推荐；用户可直接覆盖来源选择"
  },
  {
    tool: "analyze_job_fit",
    domain: "岗位匹配",
    intents: ["analyze_job_fit"],
    businessRecords: [], workflowStateRecords: [], recovery: "只读分析；缺 jobId/targetSnapshot 返回 needs_user_input"
  },

  // ── 创建岗位定制简历 ────────────────────────────────────────────────────
  {
    tool: "build_resume_evidence_graph",
    domain: "简历组装",
    intents: ["create_job_specific_resume"],
    businessRecords: [], workflowStateRecords: [], recovery: "只读构图；Profile 缺失返回 needs_profile"
  },
  {
    tool: "plan_resume_composition",
    domain: "简历组装",
    intents: ["create_job_specific_resume"],
    businessRecords: [],
    workflowStateRecords: ["appMeta:resume-composition-checkpoint"],
    recovery: "V4-P2-C 发现：risk=read 但会持久化组装 checkpoint；以同一 checkpointId 续跑，保留可重放"
  },
  {
    tool: "review_resume_composition",
    domain: "简历组装",
    intents: ["create_job_specific_resume"],
    businessRecords: [], workflowStateRecords: [], recovery: "只读审查；未形成 proposal 时不可声称完成"
  },
  {
    tool: "compose_resume",
    domain: "简历组装",
    intents: ["create_job_specific_resume"],
    businessRecords: ["resumeBranches", "resumeRevisions", "resumeBranchOperations"],
    workflowStateRecords: ["appMeta:resume-composition-checkpoint"],
    recovery: "未确认时零写入；失败保留 checkpoint，可从当前步骤重试；同一 operationId 幂等"
  },
  {
    tool: "create_job_resume_from_profile",
    domain: "岗位定制",
    intents: ["create_job_specific_resume"],
    businessRecords: ["resumeBranches", "resumeRevisions", "resumeBranchOperations"],
    workflowStateRecords: [],
    recovery: "未确认时零写入；来源简历不变；同来源指纹重复派生需显式新建"
  },
  {
    tool: "create_resume_from_profile",
    domain: "简历组装",
    intents: ["create_job_specific_resume"],
    businessRecords: ["resumeBranches", "resumeRevisions", "resumeBranchOperations"],
    workflowStateRecords: [],
    recovery: "未确认时零写入；不覆盖既有简历"
  },
  {
    tool: "ensure_general_resume_from_profile",
    domain: "简历组装",
    intents: ["create_job_specific_resume"],
    businessRecords: ["resumeBranches", "resumeRevisions", "resumeBranchOperations"],
    workflowStateRecords: [],
    recovery: "mode=update_existing 时 expectedProfileVersion 过期返回 stale 且零写入"
  },
  {
    tool: "create_tailoring_session",
    domain: "岗位定制",
    intents: ["create_job_specific_resume"],
    businessRecords: [], workflowStateRecords: [], recovery: "刷新后定制会话不存活，需用 create_tailoring_session 以同一简历与岗位重建；来源简历与岗位不受影响"
  },
  {
    tool: "answer_tailoring_question",
    domain: "岗位定制",
    intents: ["create_job_specific_resume"],
    businessRecords: [], workflowStateRecords: [], recovery: "刷新后定制会话不存活，需重建会话并重新回答；按 questionId 幂等，不影响已落盘简历"
  },
  {
    tool: "generate_tailoring_changes",
    domain: "岗位定制",
    intents: ["create_job_specific_resume"],
    businessRecords: [], workflowStateRecords: [], recovery: "刷新后定制会话不存活，需重建会话并重新回答后生成；问题未完成返回可重试的 tailoring_questions_incomplete"
  },
  {
    tool: "review_tailoring_diff",
    domain: "岗位定制",
    intents: ["create_job_specific_resume"],
    businessRecords: [], workflowStateRecords: [], recovery: "刷新后定制会话不存活，需重建会话并重新生成建议；按 diffId 幂等，不影响已落盘简历"
  },
  {
    tool: "preview_tailoring_changes",
    domain: "岗位定制",
    intents: ["create_job_specific_resume"],
    businessRecords: [], workflowStateRecords: [], recovery: "刷新后定制会话不存活，需重建会话再预览；非法路径白名单拒绝且不写入"
  },
  {
    tool: "apply_tailoring_changes",
    domain: "岗位定制",
    intents: ["create_job_specific_resume", "edit_and_export_resume"],
    businessRecords: ["resumeBranches", "resumeRevisions", "resumeBranchOperations"],
    workflowStateRecords: ["appMeta:resume-artifact-write-checkpoint", "appMeta:resume-artifact-receipt"],
    recovery: "未确认时零写入；应用失败保留已采纳 diff 与 checkpoint，回到 confirm_apply/waiting_for_user 可从当前步骤重试；同 operationId 幂等"
  },

  // ── 修改并导出简历 ──────────────────────────────────────────────────────
  {
    tool: "archive_resume",
    domain: "简历生命周期",
    intents: ["edit_and_export_resume"],
    businessRecords: ["resumeBranches"],
    workflowStateRecords: [],
    recovery: "expectedRevision 过期返回 stale 且零写入；归档可由 restore_resume 撤销"
  },
  {
    tool: "restore_resume",
    domain: "简历生命周期",
    intents: ["edit_and_export_resume"],
    businessRecords: ["resumeBranches"],
    workflowStateRecords: [],
    recovery: "expectedRevision 过期返回 stale 且零写入"
  },
  {
    tool: "export_resume",
    domain: "简历导出",
    intents: ["edit_and_export_resume"],
    businessRecords: [], workflowStateRecords: [], recovery: "刷新后导出入口失效，需重新调用生成；只产出导出入口与 route，不直接写 PDF，失败由既有导出状态机重试"
  }
];

const DESCRIPTOR_BY_TOOL = new Map(DESCRIPTORS.map((descriptor) => [descriptor.tool, descriptor]));

/**
 * 只作用于内存会话状态、刷新后必须整体重建的能力。
 *
 * 这里包含两类工具：写入型（`answer_tailoring_question`、`review_tailoring_diff`）
 * 与操作同一会话的只读型（`create_tailoring_session`、
 * `generate_tailoring_changes`、`preview_tailoring_changes`）。它们在 Registry
 * 里被标为 `risk: "read"`，但共同作用于**同一个不落盘的岗位定制会话**，
 * 因此刷新后整个定制会话失效——这一点不能被 `risk: "read"` 掩盖。
 *
 * `persistence` 由本名单 + 记录集合派生，并强制校验名单内工具**确实不落盘**，
 * 因此「哪些能力跨刷新/重启存活」不可能被手写标注掩盖或悄悄扩张。
 */
export const SESSION_SCOPED_CAPABILITY_TOOLS = [
  "create_tailoring_session",
  "answer_tailoring_question",
  "generate_tailoring_changes",
  "review_tailoring_diff",
  "preview_tailoring_changes",
  "export_resume"
] as const;

export function derivePersistence(
  tool: string,
  descriptor: AgentCapabilityDescriptor
): AgentCapabilityPersistence {
  if ((SESSION_SCOPED_CAPABILITY_TOOLS as readonly string[]).includes(tool)) return "session_only";
  return descriptor.businessRecords.length + descriptor.workflowStateRecords.length > 0
    ? "persistent"
    : "none";
}

export function deriveWriteKind(risk: string, requiresConfirmation: boolean): AgentCapabilityWriteKind {
  if (risk === "read") return "none";
  if (risk === "user_declared") return "declaration_write";
  return requiresConfirmation ? "confirmation_write" : "safe_write";
}

/**
 * 从真实 Registry 生成能力矩阵，并对描述表做双向全覆盖与写入类别校验。
 * 任何漂移都抛 `capability_matrix_drift_*`，不会返回不完整的矩阵。
 */
export function buildAgentCapabilityMatrix(registry: AgentToolRegistry): AgentCapabilityMatrix {
  const manifest = registry.manifest();
  const rows: AgentCapabilityMatrixRow[] = [];

  for (const item of manifest) {
    const descriptor = DESCRIPTOR_BY_TOOL.get(item.name);
    if (!descriptor) throw new Error(`capability_matrix_drift_missing_descriptor:${item.name}`);
    const access = item.risk === "read" ? "read" : "write";
    const writeKind = deriveWriteKind(item.risk, item.requiresConfirmation);
    if (access === "read" && descriptor.businessRecords.length > 0) {
      throw new Error(`capability_matrix_drift_read_tool_writes:${item.name}`);
    }
    rows.push({
      tool: item.name,
      domain: descriptor.domain,
      category: item.category,
      dataScope: item.dataScope,
      risk: item.risk,
      access,
      requiresConfirmation: item.requiresConfirmation,
      writeKind,
      idempotent: item.idempotent,
      resumable: item.resumable,
      producesArtifact: item.producesArtifact,
      inputSchema: item.inputSchema,
      outputSchema: item.outputSchema,
      businessRecords: descriptor.businessRecords,
      workflowStateRecords: descriptor.workflowStateRecords,
      persistence: derivePersistence(item.name, descriptor),
      recovery: descriptor.recovery,
      intents: descriptor.intents
    });
  }

  for (const descriptor of DESCRIPTORS) {
    if (!manifest.some((item) => item.name === descriptor.tool)) {
      throw new Error(`capability_matrix_drift_unknown_descriptor:${descriptor.tool}`);
    }
  }

  // 名单内工具必须确实不落盘；一旦其中某个开始持久化，能力矩阵必须失败而不是
  // 继续声称「刷新后不存活」。
  for (const tool of SESSION_SCOPED_CAPABILITY_TOOLS) {
    const descriptor = DESCRIPTOR_BY_TOOL.get(tool);
    if (!descriptor) throw new Error(`capability_matrix_drift_session_scope_unknown:${tool}`);
    if (descriptor.businessRecords.length + descriptor.workflowStateRecords.length > 0) {
      throw new Error(`capability_matrix_drift_session_scope_persists:${tool}`);
    }
  }

  const intents = {} as Record<AgentCapabilityIntent, string[]>;
  for (const key of Object.keys(AGENT_CAPABILITY_INTENTS) as AgentCapabilityIntent[]) intents[key] = [];
  for (const row of rows) {
    for (const intent of row.intents) intents[intent].push(row.tool);
  }
  const unimplementedIntents = (Object.keys(AGENT_CAPABILITY_INTENTS) as AgentCapabilityIntent[])
    .filter((intent) => !AGENT_CAPABILITY_INTENTS[intent].implemented && intents[intent].length === 0);

  return {
    rows,
    writeRows: rows.filter((row) => row.access === "write"),
    confirmationWriteRows: rows.filter((row) => row.writeKind === "confirmation_write"),
    sessionOnlyRows: rows
      .filter((row) => row.persistence === "session_only")
      .sort((left, right) => left.tool.localeCompare(right.tool)),
    intents,
    unimplementedIntents
  };
}

/** 供测试与文档核对：写入类工具若不幂等或不可恢复，会被显式列出。 */
export function capabilityMatrixWeakWriteRows(matrix: AgentCapabilityMatrix) {
  return matrix.writeRows.filter((row) => !row.idempotent || !row.resumable);
}

/**
 * V4-P2-C 认证发现：`risk: "read"` 但确实持久化工作流状态的工具。
 *
 * 这些写入承载可恢复进度与对账计划，不含用户事实，因此不提升为业务写入；
 * 但把它们登记为「无副作用」同样不诚实，因此由本函数显式暴露并由测试钉住。
 */
export function capabilityMatrixReadToolsWritingWorkflowState(matrix: AgentCapabilityMatrix) {
  return matrix.rows
    .filter((row) => row.access === "read" && row.workflowStateRecords.length > 0)
    .map((row) => row.tool)
    .sort();
}