import { z } from "zod";
import type { AgentToolDefinition, AgentToolResult } from "../contracts/agentTool";

const OperationOutputSchema = z.object({ operationId: z.string().min(8) }).passthrough();
const EmptyInputSchema = z.object({}).strict();

export type AgentToolServices = {
  listResumes(signal?: AbortSignal): Promise<unknown>;
  listProfiles(signal?: AbortSignal): Promise<unknown>;
  listJobs(signal?: AbortSignal): Promise<unknown>;
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
    define(services, meta("list_resumes", "列出可用简历摘要。", "read", false, true, true, EmptyInputSchema), (_, __, signal) => services.listResumes(signal)),
    define(services, meta("list_profiles", "列出个人资料库摘要。", "read", false, true, true, EmptyInputSchema), (_, __, signal) => services.listProfiles(signal)),
    define(services, meta("list_jobs", "列出已保存岗位摘要。", "read", false, true, true, EmptyInputSchema), (_, __, signal) => services.listJobs(signal)),
    define(services, meta("parse_resume_file", "解析已在浏览器读取的简历文件文本。", "read", false, true, true, ResumeFileInputSchema), (input, _, signal) => services.parseResumeFile(input, signal)),
    define(services, meta("create_resume_import_draft", "创建带来源证据的简历导入核对草稿。", "write", false, true, true, ResumeDraftInputSchema), (input, _, signal) => services.createResumeImportDraft(input, signal)),
    define(services, meta("commit_resume_import", "确认导入草稿并创建资料及简历版本。", "write", true, true, true, ResumeCommitInputSchema), (input, operationId, signal) => services.commitResumeImport(input, operationId, signal)),
    define(services, meta("parse_job_description", "解析岗位描述并生成岗位语义图。", "read", false, true, true, JobParseInputSchema), (input, operationId, signal) => services.parseJobDescription(input, operationId, signal)),
    define(services, meta("commit_job", "确认并保存岗位。", "write", true, true, true, JobCommitInputSchema), (input, operationId, signal) => services.commitJob(input, operationId, signal)),
    define(services, meta("analyze_job_fit", "分析简历与岗位的匹配情况。", "read", false, true, true, EntitySelectionSchema), (input, operationId, signal) => services.analyzeJobFit(input, operationId, signal)),
    define(services, meta("create_tailoring_session", "基于现有简历和岗位创建改写计划。", "read", false, true, true, TailoringSessionInputSchema), (input, operationId, signal) => services.createTailoringSession(input, operationId, signal)),
    define(services, meta("answer_tailoring_question", "记录用户对改写澄清问题的回答。", "user_declared", true, true, true, TailoringQuestionInputSchema), (input, operationId, signal) => services.answerTailoringQuestion(input, operationId, signal)),
    define(services, meta("preview_tailoring_changes", "校验并预览将要应用的改写差异。", "read", false, true, true, TailoringChangesInputSchema), (input, operationId, signal) => services.previewTailoringChanges(input, operationId, signal)),
    define(services, meta("apply_tailoring_changes", "应用已确认的改写并创建新版本。", "write", true, true, true, TailoringChangesInputSchema), (input, operationId, signal) => services.applyTailoringChanges(input, operationId, signal)),
    define(services, meta("export_resume", "为指定简历创建 PDF 导出入口。", "write", false, true, true, ExportInputSchema), (input, operationId, signal) => services.exportResume(input, operationId, signal))
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
  inputSchema: z.ZodType<TInput>
) {
  return { name, description, risk, requiresConfirmation, idempotent, resumable, inputSchema, outputSchema: OperationOutputSchema };
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
      inputSchema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>
    }));
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
  "list_resumes", "list_profiles", "list_jobs", "parse_resume_file", "create_resume_import_draft",
  "commit_resume_import", "parse_job_description", "commit_job", "analyze_job_fit",
  "create_tailoring_session", "answer_tailoring_question", "preview_tailoring_changes",
  "apply_tailoring_changes", "export_resume"
] as const;
