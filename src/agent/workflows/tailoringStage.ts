import { z } from "zod";

/**
 * The Tailoring workflow has one stage vocabulary.  UI actions, planner
 * hints, and tool names are deliberately kept out of this value: a stage is
 * an authoritative Host checkpoint, never a description of what the model
 * happens to say next.
 */
export const TailoringStageSchema = z.enum([
  "choose_resume_source",
  "choose_job",
  "analyze_fit",
  "generate_plan",
  "clarify_unsupported_facts",
  "generate_changes",
  "preview_changes",
  "confirm_apply",
  "quality_result"
]);

export type TailoringStage = z.infer<typeof TailoringStageSchema>;

export const TAILORING_STAGES = TailoringStageSchema.options;

/** Legacy persisted labels are accepted only while entering the canonical
 * TaskState boundary. They are never emitted as a current stage. */
const TAILORING_STAGE_ALIASES: Record<string, TailoringStage> = {
  select_resume: "choose_resume_source",
  answer_questions: "clarify_unsupported_facts",
  answer_tailoring_question: "clarify_unsupported_facts",
  completed: "quality_result"
};

export function normalizeTailoringStage(value: string): TailoringStage | undefined {
  const direct = TailoringStageSchema.safeParse(value);
  return direct.success ? direct.data : TAILORING_STAGE_ALIASES[value];
}

export const TAILORING_ALLOWED_TOOLS_BY_STAGE: Record<TailoringStage, readonly string[]> = {
  choose_resume_source: ["list_resumes", "recommend_resume_source"],
  choose_job: ["list_jobs"],
  analyze_fit: ["get_profile", "get_resume", "get_resume_revision", "get_job", "analyze_job_fit"],
  generate_plan: ["create_tailoring_session"],
  clarify_unsupported_facts: ["answer_tailoring_question"],
  generate_changes: ["generate_tailoring_changes"],
  preview_changes: ["review_tailoring_diff", "preview_tailoring_changes"],
  confirm_apply: ["apply_tailoring_changes"],
  quality_result: ["get_resume", "get_resume_revision"]
};

/** The one semantic operation that can advance each mutable Tailoring stage. */
export const TAILORING_REQUIRED_TOOL_BY_STAGE: Partial<Record<TailoringStage, string>> = {
  clarify_unsupported_facts: "answer_tailoring_question",
  generate_changes: "generate_tailoring_changes",
  preview_changes: "preview_tailoring_changes",
  confirm_apply: "apply_tailoring_changes"
};

export function isTailoringStage(value: string): value is TailoringStage {
  return TailoringStageSchema.safeParse(value).success;
}

export function isTailoringQuestionPaused(value: unknown) {
  const record = objectValue(value);
  const session = objectValue(record.session ?? value);
  const plan = objectValue(session.plan ?? record.plan);
  const questionPlan = objectValue(plan.questionPlan ?? record.questionPlan);
  return questionPlan.status === "asking" || typeof questionPlan.activeQuestionId === "string" && questionPlan.activeQuestionId.trim().length > 0;
}

export function tailoringToolAllowedAtStage(stage: string, sourceToolName: string) {
  const canonical = normalizeTailoringStage(stage);
  return canonical ? TAILORING_ALLOWED_TOOLS_BY_STAGE[canonical].includes(sourceToolName) : false;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
