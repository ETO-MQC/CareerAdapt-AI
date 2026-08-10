import { describe, expect, it } from "vitest";
import {
  allowedToolManifestForStep,
  agentWorkflowRegistry,
  getWorkflowDefinition,
  isUiActionAllowed
} from "@/agent/workflows/workflowRegistry";
import { agentToolNames } from "@/agent/tools/registry";
import { agentSkillRegistry } from "@/agent/kernel/AgentSkillRegistry";

const manifest = [
  { name: "list_resumes" },
  { name: "parse_job_description" },
  { name: "commit_job" },
  { name: "apply_tailoring_changes" },
  { name: "capture_profile_intake" },
  { name: "reconcile_resume_import" },
  { name: "resolve_resume_reconciliation" },
  { name: "skills_list" },
  { name: "skill_view" },
  { name: "get_agent_task_context" },
  { name: "search_agent_sessions" }
];

describe("agent workflow registry", () => {
  it("defines the required workflows", () => {
    expect(Object.keys(agentWorkflowRegistry)).toEqual(expect.arrayContaining([
      "guided_profile_intake",
      "resume_import",
      "job_ingestion",
      "build_resume_from_profile",
      "compose_resume",
      "tailor_existing_resume",
      "analyze_job_fit",
      "repair_and_export_resume"
    ]));
  });

  it("resolves the legacy Card 4 workflow to the canonical composition definition", () => {
    expect(getWorkflowDefinition("build_resume_from_profile")).toBe(getWorkflowDefinition("compose_resume"));
    expect(allowedToolManifestForStep("build_resume_from_profile", "review_composition", [
      { name: "build_resume_evidence_graph" },
      { name: "plan_resume_composition" },
      { name: "review_resume_composition" },
      { name: "create_resume_from_profile" }
    ]).map((tool) => tool.name)).toEqual([
      "build_resume_evidence_graph",
      "plan_resume_composition",
      "review_resume_composition"
    ]);
  });

  it("keeps every composition Skill preferred tool present and stage-permitted", () => {
    const compose = getWorkflowDefinition("compose_resume");
    expect(compose).toBeDefined();
    const allowed = new Set(Object.values(compose!.allowedToolsByStep).flat());
    for (const skillId of ["resume-from-profile", "resume-composition"]) {
      const skill = agentSkillRegistry.view(skillId);
      for (const toolName of skill.relevantTools) {
        expect(agentToolNames).toContain(toolName);
        expect(allowed).toContain(toolName);
      }
    }
  });

  it("gates tools by the current workflow step", () => {
    expect(allowedToolManifestForStep("job_ingestion", "parse_job", manifest).map((tool) => tool.name)).toEqual(["parse_job_description"]);
    expect(allowedToolManifestForStep("job_ingestion", "confirm_commit", manifest).map((tool) => tool.name)).toEqual(["commit_job"]);
    expect(allowedToolManifestForStep("resume_import", "reconcile_profile", manifest).map((tool) => tool.name)).toEqual(["reconcile_resume_import"]);
    expect(allowedToolManifestForStep("resume_import", "resolve_conflicts", manifest).map((tool) => tool.name)).toEqual(["resolve_resume_reconciliation"]);
    expect(allowedToolManifestForStep("guided_profile_intake", "structure_facts", manifest).map((tool) => tool.name)).toEqual(["capture_profile_intake"]);
  });

  it("does not expose procedural or session-memory tools inside a canonical domain step", () => {
    expect(allowedToolManifestForStep("guided_profile_intake", "structure_facts", manifest).map((tool) => tool.name)).toEqual([
      "capture_profile_intake"
    ]);
  });

  it("gates UI actions by the current workflow step", () => {
    expect(isUiActionAllowed("job_ingestion", "collect_job_identity", { type: "open_job_import_dialog" })).toBe(true);
    expect(isUiActionAllowed("job_ingestion", "parse_job", { type: "open_resume_picker" })).toBe(false);
  });
});

