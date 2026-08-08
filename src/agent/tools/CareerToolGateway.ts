import { nanoid } from "nanoid";
import { z } from "zod";
import type { AgentToolResult } from "../contracts/agentTool";
import { AgentConfirmationRequiredError, AgentExecutor } from "../runtime/agentExecutor";
import { AgentToolRegistry } from "./registry";
import type { CareerSessionBinding } from "../runtime/careerSessionBinding";

export type CareerToolReadWrite = "read" | "write";
export type CareerToolConfirmationPolicy = "none" | "user_confirmation" | "destructive_confirmation";
export type CareerToolIdempotencyKeyPolicy = "none" | "operation_id";
export type CareerToolPersonProfileBinding = "none" | "optional" | "required";
export type CareerToolArtifactBehavior = "none" | "produces_artifact";
export type CareerToolSafetyClass = "READ" | "SAFE_WRITE" | "CONFIRMATION_WRITE" | "DESTRUCTIVE";

export type ArtifactRef = {
  id: string;
  kind: "tool_result";
  toolName: string;
  sourceToolName: string;
};

export type OperationReceipt = {
  operationId: string;
  toolName: string;
  idempotencyKey?: string;
  status: "completed" | "failed" | "confirmation_required";
  completedAt: string;
};

export type CareerToolErrorCategory =
  | "validation"
  | "not_found"
  | "conflict"
  | "stale_revision"
  | "permission"
  | "provider"
  | "recoverable"
  | "internal";

export type CareerToolError = {
  code: string;
  category: CareerToolErrorCategory;
  message: string;
  recoverable: boolean;
  retryHint?: string;
};

export type CareerToolResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: CareerToolError;
  artifacts: ArtifactRef[];
  receipt: OperationReceipt;
};

export type CareerToolContract = {
  name: string;
  description: string;
  sourceToolName: string;
  namespace: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  readWrite: CareerToolReadWrite;
  safetyClass: CareerToolSafetyClass;
  confirmationPolicy: CareerToolConfirmationPolicy;
  idempotencyKeyPolicy: CareerToolIdempotencyKeyPolicy;
  personProfileBinding: CareerToolPersonProfileBinding;
  artifactBehavior: CareerToolArtifactBehavior;
  errorTaxonomy: CareerToolErrorCategory[];
};

export type CareerToolExecutionContext = {
  operationId?: string;
  signal?: AbortSignal;
  confirmed?: boolean;
  confirmationCount?: number;
  /** Immutable context selected by the user for this Agent Session. */
  careerSessionBinding?: CareerSessionBinding;
  /** Hermes/MCP callers must set this; legacy native tests may omit it. */
  requireSessionBinding?: boolean;
};

export type CareerSessionBindingVerification = {
  valid: boolean;
  code?: string;
  message?: string;
};

type CareerToolGatewayDependencies = {
  registry: AgentToolRegistry;
  executor?: AgentExecutor;
  verifySessionBinding?: (
    binding: CareerSessionBinding,
    input: unknown,
    signal?: AbortSignal,
    contract?: CareerToolContract
  ) => Promise<CareerSessionBindingVerification>;
};

type CareerToolDefinition = {
  name: string;
  sourceToolName: string;
  namespace: string;
  readWrite: CareerToolReadWrite;
  personProfileBinding: CareerToolPersonProfileBinding;
};

const CAREER_TOOL_DEFINITIONS: CareerToolDefinition[] = [
  { name: "career.profile.list", sourceToolName: "list_profiles", namespace: "career.profile", readWrite: "read", personProfileBinding: "none" },
  { name: "career.profile.active", sourceToolName: "get_active_profile", namespace: "career.profile", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.profile.get", sourceToolName: "get_profile", namespace: "career.profile", readWrite: "read", personProfileBinding: "required" },
  { name: "career.profile.search_facts", sourceToolName: "search_profile_facts", namespace: "career.profile", readWrite: "read", personProfileBinding: "required" },
  { name: "career.profile.capture_intake", sourceToolName: "capture_profile_intake", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },
  { name: "career.profile.synthesize_intake", sourceToolName: "synthesize_profile_intake", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },
  { name: "career.profile.review_intake", sourceToolName: "review_profile_intake", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },
  { name: "career.profile.reconcile_intake", sourceToolName: "reconcile_profile_intake", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },
  { name: "career.profile.resolve_intake_conflict", sourceToolName: "resolve_profile_intake_conflict", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },
  { name: "career.profile.commit_intake", sourceToolName: "commit_profile_intake", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },

  { name: "career.resume.list", sourceToolName: "list_resumes", namespace: "career.resume", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.resume.get", sourceToolName: "get_resume", namespace: "career.resume", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.resume.get_revision", sourceToolName: "get_resume_revision", namespace: "career.resume", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.resume.recommend_source", sourceToolName: "recommend_resume_source", namespace: "career.resume", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.resume.create_from_profile", sourceToolName: "create_resume_from_profile", namespace: "career.resume", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.create_job_from_profile", sourceToolName: "create_job_resume_from_profile", namespace: "career.resume", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.ensure_general_from_profile", sourceToolName: "ensure_general_resume_from_profile", namespace: "career.resume", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.import.prepare", sourceToolName: "prepare_resume_import", namespace: "career.resume.import", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.resume.import.parse_file", sourceToolName: "parse_resume_file", namespace: "career.resume.import", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.resume.import.create_draft", sourceToolName: "create_resume_import_draft", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "optional" },
  { name: "career.resume.import.review", sourceToolName: "review_resume_import", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "optional" },
  { name: "career.resume.import.reconcile", sourceToolName: "reconcile_resume_import", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.import.resolve_reconciliation", sourceToolName: "resolve_resume_reconciliation", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.import.commit", sourceToolName: "commit_resume_import", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.archive", sourceToolName: "archive_resume", namespace: "career.resume", readWrite: "write", personProfileBinding: "optional" },
  { name: "career.resume.restore", sourceToolName: "restore_resume", namespace: "career.resume", readWrite: "write", personProfileBinding: "optional" },

  { name: "career.job.list", sourceToolName: "list_jobs", namespace: "career.job", readWrite: "read", personProfileBinding: "none" },
  { name: "career.job.get", sourceToolName: "get_job", namespace: "career.job", readWrite: "read", personProfileBinding: "none" },
  { name: "career.job.parse", sourceToolName: "parse_job_description", namespace: "career.job", readWrite: "write", personProfileBinding: "none" },
  { name: "career.job.commit", sourceToolName: "commit_job", namespace: "career.job", readWrite: "write", personProfileBinding: "none" },
  { name: "career.job.analyze_fit", sourceToolName: "analyze_job_fit", namespace: "career.job", readWrite: "read", personProfileBinding: "required" },

  { name: "career.tailoring.create_session", sourceToolName: "create_tailoring_session", namespace: "career.tailoring", readWrite: "write", personProfileBinding: "required" },
  { name: "career.tailoring.answer_question", sourceToolName: "answer_tailoring_question", namespace: "career.tailoring", readWrite: "write", personProfileBinding: "required" },
  { name: "career.tailoring.generate_changes", sourceToolName: "generate_tailoring_changes", namespace: "career.tailoring", readWrite: "write", personProfileBinding: "required" },
  { name: "career.tailoring.review_diff", sourceToolName: "review_tailoring_diff", namespace: "career.tailoring", readWrite: "write", personProfileBinding: "required" },
  { name: "career.tailoring.preview_changes", sourceToolName: "preview_tailoring_changes", namespace: "career.tailoring", readWrite: "read", personProfileBinding: "required" },
  { name: "career.tailoring.apply_changes", sourceToolName: "apply_tailoring_changes", namespace: "career.tailoring", readWrite: "write", personProfileBinding: "required" },
  { name: "career.preview.review_diff", sourceToolName: "review_tailoring_diff", namespace: "career.preview", readWrite: "write", personProfileBinding: "required" },
  { name: "career.preview.apply_changes", sourceToolName: "apply_tailoring_changes", namespace: "career.preview", readWrite: "write", personProfileBinding: "required" },
  { name: "career.export.resume", sourceToolName: "export_resume", namespace: "career.export", readWrite: "write", personProfileBinding: "optional" }
];

export class CareerToolGateway {
  private readonly byName = new Map(CAREER_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

  constructor(
    private readonly dependencies: CareerToolGatewayDependencies | AgentToolRegistry
  ) {}

  listContracts(): CareerToolContract[] {
    return CAREER_TOOL_DEFINITIONS
      .filter((definition) => this.hasSourceTool(definition.sourceToolName))
      .map((definition) => this.toContract(definition));
  }

  getContract(name: string): CareerToolContract {
    const definition = this.byName.get(name);
    if (!definition) throw Object.assign(new Error(`Unknown Career tool: ${name}`), { code: "unknown_career_tool" });
    if (!this.hasSourceTool(definition.sourceToolName)) {
      throw Object.assign(new Error(`Career tool is unavailable: ${name}`), { code: "career_tool_unavailable" });
    }
    return this.toContract(definition);
  }

  getStableNameForSource(sourceToolName: string) {
    return CAREER_TOOL_DEFINITIONS.find((definition) => definition.sourceToolName === sourceToolName)?.name;
  }

  /**
   * Native AgentKernel/AgentHost calls use source tool names for compatibility,
   * but still cross the same Career domain boundary as Hermes calls.  The
   * wrapper preserves AgentExecutor's confirmation exception contract while
   * delegating the actual operation to this gateway.
   */
  async executeForAgent(
    sourceToolName: string,
    input: unknown,
    context: CareerToolExecutionContext = {}
  ): Promise<AgentToolResult> {
    const stableName = this.getStableNameForSource(sourceToolName);
    if (!stableName) {
      const executor = this.asDependencies().executor;
      if (executor) {
        return executor.execute({
          toolName: sourceToolName,
          toolInput: input,
          operationId: normalizeOperationId(context.operationId),
          signal: context.signal,
          confirmed: context.confirmed,
          confirmationCount: context.confirmationCount,
          careerSessionBinding: context.careerSessionBinding,
          requireSessionBinding: context.requireSessionBinding
        });
      }
      return this.asDependencies().registry.execute(sourceToolName, input, normalizeOperationId(context.operationId), context.signal);
    }
    const tool = this.asDependencies().registry.require(sourceToolName);
    const confirmationCount = context.confirmationCount ?? (context.confirmed ? 1 : 0);
    const requiredConfirmations = tool.risk === "destructive" ? 2 : tool.requiresConfirmation ? 1 : 0;
    if (confirmationCount < requiredConfirmations) {
      throw new AgentConfirmationRequiredError({
        id: `confirmation-${normalizeOperationId(context.operationId)}`,
        operationId: normalizeOperationId(context.operationId),
        toolName: sourceToolName,
        title: "确认执行 Career 工具",
        description: tool.description,
        destructive: tool.risk === "destructive",
        status: "pending",
        requestedAt: new Date().toISOString()
      });
    }
    const result = await this.execute(stableName, input, context);
    return {
      ok: result.ok,
      operationId: result.receipt.operationId,
      toolName: sourceToolName,
      ...(result.ok ? { data: result.data } : {
        error: {
          code: result.error?.code ?? "career_tool_failed",
          message: result.error?.message ?? "工具执行没有完成。",
          retryable: result.error?.recoverable ?? false
        }
      }),
      artifactIds: result.artifacts.map((artifact) => artifact.id),
      completedAt: result.receipt.completedAt
    };
  }

  async execute<T = unknown>(
    name: string,
    input: unknown,
    context: CareerToolExecutionContext = {}
  ): Promise<CareerToolResult<T>> {
    const operationId = normalizeOperationId(context.operationId);
    const definition = this.byName.get(name);
    if (!definition || !this.hasSourceTool(definition.sourceToolName)) {
      return this.failure(name, operationId, "unknown_career_tool", "当前 Career 工具不可用。", false);
    }
    try {
      const contract = this.toContract(definition);
      const bindingError = await this.verifyExecutionBinding(contract, input, context);
      if (bindingError) return this.failure(name, operationId, bindingError.code, bindingError.message, false);
      const raw = await this.executeSourceTool(definition.sourceToolName, input, operationId, context);
      return this.mapResult<T>(name, definition, raw, context.careerSessionBinding);
    } catch (error) {
      if (error instanceof AgentConfirmationRequiredError) {
        return this.failure(name, operationId, error.code, "这项操作需要你的明确确认后才能继续。", false, "请确认后重试。", "confirmation_required");
      }
      const code = errorCode(error);
      return this.failure(name, operationId, code, error instanceof Error ? error.message : "工具执行没有完成。", isRecoverable(code));
    }
  }

  private async executeSourceTool(
    sourceToolName: string,
    input: unknown,
    operationId: string,
    context: CareerToolExecutionContext
  ): Promise<AgentToolResult> {
    const executor = this.asDependencies().executor;
    if (executor) {
      return executor.execute({
        toolName: sourceToolName,
        toolInput: input,
        operationId,
        signal: context.signal,
        confirmed: context.confirmed,
        confirmationCount: context.confirmationCount,
        careerSessionBinding: context.careerSessionBinding,
        requireSessionBinding: context.requireSessionBinding
      });
    }
    return this.asDependencies().registry.execute(sourceToolName, input, operationId, context.signal);
  }

  private mapResult<T>(
    name: string,
    definition: CareerToolDefinition,
    raw: AgentToolResult,
    binding?: CareerSessionBinding
  ): CareerToolResult<T> {
    const receipt: OperationReceipt = {
      operationId: raw.operationId,
      toolName: name,
      ...(definition.readWrite === "write" ? { idempotencyKey: raw.operationId } : {}),
      status: raw.ok ? "completed" : "failed",
      completedAt: raw.completedAt
    };
    if (raw.ok) {
      const resultMismatch = boundResultMismatch(name, raw.data, binding);
      if (resultMismatch) {
        return this.failure(name, raw.operationId, resultMismatch.code, resultMismatch.message, false);
      }
      const data = filterBoundResult(name, raw.data, binding);
      return {
        ok: true,
        data: data as T,
        artifacts: (raw.artifactIds ?? []).map((id) => ({
          id,
          kind: "tool_result" as const,
          toolName: name,
          sourceToolName: definition.sourceToolName
        })),
        receipt
      };
    }
    const code = raw.error?.code ?? "career_tool_failed";
    return {
      ok: false,
      error: toCareerToolError(code, raw.error?.message ?? "工具执行没有完成。", raw.error?.retryable ?? false),
      artifacts: [],
      receipt
    };
  }

  private async verifyExecutionBinding(
    contract: CareerToolContract,
    input: unknown,
    context: CareerToolExecutionContext
  ): Promise<{ code: string; message: string } | undefined> {
    const binding = context.careerSessionBinding;
    if (context.requireSessionBinding && !binding) {
      return {
        code: "career_session_binding_required",
        message: "当前 Hermes 任务缺少固定的人物与资料版本，未执行 Career 工具。"
      };
    }
    if (!binding) return undefined;
    const inputMismatch = bindingInputMismatch(input, binding);
    if (inputMismatch) return inputMismatch;
    const verifier = this.asDependencies().verifySessionBinding;
    if (!verifier) return undefined;
    const verification = await verifier(binding, input, context.signal, contract);
    if (verification.valid) return undefined;
    return {
      code: verification.code ?? "career_session_binding_invalid",
      message: verification.message ?? "当前人物或资料版本已变化，未执行 Career 工具。"
    };
  }

  private failure(
    name: string,
    operationId: string,
    code: string,
    message: string,
    recoverable: boolean,
    retryHint?: string,
    status: OperationReceipt["status"] = "failed"
  ): CareerToolResult<never> {
    return {
      ok: false,
      error: { code, category: categoryForCode(code), message, recoverable, ...(retryHint ? { retryHint } : {}) },
      artifacts: [],
      receipt: {
        operationId,
        toolName: name,
        status,
        completedAt: new Date().toISOString()
      }
    };
  }

  private toContract(definition: CareerToolDefinition): CareerToolContract {
    const tool = this.asDependencies().registry.require(definition.sourceToolName);
    const confirmationPolicy: CareerToolConfirmationPolicy = tool.risk === "destructive"
      ? "destructive_confirmation"
      : tool.requiresConfirmation ? "user_confirmation" : "none";
    const safetyClass: CareerToolSafetyClass = tool.risk === "destructive"
      ? "DESTRUCTIVE"
      : definition.readWrite === "read"
        ? "READ"
        : tool.requiresConfirmation
          ? "CONFIRMATION_WRITE"
          : "SAFE_WRITE";
    return {
      name: definition.name,
      description: tool.description,
      sourceToolName: definition.sourceToolName,
      namespace: definition.namespace,
      inputSchema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
      outputSchema: z.toJSONSchema(tool.outputSchema) as Record<string, unknown>,
      readWrite: definition.readWrite,
      safetyClass,
      confirmationPolicy,
      idempotencyKeyPolicy: definition.readWrite === "write" ? "operation_id" : "none",
      personProfileBinding: definition.personProfileBinding,
      artifactBehavior: tool.producesArtifact ? "produces_artifact" : "none",
      errorTaxonomy: ["validation", "not_found", "conflict", "stale_revision", "permission", "provider", "recoverable", "internal"]
    };
  }

  private hasSourceTool(name: string) {
    try {
      this.asDependencies().registry.require(name);
      return true;
    } catch {
      return false;
    }
  }

  private asDependencies() {
    return this.dependencies instanceof AgentToolRegistry
      ? { registry: this.dependencies } satisfies CareerToolGatewayDependencies
      : this.dependencies;
  }
}

export class CareerToolGatewayExecutor extends AgentExecutor {
  constructor(
    registry: AgentToolRegistry,
    private readonly gateway: CareerToolGateway
  ) {
    super(registry);
  }

  override execute(input: Parameters<AgentExecutor["execute"]>[0]) {
    return this.gateway.executeForAgent(input.toolName, input.toolInput, {
      operationId: input.operationId,
      signal: input.signal,
      confirmed: input.confirmed,
      confirmationCount: input.confirmationCount,
      careerSessionBinding: input.careerSessionBinding,
      requireSessionBinding: input.requireSessionBinding
    });
  }
}

export function createCareerToolGateway(input: ConstructorParameters<typeof CareerToolGateway>[0]) {
  return new CareerToolGateway(input);
}

function normalizeOperationId(operationId?: string) {
  return operationId && operationId.trim().length >= 8
    ? operationId.trim()
    : `career-operation-${nanoid(12)}`;
}

function errorCode(error: unknown) {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return "career_tool_failed";
}

function isRecoverable(code: string) {
  return /temporar|timeout|network|unavailable|provider_http_(408|429|5\d\d)/i.test(code);
}

function categoryForCode(code: string): CareerToolErrorCategory {
  if (/input_invalid|validation|schema/i.test(code)) return "validation";
  if (/not_found|unknown_(?:agent_|career_)?tool|missing/i.test(code)) return "not_found";
  if (/stale|revision|version/i.test(code)) return "stale_revision";
  if (/conflict|duplicate|already_exists/i.test(code)) return "conflict";
  if (/confirmation|permission|forbidden|unauthor/i.test(code)) return "permission";
  if (/provider|model|planner/i.test(code)) return "provider";
  if (isRecoverable(code)) return "recoverable";
  return "internal";
}

function toCareerToolError(code: string, message: string, retryable: boolean): CareerToolError {
  const recoverable = retryable || isRecoverable(code);
  return {
    code,
    category: categoryForCode(code),
    message,
    recoverable,
    ...(recoverable ? { retryHint: "可以稍后重试；如果仍失败，请保留当前任务状态后再继续。" } : {})
  };
}

function bindingInputMismatch(input: unknown, binding: CareerSessionBinding) {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const profileId = firstString(value.profileId, value.targetProfileId, value.activeProfileId);
  if (profileId && profileId !== binding.profileId) {
    return {
      code: "career_session_binding_profile_mismatch",
      message: "Career 工具请求的资料版本不是当前 Agent Session 固定的版本。"
    };
  }
  const personId = firstString(value.personId, value.targetPersonId);
  if (personId && personId !== binding.personId) {
    return {
      code: "career_session_binding_person_mismatch",
      message: "Career 工具请求的人物不是当前 Agent Session 固定的人物。"
    };
  }
  const sessionId = firstString(value.sessionId, value.agentSessionId);
  if (sessionId && sessionId !== binding.agentSessionId) {
    return {
      code: "career_session_binding_session_mismatch",
      message: "Career 工具请求不属于当前 Agent Session。"
    };
  }
  const expectedRevision = numberValue(value.expectedProfileVersion);
  if (expectedRevision !== undefined && expectedRevision !== binding.profileRevision) {
    return {
      code: "career_session_binding_revision_mismatch",
      message: "Career 工具请求使用了过期的资料版本 revision。"
    };
  }
  const versionNumber = numberValue(value.profileVersionNumber);
  if (versionNumber !== undefined && versionNumber !== binding.profileVersionNumber) {
    return {
      code: "career_session_binding_version_mismatch",
      message: "Career 工具请求使用了错误的资料版本号。"
    };
  }
  return undefined;
}

function filterBoundResult(name: string, raw: unknown, binding?: CareerSessionBinding) {
  if (!binding || !raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  if (name === "career.profile.list" && Array.isArray(value.profiles)) {
    return {
      ...value,
      profiles: value.profiles.filter((profile) => {
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
        const candidate = profile as Record<string, unknown>;
        return candidate.id === binding.profileId && candidate.personId === binding.personId;
      })
    };
  }
  if (name === "career.resume.list" && Array.isArray(value.resumes)) {
    return {
      ...value,
      resumes: value.resumes.filter((resume) => {
        if (!resume || typeof resume !== "object" || Array.isArray(resume)) return false;
        return (resume as Record<string, unknown>).profileId === binding.profileId;
      })
    };
  }
  return raw;
}

function boundResultMismatch(name: string, raw: unknown, binding?: CareerSessionBinding) {
  if (!binding || !raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (name === "career.profile.active") {
    const profileId = firstString(value.profileId, value.activeProfileId);
    const personId = firstString(value.personId);
    if (value.selected === false || profileId !== binding.profileId || (personId && personId !== binding.personId)) {
      return {
        code: "career_session_binding_active_profile_mismatch",
        message: "当前全局活动资料不是 Agent Session 固定的资料，未返回其他资料。"
      };
    }
  }
  if (name === "career.profile.get") {
    const profile = value.profile && typeof value.profile === "object" && !Array.isArray(value.profile)
      ? value.profile as Record<string, unknown>
      : undefined;
    if (!profile || profile.id !== binding.profileId || profile.personId !== binding.personId) {
      return {
        code: "career_session_binding_profile_mismatch",
        message: "读取结果不属于当前 Agent Session 固定的资料。"
      };
    }
  }
  if (name === "career.resume.get" || name === "career.resume.get_revision") {
    const resume = value.resume && typeof value.resume === "object" && !Array.isArray(value.resume)
      ? value.resume as Record<string, unknown>
      : value;
    if (typeof resume.profileId === "string" && resume.profileId !== binding.profileId) {
      return {
        code: "career_session_binding_resume_mismatch",
        message: "读取结果不属于当前 Agent Session 固定的资料。"
      };
    }
  }
  return undefined;
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
