import { describe, expect, it } from "vitest";
import { agentSkillRegistry } from "@/agent/kernel/AgentSkillRegistry";

describe("Agent Skill runtime", () => {
  it("lists compact metadata and loads one Skill progressively", () => {
    const listed = agentSkillRegistry.list();
    expect(listed).toHaveLength(8);
    expect(listed[0]).not.toHaveProperty("procedure");
    const viewed = agentSkillRegistry.view("resume-tailoring");
    expect(viewed.procedure).toHaveLength(10);
    expect(viewed.relevantTools).toContain("apply_tailoring_changes");
    expect(viewed.content).toContain("## Procedure");
    expect(agentSkillRegistry.view("resume-tailoring", "quality-checklist.md").content).toContain("事实证据");
  });

  it("discovers only relevant Skills and rejects path traversal", () => {
    const discovered = agentSkillRegistry.discover({
      workflowId: "analyze_job_fit",
      userMessage: "我的资料库经历丰富吗"
    });
    expect(discovered.map((skill) => skill.id)).toContain("career-experience-digging");
    expect(() => agentSkillRegistry.view("resume-tailoring", "../secret.md")).toThrow("Invalid skill reference path");
  });
});
