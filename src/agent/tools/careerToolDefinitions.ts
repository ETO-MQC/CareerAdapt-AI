import type { CareerToolPersonProfileBinding, CareerToolReadWrite } from "./CareerToolGateway";

export type CareerToolDefinition = {
  name: string;
  sourceToolName: string;
  namespace: string;
  readWrite: CareerToolReadWrite;
  personProfileBinding: CareerToolPersonProfileBinding;
  hermesProduction?: true;
};

export const CAREER_TOOL_DEFINITIONS: CareerToolDefinition[] = [
  { name: "career.material.prepare", sourceToolName: "prepare_material_intake", namespace: "career.material", readWrite: "write", personProfileBinding: "optional" },
  { name: "career.system.runtime_status", sourceToolName: "get_agent_runtime_status", namespace: "career.system", readWrite: "read", personProfileBinding: "none" },
  { name: "career.system.current_task", sourceToolName: "get_agent_current_task", namespace: "career.system", readWrite: "read", personProfileBinding: "none" },
  { name: "career.system.last_failure", sourceToolName: "get_agent_last_failure", namespace: "career.system", readWrite: "read", personProfileBinding: "none" },
  { name: "career.profile.list", sourceToolName: "list_profiles", namespace: "career.profile", readWrite: "read", personProfileBinding: "none" },
  { name: "career.profile.active", sourceToolName: "get_active_profile", namespace: "career.profile", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.profile.get", sourceToolName: "get_profile", namespace: "career.profile", readWrite: "read", personProfileBinding: "required", hermesProduction: true },
  { name: "career.profile.search_facts", sourceToolName: "search_profile_facts", namespace: "career.profile", readWrite: "read", personProfileBinding: "required" },
  { name: "career.context.retrieve", sourceToolName: "retrieve_career_context", namespace: "career.context", readWrite: "read", personProfileBinding: "required", hermesProduction: true },
  { name: "career.profile.capture_intake", sourceToolName: "capture_profile_intake", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },
  { name: "career.profile.synthesize_intake", sourceToolName: "synthesize_profile_intake", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },
  { name: "career.profile.review_intake", sourceToolName: "review_profile_intake", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },
  { name: "career.profile.reconcile_intake", sourceToolName: "reconcile_profile_intake", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },
  { name: "career.profile.resolve_intake_conflict", sourceToolName: "resolve_profile_intake_conflict", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },
  { name: "career.profile.commit_intake", sourceToolName: "commit_profile_intake", namespace: "career.profile", readWrite: "write", personProfileBinding: "required" },

  { name: "career.resume.prepare_precise_edit", sourceToolName: "prepare_precise_resume_edit", namespace: "career.resume", readWrite: "read", personProfileBinding: "required" },
  { name: "career.resume.apply_precise_edit", sourceToolName: "apply_precise_resume_edit", namespace: "career.resume", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.list", sourceToolName: "list_resumes", namespace: "career.resume", readWrite: "read", personProfileBinding: "optional", hermesProduction: true },
  { name: "career.resume.get", sourceToolName: "get_resume", namespace: "career.resume", readWrite: "read", personProfileBinding: "optional", hermesProduction: true },
  { name: "career.resume.get_revision", sourceToolName: "get_resume_revision", namespace: "career.resume", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.resume.recommend_source", sourceToolName: "recommend_resume_source", namespace: "career.resume", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.resume.create_from_profile", sourceToolName: "create_resume_from_profile", namespace: "career.resume", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.create_job_from_profile", sourceToolName: "create_job_resume_from_profile", namespace: "career.resume", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.ensure_general_from_profile", sourceToolName: "ensure_general_resume_from_profile", namespace: "career.resume", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.build_evidence_graph", sourceToolName: "build_resume_evidence_graph", namespace: "career.resume", readWrite: "read", personProfileBinding: "required" },
  { name: "career.resume.plan_composition", sourceToolName: "plan_resume_composition", namespace: "career.resume", readWrite: "read", personProfileBinding: "required" },
  { name: "career.resume.review_composition", sourceToolName: "review_resume_composition", namespace: "career.resume", readWrite: "read", personProfileBinding: "required" },
  { name: "career.resume.compose", sourceToolName: "compose_resume", namespace: "career.resume", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.import.prepare", sourceToolName: "prepare_resume_import", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "optional" },
  { name: "career.resume.import.parse_file", sourceToolName: "parse_resume_file", namespace: "career.resume.import", readWrite: "read", personProfileBinding: "optional" },
  { name: "career.resume.import.create_draft", sourceToolName: "create_resume_import_draft", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "optional" },
  { name: "career.resume.import.review", sourceToolName: "review_resume_import", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "optional" },
  { name: "career.resume.import.reconcile", sourceToolName: "reconcile_resume_import", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.import.resolve_reconciliation", sourceToolName: "resolve_resume_reconciliation", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.import.commit", sourceToolName: "commit_resume_import", namespace: "career.resume.import", readWrite: "write", personProfileBinding: "required" },
  { name: "career.resume.archive", sourceToolName: "archive_resume", namespace: "career.resume", readWrite: "write", personProfileBinding: "optional" },
  { name: "career.resume.restore", sourceToolName: "restore_resume", namespace: "career.resume", readWrite: "write", personProfileBinding: "optional" },

  { name: "career.job.list", sourceToolName: "list_jobs", namespace: "career.job", readWrite: "read", personProfileBinding: "none", hermesProduction: true },
  { name: "career.job.get", sourceToolName: "get_job", namespace: "career.job", readWrite: "read", personProfileBinding: "none", hermesProduction: true },
  { name: "career.job.parse", sourceToolName: "parse_job_description", namespace: "career.job", readWrite: "write", personProfileBinding: "none" },
  { name: "career.job.commit", sourceToolName: "commit_job", namespace: "career.job", readWrite: "write", personProfileBinding: "none" },
  { name: "career.job.analyze_fit", sourceToolName: "analyze_job_fit", namespace: "career.job", readWrite: "read", personProfileBinding: "required" },

  { name: "career.tailoring.create_session", sourceToolName: "create_tailoring_session", namespace: "career.tailoring", readWrite: "write", personProfileBinding: "required" },
  { name: "career.tailoring.answer_question", sourceToolName: "answer_tailoring_question", namespace: "career.tailoring", readWrite: "write", personProfileBinding: "required" },
  { name: "career.tailoring.generate_changes", sourceToolName: "generate_tailoring_changes", namespace: "career.tailoring", readWrite: "write", personProfileBinding: "required" },
  { name: "career.tailoring.review_diff", sourceToolName: "review_tailoring_diff", namespace: "career.tailoring", readWrite: "write", personProfileBinding: "required" },
  { name: "career.tailoring.preview_changes", sourceToolName: "preview_tailoring_changes", namespace: "career.tailoring", readWrite: "read", personProfileBinding: "required" },
  { name: "career.tailoring.apply_changes", sourceToolName: "apply_tailoring_changes", namespace: "career.tailoring", readWrite: "write", personProfileBinding: "required" },
  { name: "career.preview.review_diff", sourceToolName: "review_tailoring_diff", namespace: "career.preview", readWrite: "write", personProfileBinding: "required" },
  { name: "career.preview.apply_changes", sourceToolName: "apply_tailoring_changes", namespace: "career.preview", readWrite: "write", personProfileBinding: "required" },
  { name: "career.export.resume", sourceToolName: "export_resume", namespace: "career.export", readWrite: "write", personProfileBinding: "optional" }
];
