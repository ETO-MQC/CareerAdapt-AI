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
      value: z.string().min(1).max(240),
      label: z.string().min(1).max(240)
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
    summary: z.string().max(1000)
  }).strict()).max(8)
}).strict();

export type AgentPlanner = (request: z.infer<typeof AgentTurnRequestSchema>, signal?: AbortSignal) => Promise<AgentPlannerAction>;

export type AgentSessionPersistence = {
  save(session: AgentSession): Promise<AgentSession>;
};

type PendingCall = z.infer<typeof ToolCallSchema>;

export class AgentRuntime {
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

  static create(workflowId: string, initialStep: string, title = "新的 AI 任务") {
    const now = new Date().toISOString();
    return AgentSessionSchema.parse({
      id: `agent-session-${nanoid(12)}`,
      title,
      messages: [],
      workflowState: {
        workflowId,
        step: initialStep,
        status: "idle",
        toolCallCount: 0,
        data: {}
      },
      artifactRefs: [],
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
    if (userMessage.trim() && options.appendUserMessage !== false) this.appendMessage("user", userMessage.trim());
    await this.persist();

    try {
      for (;;) {
        this.emit("planning_started");
        const action = AgentPlannerActionSchema.parse(await this.dependencies.planner({
          userMessage,
          sessionSummary: this.session.conversationSummary,
          workflowState: this.session.workflowState,
          pageContext: AgentPageContextSchema.parse(pageContext),
          toolManifest: this.dependencies.toolManifest,
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
    this.controller?.abort();
    this.emit("workflow_paused");
    return this.persist();
  }

  async resume(pageContext: AgentPageContext) {
    this.paused = false;
    this.emit("workflow_resumed");
    await this.persist();
    return this.turn("", pageContext);
  }

  abort() {
    this.controller?.abort();
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
        const tools = action.calls.map((call) => this.dependencies.executor.getDefinition(call.toolName));
        if (action.calls.length > 1 && tools.some((tool) => !tool || tool.risk !== "read")) {
          throw Object.assign(new Error("parallel_tool_calls_must_be_read_only"), { code: "parallel_tool_calls_must_be_read_only" });
        }
        const results = await Promise.all(action.calls.map((call) => this.executeCall(call, signal)));
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
      role,
      content,
      toolName,
      operationId,
      options,
      createdAt: new Date().toISOString()
    };
    const messages = [...this.session.messages, message];
    const overflow = messages.slice(0, Math.max(0, messages.length - 40));
    this.session = {
      ...this.session,
      messages: messages.slice(-40),
      conversationSummary: overflow.length
        ? `${this.session.conversationSummary}\n${overflow.map((item) => `${item.role}: ${item.content.slice(0, 240)}`).join("\n")}`.slice(-6000)
        : this.session.conversationSummary
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
