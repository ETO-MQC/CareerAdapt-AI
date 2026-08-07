import { describe, expect, it, vi } from "vitest";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import type { AgentSession } from "@/agent/contracts/agentSession";
import type { ProfileIntakeSourceTurn } from "@/domain/profileIntake/ProfileIntakeSourceTurn";
import { profileIntakeReviewProgress } from "@/domain/profileIntake/ProfileIntakeReviewProjection";

const NOW = "2026-08-05T00:00:00.000Z";

function candidate(status: "proposed" | "accepted" = "proposed") {
  return {
    id: "candidate-1",
    sectionType: "project" as const,
    sourceSpan: { start: 0, end: 12 },
    sourceQuote: "我协助完成一个项目",
    professionalText: "协助完成一个项目",
    uncertainFields: [],
    confidence: 0.9,
    needsConfirmation: false,
    status,
    canAccept: true,
    fieldEvidence: [{
      field: "description",
      sourceQuote: "我协助完成一个项目",
      support: "explicit" as const,
      confidence: 0.9,
      needsConfirmation: false
    }]
  };
}

function projection(status: "proposed" | "accepted" = "proposed") {
  return {
    importId: "intake-1",
    draftRevision: status === "accepted" ? 1 : 0,
    ...(status === "accepted" ? { finalReviewRevision: 2 } : {}),
    sourceMessageId: "message-1",
    sourceTurnId: "turn-1",
    sourceContentHash: "source-hash-123",
    providerStatus: "available" as const,
    extractionStatus: "structured_ai" as const,
    candidates: [candidate(status)],
    reviewProgress: {
      total: 1,
      proposed: status === "accepted" ? 0 : 1,
      valid: 1,
      uncertain: 0,
      accepted: status === "accepted" ? 1 : 0,
      ignored: 0,
      rejected: 0,
      reviewed: status === "accepted" ? 1 : 0
    },
    followUpQuestions: []
  };
}

function captureData(messageId = "message-1", turnId = "turn-1") {
  const review = projection();
  return {
    importId: "intake-1",
    expectedDraftRevision: 0,
    targetProfileId: "profile-1",
    expectedProfileVersion: 0,
    persistenceStatus: "saved",
    providerStatus: "available",
    extractionStatus: "structured_ai",
    candidateCount: 1,
    usableCandidateCount: 1,
    quarantinedCandidateCount: 0,
    needsConfirmationCount: 0,
    candidates: review.candidates,
    reviewProjection: { ...review, sourceMessageId: messageId, sourceTurnId: turnId },
    artifactPayload: { title: "经历核对" },
    interviewPlan: { suggestedNextSections: ["project"] },
    idempotent: false
  };
}

function intakeSession(stage: "collect_experience" | "reconcile_profile" = "collect_experience", accepted = false) {
  const base = AgentRuntime.create("guided_profile_intake", stage);
  const reducer = new AgentTaskStateReducer();
  const state = reducer.create(base, "profile_intake");
  return {
    ...base,
    taskState: {
      ...state,
      workflowId: "guided_profile_intake" as const,
      stage,
      completionStatus: "waiting_for_user" as const,
      knownSlots: {
        ...state.knownSlots,
        targetProfileId: "profile-1",
        targetProfileName: "主资料库",
        expectedProfileVersion: 0,
        acknowledgedActiveProfileId: "profile-1",
        intakeImportId: accepted ? "intake-1" : undefined,
        expectedIntakeDraftRevision: accepted ? 1 : undefined,
        profileIntakeReviewProjection: accepted ? projection("accepted") : undefined
      },
      selectedEntities: { ...state.selectedEntities, profileId: "profile-1", profileVersion: 0 },
      updatedAt: NOW
    }
  } satisfies AgentSession;
}

function persistenceHarness() {
  const sourceTurns: ProfileIntakeSourceTurn[] = [];
  const events: string[] = [];
  const save = vi.fn(async (session: AgentSession) => session);
  const persistence = {
    save,
    saveProfileIntakeSourceTurn: vi.fn(async (turn: ProfileIntakeSourceTurn) => {
      events.push(`journal:${turn.processingStatus}`);
      sourceTurns.push(structuredClone(turn));
      return turn;
    }),
    getProfileIntakeSourceTurn: vi.fn(async (identity: Pick<ProfileIntakeSourceTurn, "sessionId" | "messageId" | "turnId">) =>
      sourceTurns.find((turn) => turn.sessionId === identity.sessionId && turn.messageId === identity.messageId && turn.turnId === identity.turnId)
    ),
    updateProfileIntakeSourceTurn: vi.fn(async (
      identity: Pick<ProfileIntakeSourceTurn, "sessionId" | "messageId" | "turnId">,
      patch: Partial<Omit<ProfileIntakeSourceTurn, "sessionId" | "messageId" | "turnId">>
    ) => {
      const turn = sourceTurns.find((item) => item.sessionId === identity.sessionId && item.messageId === identity.messageId && item.turnId === identity.turnId);
      if (!turn) return undefined;
      Object.assign(turn, patch);
      events.push(`journal:${turn.processingStatus}`);
      return turn;
    }),
    listProfileIntakeSourceTurns: vi.fn(async (sessionId?: string) => sourceTurns.filter((turn) => !sessionId || turn.sessionId === sessionId))
  };
  return { sourceTurns, events, persistence };
}

function result(toolName: string, data: unknown, ok = true) {
  return ok
    ? { ok: true as const, toolName, operationId: `operation-${toolName}`, data, artifactIds: [], completedAt: NOW }
    : { ok: false as const, toolName, operationId: `operation-${toolName}`, error: { code: "provider_textual_tool_protocol", message: "safe", retryable: true }, artifactIds: [], completedAt: NOW };
}

describe("P4.3h Profile Intake host boundaries", () => {
  it("counts a rejected candidate once in reviewed progress", () => {
    expect(profileIntakeReviewProgress([
      { status: "accepted", needsConfirmation: false },
      { status: "ignored", decision: "reject", needsConfirmation: false }
    ])).toMatchObject({
      total: 2,
      accepted: 1,
      ignored: 1,
      rejected: 1,
      reviewed: 2
    });
  });

  it("starts from one active profile with zero model calls and the authoritative collect stage", async () => {
    const execute = vi.fn(async ({ toolName }: { toolName: string }) => result(toolName, {
      selected: true,
      profileId: "profile-1",
      name: "主资料库",
      version: 0
    }));
    const runTurn = vi.fn();
    const { persistence } = persistenceHarness();
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute } as never,
      persistence: persistence as never
    });

    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
    const resultSession = await host.dispatch({
      type: "quick_action",
      actionId: "build_profile_from_scratch",
      text: "从零整理我的经历",
      task: { rootGoal: "profile_intake", workflowId: "guided_profile_intake", stage: "resolve_profile_target" }
    }, { session: base, pageContext: { pathname: "/ai-workspace", query: {} } });

    expect(runTurn).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(resultSession?.taskState).toMatchObject({
      workflowId: "guided_profile_intake",
      stage: "collect_experience",
      completionStatus: "waiting_for_user",
      selectedEntities: { profileId: "profile-1", profileVersion: 0 }
    });
    expect(resultSession?.messages.at(-1)?.content).toContain("从教育背景开始");
    expect(resultSession?.messages.at(-1)?.metadata).toMatchObject({ modelCalls: 0, authoritativeStage: "collect_experience" });
  });

  it("journals the exact answer before host-owned capture and never enters the general model", async () => {
    const { persistence, events } = persistenceHarness();
    const runTurn = vi.fn();
    const execute = vi.fn(async ({ toolName, toolInput }: { toolName: string; toolInput: Record<string, unknown> }) => {
      if (toolName === "capture_profile_intake") {
        events.push("capture");
        return result(toolName, captureData(String(toolInput.messageId), String(toolInput.turnId)));
      }
      throw new Error(`unexpected:${toolName}`);
    });
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute } as never,
      persistence: persistence as never
    });

    const resultSession = await host.startTurn({
      session: intakeSession(),
      userMessage: "我协助完成一个项目，使用 RPA 技术采集数据。",
      pageContext: { pathname: "/ai-workspace", query: {} }
    });

    expect(runTurn).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "capture_profile_intake" }));
    expect(events.indexOf("journal:journaled")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("journal:journaled")).toBeLessThan(events.indexOf("capture"));
    expect(resultSession?.taskState?.stage).toBe("collect_experience");
    expect(resultSession?.taskState?.knownSlots.profileIntakePhase).toBe("clarifying");
    expect(resultSession?.messages.at(-1)?.content).toMatch(/已保留|已记下/u);
    expect(persistence.saveProfileIntakeSourceTurn).toHaveBeenCalledWith(expect.objectContaining({
      exactSourceText: "我协助完成一个项目，使用 RPA 技术采集数据。",
      processingStatus: "journaled"
    }));
  });

  it("persists the running shell and keeps it live when restored before capture resolves", async () => {
    const { persistence } = persistenceHarness();
    let resolveCapture!: (value: ReturnType<typeof result>) => void;
    let signalCaptureStarted!: () => void;
    let captureInput: Record<string, unknown> | undefined;
    const captureStarted = new Promise<void>((resolve) => { signalCaptureStarted = resolve; });
    const captureResult = new Promise<ReturnType<typeof result>>((resolve) => { resolveCapture = resolve; });
    const execute = vi.fn(async ({ toolName, toolInput }: { toolName: string; toolInput: Record<string, unknown> }) => {
      if (toolName !== "capture_profile_intake") throw new Error(`unexpected:${toolName}`);
      captureInput = toolInput;
      signalCaptureStarted();
      return captureResult;
    });
    const host = new AgentHostStore({
      kernel: { runTurn: vi.fn() } as never,
      executor: { execute } as never,
      persistence: persistence as never
    });

    const pending = host.startTurn({
      session: intakeSession(),
      userMessage: "我协助完成一个项目。",
      pageContext: { pathname: "/ai-workspace", query: {} }
    });
    await captureStarted;

    const persistedShell = [...persistence.save.mock.calls]
      .map(([session]) => session)
      .find((session) => session.messages.some((message) => message.content === "我协助完成一个项目。"));
    expect(persistedShell).toBeDefined();
    expect(persistedShell?.messages.some((message) => message.kind === "assistant_thinking")).toBe(true);

    host.adopt(persistedShell!);
    const restored = host.getSnapshot().activeSession;
    expect(restored?.activeTurn?.status).toBe("running");
    expect(restored?.messages.some((message) => message.content === "我协助完成一个项目。")).toBe(true);
    expect(restored?.messages.some((message) => message.kind === "assistant_thinking")).toBe(true);

    resolveCapture(result(
      "capture_profile_intake",
      captureData(String(captureInput?.messageId), String(captureInput?.turnId))
    ));
    const finished = await pending;
    expect(finished?.taskState?.stage).toBe("collect_experience");
    expect(finished?.messages.at(-1)?.content).toMatch(/已保留|已记下/u);
  });

  it("re-executes a failed step from its checkpoint without a manual retry phrase or shadow branch", async () => {
    const { persistence, sourceTurns } = persistenceHarness();
    let failed = true;
    const execute = vi.fn(async ({ toolName, toolInput }: { toolName: string; toolInput: Record<string, unknown> }) => {
      if (toolName !== "capture_profile_intake") throw new Error(`unexpected:${toolName}`);
      if (failed) return result(toolName, undefined, false);
      return result(toolName, captureData(String(toolInput.messageId), String(toolInput.turnId)));
    });
    const host = new AgentHostStore({
      kernel: { runTurn: vi.fn() } as never,
      executor: { execute } as never,
      persistence: persistence as never
    });
    const first = await host.startTurn({
      session: intakeSession(),
      userMessage: "我协助完成一个项目。",
      pageContext: { pathname: "/ai-workspace", query: {} }
    });
    expect(first?.taskState?.completionStatus).toBe("failed");
    expect(first?.messages.at(-1)?.content).not.toContain("重试刚才");
    failed = false;
    const retried = await host.dispatch({
      type: "option",
      action: { type: "retry_current_step" }
    }, { session: first!, pageContext: { pathname: "/ai-workspace", query: {} } });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(retried?.taskState?.completionStatus).toBe("waiting_for_user");
    expect(retried?.conversationBranches.filter((branch) => branch.status === "active")).toHaveLength(1);
    expect(sourceTurns.filter((turn) => turn.processingStatus === "superseded")).toHaveLength(1);
    expect(sourceTurns.filter((turn) => turn.processingStatus === "partial" || turn.processingStatus === "structured")).toHaveLength(1);
  });

  it("creates one final synthesis before any reconcile or commit step", async () => {
    const { persistence, sourceTurns } = persistenceHarness();
    const execute = vi.fn(async ({ toolName }: { toolName: string }) => {
      if (toolName === "synthesize_profile_intake") return result(toolName, finalSynthesisData());
      throw new Error(`unexpected:${toolName}`);
    });
    const host = new AgentHostStore({
      kernel: { runTurn: vi.fn() } as never,
      executor: { execute } as never,
      persistence: persistence as never
    });

    const saved = await host.startTurn({
      session: intakeSession("reconcile_profile", true),
      userMessage: "确认",
      pageContext: { pathname: "/ai-workspace", query: {} }
    });

    expect(execute.mock.calls.map(([call]) => call.toolName)).toEqual(["synthesize_profile_intake"]);
    expect(saved?.taskState).toMatchObject({ stage: "final_review", completionStatus: "waiting_for_user" });
    expect(saved?.taskState?.knownSlots.profileIntakePhase).toBe("ready_for_review");
    expect(saved?.taskState?.knownSlots.profileIntakeReviewProjection).toMatchObject({
      finalSynthesis: { version: "profile-intake-final-synthesis-v1" },
      phase: "ready_for_review"
    });
    expect(saved?.messages.some((message) => message.content.includes("最终资料草稿"))).toBe(true);
    expect(sourceTurns).toEqual([]);
  });
});

function finalSynthesisData() {
  const structuredItem = {
    id: "synth-candidate-1",
    sectionType: "project" as const,
    title: "Smart Fox 项目",
    role: "参与者",
    description: "协助完成一个项目",
    current: false,
    tools: ["RPA"],
    highlights: ["完成数据采集"],
    outcomes: [],
    customFields: []
  };
  const finalCandidate = {
    ...candidate("proposed"),
    id: "synth-candidate-1",
    structuredItem,
    sourceBadge: "local" as const
  };
  const finalSynthesis = {
    version: "profile-intake-final-synthesis-v1" as const,
    createdAt: NOW,
    sourceTurnIds: ["turn-1"],
    assets: [{
      candidateId: "synth-candidate-1",
      sectionType: "project" as const,
      structuredItem,
      sourceCandidateIds: ["candidate-1"],
      sourceTurnIds: ["turn-1"],
      highlights: ["完成数据采集"],
      missingDimensions: [],
      conflictFields: [],
      provenance: []
    }],
    missingDimensions: {},
    conflictCount: 0
  };
  const reviewProjection = {
    ...projection("proposed"),
    draftRevision: 2,
    phase: "ready_for_review" as const,
    finalSynthesis,
    finalReviewRevision: 2,
    candidates: [finalCandidate]
  };
  return {
    importId: "intake-1",
    expectedDraftRevision: 2,
    phase: "ready_for_review" as const,
    finalReviewCount: 1,
    finalSynthesis,
    candidates: [finalCandidate],
    reviewProjection,
    artifactPayload: { title: "最终资料草稿" },
    intakeSession: { phase: "ready_for_review" as const }
  };
}
