import { z } from "zod";
import { AgentArtifactRefSchema } from "./agentArtifact";
import { AgentErrorSchema } from "./agentTool";

export const AGENT_SESSION_MAX_MESSAGES = 48;

export const AgentMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string().max(8000),
  kind: z.enum(["text", "error_status"]).optional(),
  status: z.enum(["failed", "retrying", "recovered"]).optional(),
  errorCode: z.string().min(1).optional(),
  userMessageId: z.string().min(1).optional(),
  options: z.array(z.object({
    value: z.string().min(1).max(240),
    label: z.string().min(1).max(240)
  }).strict()).min(1).max(12).optional(),
  toolName: z.string().min(1).optional(),
  operationId: z.string().min(8).max(160).optional(),
  createdAt: z.string().datetime({ offset: true })
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

export const AgentSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(160),
  messages: z.array(AgentMessageSchema).max(AGENT_SESSION_MAX_MESSAGES),
  workflowState: AgentWorkflowStateSchema,
  artifactRefs: z.array(AgentArtifactRefSchema).max(64),
  activeProfileId: z.string().min(1).optional(),
  activeResumeId: z.string().min(1).optional(),
  activeJobId: z.string().min(1).optional(),
  conversationSummary: z.string().max(6000).default(""),
  pendingConfirmation: AgentConfirmationSchema.optional(),
  archived: z.boolean().default(false),
  archivedAt: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type AgentWorkflowState = z.infer<typeof AgentWorkflowStateSchema>;
export type AgentConfirmation = z.infer<typeof AgentConfirmationSchema>;

export function serializeAgentSession(value: AgentSession) {
  return AgentSessionSchema.parse({
    ...value,
    messages: value.messages.slice(-AGENT_SESSION_MAX_MESSAGES)
  });
}
