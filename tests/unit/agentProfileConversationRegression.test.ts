import regression from "../fixtures/agent-profile-regression.json";
import { describe, expect, it } from "vitest";
import { routeAgentIntent } from "@/agent/runtime/agentIntentRouter";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";

function services(): AgentToolServices {
  const result = async () => ({ value: "ok" });
  return {
    listResumes: result, listProfiles: result, listJobs: result,
    parseResumeFile: result, createResumeImportDraft: result, commitResumeImport: result,
    parseJobDescription: result, commitJob: result, analyzeJobFit: result,
    createTailoringSession: result, answerTailoringQuestion: result,
    previewTailoringChanges: result, applyTailoringChanges: result, exportResume: result
  };
}

describe("exported profile conversation regression", () => {
  it("keeps semantic profile questions on the Agent path", () => {
    for (const turn of regression.userTurns) {
      expect(routeAgentIntent(turn).kind).toBe("llm");
    }
  });

  it("makes authoritative profile reads available without exposing writes", () => {
    const registry = createAgentToolRegistry(services());
    const tools = new AgentToolResolver(registry).allowedTools({
      workflowId: "agent_quick_action",
      step: "collecting_intent",
      skills: []
    });
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(regression.requiredProfileTools));
    expect(names).not.toContain("apply_tailoring_changes");
    expect(names).not.toContain("commit_resume_import");
  });
});
