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
    requiredTools: ["career.profile.capture_intake", "career.profile.review_intake", "career.profile.commit_intake"]
  },
  {
    id: "resume-import",
    label: "Resume import",
    requiredTools: ["career.resume.import.prepare", "career.resume.import.parse_file", "career.resume.import.review", "career.resume.import.commit"]
  },
  {
    id: "job-fit",
    label: "Job fit",
    requiredTools: ["career.job.parse", "career.job.analyze_fit"]
  },
  {
    id: "tailoring",
    label: "Tailoring",
    requiredTools: ["career.tailoring.create_session", "career.tailoring.generate_changes", "career.tailoring.review_diff", "career.tailoring.apply_changes"]
  },
  {
    id: "profile-to-resume",
    label: "Profile → Resume",
    requiredTools: ["career.resume.ensure_general_from_profile", "career.resume.create_from_profile"]
  },
  {
    id: "repair-export",
    label: "Repair → Export",
    requiredTools: ["career.preview.review_diff", "career.preview.apply_changes", "career.export.resume"]
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
