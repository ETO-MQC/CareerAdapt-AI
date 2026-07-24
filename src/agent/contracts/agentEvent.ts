import { z } from "zod";
import { AgentArtifactRefSchema } from "./agentArtifact";

export const AgentEventTypeSchema = z.enum([
  "session_created",
  "message_added",
  "planning_started",
  "action_received",
  "tool_started",
  "tool_succeeded",
  "tool_failed",
  "confirmation_requested",
  "confirmation_resolved",
  "artifact_created",
  "workflow_paused",
  "workflow_resumed",
  "workflow_completed",
  "workflow_failed"
]);

export const AgentEventSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  type: AgentEventTypeSchema,
  operationId: z.string().min(8).max(160).optional(),
  toolName: z.string().min(1).optional(),
  message: z.string().max(1000).optional(),
  artifact: AgentArtifactRefSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime({ offset: true })
}).strict();

export type AgentEvent = z.infer<typeof AgentEventSchema>;
