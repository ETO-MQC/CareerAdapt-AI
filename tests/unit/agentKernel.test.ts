import { describe, expect, it, vi } from "vitest";
import { AgentKernel } from "@/agent/kernel/AgentKernel";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";
import type { AgentModel, AgentModelResult } from "@/agent/model/agentModel";

function services(overrides: Partial<AgentToolServices> = {}): AgentToolServices {
  const result = async () => ({ value: "ok" });
  return {
    listResumes: result,
    listProfiles: result,
    listJobs: result,
    getActiveProfile: async () => ({ selected: true, profileId: "profile-1", name: "MQC" }),
    getProfile: async () => ({ profile: { id: "profile-1", name: "MQC", sectionCounts: { projects: 3 } } }),
    searchProfileFacts: async () => ({ results: [] }),
    getResume: result,
    getResumeRevision: result,
    getJob: result,
    getAgentTaskContext: result,
    searchAgentSessions: result,
    skillsList: result,
    skillView: result,
    parseResumeFile: result,
    createResumeImportDraft: result,
    commitResumeImport: result,
    parseJobDescription: result,
    commitJob: result,
    analyzeJobFit: result,
    createTailoringSession: result,
    answerTailoringQuestion: result,
    previewTailoringChanges: result,
    applyTailoringChanges: result,
    exportResume: result,
    ...overrides
  };
}

function scriptedModel(...results: AgentModelResult[]) {
  let index = 0;
  const completeWithTools = vi.fn(async () => results[Math.min(index++, results.length - 1)]);
  return { completeWithTools } satisfies AgentModel;
}

function harness(model: AgentModel, overrides: Partial<AgentToolServices> = {}, options: { maxToolCalls?: number; maxIterations?: number } = {}) {
  const registry = createAgentToolRegistry(services(overrides));
  const executor = new AgentExecutor(registry);
  return {
    kernel: new AgentKernel({
      model,
      executor,
      toolResolver: new AgentToolResolver(registry),
      ...options
    }),
    registry
  };
}

describe("AgentKernel", () => {
  it("runs an autonomous profile-aware multi-tool loop", async () => {
    const getActiveProfile = vi.fn(async () => ({ selected: true, profileId: "profile-1", name: "MQC" }));
    const getProfile = vi.fn(async () => ({ profile: { id: "profile-1", name: "MQC", sectionCounts: { projects: 3, work: 2 } } }));
    const model = scriptedModel(
      { stopReason: "tool_calls", toolCalls: [{ id: "call-active-profile", name: "get_active_profile", arguments: {} }] },
      { stopReason: "tool_calls", toolCalls: [{ id: "call-profile-detail", name: "get_profile", arguments: { profileId: "profile-1" } }] },
      { stopReason: "final", text: "你当前选择的是 MQC 资料库，共有 5 项相关内容。" }
    );
    const { kernel } = harness(model, { getActiveProfile, getProfile });
    const events: string[] = [];
    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "你知道我是谁吗",
      emit: (event) => { events.push(event.type); }
    });

    expect(getActiveProfile).toHaveBeenCalledTimes(1);
    expect(getProfile).toHaveBeenCalledWith({ profileId: "profile-1" }, undefined);
    expect(result.text).toContain("MQC");
    expect(result.trajectory.toolCalls.map((call) => call.toolName)).toEqual(["get_active_profile", "get_profile"]);
    expect(events).toEqual(expect.arrayContaining(["turn_ack", "tool_started", "tool_result", "assistant_start", "assistant_delta", "done"]));
  });

  it("returns a recoverable observation for equivalent repeated calls", async () => {
    const repeated = { stopReason: "tool_calls", toolCalls: [{ id: "repeat-call-id", name: "get_active_profile", arguments: {} }] } satisfies AgentModelResult;
    const { kernel } = harness(scriptedModel(repeated, repeated, { stopReason: "final", text: "已复用现有结果。" }));
    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "资料库"
    });
    expect(result.trajectory.outcome).toBe("completed");
    expect(result.text).toBeTruthy();
  });

  it("enforces the total tool-call budget", async () => {
    const { kernel } = harness(scriptedModel(
      { stopReason: "tool_calls", toolCalls: [{ id: "budget-call-one", name: "get_active_profile", arguments: {} }] },
      { stopReason: "tool_calls", toolCalls: [{ id: "budget-call-two", name: "list_profiles", arguments: {} }] }
    ), {}, { maxToolCalls: 1 });
    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "资料库"
    });
    expect(result.trajectory.errors[0]?.code).toBe("agent_tool_budget_exceeded");
  });

  it("stops at confirmation without executing a write", async () => {
    const commitJob = vi.fn(async () => ({ jobId: "job-1" }));
    const { kernel } = harness(scriptedModel({
      stopReason: "tool_calls",
      toolCalls: [{ id: "confirm-job-call", name: "commit_job", arguments: { title: "AI 训练师", company: "A", rawText: "x".repeat(30), graph: {} } }]
    }), { commitJob });
    const session = AgentRuntime.create("job_ingestion", "confirm_commit");
    const result = await kernel.runTurn({
      session,
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "确认保存岗位"
    });
    expect(commitJob).not.toHaveBeenCalled();
    expect(result.pendingConfirmation?.toolName).toBe("commit_job");
    expect(result.trajectory.outcome).toBe("waiting_for_confirmation");
  });

  it("rejects a tool hidden by the current workflow step", async () => {
    const { kernel } = harness(scriptedModel({
      stopReason: "tool_calls",
      toolCalls: [{ id: "hidden-commit-call", name: "commit_job", arguments: { title: "A", company: "B", rawText: "x".repeat(30), graph: {} } }]
    }));
    const result = await kernel.runTurn({
      session: AgentRuntime.create("job_ingestion", "parse_job"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "分析这个岗位"
    });
    expect(result.trajectory.errors[0]?.code).toBe("agent_tool_not_allowed");
  });

  it("never executes user-declared facts before explicit confirmation", async () => {
    const answerTailoringQuestion = vi.fn(async () => ({ session: { status: "updated" } }));
    const { kernel } = harness(scriptedModel({
      stopReason: "tool_calls",
      toolCalls: [{
        id: "user-fact-answer-call",
        name: "answer_tailoring_question",
        arguments: { session: {}, questionId: "q-ai", answer: "熟悉模型训练", proficiency: "familiar" }
      }]
    }), { answerTailoringQuestion });
    const result = await kernel.runTurn({
      session: AgentRuntime.create("tailor_existing_resume", "answer_questions"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "我补充一条 AI 能力"
    });
    expect(answerTailoringQuestion).not.toHaveBeenCalled();
    expect(result.pendingConfirmation?.toolName).toBe("answer_tailoring_question");
  });

  it("honors an already-aborted turn", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = scriptedModel({ stopReason: "final", text: "never" });
    const { kernel } = harness(model);
    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "停止",
      signal: controller.signal
    });
    expect(model.completeWithTools).not.toHaveBeenCalled();
    expect(result.trajectory.outcome).toBe("aborted");
  });
});
