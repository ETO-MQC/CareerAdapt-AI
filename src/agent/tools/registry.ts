import { z } from "zod";
import { ProfileIntakeStructuredPatchSchema } from "@/domain/profileIntake/ProfileIntakeNormalizer";
import { CaptureProfileIntakeResultSchema } from "@/domain/profileIntake/CaptureProfileIntakeResult";
import type { AgentToolDefinition, AgentToolResult } from "../contracts/agentTool";
import type { ExternalToolProvider } from "./externalToolProvider";
import { ResumeSectionTypeV2Schema } from "@/domain/schemas/resumeV2";

const OperationOutputSchema = z.object({ operationId: z.string().min(8) }).passthrough();
const CaptureProfileIntakeToolOutputSchema = CaptureProfileIntakeResultSchema.extend({
  operationId: z.string().min(8)
});
const EmptyInputSchema = z.object({}).strict();

export type AgentToolServices = {
  listResumes(signal?: AbortSignal): Promise<unknown>;
  listProfiles(signal?: AbortSignal): Promise<unknown>;
  listJobs(signal?: AbortSignal): Promise<unknown>;
  getActiveProfile?(signal?: AbortSignal): Promise<unknown>;
  getProfile?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  searchProfileFacts?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  getResume?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  getResumeRevision?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  getJob?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  recommendResumeSource?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  createJobResumeFromProfile?(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  createResumeFromProfile?(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  buildResumeEvidenceGraph?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  planResumeComposition?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  reviewResumeComposition?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  composeResume?(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  getAgentTaskContext?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  getAgentRuntimeStatus?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  getAgentCurrentTask?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  getAgentLastFailure?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  searchAgentSessions?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  skillsList?(signal?: AbortSignal): Promise<unknown>;
  skillView?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  prepareResumeImport?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  reviewResumeImport?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  reconcileResumeImport?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  resolveResumeReconciliation?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  captureProfileIntake?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  synthesizeProfileIntake?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  reviewProfileIntake?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  reconcileProfileIntake?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  resolveProfileIntakeConflict?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  commitProfileIntake?(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  ensureGeneralResumeFromProfile?(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  parseResumeFile(input: unknown, signal?: AbortSignal): Promise<unknown>;
  createResumeImportDraft(input: unknown, signal?: AbortSignal): Promise<unknown>;
  commitResumeImport(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  parseJobDescription(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  commitJob(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  analyzeJobFit(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  createTailoringSession(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  answerTailoringQuestion(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  generateTailoringChanges?(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  reviewTailoringDiff?(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  previewTailoringChanges(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  applyTailoringChanges(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  archiveResume?(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  restoreResume?(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  exportResume(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
};

const ResumeFileInputSchema = z.object({
  fileName: z.string().min(1).max(240),
  mimeType: z.enum(["text/plain", "application/json", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  text: z.string().min(1).max(200_000)
}).strict();

const ResumeImportPrepareInputSchema = z.object({
  attachmentId: z.string().min(1)
}).strict();

const ResumeImportReviewInputSchema = z.object({
  importId: z.string().min(1),
  expectedDraftRevision: z.number().int().min(0),
  decision: z.enum(["accept_all", "ignore_uncertain"])
}).strict();

const ResumeImportReconcileInputSchema = z.object({
  importId: z.string().min(1),
  expectedDraftRevision: z.number().int().min(0),
  profileId: z.string().min(1)
}).strict();

const ResumeImportReconciliationResolutionInputSchema = z.object({
  importId: z.string().min(1),
  expectedPlanRevision: z.number().int().min(0),
  incomingItemId: z.string().min(1),
  resolution: z.enum(["keep_existing", "use_imported", "keep_both_as_distinct", "edit_value", "defer"]),
  editedValue: z.string().min(1).optional()
}).strict();

const ProfileIntakeCaptureInputSchema = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  turnId: z.string().min(1),
  text: z.string().min(1).max(24_000),
  capturedAt: z.string().datetime({ offset: true }),
  targetProfileId: z.string().min(1),
  expectedProfileVersion: z.number().int().min(0),
  acknowledgedActiveProfileId: z.string().min(1).optional(),
  intakeQuestionId: z.string().min(1).optional(),
  intakeCandidateId: z.string().min(1).optional(),
  intakeDimension: z.string().min(1).optional(),
  importId: z.string().min(1).optional(),
  expectedDraftRevision: z.number().int().min(0).optional(),
  sourceContentHash: z.string().min(8).optional(),
  retry: z.boolean().optional()
}).strict();

const ProfileIntakeReviewInputSchema = z.object({
  importId: z.string().min(1),
  expectedDraftRevision: z.number().int().min(0),
  candidateId: z.string().min(1).optional(),
  decision: z.enum(["accept", "reject", "reopen", "accept_all"]),
  editedLabel: z.string().trim().min(1).max(240).optional(),
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics"]).optional(),
  userCorrection: z.boolean().optional(),
  structuredPatch: ProfileIntakeStructuredPatchSchema.optional(),
  evidence: z.object({
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    turnId: z.string().min(1),
    capturedAt: z.string().datetime({ offset: true }),
    sourceQuote: z.string().min(1).max(24_000),
    sourceContentHash: z.string().min(8).optional()
  }).strict().optional()
}).strict().superRefine((input, context) => {
  if (input.decision !== "accept_all" && !input.candidateId) {
    context.addIssue({ code: "custom", path: ["candidateId"], message: "candidateId is required for an item decision" });
  }
  if (input.decision === "accept_all" && (input.structuredPatch || input.editedLabel || input.sectionType)) {
    context.addIssue({ code: "custom", path: ["decision"], message: "accept_all cannot carry an item edit" });
  }
  if (input.structuredPatch && !input.evidence && input.userCorrection !== true) {
    context.addIssue({
      code: "custom",
      path: ["evidence"],
      message: "structuredPatch requires follow-up source evidence"
    });
  }
});

const ProfileIntakeSynthesisInputSchema = z.object({
  importId: z.string().min(1),
  expectedDraftRevision: z.number().int().min(0)
}).strict();

const ProfileIntakeReconcileInputSchema = z.object({
  importId: z.string().min(1),
  expectedDraftRevision: z.number().int().min(0),
  targetProfileId: z.string().min(1),
  expectedProfileVersion: z.number().int().min(0),
  acknowledgedActiveProfileId: z.string().min(1).optional()
}).strict();

const ProfileIntakeConflictInputSchema = ResumeImportReconciliationResolutionInputSchema.extend({
  targetProfileId: z.string().min(1)
}).strict();

const ProfileIntakeCommitInputSchema = z.object({
  importId: z.string().min(1),
  expectedDraftRevision: z.number().int().min(0),
  expectedReconciliationRevision: z.number().int().min(0),
  targetProfileId: z.string().min(1),
  expectedProfileVersion: z.number().int().min(0),
  acknowledgedActiveProfileId: z.string().min(1).optional()
}).strict();

const EnsureGeneralResumeInputSchema = z.object({
  targetProfileId: z.string().min(1),
  expectedProfileVersion: z.number().int().min(0),
  acknowledgedActiveProfileId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional()
}).strict();

const ResumeDraftInputSchema = z.object({
  parsedResume: z.unknown()
}).strict();

const ResumeCommitInputSchema = z.object({
  importId: z.string().min(1),
  expectedDraftRevision: z.number().int().min(0),
  expectedReconciliationRevision: z.number().int().min(0).optional(),
  target: z.union([
    z.object({ mode: z.literal("existing"), profileId: z.string().min(1) }).strict(),
    z.object({ mode: z.literal("new"), profileName: z.string().min(1).max(120), createGeneralResume: z.literal(true) }).strict()
  ])
}).strict();

const JobParseInputSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  company: z.string().min(1).max(160).optional(),
  rawText: z.string().min(20).max(24_000)
}).strict();

const JobCommitInputSchema = JobParseInputSchema.extend({
  title: z.string().min(1).max(160),
  company: z.string().min(1).max(160),
  graph: z.unknown()
}).strict();

const EntitySelectionSchema = z.object({
  profileId: z.string().min(1),
  resumeId: z.string().min(1),
  jobId: z.string().min(1)
}).strict();

const TailoringSessionInputSchema = EntitySelectionSchema.extend({
  intensity: z.enum(["conservative", "balanced", "aggressive"]).optional()
}).strict();

const TailoringQuestionInputSchema = z.object({
  session: z.unknown(),
  questionId: z.string().min(1),
  answer: z.union([z.string(), z.array(z.string()), z.boolean()]),
  proficiency: z.enum(["proficient", "familiar", "aware", "learning"]).optional()
}).strict();

const CreateResumeFromProfileInputSchema = z.object({
  targetProfileId: z.string().min(1),
  expectedProfileVersion: z.number().int().min(0),
  selectedFactIds: z.array(z.string().trim().min(1)).min(1).max(60),
  acknowledgedActiveProfileId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional()
}).strict();

const GenerateTailoringChangesInputSchema = z.object({
  session: z.unknown()
}).strict();

const ReviewTailoringDiffInputSchema = z.object({
  session: z.unknown(),
  diffId: z.string().min(1),
  decision: z.enum(["accept", "edit", "reject"]),
  editedValue: z.union([z.string().min(1), z.array(z.string().min(1))]).optional()
}).strict();

const TailoringChangesInputSchema = z.object({
  session: z.unknown(),
  selectedDiffs: z.array(z.unknown()),
  confirmedRequirementIds: z.array(z.string()).default([])
}).strict();

const ExportInputSchema = z.object({
  resumeId: z.string().min(1),
  templateId: z.string().min(1).optional()
}).strict();

const ProfileIdInputSchema = z.object({ profileId: z.string().min(1) }).strict();
const ResumeIdInputSchema = z.object({ resumeId: z.string().min(1) }).strict();
const ResumeLifecycleInputSchema = z.object({
  resumeId: z.string().min(1),
  expectedRevision: z.number().int().min(0)
}).strict();
const RevisionInputSchema = z.object({ resumeId: z.string().min(1), revisionId: z.string().min(1).optional() }).strict();
const JobIdInputSchema = z.object({ jobId: z.string().min(1) }).strict();
const SourceRouteInputSchema = z.object({ profileId: z.string().min(1), jobId: z.string().min(1) }).strict();
const ProfileJobResumeInputSchema = SourceRouteInputSchema.extend({ name: z.string().min(1).max(120).optional() }).strict();
const ResumeCompositionInputSchema = z.object({
  profileId: z.string().min(1),
  expectedProfileRevision: z.number().int().min(1),
  mode: z.enum(["general", "job_specific"]),
  jobId: z.string().min(1).optional(),
  sourceResumeId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  targetDirection: z.string().trim().min(1).max(160).optional(),
  targetAudience: z.string().trim().min(1).max(160).optional(),
  companyType: z.string().trim().min(1).max(160).optional(),
  acknowledgedActiveProfileId: z.string().min(1).optional(),
  userPreferences: z.record(z.string(), z.unknown()).optional()
}).strict().superRefine((input, context) => {
  if (input.mode === "job_specific" && !input.jobId) context.addIssue({ code: "custom", path: ["jobId"], message: "jobId is required for job-specific composition" });
});
const ProfileSearchInputSchema = z.object({
  profileId: z.string().min(1),
  query: z.string().min(1).max(240),
  sectionTypes: z.array(z.string().min(1)).max(12).optional(),
  limit: z.number().int().min(1).max(24).default(12)
}).strict();
const TaskContextInputSchema = z.object({ sessionId: z.string().min(1) }).strict();
const SessionSearchInputSchema = z.object({ query: z.string().min(1).max(240), limit: z.number().int().min(1).max(20).default(8) }).strict();
const SkillViewInputSchema = z.object({ skillId: z.string().min(1), referencePath: z.string().min(1).max(240).optional() }).strict();

function define<TInput>(
  services: AgentToolServices,
  definition: Omit<AgentToolDefinition<TInput, unknown>, "execute">,
  execute: (input: TInput, operationId: string, signal?: AbortSignal) => Promise<unknown>
): AgentToolDefinition<TInput, unknown> {
  return {
    ...definition,
    execute: async (input, context) => {
      const value = await execute(input, context.operationId, context.signal);
      return typeof value === "object" && value !== null
        ? { ...value, operationId: context.operationId }
        : { operationId: context.operationId, value };
    }
  };
}

export function createAgentToolRegistry(services: AgentToolServices) {
  const tools = [
    define(services, meta("list_resumes", "发现可用简历；仅返回摘要。需要内容时继续使用 get_resume。", "read", false, true, true, EmptyInputSchema, "resume", "resume_summary"), (_, __, signal) => services.listResumes(signal)),
    define(services, meta("list_profiles", "发现个人资料库；仅返回摘要。需要权威详情时继续使用 get_profile。", "read", false, true, true, EmptyInputSchema, "profile", "profile_summary"), (_, __, signal) => services.listProfiles(signal)),
    define(services, meta("list_jobs", "发现已保存岗位；仅返回摘要。需要详情时继续使用 get_job。", "read", false, true, true, EmptyInputSchema, "job", "job_summary"), (_, __, signal) => services.listJobs(signal)),
    define(services, meta("get_active_profile", "读取用户当前明确选择的资料库标识；不会猜测身份。", "read", false, true, true, EmptyInputSchema, "profile", "active_profile"), (_, __, signal) => services.getActiveProfile ? services.getActiveProfile(signal) : unavailableTool("get_active_profile")),
    define(services, meta("get_profile", "按 profileId 读取权威 CareerProfile 详情和来源支持的资料条目。", "read", false, true, true, ProfileIdInputSchema, "profile", "career_profile"), (input, _, signal) => services.getProfile ? services.getProfile(input, signal) : unavailableTool("get_profile")),
    define(services, meta("search_profile_facts", "在指定 CareerProfile 中检索与问题相关的真实经历、技能、教育或证书。", "read", false, true, true, ProfileSearchInputSchema, "profile", "profile_facts"), (input, _, signal) => services.searchProfileFacts ? services.searchProfileFacts(input, signal) : unavailableTool("search_profile_facts")),
    define(services, meta("get_resume", "按 resumeId 读取简历分支的权威结构与当前 Revision 指针。", "read", false, true, true, ResumeIdInputSchema, "resume", "resume_detail"), (input, _, signal) => services.getResume ? services.getResume(input, signal) : unavailableTool("get_resume")),
    define(services, meta("get_resume_revision", "读取指定简历的当前或指定 Revision 快照。", "read", false, true, true, RevisionInputSchema, "resume", "resume_revision"), (input, _, signal) => services.getResumeRevision ? services.getResumeRevision(input, signal) : unavailableTool("get_resume_revision")),
    define(services, meta("get_job", "按 jobId 读取已保存岗位的权威要求详情。", "read", false, true, true, JobIdInputSchema, "job", "job_detail"), (input, _, signal) => services.getJob ? services.getJob(input, signal) : unavailableTool("get_job")),
    define(services, meta("recommend_resume_source", "根据资料证据丰富度、简历成熟度、岗位覆盖、来源、时效和缺失项推荐资料来源；用户可覆盖。", "read", false, true, true, SourceRouteInputSchema, "tailoring", "career_assets"), (input, _, signal) => services.recommendResumeSource ? services.recommendResumeSource(input, signal) : unavailableTool("recommend_resume_source")),
    define(services, meta("create_job_resume_from_profile", "从资料库中按岗位相关性选择已确认内容并创建独立岗位简历。", "write", true, true, true, ProfileJobResumeInputSchema, "tailoring", "resume_revision", true), (input, operationId, signal) => services.createJobResumeFromProfile ? services.createJobResumeFromProfile(input, operationId, signal) : unavailableTool("create_job_resume_from_profile")),
    define(services, meta("create_resume_from_profile", "按用户确认的事实范围创建独立通用简历；不会覆盖资料库或已有简历。", "write", true, true, true, CreateResumeFromProfileInputSchema, "resume", "resume_revision", true), (input, operationId, signal) => services.createResumeFromProfile ? services.createResumeFromProfile(input, operationId, signal) : unavailableTool("create_resume_from_profile")),
    define(services, meta("build_resume_evidence_graph", "读取确认 Profile 的职业资产、技能来源、事实证据和可恢复候选；不会写入任何资料。", "read", false, true, true, ResumeCompositionInputSchema, "resume", "resume_evidence_graph"), (input, _, signal) => services.buildResumeEvidenceGraph ? services.buildResumeEvidenceGraph(input, signal) : unavailableTool("build_resume_evidence_graph")),
    define(services, meta("plan_resume_composition", "基于证据图规划通用或岗位简历的资产选择、摘要、技能组、关键词缺口和可选问题；不会写入简历。", "read", false, true, true, ResumeCompositionInputSchema, "resume", "resume_blueprint"), (input, _, signal) => services.planResumeComposition ? services.planResumeComposition(input, signal) : unavailableTool("plan_resume_composition")),
    define(services, meta("review_resume_composition", "审查组装草稿的事实边界、重复、职责强度、段落密度和岗位关键词覆盖；不会写入简历。", "read", false, true, true, ResumeCompositionInputSchema, "resume", "resume_review"), (input, _, signal) => services.reviewResumeComposition ? services.reviewResumeComposition(input, signal) : unavailableTool("review_resume_composition")),
    define(services, meta("compose_resume", "在用户确认组装提案后，将证据图、蓝图、写作和审查结果写入独立 ResumeRevision；不会反向修改 Profile。", "write", true, true, true, ResumeCompositionInputSchema, "resume", "resume_revision", true), (input, operationId, signal) => services.composeResume ? services.composeResume(input, operationId, signal) : unavailableTool("compose_resume")),
    define(services, meta("get_agent_task_context", "读取一个 Agent Session 的工作流、步骤和已选实体指针。", "read", false, true, true, TaskContextInputSchema, "agent", "task_context"), (input, _, signal) => services.getAgentTaskContext ? services.getAgentTaskContext(input, signal) : unavailableTool("get_agent_task_context")),
    define(services, meta("get_agent_runtime_status", "读取一个 Agent Session 当前运行时、回退状态和活动轮次；只读诊断。", "read", false, true, true, TaskContextInputSchema, "agent", "runtime_status"), (input, _, signal) => services.getAgentRuntimeStatus ? services.getAgentRuntimeStatus(input, signal) : unavailableTool("get_agent_runtime_status")),
    define(services, meta("get_agent_current_task", "读取一个 Agent Session 当前任务、阶段、完成状态和缺失槽位；只读诊断。", "read", false, true, true, TaskContextInputSchema, "agent", "current_task"), (input, _, signal) => services.getAgentCurrentTask ? services.getAgentCurrentTask(input, signal) : unavailableTool("get_agent_current_task")),
    define(services, meta("get_agent_last_failure", "读取一个 Agent Session 最近一次运行或工具失败的安全摘要；只读诊断。", "read", false, true, true, TaskContextInputSchema, "agent", "last_failure"), (input, _, signal) => services.getAgentLastFailure ? services.getAgentLastFailure(input, signal) : unavailableTool("get_agent_last_failure")),
    define(services, meta("search_agent_sessions", "按标题、摘要和用户修正检索历史 Agent Session。", "read", false, true, true, SessionSearchInputSchema, "agent", "episodic_memory"), (input, _, signal) => services.searchAgentSessions ? services.searchAgentSessions(input, signal) : unavailableTool("search_agent_sessions")),
    define(services, meta("skills_list", "列出可按需加载的 CareerAdapt 程序性 Skills 元数据。", "read", false, true, true, EmptyInputSchema, "skill", "procedural_memory"), (_, __, signal) => services.skillsList ? services.skillsList(signal) : unavailableTool("skills_list")),
    define(services, meta("skill_view", "读取一个 Skill 的方法或其允许的单个参考文件。", "read", false, true, true, SkillViewInputSchema, "skill", "procedural_memory"), (input, _, signal) => services.skillView ? services.skillView(input, signal) : unavailableTool("skill_view")),
    define(services, meta("prepare_resume_import", "通过本地附件引用解析 PDF、DOCX 或 JSON，并创建可恢复的简历导入核对草稿。不得传入文件二进制或提取文本。", "write", false, true, true, ResumeImportPrepareInputSchema, "resume", "import_draft", true), (input, _, signal) => services.prepareResumeImport ? services.prepareResumeImport(input, signal) : unavailableTool("prepare_resume_import")),
    define(services, meta("review_resume_import", "记录用户对导入草稿不确定内容的明确采用或忽略决定，并推进草稿 revision。", "user_declared", false, true, true, ResumeImportReviewInputSchema, "resume", "import_draft"), (input, _, signal) => services.reviewResumeImport ? services.reviewResumeImport(input, signal) : unavailableTool("review_resume_import")),
    define(services, meta("reconcile_resume_import", "使用确定性 Profile Reconciliation Engine 比对导入草稿与指定已有资料库；只生成计划，不写入 Profile。", "read", false, true, false, ResumeImportReconcileInputSchema, "resume", "import_draft"), (input, _, signal) => services.reconcileResumeImport ? services.reconcileResumeImport(input, signal) : unavailableTool("reconcile_resume_import")),
    define(services, meta("resolve_resume_reconciliation", "记录用户对一个近似重复或真实字段冲突的明确决定；不会直接写入 Profile。", "user_declared", false, true, true, ResumeImportReconciliationResolutionInputSchema, "resume", "import_draft"), (input, _, signal) => services.resolveResumeReconciliation ? services.resolveResumeReconciliation(input, signal) : unavailableTool("resolve_resume_reconciliation")),
    define(services, meta("capture_profile_intake", "将当前访谈回答结构化为可恢复的经历核对草稿；保留 session、message、turn 和原文来源，不写入 CareerProfile。", "write", false, true, true, ProfileIntakeCaptureInputSchema, "profile", "conversation_intake", true, CaptureProfileIntakeToolOutputSchema), (input, _, signal) => services.captureProfileIntake ? services.captureProfileIntake(input, signal) : unavailableTool("capture_profile_intake")),
    define(services, meta("synthesize_profile_intake", "汇总本次访谈全部原始回答与临时结构化事实，生成唯一最终资料草稿；不会写入 CareerProfile。", "write", false, true, true, ProfileIntakeSynthesisInputSchema, "profile", "conversation_intake", true), (input, _, signal) => services.synthesizeProfileIntake ? services.synthesizeProfileIntake(input, signal) : unavailableTool("synthesize_profile_intake")),
    define(services, meta("review_profile_intake", "核对同一个访谈候选，并可用用户明确补充的日期、职责和职业化表达安全更新同一草稿 revision；structuredPatch 必须附补充消息来源。", "user_declared", false, true, true, ProfileIntakeReviewInputSchema, "profile", "conversation_intake"), (input, _, signal) => services.reviewProfileIntake ? services.reviewProfileIntake(input, signal) : unavailableTool("review_profile_intake")),
    define(services, meta("reconcile_profile_intake", "复用 ProfileReconciliationEngine 将访谈草稿与目标资料库对账；只生成计划。", "read", false, true, true, ProfileIntakeReconcileInputSchema, "profile", "profile_reconciliation", true), (input, _, signal) => services.reconcileProfileIntake ? services.reconcileProfileIntake(input, signal) : unavailableTool("reconcile_profile_intake")),
    define(services, meta("resolve_profile_intake_conflict", "记录用户对访谈资料与现有资料冲突的明确决定。", "user_declared", false, true, true, ProfileIntakeConflictInputSchema, "profile", "profile_reconciliation"), (input, _, signal) => services.resolveProfileIntakeConflict ? services.resolveProfileIntakeConflict(input, signal) : unavailableTool("resolve_profile_intake_conflict")),
    define(services, meta("commit_profile_intake", "将已核对、已对账的访谈事实写入绑定的 CareerProfile；不生成简历。", "write", true, true, true, ProfileIntakeCommitInputSchema, "profile", "career_profile", true), (input, operationId, signal) => services.commitProfileIntake ? services.commitProfileIntake(input, operationId, signal) : unavailableTool("commit_profile_intake")),
    define(services, meta("ensure_general_resume_from_profile", "在 Profile 已提交后创建或同步同一 Profile 的通用简历 Revision；不会创建重复通用简历。", "write", true, true, true, EnsureGeneralResumeInputSchema, "resume", "resume_revision", true), (input, operationId, signal) => services.ensureGeneralResumeFromProfile ? services.ensureGeneralResumeFromProfile(input, operationId, signal) : unavailableTool("ensure_general_resume_from_profile")),
    // Compatibility-only tools. Canonical workflow eligibility never exposes these to planning.
    define(services, meta("parse_resume_file", "兼容旧版纯文本导入；不可用于 PDF/DOCX/JSON 的 canonical Agent 导入。", "read", false, true, true, ResumeFileInputSchema, "resume", "import_source"), (input, _, signal) => services.parseResumeFile(input, signal)),
    define(services, meta("create_resume_import_draft", "兼容旧版已构建 draft 保存；canonical Agent 导入必须使用 prepare_resume_import。", "write", false, true, true, ResumeDraftInputSchema, "resume", "import_draft", true), (input, _, signal) => services.createResumeImportDraft(input, signal)),
    define(services, meta("commit_resume_import", "确认导入草稿并创建资料及简历版本。", "write", true, true, true, ResumeCommitInputSchema, "resume", "career_profile", true), (input, operationId, signal) => services.commitResumeImport(input, operationId, signal)),
    define(services, meta("parse_job_description", "解析岗位描述并生成岗位语义图。", "read", false, true, true, JobParseInputSchema, "job", "job_draft", true), (input, operationId, signal) => services.parseJobDescription(input, operationId, signal)),
    define(services, meta("commit_job", "确认并保存岗位。", "write", true, true, true, JobCommitInputSchema, "job", "job_detail", true), (input, operationId, signal) => services.commitJob(input, operationId, signal)),
    define(services, meta("analyze_job_fit", "分析简历与岗位的匹配情况。", "read", false, true, true, EntitySelectionSchema, "analysis", "career_assets", true), (input, operationId, signal) => services.analyzeJobFit(input, operationId, signal)),
    define(services, meta("create_tailoring_session", "基于现有简历和岗位创建改写计划。", "read", false, true, true, TailoringSessionInputSchema, "tailoring", "career_assets", true), (input, operationId, signal) => services.createTailoringSession(input, operationId, signal)),
    define(services, meta("answer_tailoring_question", "记录用户对当前改写澄清问题的回答；只修改当前定制会话。", "user_declared", false, true, true, TailoringQuestionInputSchema, "tailoring", "tailoring_session"), (input, operationId, signal) => services.answerTailoringQuestion(input, operationId, signal)),
    define(services, meta("generate_tailoring_changes", "汇总已冻结的岗位上下文与全部回答，一次生成最终修改建议。", "read", false, true, true, GenerateTailoringChangesInputSchema, "tailoring", "career_assets", true), (input, operationId, signal) => services.generateTailoringChanges ? services.generateTailoringChanges(input, operationId, signal) : unavailableTool("generate_tailoring_changes")),
    define(services, meta("review_tailoring_diff", "记录一项定制修改的采用、编辑或忽略决定。", "user_declared", false, true, true, ReviewTailoringDiffInputSchema, "tailoring", "tailoring_session"), (input, operationId, signal) => services.reviewTailoringDiff ? services.reviewTailoringDiff(input, operationId, signal) : unavailableTool("review_tailoring_diff")),
    define(services, meta("preview_tailoring_changes", "校验并预览将要应用的改写差异。", "read", false, true, true, TailoringChangesInputSchema, "tailoring", "resume_preview", true), (input, operationId, signal) => services.previewTailoringChanges(input, operationId, signal)),
    define(services, meta("apply_tailoring_changes", "应用已确认的改写并创建新版本。", "write", true, true, true, TailoringChangesInputSchema, "tailoring", "resume_revision", true), (input, operationId, signal) => services.applyTailoringChanges(input, operationId, signal)),
    define(services, meta("archive_resume", "归档一份当前处于 active 状态的精确简历；不会删除内容。", "write", true, true, true, ResumeLifecycleInputSchema, "resume", "resume_lifecycle"), (input, operationId, signal) => services.archiveResume ? services.archiveResume(input, operationId, signal) : unavailableTool("archive_resume")),
    define(services, meta("restore_resume", "将一份已归档简历恢复为 active 状态。", "write", true, true, true, ResumeLifecycleInputSchema, "resume", "resume_lifecycle"), (input, operationId, signal) => services.restoreResume ? services.restoreResume(input, operationId, signal) : unavailableTool("restore_resume")),
    define(services, meta("export_resume", "为指定简历创建 PDF 导出入口。", "write", false, true, true, ExportInputSchema, "export", "resume_export", true), (input, operationId, signal) => services.exportResume(input, operationId, signal))
  ] as AgentToolDefinition[];

  return new AgentToolRegistry(tools);
}

function meta<TInput>(
  name: string,
  description: string,
  risk: AgentToolDefinition["risk"],
  requiresConfirmation: boolean,
  idempotent: boolean,
  resumable: boolean,
  inputSchema: z.ZodType<TInput>,
  category: string,
  dataScope: string,
  producesArtifact = false,
  outputSchema: z.ZodType = OperationOutputSchema
) {
  return { name, description, risk, requiresConfirmation, idempotent, resumable, category, dataScope, producesArtifact, external: false, inputSchema, outputSchema };
}

function unavailableTool(name: string): Promise<never> {
  return Promise.reject(Object.assign(new Error(`Agent tool service is unavailable: ${name}`), { code: "agent_tool_service_unavailable" }));
}

export class AgentToolRegistry {
  private readonly byName: Map<string, AgentToolDefinition>;

  constructor(tools: AgentToolDefinition[]) {
    this.byName = new Map(tools.map((tool) => [tool.name, tool]));
    if (this.byName.size !== tools.length) throw new Error("duplicate_agent_tool");
  }

  list() {
    return [...this.byName.values()];
  }

  require(name: string) {
    const tool = this.byName.get(name);
    if (!tool) throw Object.assign(new Error(`Unknown agent tool: ${name}`), { code: "unknown_agent_tool" });
    return tool;
  }

  manifest() {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      requiresConfirmation: tool.requiresConfirmation,
      idempotent: tool.idempotent,
      resumable: tool.resumable,
      category: tool.category ?? "general",
      dataScope: tool.dataScope ?? "unspecified",
      producesArtifact: tool.producesArtifact ?? false,
      external: tool.external ?? false,
      inputSchema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
      outputSchema: z.toJSONSchema(tool.outputSchema) as Record<string, unknown>
    }));
  }

  async mergeExternal(provider: ExternalToolProvider) {
    const external = await provider.listTools();
    const wrapped = external.map((tool) => ({
      ...tool,
      external: true,
      execute: async (input: unknown, context: { operationId: string; signal?: AbortSignal }) =>
        provider.execute(tool.name, input, context.operationId, context.signal)
    }));
    return new AgentToolRegistry([...this.list(), ...wrapped]);
  }

  async execute(name: string, rawInput: unknown, operationId: string, signal?: AbortSignal): Promise<AgentToolResult> {
    const tool = this.require(name);
    let input: unknown;
    try {
      input = tool.inputSchema.parse(rawInput);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          ok: false,
          operationId,
          toolName: name,
          error: {
            code: "tool_input_invalid",
            message: "当前访谈状态不完整，未执行资料整理。现有输入已保留。",
            retryable: false,
            details: {
              fields: error.issues.map((issue) => issue.path.length ? issue.path.join(".") : "$")
            }
          },
          artifactIds: [],
          completedAt: new Date().toISOString()
        };
      }
      throw error;
    }
    try {
      const output = tool.outputSchema.parse(await tool.execute(input, { operationId, signal }));
      return {
        ok: true,
        operationId,
        toolName: name,
        data: output,
        artifactIds: tool.producesArtifact ? [`agent-artifact-${name}-${operationId}`] : [],
        completedAt: new Date().toISOString()
      };
    } catch (error) {
      const code = safeToolErrorCode(error);
      return {
        ok: false,
        operationId,
        toolName: name,
        error: {
          code,
          message: safeToolErrorMessage(code),
          retryable: isRetryableToolError(code)
        },
        artifactIds: [],
        completedAt: new Date().toISOString()
      };
    }
  }
}

function safeToolErrorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  if (error instanceof Error) {
    const messageCode = error.message.match(/^(?:profile|resume|tool|agent|revision|version|tailoring|unsupported|unknown|provider|operation|source|invalid|network|timeout)[a-z0-9_]*(?::|$)/i)?.[0];
    if (messageCode) return messageCode.replace(/:$/, "");
  }
  return "tool_execution_failed";
}

function safeToolErrorMessage(code: string) {
  if (code === "tool_execution_failed") return "工具执行没有完成。";
  return `工具执行未完成（${code}）。`;
}

function isRetryableToolError(code: string) {
  return /temporar|timeout|network|unavailable|provider_http_(408|429|5\d\d)/i.test(code);
}

export const agentToolNames = [
  "list_resumes", "list_profiles", "list_jobs", "get_active_profile", "get_profile", "search_profile_facts",
  "get_resume", "get_resume_revision", "get_job", "get_agent_task_context", "get_agent_runtime_status", "get_agent_current_task", "get_agent_last_failure", "search_agent_sessions",
  "recommend_resume_source",
  "skills_list", "skill_view", "prepare_resume_import", "review_resume_import", "reconcile_resume_import",
  "resolve_resume_reconciliation", "parse_resume_file", "create_resume_import_draft",
  "capture_profile_intake", "synthesize_profile_intake", "review_profile_intake", "reconcile_profile_intake",
  "resolve_profile_intake_conflict", "commit_profile_intake", "ensure_general_resume_from_profile", "build_resume_evidence_graph", "plan_resume_composition", "review_resume_composition", "compose_resume",
  "commit_resume_import", "parse_job_description", "commit_job", "create_job_resume_from_profile", "create_resume_from_profile", "analyze_job_fit",
  "create_tailoring_session", "answer_tailoring_question", "generate_tailoring_changes", "review_tailoring_diff", "preview_tailoring_changes",
  "apply_tailoring_changes", "archive_resume", "restore_resume", "export_resume"
] as const;
