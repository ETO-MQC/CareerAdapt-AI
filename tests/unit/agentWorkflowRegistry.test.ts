import { describe, expect, it } from "vitest";
import { allowedToolManifestForStep, agentWorkflowRegistry, isUiActionAllowed } from "@/agent/workflows/workflowRegistry";

const manifest = [
  { name: "list_resumes" },
  { name: "parse_job_description" },
  { name: "commit_job" },
  { name: "apply_tailoring_changes" }
];

describe("agent workflow registry", () => {
  it("defines the required workflows", () => {
    expect(Object.keys(agentWorkflowRegistry)).toEqual(expect.arrayContaining([
      "guided_profile_intake",
      "resume_import",
      "job_ingestion",
      "build_resume_from_profile",
      "tailor_existing_resume",
      "analyze_job_fit",
      "repair_and_export_resume"
    ]));
  });

  it("gates tools by the current workflow step", () => {
    expect(allowedToolManifestForStep("job_ingestion", "parse_job", manifest).map((tool) => tool.name)).toEqual(["parse_job_description"]);
    expect(allowedToolManifestForStep("job_ingestion", "confirm_commit", manifest).map((tool) => tool.name)).toEqual(["commit_job"]);
  });

  it("gates UI actions by the current workflow step", () => {
    expect(isUiActionAllowed("job_ingestion", "collect_job_identity", { type: "open_job_import_dialog" })).toBe(true);
    expect(isUiActionAllowed("job_ingestion", "parse_job", { type: "open_resume_picker" })).toBe(false);
  });
});

