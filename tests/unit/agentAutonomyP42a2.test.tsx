import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentKernel } from "@/agent/kernel/AgentKernel";
import { AgentCapabilityBroker } from "@/agent/kernel/AgentCapabilityBroker";
import { AgentObservationCache } from "@/agent/kernel/AgentObservationCache";
import { AgentToolEligibility } from "@/agent/kernel/AgentToolEligibility";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";
import type { AgentModel, AgentModelStreamEvent } from "@/agent/model/agentModel";
import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";
import { AgentConversationTimeline, normalizeAgentMessageText } from "@/components/agent/AgentConversation";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { recommendSourceRoute } from "@/agent/orchestration/sourceRouteRecommendation";
import { reconcileAuthoritativeFact, scorePageContent } from "@/agent/orchestration/qualityContracts";

describe("P4.2a.2 autonomy closure", () => {
  it("uses one native model stream and zero domain tools for a greeting", async () => {
    const model = nativeModel([
      [{ type: "assistant_text_delta", delta: "你好！" }, { type: "finish", stopReason: "final" }]
    ]);
    const { kernel } = harness(model);
    const events: string[] = [];
    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "你好",
      emit: (event) => { events.push(event.type); }
    });
    expect(model.streamTurn).toHaveBeenCalledTimes(1);
    expect(model.completeWithTools).not.toHaveBeenCalled();
    expect(result.trajectory.toolCalls).toEqual([]);
    expect(events.filter((event) => event === "assistant_delta")).toHaveLength(1);
  });

  it("streams, executes a tool, observes it, and continues with a second model stream", async () => {
    const model = nativeModel([
      [
        { type: "tool_call_start", index: 0, id: "profile-call-native", name: "get_profile" },
        { type: "tool_call_arguments_delta", index: 0, id: "profile-call-native", delta: '{"profileId":"profile-1"}' },
        { type: "tool_call_complete", index: 0, call: { id: "profile-call-native", name: "get_profile", arguments: { profileId: "profile-1" } } },
        { type: "finish", stopReason: "tool_calls" }
      ],
      [
        { type: "assistant_text_delta", delta: "已读取资料库。" },
        { type: "finish", stopReason: "final" }
      ]
    ]);
    const getProfile = vi.fn(async () => ({ profile: { id: "profile-1", version: 3, name: "测试用户" } }));
    const { kernel } = harness(model, { getProfile });
    const session = { ...AgentRuntime.create("agent_quick_action", "collecting_intent"), activeProfileId: "profile-1" };
    const result = await kernel.runTurn({
      session,
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "查看我的资料库"
    });
    expect(model.streamTurn).toHaveBeenCalledTimes(2);
    expect(model.completeWithTools).not.toHaveBeenCalled();
    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("已读取资料库。");
  });

  it("keeps Markdown intact, renders supported blocks, and never executes raw HTML", () => {
    const markdown = `## 重点\n\n**重点**\n- A\n- B\n\n| 项目 | 值 |\n| --- | --- |\n| X | \`code\` |\n\n<script>window.__unsafe = true</script>`;
    expect(normalizeAgentMessageText(markdown)).toContain("**重点**");
    render(<AgentConversationTimeline messages={[message("assistant", markdown, "turn-md")]} />);
    expect(screen.getByRole("heading", { name: "重点" })).toBeVisible();
    expect(screen.getByText("A")).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/<script>/)).toBeVisible();
  });

  it("attaches activity to its assistant turn and keeps failed activity expanded", () => {
    render(<AgentConversationTimeline messages={[
      message("user", "开始", "turn-1", "user-1"),
      {
        ...message("tool", "已读取岗位", "turn-1", "tool-1"),
        kind: "tool_status",
        type: "tool_status",
        status: "complete",
        metadata: { activityState: "complete" }
      },
      message("assistant", "这是结果。", "turn-1", "assistant-1"),
      {
        ...message("tool", "生成失败，可重试", "turn-2", "tool-2"),
        kind: "tool_status",
        type: "tool_status",
        status: "failed",
        metadata: { activityState: "failed" }
      },
      message("assistant", "我保留了进度。", "turn-2", "assistant-2")
    ]} />);
    const assistantRows = document.querySelectorAll(".agent-message-row.is-assistant");
    expect(assistantRows).toHaveLength(2);
    expect(assistantRows[0].querySelector(".agent-tool-status-row")).not.toBeNull();
    expect(assistantRows[1].querySelector("details")?.open).toBe(true);
  });

  it("persists and reloads 150 dialogue messages plus 400 activity events without truncation", async () => {
    const db = new CareerAdaptDb(`AgentP42a2-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    try {
      const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
      const messages: AgentMessage[] = [
        ...Array.from({ length: 150 }, (_, index) => message(index % 2 ? "assistant" : "user", `dialogue-${index}`, `turn-${Math.floor(index / 2)}`, `dialogue-${index}`)),
        ...Array.from({ length: 400 }, (_, index) => ({
          ...message("tool", `activity-${index}`, `turn-${index % 75}`, `activity-${index}`),
          kind: "tool_status" as const,
          type: "tool_status" as const,
          toolName: "get_profile"
        }))
      ];
      const saved = await repository.saveAgentSession({ ...base, messages });
      const reloaded = await repository.getAgentSession(saved.id);
      const exported = await new AgentSessionStore(repository).exportJson(saved.id);
      expect(saved.messages).toHaveLength(550);
      expect(reloaded?.messages).toHaveLength(550);
      expect(JSON.parse(exported).messages).toHaveLength(550);
    } finally {
      db.close();
      await db.delete();
    }
  });

  it("resumes confirmation with an internal observation rather than a synthetic user message", async () => {
    const captured: Array<{ role: string; content: string }> = [];
    const model: AgentModel = {
      completeWithTools: vi.fn(async (request) => {
        captured.push(...request.messages);
        return { stopReason: "final" as const, text: "继续完成。" };
      })
    };
    const { kernel } = harness(model);
    const base = AgentRuntime.create("job_ingestion", "confirm_commit");
    const session: AgentSession = {
      ...base,
      messages: [message("user", "请保存这个岗位", "turn-confirm", "user-confirm")]
    };
    await kernel.resumeTurn({
      session,
      pageContext: { pathname: "/ai-workspace", query: {} },
      reason: "tool_observation",
      toolName: "commit_job",
      observation: { jobId: "job-1" }
    });
    expect(session.messages.filter((entry) => entry.role === "user")).toHaveLength(1);
    expect(captured.at(-1)?.role).toBe("tool");
    expect(captured.at(-1)?.content).toContain("job-1");
  });

  it("reduces job slots deterministically and prevents capability bypass of commit preconditions", () => {
    const base = AgentRuntime.create("job_ingestion", "parse_job");
    const reducer = new AgentTaskStateReducer();
    let state = reducer.create(base, "apply_to_job");
    state = reducer.reduce(state, { type: "slot_answer", slot: "rawText", value: "完整 JD" });
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "parse_job_description",
      observation: { graph: { requirements: [] }, candidateTitle: "AI 工程师" }
    });
    expect(state.stage).toBe("complete_job_identity");
    expect(state.missingSlots).toEqual(["company"]);

    const registry = createAgentToolRegistry(services());
    const eligibility = new AgentToolEligibility();
    expect(eligibility.eligible({
      tools: [registry.require("commit_job")],
      workflowToolNames: ["commit_job"],
      capabilityToolNames: ["commit_job"],
      taskState: state
    })).toEqual([]);

    state = reducer.reduce(state, { type: "slot_answer", slot: "company", value: "示例公司" });
    expect(state.stage).toBe("review_job");
    expect(state.missingSlots).toEqual([]);
    expect(eligibility.eligible({
      tools: [registry.require("commit_job")],
      workflowToolNames: [],
      capabilityToolNames: ["commit_job"],
      taskState: state
    }).map((tool) => tool.name)).toEqual(["commit_job"]);
  });

  it("invalidates cached resume analysis dependencies after a new revision write", () => {
    const cache = new AgentObservationCache();
    const input = { resumeId: "resume-1", revisionId: "revision-1" };
    cache.set("get_resume_revision", input, {
      ok: true,
      operationId: "cache-operation",
      toolName: "get_resume_revision",
      data: { revision: { id: "revision-1", revisionId: "revision-1" } },
      artifactIds: [],
      completedAt: new Date().toISOString()
    });
    expect(cache.get("get_resume_revision", input)).toBeDefined();
    cache.invalidateAfter("apply_tailoring_changes");
    expect(cache.get("get_resume_revision", input)).toBeUndefined();
  });

  it("provides deterministic source routing and orchestration quality hooks", () => {
    const recommendation = recommendSourceRoute({
      profileEvidenceRichness: 0.95,
      resumeMaturity: 0.55,
      profileJobRelevance: 0.8,
      resumeJobRelevance: 0.5,
      profileProvenanceCoverage: 0.9,
      resumeProvenanceCoverage: 0.6,
      resumeRecency: 0.7,
      profileMissingData: 0.1,
      resumeMissingData: 0.25
    });
    expect(recommendation.route).toBe("profile_to_job_resume");
    expect(reconcileAuthoritativeFact(
      { key: "skill", value: "TypeScript", sourceId: "new", evidenceIds: ["e2"] },
      [{ key: "skill", value: "TypeScript", sourceId: "old", evidenceIds: ["e1"] }]
    ).kind).toBe("exact_duplicate");
    expect(scorePageContent({
      id: "project-1",
      jobRequirementRelevance: 1,
      evidenceStrength: 1,
      uniqueness: 0.8,
      narrativeImportance: 0.8,
      redundancy: 0.1,
      pageCost: 0.2
    })).toBeGreaterThan(0.7);
  });

  it("routes nuanced intent into a cached structured semantic result", () => {
    const broker = new AgentCapabilityBroker();
    expect(broker.route("这工作我感觉还挺合适，我想试试", "turn-application")).toMatchObject({
      intent: "application_intent",
      goal: "apply_to_job",
      needsClarification: false
    });
    expect(broker.route("还是刚才那个岗位，给我再做一版", "turn-tailoring")).toMatchObject({
      intent: "tailoring",
      relevantEntityTypes: ["job", "resume"]
    });
    expect(broker.route("我想换工作但不知道做什么", "turn-exploration")).toMatchObject({
      intent: "conversation",
      goal: "career_exploration"
    });
  });

  it("records a user source-route override as deterministic task truth", () => {
    const reducer = new AgentTaskStateReducer();
    let state = reducer.create(AgentRuntime.create("tailor_existing_resume", "select_resume"), "apply_to_job");
    state = {
      ...state,
      stage: "choose_resume_source",
      selectedEntities: { profileId: "profile-1", jobId: "job-1" },
      knownSlots: { recommendedResumeId: "resume-1" }
    };
    state = reducer.reduce(state, { type: "user_message", message: "用路线 B，优化现有简历" });
    expect(state.knownSlots.sourceRoute).toBe("existing_resume_to_job_revision");
    expect(state.selectedEntities.resumeId).toBe("resume-1");
    expect(state.stage).toBe("analyze_fit");
  });
});

function nativeModel(turns: AgentModelStreamEvent[][]) {
  let index = 0;
  return {
    capabilities: { nativeToolStreaming: true },
    completeWithTools: vi.fn(),
    streamTurn: vi.fn(async function* () {
      for (const event of turns[Math.min(index++, turns.length - 1)]) yield event;
    })
  } satisfies AgentModel;
}

function harness(model: AgentModel, overrides: Partial<AgentToolServices> = {}) {
  const registry = createAgentToolRegistry(services(overrides));
  const executor = new AgentExecutor(registry);
  return {
    kernel: new AgentKernel({
      model,
      executor,
      toolResolver: new AgentToolResolver(registry),
      observationCache: new AgentObservationCache()
    })
  };
}

function services(overrides: Partial<AgentToolServices> = {}): AgentToolServices {
  const result = async () => ({ value: "ok" });
  return {
    listResumes: result, listProfiles: result, listJobs: result,
    getActiveProfile: result, getProfile: result, searchProfileFacts: result,
    getResume: result, getResumeRevision: result, getJob: result,
    getAgentTaskContext: result, searchAgentSessions: result, skillsList: result, skillView: result,
    parseResumeFile: result, createResumeImportDraft: result, commitResumeImport: result,
    parseJobDescription: result, commitJob: result, analyzeJobFit: result,
    createTailoringSession: result, answerTailoringQuestion: result,
    previewTailoringChanges: result, applyTailoringChanges: result, exportResume: result,
    ...overrides
  };
}

function message(role: AgentMessage["role"], content: string, turnId: string, id = `${role}-${content}`): AgentMessage {
  const createdAt = "2026-07-26T12:00:00.000Z";
  return { id, turnId, role, content, createdAt, updatedAt: createdAt };
}
