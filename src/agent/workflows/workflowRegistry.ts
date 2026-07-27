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
const proceduralTools = ["skills_list", "skill_view", "get_agent_task_context", "search_agent_sessions"];

export const agentWorkflowRegistry: Record<string, AgentWorkflowDefinition> = {
  guided_profile_intake: workflow("guided_profile_intake", "collect_profile_scope", ["collect_profile_scope", "collect_experience", "review_facts", "confirm_commit", "completed"], {
    collect_profile_scope: profileReadTools,
    collect_experience: profileReadTools,
    review_facts: profileReadTools,
    confirm_commit: []
  }, {
    collect_profile_scope: ["open_profile_browser"],
    collect_experience: ["open_profile_browser"],
    review_facts: ["open_profile_browser"],
    confirm_commit: ["open_profile_browser"]
  }, ["profileId"]),
  resume_import: workflow("resume_import", "select_source", ["select_source", "prepare_import", "import_review", "resolve_target", "confirm_import", "import_complete"], {
    select_source: [],
    prepare_import: ["prepare_resume_import"],
    import_review: ["review_resume_import"],
    resolve_target: [...profileReadTools],
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
  build_resume_from_profile: workflow("build_resume_from_profile", "select_profile_scope", ["select_profile_scope", "select_facts", "review_resume_plan", "confirm_create", "completed"], {
    select_profile_scope: [...profileReadTools, ...jobReadTools],
    select_facts: [...profileReadTools, ...jobReadTools],
    review_resume_plan: [...profileReadTools, ...jobReadTools],
    confirm_create: []
  }, {
    select_profile_scope: ["open_profile_browser"],
    select_facts: ["open_profile_browser"],
    review_resume_plan: ["open_artifact"]
  }, ["profileId", "selectedFactIds"]),
  tailor_existing_resume: workflow("tailor_existing_resume", "choose_resume_source", ["select_resume", "choose_resume_source", "collect_job", "analyze_job", "review_job", "analyze_fit", "generate_plan", "answer_questions", "clarify_unsupported_facts", "preview_changes", "confirm_apply", "quality_result", "completed"], {
    select_resume: [...profileReadTools, ...resumeReadTools, ...jobReadTools],
    choose_resume_source: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "recommend_resume_source"],
    collect_job: [...profileReadTools, ...resumeReadTools, ...jobReadTools],
    analyze_job: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "parse_job_description"],
    review_job: [...jobReadTools, "commit_job"],
    analyze_fit: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "analyze_job_fit"],
    generate_plan: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "create_tailoring_session"],
    answer_questions: ["answer_tailoring_question"],
    clarify_unsupported_facts: ["answer_tailoring_question"],
    preview_changes: [...profileReadTools, ...resumeReadTools, ...jobReadTools, "preview_tailoring_changes"],
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
  repair_and_export_resume: workflow("repair_and_export_resume", "select_resume", ["select_resume", "review_export", "export", "completed"], {
    select_resume: resumeReadTools,
    review_export: resumeReadTools,
    export: [...resumeReadTools, "export_resume"]
  }, {
    select_resume: ["open_resume_picker"],
    review_export: ["open_artifact"]
  }, ["resumeId"])
};

export function getWorkflowDefinition(workflowId: string) {
  return agentWorkflowRegistry[workflowId] ?? agentWorkflowRegistry[workflowId.replace(/^quick_action:/, "")];
}

export function allowedToolManifestForStep(
  workflowId: string,
  step: string,
  manifest: Array<Record<string, unknown>>
) {
  const definition = getWorkflowDefinition(workflowId);
  if (!definition) return manifest;
  const allowed = new Set([...(definition.allowedToolsByStep[step] ?? []), ...proceduralTools]);
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
