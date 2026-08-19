import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { routeAgentIntent } from "@/agent/runtime/agentIntentRouter";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";

describe("P4.2a.3 single runtime closure", () => {
  it.each([
    "基于现有简历做岗位定制",
    "用最新的通用简历，针对AI训练师",
    "基于这些建议创建一份新的定制简历",
    "导入简历",
    "从资料库生成简历",
    "分析岗位匹配度",
    "导出简历"
  ])("keeps the natural-language domain turn on AgentHost: %s", (message) => {
    expect(routeAgentIntent(message)).toEqual({ kind: "llm", confidence: "low" });
  });

  it("continues the active tailoring task before interpreting global domain keywords", () => {
    const reducer = new AgentTaskStateReducer();
    let state = reducer.create(
      AgentRuntime.create("tailor_existing_resume", "preview_changes"),
      "create_tailored_resume"
    );
    state = {
      ...state,
      stage: "preview_changes",
      selectedEntities: {
        profileId: "profile-1",
        resumeId: "resume-general-latest",
        jobId: "job-ai-trainer"
      },
      knownSlots: {
        tailoringSession: { id: "tailoring-1" },
        selectedDiffs: [{ id: "diff-1" }],
        fitAnalysis: { score: 82 }
      }
    };

    const continued = reducer.reduce(state, {
      type: "user_message",
      message: "基于这些建议创建一份新的定制简历"
    });

    expect(continued.goal).toBe("create_tailored_resume");
    expect(continued.rootGoal).toBe("create_tailored_resume");
    expect(continued.activeGoal).toBe("create_tailored_resume");
    expect(continued.stage).toBe("preview_changes");
    expect(continued.selectedEntities).toEqual({
      ...state.selectedEntities,
      sourceResumeId: "resume-general-latest",
      sourceResumeRevisionId: undefined
    });
  });

  it("leaves AgentWorkspace as a view adapter with no legacy conversation owner", () => {
    const workspace = fs.readFileSync(
      path.resolve("src/components/agent/AgentWorkspace.tsx"),
      "utf8"
    );
    const provider = fs.readFileSync(
      path.resolve("src/components/agent/runtime/AgentRuntimeProvider.tsx"),
      "utf8"
    );

    expect(workspace).not.toContain("appendLocalMessage");
    expect(workspace).not.toContain("consumeAgentStream");
    expect(workspace).not.toContain("dependencies.controller");
    expect(workspace).not.toContain("dependencies.kernel.runTurn");
    expect(provider).not.toContain("TailorExistingResumeWorkflowController");
    expect(provider).not.toContain("beginTurn()");
    expect(provider).not.toContain("finishTurn(");
  });
});
