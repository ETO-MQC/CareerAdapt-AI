import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentKernel } from "@/agent/kernel/AgentKernel";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";
import { AgentMessageSchema } from "@/agent/contracts/agentSession";
import { agentSkillRegistry } from "@/agent/kernel/AgentSkillRegistry";
import { classifyTurnIntent } from "@/agent/runtime/AgentTurnIntent";
import type { AgentModel } from "@/agent/model/agentModel";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import type { AgentSession } from "@/agent/contracts/agentSession";

const emptyResult = async () => ({ value: "ok" });

function services(): AgentToolServices {
  return {
    listResumes: emptyResult,
    listProfiles: emptyResult,
    listJobs: emptyResult,
    getActiveProfile: emptyResult,
    getProfile: emptyResult,
    searchProfileFacts: emptyResult,
    getResume: emptyResult,
    getResumeRevision: emptyResult,
    getJob: emptyResult,
    getAgentTaskContext: emptyResult,
    searchAgentSessions: emptyResult,
    skillsList: emptyResult,
    skillView: emptyResult,
    parseResumeFile: emptyResult,
    createResumeImportDraft: emptyResult,
    commitResumeImport: emptyResult,
    parseJobDescription: emptyResult,
    commitJob: emptyResult,
    analyzeJobFit: emptyResult,
    createTailoringSession: emptyResult,
    answerTailoringQuestion: emptyResult,
    previewTailoringChanges: emptyResult,
    applyTailoringChanges: emptyResult,
    exportResume: emptyResult
  };
}

describe("P4.2a.3e turn intent and task isolation", () => {
  it("keeps the real exported failure sequence as a regression fixture", () => {
    const fixture = JSON.parse(fs.readFileSync(
      path.resolve("tests/fixtures/p42a3e-exported-conversation.regression.json"),
      "utf8"
    )) as {
      cases: {
        quotedFollowup: { legacyStoredContentPrefix: string; observedError: string };
        postFailureGreeting: { userText: string; observedError: string };
        concatenatedGreeting: { persistedStatus: string; answerOccurrences: number };
      };
    };
    expect(fixture.cases.quotedFollowup.legacyStoredContentPrefix).toContain("基于这条回复继续");
    expect(fixture.cases.quotedFollowup.observedError).toBe("agent_iteration_budget_exceeded");
    expect(fixture.cases.postFailureGreeting).toMatchObject({
      userText: "你好",
      observedError: "agent_iteration_budget_exceeded"
    });
    expect(fixture.cases.concatenatedGreeting).toMatchObject({
      persistedStatus: "streaming",
      answerOccurrences: 6
    });
  });

  it.each([
    ["你好", "casual_side_turn"],
    ["谢谢", "casual_side_turn"],
    ["你能做什么", "casual_side_turn"],
    ["你能联网吗", "casual_side_turn"],
    ["我的名字是什么", "casual_side_turn"],
    ["当前活动资料库已经切换，请重新读取并确认写入目标。", "casual_side_turn"],
    ["我已经改成小明了，请读取当前资料库确认后继续。", "casual_side_turn"],
    ["刚才暂时没有新进展的原因是什么", "casual_side_turn"],
    ["我应该补充什么信息", "casual_side_turn"],
    ["继续", "continue_current_task"],
    ["继续刚才的简历任务", "continue_current_task"],
    ["导入一个岗位", "new_domain_task"],
    ["重新优化另一份简历", "new_domain_task"]
  ] as const)("classifies %s as %s", (text, expected) => {
    expect(classifyTurnIntent({ text }).intent).toBe(expected);
  });

  it("preserves a failed domain task for a casual side turn", () => {
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("tailor_existing_resume", "preview_changes");
    const failed = {
      ...reducer.create(base, "create_tailored_resume"),
      completionStatus: "failed" as const
    };
    const classified = classifyTurnIntent({ text: "你好", taskState: failed });
    expect(classified.intent).toBe("casual_side_turn");
    expect(classified.taskMutation).toBe("preserve");
    expect(failed.rootGoal).toBe("create_tailored_resume");
  });

  it("answers profile identity as a read-only side turn without advancing profile intake", () => {
    const reducer = new AgentTaskStateReducer();
    const intake = reducer.create(
      AgentRuntime.create("guided_profile_intake", "collect_experience"),
      "profile_intake"
    );
    const classified = classifyTurnIntent({
      text: "我的名字是什么？",
      taskState: intake
    });

    expect(classified).toMatchObject({
      intent: "casual_side_turn",
      taskMutation: "preserve",
      toolScope: "profile_read"
    });
    expect(intake.rootGoal).toBe("profile_intake");
    expect(intake.stage).toBe("collect_experience");
  });

  it("requires explicit continuation before recovering a terminal task", () => {
    const reducer = new AgentTaskStateReducer();
    const failed = {
      ...reducer.create(AgentRuntime.create("tailor_existing_resume", "preview_changes"), "create_tailored_resume"),
      completionStatus: "failed" as const
    };
    expect(classifyTurnIntent({ text: "你好", taskState: failed }).taskMutation).toBe("preserve");
    expect(classifyTurnIntent({ text: "继续刚才的简历任务", taskState: failed }).taskMutation).toBe("recover");
  });

  it("describes a canonical fresh root for an explicit unrelated domain request", () => {
    expect(classifyTurnIntent({ text: "导入一个岗位" }).newTask).toEqual({
      goal: "ingest_job",
      workflowId: "job_ingestion",
      stage: "collect_job_description"
    });
    expect(classifyTurnIntent({ text: "重新优化另一份简历" }).newTask).toEqual({
      goal: "create_tailored_resume",
      workflowId: "tailor_existing_resume",
      stage: "choose_resume_source"
    });
    expect(classifyTurnIntent({ text: "帮我深挖一下 示例任务系统 项目经历" }).newTask).toEqual({
      goal: "career_exploration",
      workflowId: "guided_profile_intake",
      stage: "collect_experience"
    });
    expect(classifyTurnIntent({ text: "分析这个 JD" }).newTask).toEqual({
      goal: "ingest_job",
      workflowId: "job_ingestion",
      stage: "collect_job_description"
    });
    expect(classifyTurnIntent({
      text: "我想分析自己与目标岗位的匹配度。请先向我收集岗位描述和要比较的简历或资料。"
    }).newTask).toEqual({
      goal: "analyze_job_fit",
      workflowId: "analyze_job_fit",
      stage: "select_assets"
    });
  });
});

describe("P4.2a.3e structured references and Skill discovery", () => {
  it("persists a bounded reference without copying the assistant body into user content", () => {
    const parsed = AgentMessageSchema.parse({
      id: "user-followup",
      turnId: "turn-followup",
      role: "user",
      content: "这里面的岗位匹配是什么意思？",
      references: [{
        messageId: "assistant-capabilities",
        role: "assistant",
        type: "assistant_message",
        excerpt: "除了刚才展示的资料库读取功能……"
      }],
      createdAt: "2026-07-27T08:00:00.000Z"
    });
    expect(parsed.content).not.toContain("除了刚才展示");
    expect(parsed.references?.[0]?.messageId).toBe("assistant-capabilities");
  });

  it.each(["你好", "你能做什么", "基于一条含 AI 字样的回复，简单解释一下"])(
    "loads no domain Skill for %s",
    (userMessage) => {
      expect(agentSkillRegistry.discover({
        workflowId: "agent_quick_action",
        step: "collecting_intent",
        userMessage
      })).toEqual([]);
    }
  );

  it("loads only the explicitly relevant primary Skill", () => {
    expect(agentSkillRegistry.discover({
      workflowId: "guided_profile_intake",
      step: "collecting_experience",
      userMessage: "帮我深挖一下 示例任务系统 项目经历"
    }).map((skill) => skill.id)).toEqual(["career-experience-digging"]);
    expect(agentSkillRegistry.discover({
      workflowId: "job_ingestion",
      step: "parse_job",
      userMessage: "分析这个 JD"
    }).map((skill) => skill.id)).toEqual(["jd-analysis"]);
  });
});

describe("P4.2a.3e iteration stream isolation", () => {
  it("answers a greeting once without invoking the domain model or tools", async () => {
    const model: AgentModel = {
      completeWithTools: vi.fn(async () => ({ stopReason: "final" as const, text: "不应调用" }))
    };
    const registry = createAgentToolRegistry(services());
    const kernel = new AgentKernel({
      model,
      executor: new AgentExecutor(registry),
      toolResolver: new AgentToolResolver(registry)
    });
    const events: Array<{ type: string; delta?: string }> = [];
    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "你好",
      turnIntent: "casual_side_turn",
      toolScope: "none",
      emit: (event) => { events.push(event); }
    });
    expect(model.completeWithTools).not.toHaveBeenCalled();
    expect(result.text).toBe("你好！今天想处理哪项求职任务？");
    expect(events.filter((event) => event.type === "assistant_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "assistant_delta").map((event) => event.delta).join("")).toBe(result.text);
  });

  it("publishes only the terminal candidate as one visible assistant stream", async () => {
    let iteration = 0;
    const model: AgentModel = {
      capabilities: { nativeToolStreaming: true },
      completeWithTools: vi.fn(),
      async *streamTurn() {
        iteration += 1;
        yield { type: "assistant_text_delta" as const, delta: "内部候选" };
        yield { type: "finish" as const, stopReason: "final" as const };
      }
    };
    const registry = createAgentToolRegistry(services());
    const kernel = new AgentKernel({
      model,
      executor: new AgentExecutor(registry),
      toolResolver: new AgentToolResolver(registry),
      maxIterations: 3
    });
    const reducer = new AgentTaskStateReducer();
    const session = AgentRuntime.create("tailor_existing_resume", "preview_changes");
    const taskState = {
      ...reducer.create(session, "create_tailored_resume"),
      completionStatus: "active" as const,
      stage: "choose_resume_source"
    };
    const events: Array<{ type: string; delta?: string; message?: string }> = [];
    const result = await kernel.runTurn({
      session: { ...session, taskState },
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "继续定制简历",
      turnIntent: "continue_current_task",
      emit: (event) => { events.push(event); }
    });
    expect(iteration).toBe(2);
    expect(result.text).not.toContain("内部候选");
    expect(events.filter((event) => event.type === "assistant_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    expect(events.filter((event) => event.type === "assistant_delta").map((event) => event.delta).join("")).toBe(result.text);
  });
});

describe("P4.2a.3e AgentHost isolation and exactly-once persistence", () => {
  it("completes a greeting after a failed domain task without mutating that task", async () => {
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("tailor_existing_resume", "preview_changes");
    const failed = {
      ...reducer.create(base, "create_tailored_resume"),
      completionStatus: "failed" as const
    };
    const save = vi.fn(async (session: AgentSession) => session);
    const runTurn = vi.fn(async (input: {
      turnId: string;
      turnIntent: string;
      toolScope: string;
      session: AgentSession;
      emit(event: Record<string, unknown>): Promise<void>;
    }) => {
      const streamId = `${input.turnId}:final`;
      const iterationId = `${input.turnId}:iteration:1`;
      await input.emit({ type: "assistant_start", turnId: input.turnId, streamId, iterationId });
      await input.emit({ type: "assistant_delta", delta: "你好！", turnId: input.turnId, streamId, iterationId });
      await input.emit({ type: "done", message: "你好！", turnId: input.turnId, streamId, iterationId });
      return {
        text: "你好！",
        trajectory: trajectory("completed"),
        taskState: input.session.taskState
      };
    });
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: {} as never,
      persistence: { save } as never
    });
    const result = await host.startTurn({
      session: { ...base, taskState: failed },
      userMessage: "你好",
      pageContext: { pathname: "/ai-workspace", query: {} }
    });

    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({
      turnIntent: "casual_side_turn",
      toolScope: "none"
    }));
    expect(result?.taskState).toMatchObject({
      rootGoal: "create_tailored_resume",
      completionStatus: "failed"
    });
    expect(result?.activeTurn?.status).toBe("completed");
    expect(result?.messages.filter((message) => message.role === "assistant" && message.status === "complete")).toHaveLength(1);
    expect(result?.messages.some((message) => message.streaming || message.status === "streaming")).toBe(false);
  });

  it("rejects stale retry/iteration stream events", async () => {
    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
    const save = vi.fn(async (session: AgentSession) => session);
    const runTurn = vi.fn(async (input: {
      turnId: string;
      session: AgentSession;
      emit(event: Record<string, unknown>): Promise<void>;
    }) => {
      const streamId = `${input.turnId}:final`;
      const iterationId = `${input.turnId}:iteration:2`;
      await input.emit({ type: "assistant_start", turnId: input.turnId, streamId, iterationId });
      await input.emit({ type: "assistant_delta", delta: "旧答案", turnId: input.turnId, streamId: "old-stream", iterationId: "old-iteration" });
      await input.emit({ type: "assistant_delta", delta: "你好", turnId: input.turnId, streamId, iterationId });
      await input.emit({ type: "done", message: "旧答案", turnId: "old-turn", streamId: "old-stream", iterationId: "old-iteration" });
      await input.emit({ type: "done", message: "你好", turnId: input.turnId, streamId, iterationId });
      await input.emit({ type: "assistant_delta", delta: "重复", turnId: input.turnId, streamId, iterationId });
      return { text: "你好", trajectory: trajectory("completed"), taskState: input.session.taskState };
    });
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: {} as never,
      persistence: { save } as never
    });
    const result = await host.startTurn({
      session: base,
      userMessage: "你好",
      pageContext: { pathname: "/ai-workspace", query: {} }
    });
    expect(result?.messages.find((message) => message.role === "assistant")?.content).toBe("你好");
  });

  it("recovers a failed task only after an explicit continuation", async () => {
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("tailor_existing_resume", "preview_changes");
    const failed = {
      ...reducer.create(base, "create_tailored_resume"),
      completionStatus: "failed" as const
    };
    const save = vi.fn(async (session: AgentSession) => session);
    const runTurn = vi.fn(async (input: {
      turnId: string;
      turnIntent: string;
      session: AgentSession;
      emit(event: Record<string, unknown>): Promise<void>;
    }) => {
      const streamId = `${input.turnId}:final`;
      const iterationId = `${input.turnId}:iteration:1`;
      await input.emit({ type: "assistant_start", turnId: input.turnId, streamId, iterationId });
      await input.emit({ type: "assistant_delta", delta: "已恢复任务。", turnId: input.turnId, streamId, iterationId });
      await input.emit({ type: "done", message: "已恢复任务。", turnId: input.turnId, streamId, iterationId });
      return { trajectory: trajectory("completed"), taskState: input.session.taskState };
    });
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: {} as never,
      persistence: { save } as never
    });
    const result = await host.startTurn({
      session: { ...base, taskState: failed },
      userMessage: "继续刚才的简历任务",
      pageContext: { pathname: "/ai-workspace", query: {} }
    });
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({
      turnIntent: "continue_current_task",
      session: expect.objectContaining({
        taskState: expect.objectContaining({
          rootGoal: "create_tailored_resume",
          completionStatus: "active"
        })
      })
    }));
    expect(result?.taskState?.rootGoal).toBe("create_tailored_resume");
  });

  it("persists reference metadata while keeping user content clean", async () => {
    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
    const referenced: AgentSession = {
      ...base,
      messages: [{
        id: "assistant-capabilities",
        turnId: "turn-capabilities",
        role: "assistant",
        content: "除了刚才展示的资料库读取功能，我还能分析岗位匹配。",
        status: "complete",
        createdAt: "2026-07-27T08:00:00.000Z"
      }]
    };
    const save = vi.fn(async (session: AgentSession) => session);
    const runTurn = vi.fn(async (input: {
      turnId: string;
      session: AgentSession;
      references: Array<{ messageId: string }>;
      emit(event: Record<string, unknown>): Promise<void>;
    }) => {
      const streamId = `${input.turnId}:final`;
      const iterationId = `${input.turnId}:iteration:1`;
      await input.emit({ type: "assistant_start", turnId: input.turnId, streamId, iterationId });
      await input.emit({ type: "assistant_delta", delta: "它表示岗位要求与你资料证据的对应程度。", turnId: input.turnId, streamId, iterationId });
      await input.emit({ type: "done", message: "它表示岗位要求与你资料证据的对应程度。", turnId: input.turnId, streamId, iterationId });
      return { trajectory: trajectory("completed"), taskState: input.session.taskState };
    });
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: {} as never,
      persistence: { save } as never
    });
    const result = await host.startTurn({
      session: referenced,
      userMessage: "这里面的岗位匹配是什么意思？",
      references: [{
        messageId: "assistant-capabilities",
        role: "assistant",
        type: "assistant_message",
        excerpt: "除了刚才展示的资料库读取功能……"
      }],
      pageContext: { pathname: "/ai-workspace", query: {} }
    });
    const user = result?.messages.findLast((message) => message.role === "user");
    expect(user?.content).toBe("这里面的岗位匹配是什么意思？");
    expect(user?.content).not.toContain("除了刚才展示");
    expect(user?.references?.[0]?.messageId).toBe("assistant-capabilities");
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({
      turnIntent: "reference_followup",
      toolScope: "none"
    }));
  });

  it("recovers orphan streaming after reload and keeps at most one active final per turn", () => {
    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
    const session: AgentSession = {
      ...base,
      messages: [
        {
          id: "final-old",
          turnId: "turn-orphan",
          role: "assistant",
          content: "旧答案",
          kind: "text",
          status: "complete",
          createdAt: "2026-07-27T08:00:00.000Z"
        },
        {
          id: "final-current",
          turnId: "turn-orphan",
          role: "assistant",
          content: "最终答案",
          kind: "text",
          status: "complete",
          createdAt: "2026-07-27T08:00:01.000Z"
        },
        {
          id: "stream-orphan",
          turnId: "turn-stream",
          role: "assistant",
          content: "未完成",
          kind: "assistant_streaming",
          type: "assistant_streaming",
          status: "streaming",
          streaming: true,
          createdAt: "2026-07-27T08:00:02.000Z"
        }
      ],
      activeTurn: {
        id: "turn-orphan",
        sessionId: base.id,
        status: "completed",
        startedAt: "2026-07-27T08:00:00.000Z",
        completedAt: "2026-07-27T08:00:03.000Z"
      }
    };
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save: vi.fn(async (value: AgentSession) => value) } as never
    });
    host.adopt(session);
    const adopted = host.getSnapshot().activeSession!;
    expect(adopted.messages.some((message) => message.streaming || message.status === "streaming")).toBe(false);
    expect(adopted.messages.filter((message) =>
      message.turnId === "turn-orphan"
      && message.role === "assistant"
      && message.status === "complete"
      && message.metadata?.retracted !== true
    )).toHaveLength(1);
    expect(adopted.messages.find((message) => message.id === "stream-orphan")).toMatchObject({
      kind: "system_notice",
      status: "recovered",
      streaming: false
    });
  });

  it("recovers the last substantive intake answer when an older session resumes with 导入", async () => {
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("guided_profile_intake", "collect_experience");
    const narrative = "我参加了 ESP32 课程项目，负责心跳模块、摔倒模块和蓝牙联调，并排查了接线错误。";
    const taskState = {
      ...reducer.create(base, "profile_intake"),
      rootGoal: "profile_intake",
      activeGoal: "profile_intake",
      goal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "collect_experience",
      completionStatus: "waiting_for_user" as const
    };
    const session: AgentSession = {
      ...base,
      taskState,
      messages: [{
        id: "legacy-intake-answer",
        turnId: "legacy-intake-turn",
        role: "user",
        content: narrative,
        status: "complete",
        createdAt: "2026-07-28T08:18:25.450Z",
        updatedAt: "2026-07-28T08:18:25.450Z"
      }]
    };
    const save = vi.fn(async (value: AgentSession) => value);
    const runTurn = vi.fn(async (input: { session: AgentSession }) => ({
      trajectory: trajectory("completed"),
      taskState: input.session.taskState
    }));
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: {} as never,
      persistence: { save } as never
    });

    await host.startTurn({
      session,
      userMessage: "导入",
      pageContext: { pathname: "/ai-workspace", query: {} }
    });

    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: "导入",
      session: expect.objectContaining({
        taskState: expect.objectContaining({
          stage: "structure_facts",
          knownSlots: expect.objectContaining({
            latestIntakeSource: expect.objectContaining({
              messageId: "legacy-intake-answer",
              turnId: "legacy-intake-turn",
              exactSourceQuote: narrative
            })
          })
        })
      })
    }));
  });
});

function trajectory(outcome: "completed" | "failed") {
  return {
    taskId: "task-p42a3e",
    workflowId: "agent_quick_action",
    startedAt: "2026-07-27T08:00:00.000Z",
    completedAt: "2026-07-27T08:00:01.000Z",
    skills: [],
    toolCalls: [],
    confirmations: [],
    errors: [],
    outcome
  };
}
