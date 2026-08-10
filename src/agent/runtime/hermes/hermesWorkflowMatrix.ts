import type { CareerToolContract } from "../../tools/CareerToolGateway";

/**
 * The six roadshow workflows are intentionally expressed as tool coverage,
 * not as a second persistence model. Hermes may plan differently, while the
 * host still verifies that every workflow has the domain operations it needs.
 */
export const HERMES_WORKFLOW_MATRIX = [
  {
    id: "profile-intake",
    label: "Profile Intake",
    preferredFacades: ["career.workflow.profile_intake_turn", "career.workflow.profile_intake_finalize"],
    requiredTools: ["career.workflow.profile_intake_turn", "career.workflow.profile_intake_finalize", "career.profile.capture_intake", "career.profile.review_intake", "career.profile.commit_intake"]
  },
  {
    id: "resume-import",
    label: "Resume import",
    preferredFacades: ["career.workflow.resume_import"],
    requiredTools: ["career.workflow.resume_import", "career.resume.import.prepare", "career.resume.import.parse_file", "career.resume.import.review", "career.resume.import.commit"]
  },
  {
    id: "job-fit",
    label: "Job fit",
    preferredFacades: ["career.workflow.job_fit"],
    requiredTools: ["career.workflow.job_fit", "career.job.parse", "career.job.analyze_fit"]
  },
  {
    id: "tailoring",
    label: "Tailoring",
    preferredFacades: ["career.workflow.tailor_resume"],
    requiredTools: ["career.workflow.tailor_resume", "career.tailoring.create_session", "career.tailoring.generate_changes", "career.tailoring.review_diff", "career.tailoring.apply_changes"]
  },
  {
    id: "profile-to-resume",
    label: "Profile → Resume",
    preferredFacades: ["career.workflow.compose_resume", "career.workflow.profile_to_resume"],
    requiredTools: ["career.workflow.compose_resume", "career.resume.build_evidence_graph", "career.resume.plan_composition", "career.resume.compose", "career.resume.review_composition", "career.resume.ensure_general_from_profile", "career.resume.create_from_profile"]
  },
  {
    id: "repair-export",
    label: "Repair → Export",
    preferredFacades: ["career.workflow.resume_export"],
    requiredTools: ["career.workflow.resume_export", "career.preview.review_diff", "career.preview.apply_changes", "career.export.resume"]
  }
] as const;

export type HermesWorkflowCoverage = {
  workflowId: string;
  label: string;
  covered: boolean;
  missingTools: string[];
};

export function evaluateHermesWorkflowCoverage(contracts: CareerToolContract[]): HermesWorkflowCoverage[] {
  const available = new Set(contracts.map((contract) => contract.name));
  return HERMES_WORKFLOW_MATRIX.map((workflow) => {
    const missingTools = workflow.requiredTools.filter((name) => !available.has(name));
    return {
      workflowId: workflow.id,
      label: workflow.label,
      covered: missingTools.length === 0,
      missingTools: [...missingTools]
    };
  });
}

export function allHermesWorkflowsCovered(contracts: CareerToolContract[]) {
  return evaluateHermesWorkflowCoverage(contracts).every((workflow) => workflow.covered);
}
