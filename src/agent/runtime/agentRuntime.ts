import { nanoid } from "nanoid";
import {
  AgentSessionSchema,
  type AgentSession,
  type WorkflowAgentSession,
  isWorkflowAgentSession
} from "../contracts/agentSession";
import type { AgentPageContext } from "../contracts/agentContext";
import type { ActiveCareerContext } from "@/domain/schemas";
import type { RunStopReason } from "./hermes/hermesIncidentTrace";

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

/** Stable runtime boundary implemented by HermesCareerAgentRuntime. */
export interface AgentRuntime {
  readonly id: string;
  runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent>;
  pause(sessionId: string): Promise<void>;
  interrupt(sessionId: string, reason?: RunStopReason): Promise<void>;
  /** Releases only the runtime-session binding after a verified model apply. */
  releaseSessionBinding?(sessionId: string): void;
  resume(sessionId: string): Promise<void>;
  capabilities(): AgentRuntimeCapabilities;
}

/**
 * Session factories retain the historical value name used by the workspace
 * and persisted-session fixtures. They do not instantiate or execute a local
 * agent runtime; Hermes owns production orchestration.
 */
export const AgentRuntime = {
  create(
    workflowId: string,
    initialStep: string,
    title = "新的 AI 任务",
    context?: ActiveCareerContext
  ): WorkflowAgentSession {
    const now = new Date().toISOString();
    const session = AgentSessionSchema.parse({
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
    if (!isWorkflowAgentSession(session)) throw new Error("workflow_session_required");
    return session;
  },

  createConversationSession(title = "新的对话", context?: ActiveCareerContext) {
    const now = new Date().toISOString();
    return AgentSessionSchema.parse({
      id: `agent-session-${nanoid(12)}`,
      title,
      titleOrigin: title === "新的对话" ? "default" : "user",
      messages: [],
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
};
