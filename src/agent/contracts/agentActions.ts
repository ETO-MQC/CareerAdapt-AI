import { z } from "zod";
import { ProfileIntakeStructuredPatchSchema } from "@/domain/profileIntake/ProfileIntakeNormalizer";
import { ResumeSectionTypeV2Schema } from "@/domain/schemas/resumeV2";

export const ProfileIntakeSectionSchema = z.enum([
  "internship",
  "project",
  "campus",
  "skills",
  "awards",
  "certificates",
  "finish"
]);

export type ProfileIntakeSection = z.infer<typeof ProfileIntakeSectionSchema>;

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
  z.object({ type: z.literal("open_resume_upload") }).strict(),
  z.object({ type: z.literal("open_job_import_dialog") }).strict(),
  z.object({ type: z.literal("open_profile_browser") }).strict(),
  z.object({ type: z.literal("open_tool_palette") }).strict(),
  z.object({ type: z.literal("request_resume_import_consent"), attachmentId: z.string().min(1) }).strict(),
  z.object({
    type: z.literal("open_import_review"),
    importId: z.string().min(1),
    targetMode: z.enum(["existing", "new"])
  }).strict(),
  z.object({ type: z.literal("open_artifact"), artifactId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("select_tailoring_question"), questionId: z.string().min(1) }).strict()
]);

export const AgentArtifactActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("profile_intake_candidate_decision"),
    candidateId: z.string().min(1),
    decision: z.enum(["accept", "reject", "reopen"])
  }).strict(),
  z.object({
    type: z.literal("profile_intake_final_review_decision"),
    importId: z.string().min(1),
    expectedDraftRevision: z.number().int().min(0),
    decision: z.literal("accept_all")
  }).strict(),
  z.object({
    type: z.literal("resume_import_review_decision"),
    decision: z.enum(["accept_all", "ignore_uncertain"])
  }).strict(),
  z.object({
    type: z.literal("resume_import_reconciliation_decision"),
    incomingItemId: z.string().min(1),
    resolution: z.enum(["keep_existing", "use_imported", "keep_both_as_distinct"])
  }).strict(),
  z.object({
    type: z.literal("tailoring_answer_edit"),
    questionId: z.string().min(1),
    answer: z.union([z.string().min(1), z.array(z.string().min(1)), z.boolean()]),
    proficiency: z.enum(["proficient", "familiar", "aware", "learning"]).optional()
  }).strict(),
  z.object({
    type: z.literal("tailoring_regenerate")
  }).strict(),
  z.object({
    type: z.literal("tailoring_diff_stage_decision"),
    diffId: z.string().min(1),
    decision: z.enum(["accept", "edit", "reject"]),
    editedValue: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    generatedDiffRevision: z.number().int().min(0).optional()
  }).strict(),
  z.object({
    type: z.literal("tailoring_diff_submit"),
    reviews: z.array(z.object({
      diffId: z.string().min(1),
      decision: z.enum(["accept", "edit", "reject"]),
      editedValue: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
      generatedDiffRevision: z.number().int().min(0).optional()
    }).strict()).min(1).optional()
  }).strict(),
  z.object({
    type: z.literal("tailoring_diff_decision"),
    diffId: z.string().min(1),
    decision: z.enum(["accept", "edit", "reject"]),
    editedValue: z.union([z.string().min(1), z.array(z.string().min(1))]).optional()
  }).strict()
  ,z.object({
    type: z.literal("profile_intake_candidate_edit"),
    importId: z.string().min(1),
    expectedDraftRevision: z.number().int().min(0),
    candidateId: z.string().min(1),
    sectionType: ResumeSectionTypeV2Schema.exclude(["basics"]).optional(),
    editedLabel: z.string().trim().min(1).max(240).optional(),
    fieldPatch: ProfileIntakeStructuredPatchSchema.optional(),
    userCorrection: z.boolean().optional(),
    decision: z.literal("accept")
  }).strict().superRefine((action, context) => {
    const hasLabel = Boolean(action.editedLabel?.trim());
    const hasFields = Boolean(action.fieldPatch && Object.keys(action.fieldPatch).length);
    if (!hasLabel && !hasFields) {
      context.addIssue({
        code: "custom",
        path: ["fieldPatch"],
        message: "profile intake candidate edit requires a label or at least one field"
      });
    }
  }),
  z.object({
    type: z.literal("profile_intake_retry_extraction"),
    importId: z.string().min(1),
    sourceMessageId: z.string().min(1),
    expectedDraftRevision: z.number().int().min(0)
  }).strict(),
  z.object({
    type: z.literal("profile_intake_extraction_recovery"),
    importId: z.string().min(1),
    sourceMessageId: z.string().min(1),
    expectedDraftRevision: z.number().int().min(0),
    decision: z.enum(["manual_review", "preserve_source"])
  }).strict(),
  z.object({
    type: z.literal("profile_intake_reconciliation_decision"),
    incomingItemId: z.string().min(1),
    resolution: z.enum(["keep_existing", "use_imported", "keep_both_as_distinct"])
  }).strict()
]);

export const AgentOptionActionSchema = z.union([
  AgentWorkflowControlSchema,
  AgentUiActionSchema,
  z.object({
    type: z.literal("task_decision"),
    decisionType: z.enum(["resume_source_route", "job_target_persistence", "profile_intake_target", "profile_intake_resume", "profile_intake_post_save"]),
    option: z.enum([
      "profile",
      "existing_resume",
      "session_only",
      "save_job",
      "switch_to_active",
      "keep_original",
      "save_profile_only",
      "generate_general_resume",
      "finish"
    ])
  }).strict(),
  z.object({
    type: z.literal("quick_action_decision"),
    decision: z.enum([
      "continue_profile_intake",
      "view_profile",
      "edit_profile",
      "archive_profile",
      "import_current_version",
      "import_new_version",
      "import_new_person",
      "cancel_import"
    ])
  }).strict(),
  z.object({
    type: z.literal("quick_action_shortcut"),
    actionId: z.literal("import_existing_resume")
  }).strict(),
  z.object({
    type: z.literal("select_entity"),
    entityType: z.enum(["job", "resume"]),
    entityId: z.string().min(1),
    candidateSetRevision: z.string().min(1)
  }).strict(),
  z.object({
    type: z.literal("profile_intake_section_select"),
    section: ProfileIntakeSectionSchema,
    sourceMessageId: z.string().min(1),
    optionSetRevision: z.number().int().min(0)
  }).strict(),
  z.object({ type: z.literal("retry_current_step") }).strict(),
  z.object({ type: z.literal("new_tailoring_task") }).strict(),
  z.object({
    type: z.literal("answer"),
    field: z.string().min(1),
    value: z.unknown(),
    /** WorkflowInteraction binding; absent only for legacy persisted options. */
    interactionId: z.string().min(1).optional(),
    checkpointId: z.string().min(1).optional(),
    interactionRevision: z.number().int().min(0).optional()
  }).strict()
]);

export const AgentOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(240),
  disabled: z.boolean().optional(),
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

