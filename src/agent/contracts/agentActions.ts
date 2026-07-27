import { z } from "zod";

export const AgentWorkflowControlSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start_workflow"), workflowId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("switch_workflow"), workflowId: z.string().min(1), preserveCurrent: z.boolean() }).strict(),
  z.object({ type: z.literal("pause_workflow"), workflowId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("resume_workflow"), workflowId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("cancel_workflow"), workflowId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("go_back"), workflowId: z.string().min(1) }).strict()
]);

export const AgentUiActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("open_resume_picker") }).strict(),
  z.object({ type: z.literal("open_job_import_dialog") }).strict(),
  z.object({ type: z.literal("open_profile_browser") }).strict(),
  z.object({ type: z.literal("open_tool_palette") }).strict(),
  z.object({ type: z.literal("open_artifact"), artifactId: z.string().min(1) }).strict()
]);

export const AgentOptionActionSchema = z.union([
  AgentWorkflowControlSchema,
  AgentUiActionSchema,
  z.object({
    type: z.literal("task_decision"),
    decisionType: z.literal("resume_source_route"),
    option: z.enum(["profile", "existing_resume"])
  }).strict(),
  z.object({ type: z.literal("answer"), field: z.string().min(1), value: z.unknown() }).strict()
]);

export const AgentOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(240),
  action: AgentOptionActionSchema
}).strict();

export type AgentWorkflowControl = z.infer<typeof AgentWorkflowControlSchema>;
export type AgentUiAction = z.infer<typeof AgentUiActionSchema>;
export type AgentOptionAction = z.infer<typeof AgentOptionActionSchema>;
export type AgentOption = z.infer<typeof AgentOptionSchema>;

export type AgentConversationInput = {
  type: "conversation_input";
  message: string;
};

export type AgentToolCall = {
  type: "tool_call";
  toolName: string;
  operationId: string;
  input: Record<string, unknown>;
};

