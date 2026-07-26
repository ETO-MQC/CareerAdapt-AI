import { z } from "zod";
import type { AgentToolDefinition, AgentToolResult } from "../contracts/agentTool";
import type { ExternalToolProvider } from "./externalToolProvider";

const OperationOutputSchema = z.object({ operationId: z.string().min(8) }).passthrough();
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
  getAgentTaskContext?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  searchAgentSessions?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  skillsList?(signal?: AbortSignal): Promise<unknown>;
  skillView?(input: unknown, signal?: AbortSignal): Promise<unknown>;
  parseResumeFile(input: unknown, signal?: AbortSignal): Promise<unknown>;
  createResumeImportDraft(input: unknown, signal?: AbortSignal): Promise<unknown>;
  commitResumeImport(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  parseJobDescription(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  commitJob(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  analyzeJobFit(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  createTailoringSession(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  answerTailoringQuestion(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  previewTailoringChanges(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  applyTailoringChanges(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
  exportResume(input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
};

const ResumeFileInputSchema = z.object({
  fileName: z.string().min(1).max(240),
  mimeType: z.enum(["text/plain", "application/json", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  text: z.string().min(1).max(200_000)
}).strict();

const ResumeDraftInputSchema = z.object({
  parsedResume: z.unknown()
}).strict();

const ResumeCommitInputSchema = z.object({
  importId: z.string().min(1),
  expectedDraftRevision: z.number().int().min(0),
  target: z.union([
    z.object({ mode: z.literal("existing"), profileId: z.string().min(1) }).strict(),
    z.object({ mode: z.literal("new"), profileName: z.string().min(1).max(120), createGeneralResume: z.literal(true) }).strict()
  ]).optional()
}).strict();

const JobParseInputSchema = z.object({
  title: z.string().min(1).max(160),
  company: z.string().min(1).max(160),
  rawText: z.string().min(20).max(24_000)
}).strict();

const JobCommitInputSchema = JobParseInputSchema.extend({
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
const RevisionInputSchema = z.object({ resumeId: z.string().min(1), revisionId: z.string().min(1).optional() }).strict();
const JobIdInputSchema = z.object({ jobId: z.string().min(1) }).strict();
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
    define(services, meta("get_agent_task_context", "读取一个 Agent Session 的工作流、步骤和已选实体指针。", "read", false, true, true, TaskContextInputSchema, "agent", "task_context"), (input, _, signal) => services.getAgentTaskContext ? services.getAgentTaskContext(input, signal) : unavailableTool("get_agent_task_context")),
    define(services, meta("search_agent_sessions", "按标题、摘要和用户修正检索历史 Agent Session。", "read", false, true, true, SessionSearchInputSchema, "agent", "episodic_memory"), (input, _, signal) => services.searchAgentSessions ? services.searchAgentSessions(input, signal) : unavailableTool("search_agent_sessions")),
    define(services, meta("skills_list", "列出可按需加载的 CareerAdapt 程序性 Skills 元数据。", "read", false, true, true, EmptyInputSchema, "skill", "procedural_memory"), (_, __, signal) => services.skillsList ? services.skillsList(signal) : unavailableTool("skills_list")),
    define(services, meta("skill_view", "读取一个 Skill 的方法或其允许的单个参考文件。", "read", false, true, true, SkillViewInputSchema, "skill", "procedural_memory"), (input, _, signal) => services.skillView ? services.skillView(input, signal) : unavailableTool("skill_view")),
    define(services, meta("parse_resume_file", "解析已在浏览器读取的简历文件文本。", "read", false, true, true, ResumeFileInputSchema, "resume", "import_source"), (input, _, signal) => services.parseResumeFile(input, signal)),
    define(services, meta("create_resume_import_draft", "创建带来源证据的简历导入核对草稿。", "write", false, true, true, ResumeDraftInputSchema, "resume", "import_draft", true), (input, _, signal) => services.createResumeImportDraft(input, signal)),
    define(services, meta("commit_resume_import", "确认导入草稿并创建资料及简历版本。", "write", true, true, true, ResumeCommitInputSchema, "resume", "career_profile", true), (input, operationId, signal) => services.commitResumeImport(input, operationId, signal)),
    define(services, meta("parse_job_description", "解析岗位描述并生成岗位语义图。", "read", false, true, true, JobParseInputSchema, "job", "job_draft", true), (input, operationId, signal) => services.parseJobDescription(input, operationId, signal)),
    define(services, meta("commit_job", "确认并保存岗位。", "write", true, true, true, JobCommitInputSchema, "job", "job_detail", true), (input, operationId, signal) => services.commitJob(input, operationId, signal)),
    define(services, meta("analyze_job_fit", "分析简历与岗位的匹配情况。", "read", false, true, true, EntitySelectionSchema, "analysis", "career_assets", true), (input, operationId, signal) => services.analyzeJobFit(input, operationId, signal)),
    define(services, meta("create_tailoring_session", "基于现有简历和岗位创建改写计划。", "read", false, true, true, TailoringSessionInputSchema, "tailoring", "career_assets", true), (input, operationId, signal) => services.createTailoringSession(input, operationId, signal)),
    define(services, meta("answer_tailoring_question", "记录用户对改写澄清问题的回答。", "user_declared", true, true, true, TailoringQuestionInputSchema, "tailoring", "user_declared_fact"), (input, operationId, signal) => services.answerTailoringQuestion(input, operationId, signal)),
    define(services, meta("preview_tailoring_changes", "校验并预览将要应用的改写差异。", "read", false, true, true, TailoringChangesInputSchema, "tailoring", "resume_preview", true), (input, operationId, signal) => services.previewTailoringChanges(input, operationId, signal)),
    define(services, meta("apply_tailoring_changes", "应用已确认的改写并创建新版本。", "write", true, true, true, TailoringChangesInputSchema, "tailoring", "resume_revision", true), (input, operationId, signal) => services.applyTailoringChanges(input, operationId, signal)),
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
  producesArtifact = false
) {
  return { name, description, risk, requiresConfirmation, idempotent, resumable, category, dataScope, producesArtifact, external: false, inputSchema, outputSchema: OperationOutputSchema };
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
    const input = tool.inputSchema.parse(rawInput);
    try {
      const output = tool.outputSchema.parse(await tool.execute(input, { operationId, signal }));
      return {
        ok: true,
        operationId,
        toolName: name,
        data: output,
        artifactIds: [],
        completedAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        ok: false,
        operationId,
        toolName: name,
        error: {
          code: typeof error === "object" && error && "code" in error ? String(error.code) : "tool_execution_failed",
          message: error instanceof Error ? error.message : "Tool execution failed.",
          retryable: false
        },
        artifactIds: [],
        completedAt: new Date().toISOString()
      };
    }
  }
}

export const agentToolNames = [
  "list_resumes", "list_profiles", "list_jobs", "get_active_profile", "get_profile", "search_profile_facts",
  "get_resume", "get_resume_revision", "get_job", "get_agent_task_context", "search_agent_sessions",
  "skills_list", "skill_view", "parse_resume_file", "create_resume_import_draft",
  "commit_resume_import", "parse_job_description", "commit_job", "analyze_job_fit",
  "create_tailoring_session", "answer_tailoring_question", "preview_tailoring_changes",
  "apply_tailoring_changes", "export_resume"
] as const;
