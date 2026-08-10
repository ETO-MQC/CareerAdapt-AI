import type { AgentUiAction } from "../contracts/agentActions";

export type AgentWorkflowDefinition = {
  id: string;
  initialStep: string;
  states: string[];
  allowedToolsByStep: Record<string, string[]>;
  allowedUiActionsByStep: Record<string, AgentUiAction["type"][]>;
  requiredSlots: Record<string, string[]>;
  completionCondition: string;
  cancelPolicy: "local_only" | "confirm_if_uncommitted_draft" | "confirm_always";
  resumePolicy: "resume_from_step" | "restart_step" | "manual_review";
};

const profileReadTools = ["list_profiles", "get_active_profile", "get_profile", "search_profile_facts"];
const resumeReadTools = ["list_resumes", "get_resume", "get_resume_revision"];
const jobReadTools = ["list_jobs", "get_job"];
const readTools = [...profileReadTools, ...resumeReadTools, ...jobReadTools];

/** Persisted pre-P4.5b sessions may still contain this identifier. It is an
 * alias only; all runtime decisions resolve it to the canonical composition
 * workflow before reading stages, tools, Skills, or recovery rules. */
export const LEGACY_WORKFLOW_ALIASES: Record<string, string> = {
  build_resume_from_profile: "compose_resume"
};

export function canonicalWorkflowId(workflowId: string) {
  const withoutQuickActionPrefix = workflowId.replace(/^quick_action:/, "");
  return LEGACY_WORKFLOW_ALIASES[withoutQuickActionPrefix] ?? withoutQuickActionPrefix;
}

export const agentWorkflowRegistry: Record<string, AgentWorkflowDefinition> = {
  guided_profile_intake: workflow("guided_profile_intake", "resolve_profile_target", ["resolve_profile_target", "collect_experience", "structure_facts", "review_facts", "final_review", "reconcile_profile", "resolve_conflicts", "confirm_commit", "profile_complete", "optional_resume_decision", "resume_ready"], {
    resolve_profile_target: profileReadTools,
    collect_experience: profileReadTools,
    structure_facts: [...profileReadTools, "capture_profile_intake"],
    review_facts: [...profileReadTools, "review_profile_intake"],
    final_review: [],
    reconcile_profile: ["reconcile_profile_intake"],
    resolve_conflicts: ["resolve_profile_intake_conflict"],
    confirm_commit: ["commit_profile_intake"],
    profile_complete: ["get_profile"],
    optional_resume_decision: ["ensure_general_resume_from_profile"],
    resume_ready: []
  }, {
    resolve_profile_target: ["open_profile_browser"],
    collect_experience: ["open_profile_browser"],
    review_facts: ["open_profile_browser"],
    final_review: ["open_artifact"],
    reconcile_profile: ["open_artifact"],
    resolve_conflicts: ["open_artifact"],
    confirm_commit: ["open_profile_browser"],
    optional_resume_decision: ["open_artifact"]
  }, []),
  resume_import: workflow("resume_import", "select_source", ["select_source", "prepare_import", "import_review", "resolve_target", "reconcile_profile", "resolve_conflicts", "confirm_import", "import_complete"], {
    select_source: [],
    prepare_import: ["prepare_resume_import"],
    import_review: ["review_resume_import"],
    resolve_target: [...profileReadTools],
    reconcile_profile: ["reconcile_resume_import"],
    resolve_conflicts: ["resolve_resume_reconciliation"],
    confirm_import: ["commit_resume_import"],
    import_complete: []
  }, {
    select_source: ["open_resume_picker"],
    import_review: ["open_artifact"],
    resolve_target: ["open_profile_browser"],
    confirm_import: ["open_artifact"]
  }, ["attachmentId"]),
  job_ingestion: {
    id: "job_ingestion",
    initialStep: "collect_job_identity",
    states: ["collect_job_identity", "complete_job_identity", "collect_job_description", "parse_job", "review_job", "review_job_semantics", "confirm_commit", "completed"],
    allowedToolsByStep: {
      collect_job_identity: [],
      complete_job_identity: [],
      collect_job_description: [],
      parse_job: ["parse_job_description"],
      review_job_semantics: [],
      review_job: ["commit_job"],
      confirm_commit: ["commit_job"],
      completed: []
    },
    allowedUiActionsByStep: {
      collect_job_identity: ["open_job_import_dialog"],
      complete_job_identity: ["open_job_import_dialog"],
      collect_job_description: ["open_job_import_dialog"],
      parse_job: [],
      review_job_semantics: ["open_artifact"],
      review_job: ["open_artifact"],
      confirm_commit: ["open_job_import_dialog"],
      completed: []
    },
    requiredSlots: {
      collect_job_identity: ["title", "company"],
      complete_job_identity: ["title", "company"],
      collect_job_description: ["rawText"],
      parse_job: ["rawText"],
      review_job_semantics: ["graph"],
      review_job: ["title", "company", "rawText", "graph"],
      confirm_commit: ["title", "company", "rawText", "graph"],
      completed: []
    },
    completionCondition: "JobDescription committed through WorkspaceRepository after user confirmation.",
    cancelPolicy: "confirm_if_uncommitted_draft",
    resumePolicy: "resume_from_step"
  },
  // Compatibility shape for callers that enumerate persisted workflow IDs.
  // `getWorkflowDefinition` and all active runtime paths resolve this alias to
  // compose_resume, so this is never a second executable workflow.
  build_resume_from_profile: workflow("build_resume_from_profile", "select_profile_scope", ["select_profile_scope", "review_composition", "confirm_create", "resume_ready", "completed"], {
    select_profile_scope: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "build_resume_evidence_graph", "plan_resume_composition"],
    review_composition: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "build_resume_evidence_graph", "plan_resume_composition", "review_resume_composition"],
    confirm_create: ["compose_resume"],
    resume_ready: []
  }, {
    select_profile_scope: ["open_profile_browser", "open_resume_picker", "open_job_import_dialog"],
    review_composition: ["open_artifact"],
    confirm_create: ["open_artifact"],
    resume_ready: ["open_artifact"]
  }, ["profileId", "mode"]),
  compose_resume: workflow("compose_resume", "select_profile_scope", ["select_profile_scope", "review_composition", "confirm_create", "resume_ready", "completed"], {
    select_profile_scope: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "build_resume_evidence_graph", "plan_resume_composition"],
    review_composition: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "build_resume_evidence_graph", "plan_resume_composition", "review_resume_composition"],
    confirm_create: ["compose_resume"],
    resume_ready: [],
    completed: []
  }, {
    select_profile_scope: ["open_profile_browser", "open_resume_picker", "open_job_import_dialog"],
    review_composition: ["open_artifact"],
    confirm_create: ["open_artifact"]
  }, ["profileId", "mode"]),
  tailor_existing_resume: workflow("tailor_existing_resume", "choose_resume_source", ["select_resume", "choose_resume_source", "choose_job", "collect_job", "analyze_job", "review_job", "analyze_fit", "generate_plan", "answer_questions", "clarify_unsupported_facts", "generate_changes", "preview_changes", "confirm_apply", "quality_result", "completed"], {
    select_resume: [...profileReadTools, ...resumeReadTools, ...jobReadTools],
    choose_resume_source: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "recommend_resume_source"],
    choose_job: ["list_jobs"],
    collect_job: [...profileReadTools, ...resumeReadTools, ...jobReadTools],
    analyze_job: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "parse_job_description"],
    review_job: [...jobReadTools, "commit_job"],
    analyze_fit: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "analyze_job_fit"],
    generate_plan: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "create_tailoring_session"],
    answer_questions: ["answer_tailoring_question"],
    clarify_unsupported_facts: ["answer_tailoring_question"],
    generate_changes: ["generate_tailoring_changes"],
    preview_changes: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "review_tailoring_diff", "preview_tailoring_changes"],
    confirm_apply: ["apply_tailoring_changes"],
    quality_result: [...resumeReadTools]
  }, {
    select_resume: ["open_resume_picker"],
    collect_job: ["open_job_import_dialog"],
    review_job: ["open_artifact"],
    preview_changes: ["open_artifact"]
  }, ["profileId", "resumeId", "jobId"]),
  analyze_job_fit: workflow("analyze_job_fit", "select_assets", ["select_assets", "analyze_fit", "review_result", "completed"], {
    select_assets: readTools,
    analyze_fit: [...readTools, "analyze_job_fit"],
    review_result: readTools
  }, {
    select_assets: ["open_resume_picker", "open_job_import_dialog", "open_profile_browser"],
    review_result: ["open_artifact"]
  }, ["profileId", "resumeId", "jobId"]),
  repair_and_export_resume: workflow("repair_and_export_resume", "select_resume", ["select_resume", "review_export", "export", "export_ready"], {
    select_resume: resumeReadTools,
    review_export: resumeReadTools,
    export: [...resumeReadTools, "export_resume"],
    export_ready: []
  }, {
    select_resume: ["open_resume_picker"],
    review_export: ["open_artifact"]
  }, ["resumeId"])
};

export function getWorkflowDefinition(workflowId: string) {
  return agentWorkflowRegistry[canonicalWorkflowId(workflowId)];
}

export function allowedToolManifestForStep(
  workflowId: string,
  step: string,
  manifest: Array<Record<string, unknown>>
) {
  const definition = getWorkflowDefinition(canonicalWorkflowId(workflowId));
  if (!definition) return manifest;
  // Canonical workflows already carry their task state and active Skills.
  // Session-memory/procedural tools must not compete with the required domain
  // action (for example, experience capture) and consume the iteration budget.
  const allowed = new Set(definition.allowedToolsByStep[step] ?? []);
  return manifest.filter((tool) => allowed.has(String(tool.name)));
}

export function isUiActionAllowed(workflowId: string, step: string, action: AgentUiAction) {
  const definition = getWorkflowDefinition(workflowId);
  if (!definition) return false;
  return (definition.allowedUiActionsByStep[step] ?? []).includes(action.type);
}

function workflow(
  id: string,
  initialStep: string,
  states: string[],
  allowedToolsByStep: Record<string, string[]>,
  allowedUiActionsByStep: Record<string, AgentUiAction["type"][]>,
  requiredSlots: string[]
): AgentWorkflowDefinition {
  return {
    id,
    initialStep,
    states,
    allowedToolsByStep: Object.fromEntries(states.map((state) => [state, allowedToolsByStep[state] ?? []])),
    allowedUiActionsByStep: Object.fromEntries(states.map((state) => [state, allowedUiActionsByStep[state] ?? []])),
    requiredSlots: Object.fromEntries(states.map((state) => [state, requiredSlots])),
    completionCondition: "Workflow reaches completed after required user confirmation and allowed tool execution.",
    cancelPolicy: "confirm_if_uncommitted_draft",
    resumePolicy: "resume_from_step"
  };
}
