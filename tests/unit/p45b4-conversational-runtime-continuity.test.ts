import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { classifyTurnIntent } from "@/agent/runtime/AgentTurnIntent";
import { deriveNextLegalStage, resolveContinuationIntent } from "@/agent/runtime/TaskContinuationResolver";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";

function tailoringState() {
  const reducer = new AgentTaskStateReducer();
  let state = reducer.create(AgentRuntime.create("agent_quick_action", "collecting_intent"));
  state = reducer.reduce(state, {
    type: "new_root_task",
    goal: "apply_to_job",
    workflowId: "tailor_existing_resume",
    stage: "analyze_fit"
  });
  return {
    ...state,
    selectedEntities: {
      ...state.selectedEntities,
      profileId: "profile-card-3",
      resumeId: "resume-general",
      jobId: "job-telent-ai"
    },
    knownSlots: {
      ...state.knownSlots,
      fitAnalysis: { score: 37, gaps: ["AI 应用"] }
    }
  };
}

describe("P4.5b.4 conversational runtime continuity", () => {
  it("keeps the canonical Card 3 application sentence under Apply/Tailor", () => {
    const decision = classifyTurnIntent({
      text: "我想用现有简历投这个岗位。先读取资料、简历、岗位和已有匹配分析，只有答案会改变定制结果时再问我。"
    });

    expect(decision).toMatchObject({
      intent: "new_domain_task",
      taskMutation: "replace",
      newTask: {
        goal: "apply_to_job",
        workflowId: "tailor_existing_resume",
        stage: "choose_resume_source"
      }
    });
    expect(decision.newTask?.goal).not.toBe("analyze_job_fit");
  });

  it("treats 提升匹配度 as a continuation and derives the next legal tailoring stage", () => {
    const state = tailoringState();
    expect(classifyTurnIntent({ text: "提升匹配度", taskState: state })).toMatchObject({
      intent: "continue_current_task",
      taskMutation: "continue",
      toolScope: "domain"
    });
    expect(resolveContinuationIntent(state, "提升匹配度")).toMatchObject({
      consumed: true,
      slotUpdates: {
        tailoringContinuation: "improve_fit",
        tailoringWorkspaceView: "fit"
      }
    });
    expect(deriveNextLegalStage(state)).toBe("generate_plan");
  });

  it("keeps the three diagnostics available for a failure-side 为什么 turn", () => {
    const taskState = tailoringState();
    const session = {
      ...AgentRuntime.create("tailor_existing_resume", "analyze_fit"),
      taskState,
      activeResumeId: taskState.selectedEntities.resumeId,
      activeJobId: taskState.selectedEntities.jobId
    };
    const resolver = new AgentToolResolver(createAgentToolRegistry({} as AgentToolServices));
    const tools = resolver.allowedTools({
      workflowId: "tailor_existing_resume",
      step: "analyze_fit",
      skills: [],
      session,
      userMessage: "为什么"
    }).map((tool) => tool.name);

    expect(tools).toEqual(expect.arrayContaining([
      "get_agent_current_task",
      "get_agent_last_failure",
      "get_agent_runtime_status"
    ]));
  });
});
