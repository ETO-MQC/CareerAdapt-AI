import { nanoid } from "nanoid";
import { z } from "zod";
import type { AgentToolResult } from "../contracts/agentTool";
import { AgentConfirmationRequiredError, AgentExecutor } from "../runtime/agentExecutor";
import { AgentToolRegistry } from "./registry";
import type { CareerSessionBinding } from "../runtime/careerSessionBinding";
import {
  CAREER_WORKFLOW_FACADE_DEFINITIONS,
  CareerWorkflowFacadeResultSchema,
  executeCareerWorkflowFacade
} from "../workflows/CareerWorkflowFacade";
import { isRetryableAiProviderErrorCode } from "@/ai/providers/transportError";
import type { AgentTaskState } from "../contracts/agentSession";
import { isTailoringQuestionPaused, normalizeTailoringStage } from "../workflows/tailoringStage";
import {
  CareerToolFailureDiagnosticsSchema,
  type CareerToolFailureDiagnostics,
  type CareerToolFailureLayer,
  safeCareerToolArgumentShape,
  safeZodSchemaIssues
} from "./careerToolDiagnostics";
import { contractIdentityForInputSchema, stableCareerLogicalToolOperationId } from "./careerToolContract";
import {
  TransactionalWorkflowLeaseManager,
  type TransactionalWorkflowLease
} from "../workflows/TransactionalWorkflowLease";
import { isCareerDomainPreconditionCode } from "../runtime/careerContextBindingResolver";
import { appBuildTechnicalDiagnostics } from "@/services/diagnostics/appBuildInfo";

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
  scope?: CareerToolFailureDiagnostics["failureScope"];
  invalidFields?: string[];
  acceptedShapeHint?: CareerToolFailureDiagnostics["acceptedShapeHint"];
  diagnostics?: CareerToolFailureDiagnostics;
};

export type CareerToolResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: CareerToolError;
  /** Safe execution trace; never contains raw tool input or domain payloads. */
  diagnostics?: CareerToolFailureDiagnostics;
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
  /** Public schema identity used to reject stale Hermes/MCP surfaces. */
  contractVersion?: string;
  contractSchemaHash?: string;
};

export type CareerToolExecutionContext = {
  operationId?: string;
  /** Stable across Hermes/MCP/Gateway lifecycle events for one logical call. */
  logicalToolOperationId?: string;
  /** Stable transaction key supplied by the runtime/bridge. */
  logicalTurnId?: string;
  /** Host task key used with logicalTurnId for transactional serialization. */
  taskId?: string;
  /** Observability-only trace shared by one LogicalTurn. */
  incidentTraceId?: string;
  /** Runtime session identity used when a facade resolves an unbound profile. */
  agentSessionId?: string;
  signal?: AbortSignal;
  confirmed?: boolean;
  confirmationCount?: number;
  /** Immutable context selected by the user for this Agent Session. */
  careerSessionBinding?: CareerSessionBinding;
  /** Hermes/MCP callers must set this; legacy native tests may omit it. */
  requireSessionBinding?: boolean;
  /** Host-only replay of a failed idempotent operation against the same checkpoint. */
  retryFailedOperation?: boolean;
  /** Host projection supplied to a resumable workflow facade. */
  authoritativeTaskState?: AgentTaskState;
  /** Only the deterministic facade may use this to advance internal stages. */
  workflowFacadeInternal?: boolean;
  /** Internal discovery snapshot used only to keep partial test/adapter registries source-compatible. */
  availableCareerToolNames?: ReadonlySet<string>;
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
  /** Read the current Host projection at execution time; never use the
   * planner's stale stage metadata for authorization. */
  getAuthoritativeTaskState?: () => AgentTaskState | undefined;
  transactionalWorkflowLeases?: TransactionalWorkflowLeaseManager;
};

type CareerToolDefinition = {
  name: string;
  sourceToolName: string;
  namespace: string;
  readWrite: CareerToolReadWrite;
  personProfileBinding: CareerToolPersonProfileBinding;
};

const CAREER_TOOL_DEFINITIONS: CareerToolDefinition[] = [
  { name: "career.system.runtime_status", sourceToolName: "get_agent_runtime_status", namespace: "career.system", readWrite: "read", personProfileBinding: "none" },
  { name: "career.system.current_task", sourceToolName: "get_agent_current_task", namespace: "career.system", readWrite: "read", personProfileBinding: "none" },
  { name: "career.system.last_failure", sourceToolName: "get_agent_last_failure", namespace: "career.system", readWrite: "read", personProfileBinding: "none" },
  { name: "career.profile.list", sourceToolName: "list_profiles", namespace: "career.profile", readWrite: "read", personProfileBinding: "none" },
  { name: "career.profile.active", sourceToolName: "get_active_profile", namespace: "career.profile", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.profile.get", sourceToolName: "get_profile", namespace: "career.profile", readWrite: "read", personProfileBinding: "required" },
  { name: "career.profile.search_facts", sourceToolName: "search_profile_facts", namespace: "career.profile", readWrite: "read", personProfileBinding: "required" },
  { name: "career.context.retrieve", sourceToolName: "retrieve_career_context", namespace: "career.context", readWrite: "read", personProfileBinding: "required" },
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
  { name: "career.resume.build_evidence_graph", sourceToolName: "build_resume_evidence_graph", namespace: "career.resume", readWrite: "read", personProfileBinding: "required" },
  { name: "career.resume.plan_composition", sourceToolName: "plan_resume_composition", namespace: "career.resume", readWrite: "read", personProfileBinding: "required" },
  { name: "career.resume.review_composition", sourceToolName: "review_resume_composition", namespace: "career.resume", readWrite: "read", personProfileBinding: "required" },
  { name: "career.resume.compose", sourceToolName: "compose_resume", namespace: "career.resume", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.import.prepare", sourceToolName: "prepare_resume_import", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "optional" },
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
  private readonly workflowByName = new Map(CAREER_WORKFLOW_FACADE_DEFINITIONS.map((definition) => [definition.name, definition]));
  private readonly transactionalWorkflowLeases: TransactionalWorkflowLeaseManager;

  constructor(
    private readonly dependencies: CareerToolGatewayDependencies | AgentToolRegistry
  ) {
    this.transactionalWorkflowLeases = this.asDependencies().transactionalWorkflowLeases ?? new TransactionalWorkflowLeaseManager();
  }

  listContracts(): CareerToolContract[] {
    const atomic = CAREER_TOOL_DEFINITIONS
      .filter((definition) => this.hasSourceTool(definition.sourceToolName))
      .map((definition) => this.toContract(definition));
    return [...CAREER_WORKFLOW_FACADE_DEFINITIONS.map((definition) => this.toWorkflowContract(definition)), ...atomic];
  }

  getContract(name: string): CareerToolContract {
    const workflow = this.workflowByName.get(name);
    if (workflow) return this.toWorkflowContract(workflow);
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
          logicalToolOperationId: context.logicalToolOperationId,
          logicalTurnId: context.logicalTurnId,
          taskId: context.taskId,
          incidentTraceId: context.incidentTraceId,
          signal: context.signal,
          confirmed: context.confirmed,
          confirmationCount: context.confirmationCount,
          careerSessionBinding: context.careerSessionBinding,
          requireSessionBinding: context.requireSessionBinding,
          retryFailedOperation: context.retryFailedOperation
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
      ...(result.ok ? { data: result.data, ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}) } : {
        error: {
          code: result.error?.code ?? "career_tool_failed",
          message: result.error?.message ?? "工具执行没有完成。",
          retryable: result.error?.recoverable ?? false,
          ...(result.error?.diagnostics ? { details: result.error.diagnostics } : {})
        }
      }),
      ...(!result.ok && result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      artifactIds: result.artifacts.map((artifact) => artifact.id),
      completedAt: result.receipt.completedAt
    };
  }

  async execute<T = unknown>(
    name: string,
    input: unknown,
    context: CareerToolExecutionContext = {}
  ): Promise<CareerToolResult<T>> {
    context = {
      ...context,
      ...(context.logicalToolOperationId || !context.logicalTurnId
        ? {}
        : { logicalToolOperationId: stableCareerLogicalToolOperationId(context.logicalTurnId, name) })
    };
    const operationId = normalizeOperationId(context.operationId);
    const trace = createExecutionTrace(name, input, operationId, context);
    const workflow = this.workflowByName.get(name);
    if (workflow) {
      let lease: TransactionalWorkflowLease | undefined;
      try {
        trace.enteredGatewayAt = new Date().toISOString();
        const stageError = this.verifyTailoringStage(name, context);
        if (stageError) return this.failure(name, operationId, stageError.code, stageError.message, true, undefined, "failed", finishFailureTrace(trace, stageError.code, "gateway_policy"));
        const contract = this.toWorkflowContract(workflow);
        attachContractIdentity(trace, contract);
        const bindingError = await this.verifyExecutionBinding(contract, input, context);
        if (bindingError) return this.failure(name, operationId, bindingError.code, bindingError.message, false, undefined, "failed", finishFailureTrace(trace, bindingError.code, "gateway_policy"));
        if (!context.workflowFacadeInternal && isTransactionalWorkflow(name)) {
          lease = this.transactionalWorkflowLeases.acquire({
            workflowName: name,
            logicalTurnId: context.logicalTurnId ?? context.taskId ?? context.careerSessionBinding?.agentSessionId,
            taskId: context.taskId,
            operationId
          });
        }
        const facadeContext = {
          ...context,
          authoritativeTaskState: context.authoritativeTaskState ?? this.asDependencies().getAuthoritativeTaskState?.(),
          availableCareerToolNames: context.availableCareerToolNames ?? new Set(this.listContracts().map((candidate) => candidate.name))
        };
        trace.enteredFacadeAt = new Date().toISOString();
        trace.firstInternalOperationAt = new Date().toISOString();
        const facade = await executeCareerWorkflowFacade(
          name,
          input,
          facadeContext,
          operationId,
          (atomicName, atomicInput, atomicContext) => this.execute(atomicName, atomicInput, {
            ...atomicContext,
            logicalToolOperationId: atomicContext.logicalToolOperationId ?? context.logicalToolOperationId,
            incidentTraceId: atomicContext.incidentTraceId ?? context.incidentTraceId,
            logicalTurnId: atomicContext.logicalTurnId ?? context.logicalTurnId,
            taskId: atomicContext.taskId ?? context.taskId,
            workflowFacadeInternal: true,
            authoritativeTaskState: facadeContext.authoritativeTaskState
          })
        );
        trace.workflowStageAfter = facade.data.workflowStage;
        const facadeReceipt = facade.receipts.at(-1)!;
        const facadeHasSafeError = Boolean(facade.data.safeError);
        const facadeSucceeded = !["failed", "partial", "recoverable_failure"].includes(facade.data.status) && !facadeHasSafeError;
        const result: CareerToolResult<T> = {
          ok: facadeSucceeded,
          data: facade.data as T,
          ...(facade.data.safeError ? { error: toCareerToolError(facade.data.safeError.code, facade.data.safeError.message, facade.data.safeError.recoverable) } : {}),
          artifacts: facade.artifacts,
          receipt: facadeReceipt
        };
        return withExecutionDiagnostics(result, trace, result.error?.code);
      } catch (error) {
        const code = errorCode(error);
        attachSchemaFailure(trace, error, name, code);
        return this.failure(name, operationId, code, safeGatewayErrorMessage(error, code), isRecoverable(code), undefined, "failed", finishFailureTrace(trace, code));
      } finally {
        this.transactionalWorkflowLeases.release(lease);
      }
    }
    const definition = this.byName.get(name);
    if (!definition || !this.hasSourceTool(definition.sourceToolName)) {
      return this.failure(name, operationId, "unknown_career_tool", "当前 Career 工具不可用。", false, undefined, "failed", finishFailureTrace(trace, "unknown_career_tool"));
    }
    let lease: TransactionalWorkflowLease | undefined;
    try {
      trace.enteredGatewayAt = new Date().toISOString();
      const stageError = this.verifyTailoringStage(name, context);
      if (stageError) return this.failure(name, operationId, stageError.code, stageError.message, true, undefined, "failed", finishFailureTrace(trace, stageError.code, "gateway_policy"));
      const contract = this.toContract(definition);
      attachContractIdentity(trace, contract);
      const bindingError = await this.verifyExecutionBinding(contract, input, context);
      if (bindingError) return this.failure(name, operationId, bindingError.code, bindingError.message, false, undefined, "failed", finishFailureTrace(trace, bindingError.code, "gateway_policy"));
      if (!context.workflowFacadeInternal && isTransactionalAtomic(definition.sourceToolName)) {
        lease = this.transactionalWorkflowLeases.acquire({
          workflowName: name,
          logicalTurnId: context.logicalTurnId ?? context.taskId ?? context.careerSessionBinding?.agentSessionId,
          taskId: context.taskId,
          operationId
        });
      }
      trace.firstInternalOperationAt = new Date().toISOString();
      const raw = await this.executeSourceTool(definition.sourceToolName, input, operationId, context);
      const mapped = this.mapResult<T>(name, definition, raw, context.careerSessionBinding);
      return withExecutionDiagnostics(mapped, trace, mapped.error?.code);
    } catch (error) {
      if (error instanceof AgentConfirmationRequiredError) {
        return this.failure(name, operationId, error.code, "这项操作需要你的明确确认后才能继续。", false, "请确认后重试。", "confirmation_required", finishFailureTrace(trace, error.code, "gateway_policy"));
      }
      const code = errorCode(error);
      attachSchemaFailure(trace, error, name, code);
      return this.failure(name, operationId, code, safeGatewayErrorMessage(error, code), isRecoverable(code), undefined, "failed", finishFailureTrace(trace, code));
    } finally {
      this.transactionalWorkflowLeases.release(lease);
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
        logicalToolOperationId: context.logicalToolOperationId,
        logicalTurnId: context.logicalTurnId,
        taskId: context.taskId,
        incidentTraceId: context.incidentTraceId,
        signal: context.signal,
        confirmed: context.confirmed,
        confirmationCount: context.confirmationCount,
        careerSessionBinding: context.careerSessionBinding,
        requireSessionBinding: context.requireSessionBinding,
        retryFailedOperation: context.retryFailedOperation
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
    if (context.requireSessionBinding && !binding && contract.personProfileBinding === "required") {
      return {
        code: "needs_profile",
        message: "当前还没有可用于定制的个人资料。你可以选择已有资料，或先导入一份简历。"
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

  private verifyTailoringStage(name: string, context: CareerToolExecutionContext = {}) {
    if (context.workflowFacadeInternal) return undefined;
    // Hermes' authoritative tool-start event promotes the task immediately
    // before the transaction. Do not reject the canonical facade from a
    // stale Host projection; the facade owns checkpoint validation and can
    // return a recoverable result without creating a second route.
    if (name === "career.workflow.tailor_resume") return undefined;
    const state = context.authoritativeTaskState ?? this.asDependencies().getAuthoritativeTaskState?.();
    if (!state || !isTailoringWorkflowId(state.workflowId)) return undefined;
    const sourceToolName = name.startsWith("career.workflow.")
      ? name === "career.workflow.tailor_resume" ? "create_tailoring_session" : undefined
      : this.byName.get(name)?.sourceToolName;
    if (!sourceToolName) return undefined;
    const stage = normalizeTailoringStage(state.stage);
    if (!stage) return undefined;
    const questionPaused = isTailoringQuestionPaused(state.knownSlots.tailoringSession);
    if (questionPaused && sourceToolName !== "answer_tailoring_question" && !isTailoringReadTool(sourceToolName)) {
      return {
        code: "tailoring_questions_incomplete",
        message: "当前定制问题尚未回答；请先展示并回答唯一的当前问题。"
      };
    }
    const requiredStage: Record<string, string> = {
      analyze_job_fit: "analyze_fit",
      create_tailoring_session: "generate_plan",
      answer_tailoring_question: "clarify_unsupported_facts",
      generate_tailoring_changes: "generate_changes",
      review_tailoring_diff: "preview_changes",
      preview_tailoring_changes: "preview_changes",
      apply_tailoring_changes: "confirm_apply"
    };
    const expected = requiredStage[sourceToolName];
    // Reads are useful for checkpoint verification and do not advance the
    // workflow. Every semantic Tailoring mutation is stage-checked here.
    if (!expected || stage === expected) return undefined;
    return {
      code: "agent_tool_not_allowed_current_stage",
      message: `当前岗位定制步骤为 ${stage}，暂不允许执行 ${sourceToolName}。`
    };
  }

  private failure(
    name: string,
    operationId: string,
    code: string,
    message: string,
    recoverable: boolean,
    retryHint?: string,
    status: OperationReceipt["status"] = "failed",
    diagnostics?: CareerToolFailureDiagnostics
  ): CareerToolResult<never> {
    const safeDiagnostics = diagnostics ?? createFailureDiagnostics({
      name,
      operationId,
      code,
      recoverable,
      context: {},
      input: undefined
    });
    const errorValue = {
      code,
      category: categoryForCode(code),
      message,
      recoverable,
      ...(retryHint ? { retryHint } : {}),
      ...(safeDiagnostics.failureScope ? { scope: safeDiagnostics.failureScope } : {}),
      ...(safeDiagnostics.invalidFields ? { invalidFields: safeDiagnostics.invalidFields } : {}),
      ...(safeDiagnostics.acceptedShapeHint ? { acceptedShapeHint: safeDiagnostics.acceptedShapeHint } : {}),
      diagnostics: safeDiagnostics
    } satisfies CareerToolError;
    return {
      ok: false,
      error: errorValue,
      diagnostics: safeDiagnostics,
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
    const inputSchema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
    const identity = contractIdentityForInputSchema(inputSchema);
    return {
      name: definition.name,
      description: `${atomicWorkflowHint(definition.name)}${tool.description}`,
      sourceToolName: definition.sourceToolName,
      namespace: definition.namespace,
      inputSchema,
      outputSchema: careerToolEnvelopeJsonSchema(tool.outputSchema),
      readWrite: definition.readWrite,
      safetyClass,
      confirmationPolicy,
      idempotencyKeyPolicy: definition.readWrite === "write" ? "operation_id" : "none",
      personProfileBinding: definition.personProfileBinding,
      artifactBehavior: tool.producesArtifact ? "produces_artifact" : "none",
      errorTaxonomy: ["validation", "not_found", "conflict", "stale_revision", "permission", "provider", "recoverable", "internal"],
      ...identity
    };
  }

  private toWorkflowContract(definition: (typeof CAREER_WORKFLOW_FACADE_DEFINITIONS)[number]): CareerToolContract {
    const inputSchema = definition.inputJsonSchema
      ?? z.toJSONSchema(definition.inputSchema) as Record<string, unknown>;
    const identity = contractIdentityForInputSchema(inputSchema);
    return {
      name: definition.name,
      description: `${definition.description} Stop when status is completed, waiting_for_user, waiting_for_confirmation, working, review_ready, recoverable_failure, partial, or failed; do not call another workflow facade in the same turn. The result status and receipt are authoritative; do not claim completion from prose alone.`,
      sourceToolName: definition.name,
      namespace: "career.workflow",
      inputSchema,
      outputSchema: careerToolEnvelopeJsonSchema(CareerWorkflowFacadeResultSchema),
      readWrite: "write",
      safetyClass: "SAFE_WRITE",
      confirmationPolicy: "none",
      idempotencyKeyPolicy: "operation_id",
      personProfileBinding: definition.personProfileBinding,
      artifactBehavior: "produces_artifact",
      errorTaxonomy: ["validation", "not_found", "conflict", "stale_revision", "permission", "provider", "recoverable", "internal"],
      ...identity
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

function isTailoringReadTool(sourceToolName: string) {
  return ["get_profile", "get_resume", "get_resume_revision", "get_job", "list_resumes", "list_jobs"].includes(sourceToolName);
}

function isTailoringWorkflowId(workflowId: string | undefined) {
  return workflowId === "tailor_existing_resume" || workflowId === "tailor_resume";
}

function atomicWorkflowHint(name: string) {
  const pairedFacade: Record<string, string> = {
    "career.profile.capture_intake": "仅用于 Profile Intake facade 的内部/恢复步骤；正常访谈请先调用 career.workflow.profile_intake_turn。 ",
    "career.profile.synthesize_intake": "仅用于 Profile Intake facade 的内部/恢复步骤；正常访谈请先调用 career.workflow.profile_intake_finalize。 ",
    "career.resume.import.prepare": "仅用于 Resume Import facade 的内部/恢复步骤；正常导入请先调用 career.workflow.resume_import。 ",
    "career.job.analyze_fit": "仅用于 Job Fit facade 的内部/恢复步骤；正常匹配请先调用 career.workflow.job_fit。 ",
    "career.tailoring.create_session": "仅用于 Tailoring facade 的内部/恢复步骤；正常定制请先调用 career.workflow.tailor_resume。 ",
    "career.resume.ensure_general_from_profile": "仅用于 Profile→Resume facade 的内部/恢复步骤；正常组装请先调用 career.workflow.profile_to_resume。 ",
    "career.resume.compose": "仅用于 Resume Composition facade 的确认写入步骤；正常组装请先调用 career.workflow.compose_resume。 ",
    "career.export.resume": "仅用于 Repair→Export facade 的内部/恢复步骤；正常导出请先调用 career.workflow.resume_export。 "
  };
  return pairedFacade[name] ?? "";
}

export class CareerToolGatewayExecutor extends AgentExecutor {
  constructor(
    registry: AgentToolRegistry,
    private readonly gateway: CareerToolGateway
  ) {
    super(registry);
  }

  override execute(input: Parameters<AgentExecutor["execute"]>[0]): Promise<AgentToolResult> {
    if (input.toolName.startsWith("career.workflow.")) {
      return this.executeWorkflowConfirmation(input);
    }
    return this.gateway.executeForAgent(input.toolName, input.toolInput, {
      operationId: input.operationId,
      logicalToolOperationId: input.logicalToolOperationId,
      logicalTurnId: input.logicalTurnId,
      taskId: input.taskId,
      incidentTraceId: input.incidentTraceId,
      signal: input.signal,
      confirmed: input.confirmed,
      confirmationCount: input.confirmationCount,
      careerSessionBinding: input.careerSessionBinding,
      requireSessionBinding: input.requireSessionBinding,
      retryFailedOperation: input.retryFailedOperation
    });
  }

  private async executeWorkflowConfirmation(input: Parameters<AgentExecutor["execute"]>[0]): Promise<AgentToolResult> {
    const result = await this.gateway.execute(input.toolName, input.toolInput, {
      operationId: input.operationId,
      logicalToolOperationId: input.logicalToolOperationId,
      logicalTurnId: input.logicalTurnId,
      taskId: input.taskId,
      incidentTraceId: input.incidentTraceId,
      signal: input.signal,
      confirmed: input.confirmed,
      confirmationCount: input.confirmationCount,
      careerSessionBinding: input.careerSessionBinding,
      requireSessionBinding: input.requireSessionBinding,
      retryFailedOperation: input.retryFailedOperation
    });
    return {
      ok: result.ok,
      operationId: result.receipt.operationId,
      toolName: input.toolName,
      ...(result.ok ? { data: result.data, ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}) } : {
        error: {
          code: result.error?.code ?? "career_tool_failed",
          message: result.error?.message ?? "工具执行没有完成。",
          retryable: result.error?.recoverable ?? false,
          ...(result.error?.diagnostics ? { details: result.error.diagnostics } : {})
        }
      }),
      ...(!result.ok && result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      artifactIds: result.artifacts.map((artifact) => artifact.id),
      completedAt: result.receipt.completedAt
    } satisfies AgentToolResult;
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

function careerToolEnvelopeJsonSchema(dataSchema: z.ZodType): Record<string, unknown> {
  const schema = z.object({
    ok: z.boolean(),
    data: dataSchema.optional(),
    error: z.object({
      code: z.string(),
      category: z.enum(["validation", "not_found", "conflict", "stale_revision", "permission", "provider", "recoverable", "internal"]),
      message: z.string(),
      recoverable: z.boolean(),
      retryHint: z.string().optional(),
      scope: z.string().optional(),
      invalidFields: z.array(z.string()).optional(),
      acceptedShapeHint: z.record(z.string(), z.unknown()).optional(),
      diagnostics: CareerToolFailureDiagnosticsSchema.optional()
    }).optional(),
    diagnostics: CareerToolFailureDiagnosticsSchema.optional(),
    artifacts: z.array(z.object({
      id: z.string(),
      kind: z.literal("tool_result"),
      toolName: z.string(),
      sourceToolName: z.string()
    })),
    receipt: z.object({
      operationId: z.string(),
      toolName: z.string(),
      idempotencyKey: z.string().optional(),
      status: z.enum(["completed", "failed", "confirmation_required"]),
      completedAt: z.string()
    })
  });
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

function errorCode(error: unknown) {
  if (error instanceof z.ZodError) return "schema_validation_failed";
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return "career_tool_failed";
}

function safeGatewayErrorMessage(error: unknown, code: string) {
  if (code === "schema_validation_failed") return "工具输入未通过 Career Schema 校验，未执行写入。";
  return error instanceof Error && error.message.trim()
    ? error.message.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 360)
    : "工具执行没有完成。";
}

function isRecoverable(code: string) {
  return isRetryableAiProviderErrorCode(code)
    || /temporar|timeout|network|unavailable|tailoring_questions_incomplete|tailoring_apply_verification_failed|career_workflow_in_progress/i.test(code);
}

function categoryForCode(code: string): CareerToolErrorCategory {
  if (/input_invalid|validation|schema/i.test(code)) return "validation";
  if (/not_found|unknown_(?:agent_|career_)?tool|missing/i.test(code)) return "not_found";
  if (/stale|revision|version/i.test(code)) return "stale_revision";
  if (/conflict|duplicate|already_exists|career_workflow_in_progress/i.test(code)) return "conflict";
  if (/confirmation|permission|forbidden|unauthor/i.test(code)) return "permission";
  if (/provider|model|planner/i.test(code)) return "provider";
  if (isRecoverable(code)) return "recoverable";
  return "internal";
}

function toCareerToolError(code: string, message: string, retryable: boolean, diagnostics?: CareerToolFailureDiagnostics): CareerToolError {
  const recoverable = retryable || isRecoverable(code);
  return {
    code,
    category: categoryForCode(code),
    message,
    recoverable,
    ...(diagnostics ? { diagnostics } : {}),
    ...(diagnostics?.failureScope ? { scope: diagnostics.failureScope } : {}),
    ...(diagnostics?.invalidFields ? { invalidFields: diagnostics.invalidFields } : {}),
    ...(diagnostics?.acceptedShapeHint ? { acceptedShapeHint: diagnostics.acceptedShapeHint } : {}),
    ...(recoverable ? { retryHint: "可以稍后重试；如果仍失败，请保留当前任务状态后再继续。" } : {})
  };
}

type ExecutionTrace = {
  name: string;
  input: unknown;
  operationId: string;
  logicalToolOperationId: string;
  logicalTurnId?: string;
  taskId?: string;
  workflowStageBefore?: string;
  workflowStageAfter?: string;
  startedAtMs: number;
  startedAt: string;
  enteredGatewayAt?: string;
  enteredFacadeAt?: string;
  firstInternalOperationAt?: string;
  publishedContractVersion?: string;
  publishedSchemaHash?: string;
  gatewayContractVersion?: string;
  gatewaySchemaHash?: string;
  schemaIssues?: ReturnType<typeof safeZodSchemaIssues>;
  invalidFields?: string[];
  acceptedShapeHint?: { requiredOneOf: string[]; note?: string };
};

const TRANSACTIONAL_WORKFLOW_NAMES = new Set([
  "career.workflow.profile_intake_turn",
  "career.workflow.profile_intake_finalize",
  "career.workflow.resume_import",
  "career.workflow.tailor_resume",
  "career.workflow.profile_to_resume",
  "career.workflow.compose_resume",
  "career.workflow.resume_export"
]);

function isTransactionalWorkflow(name: string) {
  return TRANSACTIONAL_WORKFLOW_NAMES.has(name);
}

const TRANSACTIONAL_ATOMIC_TOOL_NAMES = new Set([
  "commit_profile_intake",
  "commit_resume_import",
  "compose_resume",
  "create_resume_from_profile",
  "create_job_resume_from_profile",
  "ensure_general_resume_from_profile",
  "create_tailoring_session",
  "answer_tailoring_question",
  "generate_tailoring_changes",
  "review_tailoring_diff",
  "apply_tailoring_changes",
  "export_resume",
  "archive_resume",
  "restore_resume",
  "commit_job"
]);

function isTransactionalAtomic(sourceToolName: string) {
  return TRANSACTIONAL_ATOMIC_TOOL_NAMES.has(sourceToolName);
}

function createExecutionTrace(
  name: string,
  input: unknown,
  operationId: string,
  context: CareerToolExecutionContext
): ExecutionTrace {
  const startedAtMs = Date.now();
  return {
    name,
    input,
    operationId,
    // The gateway is downstream of Hermes/MCP. If an upstream logical ID was
    // not supplied, reuse the operation ID instead of minting a second
    // logical identity at this boundary.
    logicalToolOperationId: context.logicalToolOperationId ?? operationId,
    logicalTurnId: context.logicalTurnId,
    taskId: context.taskId,
    workflowStageBefore: context.authoritativeTaskState?.stage,
    startedAtMs,
    startedAt: new Date(startedAtMs).toISOString()
  };
}

function withExecutionDiagnostics<T>(
  result: CareerToolResult<T>,
  trace: ExecutionTrace,
  code?: string
): CareerToolResult<T> {
  const diagnostics = finishTrace(trace, code ?? "none", result.ok ? false : true);
  return {
    ...result,
    diagnostics,
    ...(result.error ? { error: { ...result.error, diagnostics } } : {})
  };
}

function finishFailureTrace(trace: ExecutionTrace, code: string, layer?: CareerToolFailureLayer) {
  return finishTrace(trace, code, true, layer);
}

function finishTrace(
  trace: ExecutionTrace,
  code: string,
  toolResultIsError: boolean,
  explicitLayer?: CareerToolFailureLayer
): CareerToolFailureDiagnostics {
  const layer = explicitLayer ?? (toolResultIsError ? failureLayerForCode(code) : "unknown");
  const completedAt = new Date().toISOString();
  return CareerToolFailureDiagnosticsSchema.parse({
    toolFailureLayer: layer,
    ...(toolResultIsError ? { failureKind: failureKindFor(code, layer) } : {}),
    failureScope: isCareerDomainPreconditionCode(code) ? "career_context" : scopeForLayer(layer),
    safeDomainErrorCode: code,
    toolResultIsError,
    failedStage: toolResultIsError ? failedStageForLayer(layer) : "completed",
    durationMs: Math.max(0, Date.now() - trace.startedAtMs),
    retryable: toolResultIsError && isRecoverable(code),
    ...(trace.workflowStageBefore ? { workflowStageBefore: trace.workflowStageBefore } : {}),
    ...(trace.workflowStageAfter ? { workflowStageAfter: trace.workflowStageAfter } : {}),
    operationId: trace.operationId,
    logicalToolOperationId: trace.logicalToolOperationId,
    ...(trace.logicalTurnId ? { logicalTurnId: trace.logicalTurnId } : {}),
    ...(trace.taskId ? { taskId: trace.taskId } : {}),
    argumentShape: safeCareerToolArgumentShape(trace.input),
    gatewayArgumentShape: safeCareerToolArgumentShape(trace.input),
    ...appBuildTechnicalDiagnostics,
    ...(trace.schemaIssues?.length ? { schemaIssues: trace.schemaIssues } : {}),
    ...(trace.invalidFields?.length ? { invalidFields: trace.invalidFields } : {}),
    ...(trace.acceptedShapeHint ? { acceptedShapeHint: trace.acceptedShapeHint } : {}),
    ...(trace.publishedContractVersion ? { publishedContractVersion: trace.publishedContractVersion } : {}),
    ...(trace.publishedSchemaHash ? { publishedSchemaHash: trace.publishedSchemaHash } : {}),
    ...(trace.gatewayContractVersion ? { gatewayContractVersion: trace.gatewayContractVersion } : {}),
    ...(trace.gatewaySchemaHash ? { gatewaySchemaHash: trace.gatewaySchemaHash } : {}),
    startedAt: trace.startedAt,
    ...(trace.enteredGatewayAt ? { enteredGatewayAt: trace.enteredGatewayAt } : {}),
    ...(trace.enteredFacadeAt ? { enteredFacadeAt: trace.enteredFacadeAt } : {}),
    ...(trace.firstInternalOperationAt ? { firstInternalOperationAt: trace.firstInternalOperationAt } : {}),
    completedAt
  });
}

function attachContractIdentity(trace: ExecutionTrace, contract: CareerToolContract) {
  trace.publishedContractVersion = contract.contractVersion;
  trace.publishedSchemaHash = contract.contractSchemaHash;
  trace.gatewayContractVersion = contract.contractVersion;
  trace.gatewaySchemaHash = contract.contractSchemaHash;
}

function attachSchemaFailure(trace: ExecutionTrace, error: unknown, name: string, code: string) {
  if (code !== "schema_validation_failed") return;
  trace.schemaIssues = safeZodSchemaIssues(error);
  trace.invalidFields = [...new Set(trace.schemaIssues.map((issue) => issue.key).filter((key): key is string => Boolean(key)))];
  trace.acceptedShapeHint = name === "career.workflow.tailor_resume"
    ? {
        requiredOneOf: ["targetText", "jobId", "checkpointId"],
        note: "targetText 用于原始外部 JD；不要把原始 JD 放入 target。"
      }
    : { requiredOneOf: ["published inputSchema"] };
}

function failureKindFor(code: string, layer: CareerToolFailureLayer) {
  if (layer === "mcp_jsonrpc") return "mcp_jsonrpc_failed" as const;
  if (layer === "mcp_handler") return "mcp_handler_not_reached" as const;
  if (layer === "gateway_validation") return "gateway_validation_failed" as const;
  if (code === "schema_validation_failed") return "tool_schema_rejected_by_hermes_or_mcp" as const;
  return "workflow_failed" as const;
}

function createFailureDiagnostics(input: {
  name: string;
  operationId: string;
  code: string;
  recoverable: boolean;
  context: CareerToolExecutionContext;
  input: unknown;
}) {
  return finishTrace(createExecutionTrace(input.name, input.input, input.operationId, input.context), input.code, true);
}

function failureLayerForCode(code: string): CareerToolFailureLayer {
  if (/jsonrpc/i.test(code)) return "mcp_jsonrpc";
  if (/mcp_(?:bridge_)?(?:poll|register|binding|heartbeat|transport|unavailable)|mcp_unavailable/i.test(code)) return "mcp_transport";
  if (/mcp.*handler|handler/i.test(code)) return "mcp_handler";
  if (/hermes.*tool|tool_protocol|tool_failed/i.test(code)) return "hermes_tool_protocol";
  if (/fact_guard|ungrounded|unsupported_fact/i.test(code)) return "fact_guard";
  if (/completion_guard|completion_proof/i.test(code)) return "completion_guard";
  if (/timeout|timed_out|deadline/i.test(code)) return "timeout";
  if (/repository|workspace|repo_|database|dexie/i.test(code)) return "repository";
  if (/provider|model|planner|ai_/i.test(code)) return "provider";
  if (/binding|not_allowed|permission|confirmation|forbidden|unauthor/i.test(code)) return "gateway_policy";
  if (/invalid|schema|missing|unknown_|not_found|input_/i.test(code)) return "gateway_validation";
  if (/selection_required|checkpoint|stale|revision|workflow_in_progress|questions_incomplete|precondition/i.test(code)) return "workflow_precondition";
  if (/tailor|compose|profile|resume|workflow/i.test(code)) return "workflow_execution";
  return "unknown";
}

function failedStageForLayer(layer: CareerToolFailureLayer) {
  return layer === "unknown" ? "gateway" : layer;
}

function scopeForLayer(layer: CareerToolFailureLayer) {
  if (layer === "provider") return "provider" as const;
  if (layer === "mcp_transport" || layer === "mcp_jsonrpc" || layer === "mcp_handler") return "mcp_transport" as const;
  if (layer === "hermes_tool_protocol") return "runtime" as const;
  if (layer === "repository") return "repository" as const;
  if (layer === "gateway_policy") return "policy" as const;
  return "career_workflow" as const;
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
