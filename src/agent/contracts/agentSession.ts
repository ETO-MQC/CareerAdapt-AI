import { z } from "zod";
import { AgentArtifactRefSchema } from "./agentArtifact";
import { AgentErrorSchema } from "./agentTool";
import { AgentOptionSchema } from "./agentActions";
import { AgentTrajectorySchema } from "../kernel/AgentTrajectory";
import { AgentReflectionSchema } from "../kernel/AgentReflection";
import { AgentAttachmentRefSchema } from "@/services/agent/AgentAttachmentStore";

export const AgentOptionSetStateSchema = z.enum(["active", "resolved", "superseded", "stale"]);

export const AgentOptionSetSchema = z.object({
  optionSetId: z.string().min(1),
  optionSetRevision: z.number().int().min(0),
  sourceMessageId: z.string().min(1),
  state: AgentOptionSetStateSchema,
  resolvedOptionId: z.string().min(1).optional(),
  resolvedValue: z.string().min(1).optional(),
  resolvedAt: z.string().datetime({ offset: true }).optional()
}).strict();

export const ConversationBranchSchema = z.object({
  id: z.string().min(1),
  parentBranchId: z.string().min(1).optional(),
  forkedFromMessageId: z.string().min(1).optional(),
  headMessageId: z.string().min(1).optional(),
  status: z.enum(["active", "superseded", "archived"]),
  createdAt: z.string().datetime({ offset: true })
}).strict();

export const AgentMessageReferenceSchema = z.object({
  messageId: z.string().min(1),
  role: z.enum(["user", "assistant", "tool", "system"]),
  type: z.enum(["assistant_message", "user_message", "artifact", "tool_result"]),
  excerpt: z.string().max(280).optional()
}).strict();

export const AgentMessageRevisionSchema = z.object({
  id: z.string().min(1),
  content: z.string().max(8000),
  createdAt: z.string().datetime({ offset: true })
}).strict();

export const AgentMessageSchema = z.object({
  id: z.string().min(1),
  branchId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string().max(8000),
  kind: z.enum([
    "text",
    "assistant_thinking",
    "assistant_streaming",
    "tool_status",
    "interactive_card",
    "error_status",
    "system_notice"
  ]).optional(),
  type: z.enum([
    "text",
    "assistant_thinking",
    "assistant_streaming",
    "tool_status",
    "interactive_card",
    "error",
    "system_notice"
  ]).optional(),
  status: z.enum(["pending", "thinking", "streaming", "complete", "failed", "retrying", "recovered"]).optional(),
  errorCode: z.string().min(1).optional(),
  userMessageId: z.string().min(1).optional(),
  options: z.array(AgentOptionSchema).min(1).max(12).optional(),
  optionSet: AgentOptionSetSchema.optional(),
  toolName: z.string().min(1).optional(),
  operationId: z.string().min(8).max(160).optional(),
  parentMessageId: z.string().min(1).optional(),
  references: z.array(AgentMessageReferenceSchema).max(4).optional(),
  revisions: z.array(AgentMessageRevisionSchema).max(20).optional(),
  language: z.enum(["zh", "en", "unknown"]).optional(),
  streaming: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true })
}).strict();

export const AgentMessageRecordSchema = AgentMessageSchema.extend({
  sessionId: z.string().min(1),
  sequence: z.number().int().min(0)
}).strict();

export const AgentWorkflowStateSchema = z.object({
  workflowId: z.string().min(1),
  step: z.string().min(1),
  status: z.enum(["idle", "running", "waiting_for_user", "waiting_for_confirmation", "paused", "completed", "failed"]),
  toolCallCount: z.number().int().min(0).max(12).default(0),
  pendingOperationId: z.string().min(8).max(160).optional(),
  pendingToolName: z.string().min(1).optional(),
  data: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()).max(100)])
  ).default({}),
  error: AgentErrorSchema.optional()
}).strict();

export const AgentConfirmationSchema = z.object({
  id: z.string().min(1),
  turnId: z.string().min(1).optional(),
  operationId: z.string().min(8).max(160),
  toolName: z.string().min(1),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(1200),
  destructive: z.boolean().default(false),
  validatedInput: z.record(z.string(), z.unknown()).optional(),
  dependencyExpectation: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["pending", "confirmed", "rejected"]).default("pending"),
  requestedAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).optional()
}).strict();

export const AgentDependencySnapshotSchema = z.object({
  profileId: z.string().min(1).optional(),
  profileVersion: z.union([z.string().min(1), z.number().int().min(0)]).optional(),
  resumeId: z.string().min(1).optional(),
  resumeRevisionId: z.string().min(1).optional(),
  resumeHash: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  jobRevision: z.union([z.string().min(1), z.number().int().min(0)]).optional(),
  jobGraphHash: z.string().min(1).optional(),
  tailoringSessionId: z.string().min(1).optional()
}).strict();

export const AgentPendingDecisionSchema = z.object({
  type: z.enum(["resume_source_route", "profile_intake_target", "profile_intake_resume", "profile_intake_post_save"]),
  options: z.array(z.enum([
    "profile",
    "existing_resume",
    "switch_to_active",
    "keep_original",
    "save_profile_only",
    "generate_general_resume",
    "finish"
  ])).min(2).max(3)
}).strict();

export const AgentMemoryStateSchema = z.object({
  currentGoal: z.string().max(500).optional(),
  missingSlots: z.array(z.string().max(120)).max(24).default([]),
  currentStage: z.string().max(160).optional(),
  userPreferences: z.array(z.string().max(500)).max(32).default([]),
  episodic: z.array(z.string().max(1000)).max(32).default([]),
  procedural: z.array(z.string().max(160)).max(32).default([])
}).strict();

export const AgentPendingToolCallSchema = z.object({
  turnId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  operationId: z.string().min(8).max(160),
  input: z.record(z.string(), z.unknown())
}).strict();

export const AgentTurnSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  userMessageId: z.string().min(1).optional(),
  runtimeId: z.string().min(1).optional(),
  preferredRuntime: z.enum(["native", "hermes"]).optional(),
  attemptedRuntime: z.enum(["native", "hermes"]).optional(),
  finalRuntime: z.enum(["native", "hermes"]).optional(),
  executionOwner: z.enum(["native", "hermes", "deterministic_transition", "runtime_continuation"]).optional(),
  fallbackUsed: z.boolean().optional(),
  fallbackReasonCode: z.string().min(1).optional(),
  hermesRunId: z.string().min(1).optional(),
  nextHermesRunId: z.string().min(1).optional(),
  firstEventAt: z.string().datetime({ offset: true }).optional(),
  runtimeFailureAt: z.string().datetime({ offset: true }).optional(),
  status: z.enum(["running", "waiting_for_user", "waiting_for_confirmation", "completed", "failed", "aborted"]),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional()
}).strict();

const AgentTaskStateObjectSchema = z.object({
  // `goal` is retained as a persisted compatibility alias for rootGoal.
  goal: z.string().max(500).default("conversation"),
  rootGoal: z.string().max(500),
  activeGoal: z.string().max(500),
  workflowId: z.string().min(1),
  stage: z.string().min(1),
  requiredSlots: z.array(z.string().min(1)).max(32).default([]),
  knownSlots: z.record(z.string(), z.unknown()).default({}),
  missingSlots: z.array(z.string().min(1)).max(32).default([]),
  selectedEntities: z.object({
    profileId: z.string().min(1).optional(),
    profileVersion: z.union([z.string().min(1), z.number().int().min(0)]).optional(),
    resumeId: z.string().min(1).optional(),
    resumeRevisionId: z.string().min(1).optional(),
    resumeHash: z.string().min(1).optional(),
    jobId: z.string().min(1).optional(),
    jobRevision: z.union([z.string().min(1), z.number().int().min(0)]).optional(),
    jobGraphHash: z.string().min(1).optional(),
    tailoringSessionId: z.string().min(1).optional(),
    revisionId: z.string().min(1).optional()
  }).strict().default({}),
  attachment: AgentAttachmentRefSchema.optional(),
  pendingDecision: AgentPendingDecisionSchema.optional(),
  dependencySnapshots: z.object({
    fitResult: AgentDependencySnapshotSchema.optional(),
    tailoringSession: AgentDependencySnapshotSchema.optional(),
    clarificationAnswers: AgentDependencySnapshotSchema.optional(),
    preview: AgentDependencySnapshotSchema.optional(),
    pendingApplyConfirmation: AgentDependencySnapshotSchema.optional(),
    qualityResult: AgentDependencySnapshotSchema.optional()
  }).strict().default({}),
  artifacts: z.array(z.string().min(1)).max(128).default([]),
  lastObservation: z.unknown().optional(),
  completionStatus: z.enum(["active", "waiting_for_user", "waiting_for_confirmation", "completed", "failed", "cancelled"]).default("active"),
  computeTier: z.enum(["T0", "T1", "T2", "T3", "T4"]).default("T0"),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export const AgentTaskStateSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const state = value as Record<string, unknown>;
  const rootGoal = typeof state.rootGoal === "string"
    ? state.rootGoal
    : typeof state.goal === "string"
      ? state.goal
      : "conversation";
  return {
    ...state,
    goal: rootGoal,
    rootGoal,
    activeGoal: typeof state.activeGoal === "string" ? state.activeGoal : rootGoal
  };
}, AgentTaskStateObjectSchema);

export const AgentTurnCheckpointSchema = z.object({
  turnId: z.string().min(1),
  userMessageId: z.string().min(1),
  branchId: z.string().min(1).optional(),
  taskStateBefore: AgentTaskStateSchema,
  taskStateAfter: AgentTaskStateSchema.optional(),
  workflowStateBefore: AgentWorkflowStateSchema,
  workflowStateAfter: AgentWorkflowStateSchema.optional(),
  selectedEntitiesBefore: AgentTaskStateObjectSchema.shape.selectedEntities,
  artifactRefsBefore: z.array(AgentArtifactRefSchema).max(64),
  artifactRefsAfter: z.array(AgentArtifactRefSchema).max(64).optional(),
  pendingConfirmationBefore: AgentConfirmationSchema.optional(),
  pendingConfirmationAfter: AgentConfirmationSchema.optional(),
  pendingToolCallBefore: AgentPendingToolCallSchema.optional(),
  pendingToolCallAfter: AgentPendingToolCallSchema.optional(),
  toolReceipts: z.array(z.object({
    toolName: z.string().min(1),
    operationId: z.string().min(1),
    status: z.enum(["complete", "failed", "recovered"]),
    observation: z.unknown().optional()
  }).strict()).max(32).optional(),
  createdAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional()
}).strict();

export const HermesRunHandleSchema = z.object({
  runId: z.string().min(1),
  hermesSessionId: z.string().min(1),
  careerAgentSessionId: z.string().min(1),
  turnId: z.string().min(1),
  status: z.enum(["queued", "running", "waiting_for_approval", "stopping", "completed", "failed", "cancelled"]),
  startedAt: z.string().datetime({ offset: true }),
  lastEventAt: z.string().datetime({ offset: true })
}).strict();

export const AgentSessionSchema = z.object({
  // P4.3i adds pinned identity fields compatibly; keep the persisted session
  // schema number stable so existing session stores do not need a destructive
  // rewrite just to acquire the optional fields.
  agentSessionSchemaVersion: z.number().int().min(1).default(3),
  id: z.string().min(1),
  title: z.string().min(1).max(160),
  titleOrigin: z.enum(["default", "deterministic", "ai_summary", "user"]).default("default"),
  // Hydrated by WorkspaceRepository from the append-only AgentMessageRecord store.
  // This is intentionally unbounded at the session-contract level: model context
  // has its own independent budget in AgentContextWindow.
  messages: z.array(AgentMessageSchema),
  sessionRevision: z.number().int().min(0).default(0),
  workflowState: AgentWorkflowStateSchema,
  artifactRefs: z.array(AgentArtifactRefSchema).max(64),
  /** Session-pinned career identity. It never follows the global context implicitly. */
  personId: z.string().min(1).optional(),
  activeProfileId: z.string().min(1).optional(),
  profileVersionNumber: z.number().int().min(1).optional(),
  profileRevision: z.number().int().min(0).optional(),
  activeResumeId: z.string().min(1).optional(),
  activeJobId: z.string().min(1).optional(),
  conversationSummary: z.string().max(6000).default(""),
  memory: AgentMemoryStateSchema.optional(),
  trajectory: AgentTrajectorySchema.optional(),
  reflection: AgentReflectionSchema.optional(),
  pendingConfirmation: AgentConfirmationSchema.optional(),
  pendingToolCall: AgentPendingToolCallSchema.optional(),
  runtimeId: z.string().min(1).optional(),
  hermesRun: HermesRunHandleSchema.optional(),
  activeTurn: AgentTurnSchema.optional(),
  taskState: AgentTaskStateSchema.optional(),
  conversationBranches: z.array(ConversationBranchSchema).max(100).default([]),
  activeBranchId: z.string().min(1).default("legacy-branch"),
  activeHeadMessageId: z.string().min(1).optional(),
  conversationSummaryBranchId: z.string().min(1).optional(),
  turnCheckpoints: z.array(AgentTurnCheckpointSchema).max(100).default([]),
  archived: z.boolean().default(false),
  archivedAt: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type AgentMessageRevision = z.infer<typeof AgentMessageRevisionSchema>;
export type AgentMessageReference = z.infer<typeof AgentMessageReferenceSchema>;
export type AgentMessageRecord = z.infer<typeof AgentMessageRecordSchema>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type AgentWorkflowState = z.infer<typeof AgentWorkflowStateSchema>;
export type AgentConfirmation = z.infer<typeof AgentConfirmationSchema>;
export type AgentTurn = z.infer<typeof AgentTurnSchema>;
export type AgentTurnCheckpoint = z.infer<typeof AgentTurnCheckpointSchema>;
export type HermesRunHandle = z.infer<typeof HermesRunHandleSchema>;
export type AgentTaskState = z.infer<typeof AgentTaskStateSchema>;
export type AgentOptionSetState = z.infer<typeof AgentOptionSetStateSchema>;
export type AgentOptionSet = z.infer<typeof AgentOptionSetSchema>;
export type ConversationBranch = z.infer<typeof ConversationBranchSchema>;
export type AgentTaskTitleOrigin = AgentSession["titleOrigin"];

const AUTO_SESSION_TITLES = new Set(["新的 AI 任务", "AI 求职任务"]);

export function deriveAgentSessionTitle(message: string) {
  const firstLine = message
    .replace(/\r\n/g, "\n")
    .split("\n")[0]
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[，。！？!?、；;：:]+|[，。！？!?、；;：:]+$/g, "");
  if (!firstLine) return "新的 AI 任务";
  const characters = Array.from(firstLine);
  return characters.length > 32
    ? `${characters.slice(0, 32).join("")}…`
    : firstLine;
}

export function shouldAutoNameAgentSession(session: Pick<AgentSession, "title">) {
  return AUTO_SESSION_TITLES.has(session.title);
}

export function getAgentSessionDisplayTitle(
  session: Pick<AgentSession, "title" | "messages"> & { titleOrigin?: AgentSession["titleOrigin"] }
) {
  // Legacy records had no titleOrigin and may still carry the old placeholder.
  // Current and migrated records always use the bounded title service result.
  if (
    (session.titleOrigin === undefined || session.titleOrigin === "default")
    && session.title === "新的 AI 任务"
  ) {
    const firstUserMessage = session.messages.find((message) => message.role === "user" && message.content.trim());
    // Limit this compatibility path to un-migrated in-memory records. Current
    // Host-published messages carry an execution marker and keep the bounded
    // title service result instead of copying a long first message.
    return firstUserMessage && !firstUserMessage.metadata ? firstUserMessage.content : session.title;
  }
  return session.title;
}

export function serializeAgentSession(value: AgentSession) {
  return AgentSessionSchema.parse(value);
}
