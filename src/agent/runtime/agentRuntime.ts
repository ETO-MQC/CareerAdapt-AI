import { nanoid } from "nanoid";
import { z } from "zod";
import {
  AgentSessionSchema,
  type AgentConfirmation,
  type AgentMessage,
  type AgentSession
} from "../contracts/agentSession";
import { AgentPageContextSchema, type AgentPageContext } from "../contracts/agentContext";
import type { AgentToolResult } from "../contracts/agentTool";
import { AgentEventBus } from "./agentEventBus";
import { AgentConfirmationRequiredError, AgentExecutor } from "./agentExecutor";
import { workflowReducer } from "./workflowReducer";
import { encodeAiSettingsForHeader, readAiSettings } from "@/services/storage/aiSettings";
import { allowedToolManifestForStep } from "@/agent/workflows/workflowRegistry";
import { recoverUnknownToolCall } from "./normalizeAgentPlannerAction";
import { ProfileIntakeSectionSchema } from "../contracts/agentActions";
import type { ActiveCareerContext } from "@/domain/schemas";
import { createRunStopReason, type RunStopReason } from "./hermes/hermesIncidentTrace";

export type AgentRuntimeEventType =
  | "progress"
  | "reasoning_status"
  | "text_delta"
  | "tool_call_requested"
  | "tool_call_completed"
  | "tool_call_failed"
  | "artifact_updated"
  | "approval_required"
  | "tool_call_started"
  | "tool_call_finished"
  | "approval_requested"
  | "turn_paused"
  | "turn_interrupted"
  | "turn_resumed"
  | "turn_completed"
  | "turn_failed";

export type AgentRuntimeEvent = {
  type: AgentRuntimeEventType;
  sessionId: string;
  turnId: string;
  timestamp: string;
  /** Stable upstream Hermes event id, when the transport supplied one. */
  eventId?: string;
  message?: string;
  delta?: string;
  toolName?: string;
  operationId?: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
};

export type AgentRuntimeTurnInput = {
  sessionId: string;
  turnId?: string;
  userMessage: string;
  pageContext: AgentPageContext;
  session?: AgentSession;
  attachments?: AgentRuntimeAttachment[];
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type AgentRuntimeAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  purpose: "resume_import" | "career_evidence" | "other";
};

export type AgentRuntimeCapabilities = {
  streaming: boolean;
  interruptible: boolean;
  resumable: boolean;
  toolCalls: boolean;
  approvals: boolean;
  offline: boolean;
  runtimeVersion?: string;
};

export type AgentRuntimeRecoveryPlan =
  | { kind: "reattach"; runId: string }
  | { kind: "retry" };

/**
 * Stable runtime boundary used by the application host.  Legacy planner
 * behavior remains available below, while native and future Hermes adapters
 * can expose the same event stream without leaking planner internals.
 */
export interface AgentRuntime {
  readonly id: string;
  runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent>;
  pause(sessionId: string): Promise<void>;
  interrupt(sessionId: string, reason?: RunStopReason): Promise<void>;
  resume(sessionId: string): Promise<void>;
  capabilities(): AgentRuntimeCapabilities;
  /** One bounded Hermes health/session recovery before a safe retry. */
  recoverBeforeFallback?(input: AgentRuntimeTurnInput): Promise<AgentRuntimeRecoveryPlan | undefined>;
}

const ToolCallSchema = z.object({
  toolName: z.string().min(1),
  operationId: z.string().min(8).max(160),
  input: z.record(z.string(), z.unknown())
}).strict();

export const AgentPlannerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assistant_message"), message: z.string().min(1).max(4000) }).strict(),
  z.object({ type: z.literal("tool_call"), calls: z.array(ToolCallSchema).min(1).max(4) }).strict(),
  z.object({
    type: z.literal("ask_user"),
    message: z.string().min(1).max(2000),
    field: z.string().min(1).optional(),
    options: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1).max(240),
      action: z.union([
        z.object({ type: z.literal("answer"), field: z.string().min(1), value: z.unknown() }).strict(),
        z.object({ type: z.literal("start_workflow"), workflowId: z.string().min(1) }).strict(),
        z.object({ type: z.literal("switch_workflow"), workflowId: z.string().min(1), preserveCurrent: z.boolean() }).strict(),
        z.object({ type: z.literal("pause_workflow"), workflowId: z.string().min(1) }).strict(),
        z.object({ type: z.literal("resume_workflow"), workflowId: z.string().min(1) }).strict(),
        z.object({ type: z.literal("cancel_workflow"), workflowId: z.string().min(1) }).strict(),
        z.object({ type: z.literal("go_back"), workflowId: z.string().min(1) }).strict(),
        z.object({ type: z.literal("open_resume_picker") }).strict(),
        z.object({ type: z.literal("open_resume_upload") }).strict(),
        z.object({ type: z.literal("open_job_import_dialog") }).strict(),
        z.object({ type: z.literal("open_profile_browser") }).strict(),
        z.object({ type: z.literal("open_tool_palette") }).strict(),
        z.object({ type: z.literal("open_artifact"), artifactId: z.string().min(1) }).strict(),
        z.object({
          type: z.literal("task_decision"),
          decisionType: z.literal("resume_source_route"),
          option: z.enum(["profile", "existing_resume"])
        }).strict(),
        z.object({
          type: z.literal("profile_intake_section_select"),
          section: ProfileIntakeSectionSchema,
          sourceMessageId: z.string().min(1),
          optionSetRevision: z.number().int().min(0)
        }).strict()
      ])
    }).strict()).min(1).max(12).optional()
  }).strict(),
  z.object({ type: z.literal("request_confirmation"), message: z.string().min(1).max(2000), call: ToolCallSchema }).strict(),
  z.object({ type: z.literal("workflow_complete"), message: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal("workflow_failed"), code: z.string().min(1), message: z.string().min(1).max(2000), retryable: z.boolean().default(false) }).strict()
]);

export type AgentPlannerAction = z.infer<typeof AgentPlannerActionSchema>;

export const AgentTurnRequestSchema = z.object({
  userMessage: z.string().max(8000),
  sessionSummary: z.string().max(6000),
  workflowState: AgentSessionSchema.shape.workflowState,
  pageContext: AgentPageContextSchema,
  toolManifest: z.array(z.record(z.string(), z.unknown())).max(32),
  recentToolResults: z.array(z.object({
    toolName: z.string(),
    operationId: z.string(),
    ok: z.boolean(),
    summary: z.string().max(3000)
  }).strict()).max(8)
}).strict();

export type AgentPlanner = (request: z.infer<typeof AgentTurnRequestSchema>, signal?: AbortSignal) => Promise<AgentPlannerAction>;

export type AgentSessionPersistence = {
  save(session: AgentSession): Promise<AgentSession>;
};

type PendingCall = z.infer<typeof ToolCallSchema>;

/**
 * @deprecated Compatibility runtime for legacy planner tests and migrations.
 * Production orchestration is owned by AgentKernel through AgentRuntimeProvider.
 */
export class LegacyAgentRuntime {
  readonly id: string = "legacy-native";
  private controller?: AbortController;
  private readonly recentResults: AgentToolResult[] = [];
  private pendingCall?: PendingCall;
  private paused = false;

  constructor(
    private session: AgentSession,
    private readonly dependencies: {
      planner: AgentPlanner;
      executor: AgentExecutor;
      persistence: AgentSessionPersistence;
      eventBus: AgentEventBus;
      toolManifest: Array<Record<string, unknown>>;
      maxToolCalls?: number;
    }
  ) {
    this.session = AgentSessionSchema.parse(session);
  }

  static create(workflowId: string, initialStep: string, title = "新的 AI 任务", context?: ActiveCareerContext) {
    const now = new Date().toISOString();
    return AgentSessionSchema.parse({
      id: `agent-session-${nanoid(12)}`,
      title,
      titleOrigin: title === "新的 AI 任务" || title === "AI 求职任务" ? "default" : "user",
      messages: [],
      workflowState: {
        workflowId,
        step: initialStep,
        status: "idle",
        toolCallCount: 0,
        data: {}
      },
      artifactRefs: [],
      personId: context?.personId,
      activeProfileId: context?.profileId,
      profileVersionNumber: context?.profileVersionNumber,
      profileRevision: context?.profileRevision,
      conversationSummary: "",
      createdAt: now,
      updatedAt: now
    });
  }

  getSnapshot() {
    return this.session;
  }

  async turn(
    userMessage: string,
    pageContext: AgentPageContext,
    options: { appendUserMessage?: boolean } = {}
  ) {
    if (this.paused) throw Object.assign(new Error("agent_runtime_paused"), { code: "agent_runtime_paused" });
    if (this.controller) throw Object.assign(new Error("agent_turn_in_progress"), { code: "agent_turn_in_progress" });
    this.controller = new AbortController();
    const signal = this.controller.signal;
    if (userMessage.trim() && options.appendUserMessage !== false) {
      this.appendMessage("user", userMessage.trim());
      await this.persist();
    }

    try {
      for (;;) {
        this.emit("planning_started");
        const action = AgentPlannerActionSchema.parse(await this.dependencies.planner({
          userMessage,
          sessionSummary: this.session.conversationSummary,
          workflowState: this.session.workflowState,
          pageContext: AgentPageContextSchema.parse(pageContext),
          toolManifest: allowedToolManifestForStep(
            this.session.workflowState.workflowId,
            this.session.workflowState.step,
            this.dependencies.toolManifest
          ),
          recentToolResults: this.recentResults.slice(-8).map(compactToolResult)
        }, signal));
        this.emit("action_received", { payload: { actionType: action.type } });

        const shouldContinue = await this.handleAction(action, signal);
        await this.persist();
        if (!shouldContinue) return this.session;
      }
    } finally {
      this.controller = undefined;
    }
  }

  pause() {
    this.paused = true;
    this.controller?.abort(createRunStopReason({
      requestedBy: "agent_runtime_provider",
      reasonCode: "workflow_paused",
      sourceComponent: "AgentRuntime.pause",
      sessionId: this.session.id,
      logicalTurnId: this.session.activeTurn?.id,
      runId: this.session.hermesRun?.runId,
      incidentTraceId: this.session.activeTurn?.incidentTraceId
    }));
    this.emit("workflow_paused");
    return this.persist();
  }

  async resume(pageContext: AgentPageContext) {
    this.paused = false;
    this.emit("workflow_resumed");
    await this.persist();
    return this.turn("", pageContext);
  }

  abort(reason?: RunStopReason | Record<string, unknown>) {
    this.controller?.abort(reason);
  }

  async interrupt(sessionId: string, reason?: RunStopReason) {
    if (sessionId !== this.session.id) return;
    this.abort(reason ?? createRunStopReason({
      requestedBy: "agent_runtime_provider",
      reasonCode: "user_interrupt",
      sourceComponent: "AgentRuntime.interrupt",
      sessionId,
      logicalTurnId: this.session.activeTurn?.id,
      runId: this.session.hermesRun?.runId,
      incidentTraceId: this.session.activeTurn?.incidentTraceId
    }));
  }

  capabilities(): AgentRuntimeCapabilities {
    return {
      streaming: true,
      interruptible: true,
      resumable: true,
      toolCalls: true,
      approvals: true,
      offline: false,
      runtimeVersion: "legacy-native-adapter"
    };
  }

  async *runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    if (input.sessionId !== this.session.id) {
      yield runtimeEvent(input, "turn_failed", {
        error: {
          code: "runtime_session_mismatch",
          message: "运行时会话与当前任务不一致。",
          recoverable: false
        }
      });
      return;
    }
    const turnId = input.turnId ?? `runtime-turn-${nanoid(12)}`;
    const abortListener = () => this.abort(input.signal?.reason as Record<string, unknown> | undefined);
    input.signal?.addEventListener("abort", abortListener, { once: true });
    yield runtimeEvent({ ...input, turnId }, "reasoning_status", { message: "正在处理当前任务…" });
    yield runtimeEvent({ ...input, turnId }, "progress", { message: "已接收当前输入，正在准备下一步…" });
    try {
      const session = await this.turn(input.userMessage, input.pageContext);
      const assistant = [...session.messages].reverse().find((message) =>
        message.role === "assistant" && message.kind !== "assistant_thinking" && message.content.trim()
      );
      if (assistant) {
        yield runtimeEvent({ ...input, turnId }, "text_delta", { delta: assistant.content });
      }
      yield runtimeEvent({ ...input, turnId }, "turn_completed", { data: session });
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "runtime_turn_failed";
      yield runtimeEvent({ ...input, turnId }, "turn_failed", {
        error: {
          code,
          message: error instanceof Error ? error.message : "运行时处理没有完成。",
          recoverable: /temporar|timeout|network|unavailable/i.test(code)
        }
      });
    } finally {
      input.signal?.removeEventListener("abort", abortListener);
    }
  }

  async resolveConfirmation(confirmed: boolean, pageContext: AgentPageContext) {
    const confirmation = this.session.pendingConfirmation;
    const call = this.pendingCall;
    if (!confirmation || !call) throw Object.assign(new Error("confirmation_not_pending"), { code: "confirmation_not_pending" });
    const now = new Date().toISOString();
    this.session = {
      ...this.session,
      pendingConfirmation: { ...confirmation, status: confirmed ? "confirmed" : "rejected", resolvedAt: now }
    };
    this.emit("confirmation_resolved", { operationId: call.operationId, toolName: call.toolName, payload: { confirmed } });
    if (!confirmed) {
      this.pendingCall = undefined;
      this.session = { ...this.session, pendingConfirmation: undefined };
      this.appendMessage("assistant", "已取消这次操作，现有数据没有改变。");
      await this.persist();
      return this.session;
    }

    const result = await this.executeCall(call, undefined, true);
    this.pendingCall = undefined;
    this.session = { ...this.session, pendingConfirmation: undefined };
    await this.persist();
    if (!result.ok) return this.session;
    return this.turn("", pageContext);
  }

  private async handleAction(action: AgentPlannerAction, signal: AbortSignal) {
    switch (action.type) {
      case "assistant_message":
        this.appendMessage("assistant", action.message);
        return false;
      case "ask_user":
        this.appendMessage("assistant", action.message, undefined, undefined, action.options);
        this.session = { ...this.session, workflowState: { ...this.session.workflowState, status: "waiting_for_user" } };
        return false;
      case "request_confirmation":
        return this.requestConfirmation(action.call, action.message);
      case "workflow_complete":
        this.appendMessage("assistant", action.message);
        this.emit("workflow_completed", { message: action.message });
        return false;
      case "workflow_failed":
        this.appendMessage("assistant", action.message);
        this.emit("workflow_failed", { message: action.message, payload: { code: action.code, retryable: action.retryable } });
        return false;
      case "tool_call": {
        const allowedManifest = allowedToolManifestForStep(
          this.session.workflowState.workflowId,
          this.session.workflowState.step,
          this.dependencies.toolManifest
        );
        const allowedNames = new Set(allowedManifest.map((tool) => String(tool.name)));
        const normalizedCalls = action.calls.map((call) => {
          if (allowedNames.has(call.toolName)) return call;
          const recovered = recoverUnknownToolCall(call.toolName, allowedNames);
          if (recovered) {
            console.warn("[agent-planner-tool-alias]", { requestedToolName: call.toolName, normalizedToolName: recovered });
            return { ...call, toolName: recovered };
          }
          console.warn("[agent-planner-unknown-tool]", { requestedToolName: call.toolName, workflowId: this.session.workflowState.workflowId, step: this.session.workflowState.step });
          this.appendMessage("assistant", recoveryMessage(allowedNames));
          return undefined;
        }).filter((call): call is PendingCall => Boolean(call));
        if (!normalizedCalls.length) return false;
        const tools = normalizedCalls.map((call) => this.dependencies.executor.getDefinition(call.toolName));
        if (normalizedCalls.length > 1 && tools.some((tool) => !tool || tool.risk !== "read")) {
          throw Object.assign(new Error("parallel_tool_calls_must_be_read_only"), { code: "parallel_tool_calls_must_be_read_only" });
        }
        const results = await Promise.all(normalizedCalls.map((call) => this.executeCall(call, signal)));
        return results.every((result) => result.ok);
      }
    }
  }

  private async executeCall(call: PendingCall, signal?: AbortSignal, confirmed = false) {
    this.assertStepLimit();
    this.emit("tool_started", { operationId: call.operationId, toolName: call.toolName });
    try {
      const result = await this.dependencies.executor.execute({
        toolName: call.toolName,
        toolInput: call.input,
        operationId: call.operationId,
        signal,
        confirmed
      });
      this.recentResults.push(result);
      this.appendMessage("tool", result.ok ? "工具执行完成。" : result.error?.message ?? "工具执行失败。", call.toolName, call.operationId);
      this.emit(result.ok ? "tool_succeeded" : "tool_failed", {
        operationId: call.operationId,
        toolName: call.toolName,
        message: result.error?.message,
        payload: result.error ? { code: result.error.code, retryable: result.error.retryable } : undefined
      });
      return result;
    } catch (error) {
      if (error instanceof AgentConfirmationRequiredError) {
        this.pendingCall = call;
        this.setConfirmation(error.confirmation);
        return {
          ok: false,
          operationId: call.operationId,
          toolName: call.toolName,
          error: { code: error.code, message: error.message, retryable: true },
          artifactIds: [],
          completedAt: new Date().toISOString()
        } satisfies AgentToolResult;
      }
      throw error;
    }
  }

  private requestConfirmation(call: PendingCall, message: string) {
    this.pendingCall = call;
    this.setConfirmation({
      id: `confirmation-${call.operationId}`,
      operationId: call.operationId,
      toolName: call.toolName,
      title: "需要你的确认",
      description: message,
      destructive: false,
      status: "pending",
      requestedAt: new Date().toISOString()
    });
    return false;
  }

  private setConfirmation(confirmation: AgentConfirmation) {
    this.session = { ...this.session, pendingConfirmation: confirmation };
    this.emit("confirmation_requested", {
      operationId: confirmation.operationId,
      toolName: confirmation.toolName,
      message: confirmation.description
    });
  }

  private appendMessage(
    role: AgentMessage["role"],
    content: string,
    toolName?: string,
    operationId?: string,
    options?: AgentMessage["options"]
  ) {
    const message: AgentMessage = {
      id: `agent-message-${nanoid(12)}`,
      branchId: this.session.activeBranchId ?? "legacy-branch",
      role,
      content,
      toolName,
      operationId,
      options,
      parentMessageId: this.session.activeHeadMessageId,
      createdAt: new Date().toISOString()
    };
    const messages = [...this.session.messages, message];
    this.session = {
      ...this.session,
      messages,
      activeHeadMessageId: message.id,
      conversationBranches: this.session.conversationBranches.map((branch) =>
        branch.id === (this.session.activeBranchId ?? "legacy-branch") ? { ...branch, headMessageId: message.id } : branch
      )
    };
  }

  private emit(type: Parameters<AgentEventBus["emit"]>[0]["type"], partial: Partial<Parameters<AgentEventBus["emit"]>[0]> = {}) {
    const event = this.dependencies.eventBus.emit({
      id: `agent-event-${nanoid(12)}`,
      sessionId: this.session.id,
      type,
      createdAt: new Date().toISOString(),
      ...partial
    });
    this.session = { ...this.session, workflowState: workflowReducer(this.session.workflowState, event) };
  }

  private assertStepLimit() {
    const maximum = this.dependencies.maxToolCalls ?? 12;
    if (this.session.workflowState.toolCallCount >= maximum) {
      this.emit("workflow_failed", {
        message: `已达到最多 ${maximum} 次工具调用，任务已停止。`,
        payload: { code: "maximum_tool_steps_exceeded", retryable: false }
      });
      throw Object.assign(new Error("maximum_tool_steps_exceeded"), { code: "maximum_tool_steps_exceeded" });
    }
  }

  private async persist() {
    this.session = await this.dependencies.persistence.save({
      ...this.session,
      updatedAt: new Date().toISOString()
    });
  }
}

// Keep the historical value import (`new AgentRuntime`, `AgentRuntime.create`)
// source-compatible while the type namespace exposes the runtime boundary.
export const AgentRuntime = LegacyAgentRuntime;

function runtimeEvent(
  input: AgentRuntimeTurnInput,
  type: AgentRuntimeEventType,
  partial: Pick<AgentRuntimeEvent, "message" | "delta" | "data" | "error"> = {}
): AgentRuntimeEvent {
  return {
    type,
    sessionId: input.sessionId,
    turnId: input.turnId ?? "runtime-turn-unknown",
    timestamp: new Date().toISOString(),
    ...partial
  };
}

function recoveryMessage(allowedNames: Set<string>) {
  const labels = [...allowedNames].map(toolLabel).filter(Boolean);
  if (!labels.length) return "当前步骤需要先由你补充信息，我不会执行不可用的工具。";
  return `当前步骤可以继续：${labels.join("、")}。我已安全忽略不可用的工具请求。`;
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    list_resumes: "选择简历",
    list_profiles: "打开资料库",
    list_jobs: "查看岗位",
    parse_job_description: "解析岗位描述",
    commit_job: "保存岗位",
    export_resume: "导出简历"
  };
  return labels[name] ?? name;
}

function compactToolResult(result: AgentToolResult) {
  return {
    toolName: result.toolName,
    operationId: result.operationId,
    ok: result.ok,
    summary: result.ok
      ? JSON.stringify(result.data).slice(0, 1000)
      : `${result.error?.code}: ${result.error?.message}`.slice(0, 1000)
  };
}

export async function browserAgentPlanner(request: z.infer<typeof AgentTurnRequestSchema>, signal?: AbortSignal) {
  const settings = readAiSettings();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey || settings.baseUrl || settings.model) headers["x-ai-config"] = encodeAiSettingsForHeader(settings);
  const response = await fetch("/api/agent/turn", {
    method: "POST",
    headers,
    body: JSON.stringify(AgentTurnRequestSchema.parse(request)),
    signal
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? "Planner request failed."), { code: body?.error?.code ?? "planner_failed" });
  return AgentPlannerActionSchema.parse(body);
}
