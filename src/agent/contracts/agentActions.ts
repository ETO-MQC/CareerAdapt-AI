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

export const AgentArtifactActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("profile_intake_candidate_decision"),
    candidateId: z.string().min(1),
    decision: z.enum(["accept", "reject"])
  }).strict(),
  z.object({
    type: z.literal("resume_import_review_decision"),
    decision: z.enum(["accept_all", "ignore_uncertain"])
  }).strict(),
  z.object({
    type: z.literal("resume_import_reconciliation_decision"),
    incomingItemId: z.string().min(1),
    resolution: z.enum(["keep_existing", "use_imported", "keep_both_as_distinct"])
  }).strict()
]);

export const AgentOptionActionSchema = z.union([
  AgentWorkflowControlSchema,
  AgentUiActionSchema,
  z.object({
    type: z.literal("task_decision"),
    decisionType: z.enum(["resume_source_route", "profile_intake_target", "profile_intake_resume"]),
    option: z.enum([
      "profile",
      "existing_resume",
      "switch_to_active",
      "keep_original",
      "save_profile_only",
      "generate_general_resume"
    ])
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
export type AgentArtifactAction = z.infer<typeof AgentArtifactActionSchema>;
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

