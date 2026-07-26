import { z } from "zod";
import { AgentArtifactRefSchema } from "./agentArtifact";
import { AgentErrorSchema } from "./agentTool";
import { AgentOptionSchema } from "./agentActions";
import { AgentTrajectorySchema } from "../kernel/AgentTrajectory";
import { AgentReflectionSchema } from "../kernel/AgentReflection";

export const AgentMessageSchema = z.object({
  id: z.string().min(1),
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
  toolName: z.string().min(1).optional(),
  operationId: z.string().min(8).max(160).optional(),
  parentMessageId: z.string().min(1).optional(),
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
  operationId: z.string().min(8).max(160),
  toolName: z.string().min(1),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(1200),
  destructive: z.boolean().default(false),
  status: z.enum(["pending", "confirmed", "rejected"]).default("pending"),
  requestedAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).optional()
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
  toolName: z.string().min(1),
  operationId: z.string().min(8).max(160),
  input: z.record(z.string(), z.unknown())
}).strict();

export const AgentSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(160),
  // Hydrated by WorkspaceRepository from the append-only AgentMessageRecord store.
  // This is intentionally unbounded at the session-contract level: model context
  // has its own independent budget in AgentContextWindow.
  messages: z.array(AgentMessageSchema),
  sessionRevision: z.number().int().min(0).default(0),
  workflowState: AgentWorkflowStateSchema,
  artifactRefs: z.array(AgentArtifactRefSchema).max(64),
  activeProfileId: z.string().min(1).optional(),
  activeResumeId: z.string().min(1).optional(),
  activeJobId: z.string().min(1).optional(),
  conversationSummary: z.string().max(6000).default(""),
  memory: AgentMemoryStateSchema.optional(),
  trajectory: AgentTrajectorySchema.optional(),
  reflection: AgentReflectionSchema.optional(),
  pendingConfirmation: AgentConfirmationSchema.optional(),
  pendingToolCall: AgentPendingToolCallSchema.optional(),
  archived: z.boolean().default(false),
  archivedAt: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type AgentMessageRecord = z.infer<typeof AgentMessageRecordSchema>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type AgentWorkflowState = z.infer<typeof AgentWorkflowStateSchema>;
export type AgentConfirmation = z.infer<typeof AgentConfirmationSchema>;

export function serializeAgentSession(value: AgentSession) {
  return AgentSessionSchema.parse(value);
}
