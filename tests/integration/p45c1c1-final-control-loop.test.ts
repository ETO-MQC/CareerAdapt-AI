import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionSchema, type AgentSession, type AgentTaskState } from "@/agent/contracts/agentSession";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import {
  AgentHostStore,
  attachTaskStateOptions,
  getActiveTailoringQuestionProjection
} from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { projectTaskStateIntoSession } from "@/agent/runtime/projectTaskStateToWorkflowState";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import { ResumeTailoringPlanSchema } from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import {
  TailoringSessionSchema,
  createTailoringSessionCommand,
  reviewTailoringDiffCommand,
  tailoringDiffId
} from "@/services/jobs/tailoringCommands";
import { isTailoringQuestionPlanComplete, tailoringAnswerRevisionHash } from "@/services/jobs/tailoringService";

const pageContext = { pathname: "/ai-workspace", query: {} };

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  await db?.delete();
  db = undefined;
});

describe("P4.5c.1 final control-loop closure", () => {
  it("drives Q1→Q2→Q3→diff review→confirmation into a real Job Revision", async () => {
    const job = demoJobDescriptions[0];
    const general = buildGeneralBranchFromProfile({
      profile: demoCareerProfile,
      operationId: "p45c1-final-general",
      name: "闭环通用简历",
      includeProfileFacts: true,
      includeProfileBasics: true,
      now: "2026-08-21T00:00:00.000Z"
    });
    const summary = general.branch.structuredContentItems?.find((item) => item.data.sectionType === "summary");
    const skill = general.branch.structuredContentItems?.find((item) => item.data.sectionType === "skills");
    if (!summary || summary.data.sectionType !== "summary") throw new Error("summary_fixture_missing");
    if (!skill || skill.data.sectionType !== "skills") throw new Error("skill_fixture_missing");

    db = new CareerAdaptDb(`P45c1Final-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(demoCareerProfile);
    await repository.saveJobDescription(job);
    await repository.saveResumeBranch(general.branch);
    await db.resumeRevisions.put(general.firstRevision);

    const created = createTailoringSessionCommand({
      operationId: "p45c1-final-tailoring",
      profile: demoCareerProfile,
      branch: general.branch,
      job
    });
    const now = "2026-08-21T00:00:00.000Z";
    const questions = ["q-1", "q-2", "q-3"].map((id, index) => ({
      id,
      question: `请说明 ${id} 对应的真实经历。`,
      requirementText: `${id} 的岗位要求`,
      requirementCategory: "tool_or_technology",
      requirementPriority: "high",
      evidenceNeed: "请提供真实场景和可核验结果。",
      requirementIds: [`requirement-${id}`],
      sourceItemIds: [summary.id],
      relatedItemIds: [summary.id],
      candidateClaim: `${id} 的候选事实`,
      targetFieldPaths: [`summary.${summary.id}.text`],
      answerType: "text" as const,
      options: [
        { id: "yes", label: "有", value: "有" },
        { id: "uncertain", label: "不确定", value: "不确定" },
        { id: "skip", label: "跳过", value: "跳过" }
      ],
      status: index === 0 ? "active" as const : "pending" as const,
      updatedAt: now
    }));
    const questionPlan = {
      ...created.session.plan.questionPlan!,
      id: "p45c1-final-question-plan",
      sessionId: created.session.id,
      revision: 1,
      questionIds: questions.map((question) => question.id),
      activeQuestionId: "q-1",
      answeredQuestionIds: [],
      skippedQuestionIds: [],
      uncertainQuestionIds: [],
      status: "asking" as const,
      createdAt: now
    };
    const initialPlan = ResumeTailoringPlanSchema.parse({
      ...created.session.plan,
      clarificationQuestions: questions,
      clarificationAnswers: [],
      answerReceipts: [],
      questionPlan: questionPlan,
      generationStatus: "not_started",
      diffs: [],
      diffReviews: []
    });
    const initialTailoringSession = TailoringSessionSchema.parse({
      ...created.session,
      plan: initialPlan,
      revision: 1,
      generatedDiffRevision: 0
    });

    const acceptedSummary = "基于已核验的数据分析项目，突出样本清洗与区域差异分析交付。";
    const fact = demoCareerProfile.experiences[0].facts[0];
    const evidence = {
      type: "experience_fact" as const,
      experienceId: demoCareerProfile.experiences[0].id,
      factId: fact.id,
      factQuote: fact.statement,
      factText: fact.statement
    };
    const diffA = {
      target: { sectionId: "summary", itemId: summary.id, fieldPath: "text" as const },
      operation: "replace" as const,
      original: summary.data.text,
      value: acceptedSummary,
      reason: "突出已核验的数据分析交付经验",
      requirementIds: ["requirement-q-3"],
      targetKeywords: ["数据分析"],
      evidenceRefs: [evidence],
      supportLevel: "verified" as const
    };
    const diffB = {
      target: { sectionId: "skills", itemId: skill.id, fieldPath: "name" as const },
      operation: "replace" as const,
      original: skill.data.name,
      value: `${skill.data.name}（岗位相关）`,
      reason: "记录岗位相关技能的人工取舍",
      requirementIds: ["requirement-q-2"],
      targetKeywords: [skill.data.name],
      evidenceRefs: [evidence],
      supportLevel: "verified" as const
    };

    const base = AgentRuntime.create("tailor_resume", "clarify_unsupported_facts", "P4.5c.1 final control loop");
    const reducer = new AgentTaskStateReducer();
    const seed = reducer.create(base, "generate_job_specific_resume");
    const taskState: AgentTaskState = {
      ...seed,
      rootGoal: "generate_job_specific_resume",
      activeGoal: "clarify_tailoring",
      workflowId: "tailor_resume",
      stage: "clarify_unsupported_facts",
      completionStatus: "waiting_for_user",
      completionType: "transactional",
      selectedEntities: {
        ...seed.selectedEntities,
        profileId: demoCareerProfile.id,
        resumeId: general.branch.id,
        jobId: job.id,
        tailoringSessionId: initialTailoringSession.id
      },
      knownSlots: {
        ...seed.knownSlots,
        tailoringSession: initialTailoringSession,
        questionPlan,
        activeQuestionId: "q-1"
      },
      updatedAt: now
    };
    const initialSession = AgentSessionSchema.parse(attachTaskStateOptions(
      projectTaskStateIntoSession({
        ...base,
        activeTurn: {
          id: "p45c1-final-question-turn",
          sessionId: base.id,
          status: "waiting_for_user",
          startedAt: now
        }
      }, taskState),
      taskState
    ));

    const service = new BrowserAgentToolService(repository);
    const execute = vi.fn(async (input: {
      toolName: string;
      toolInput: Record<string, unknown>;
      operationId: string;
    }) => {
      const completedAt = new Date().toISOString();
      let data: unknown;
      if (input.toolName === "generate_tailoring_changes") {
        const source = TailoringSessionSchema.parse(input.toolInput.session);
        const sourceQuestionPlan = source.plan.questionPlan!;
        const answerRevisionHash = tailoringAnswerRevisionHash(source.plan);
        const plan = ResumeTailoringPlanSchema.parse({
          ...source.plan,
          questionPlan: {
            ...sourceQuestionPlan,
            activeQuestionId: undefined,
            status: "completed",
            completedAt
          },
          generationStatus: "completed",
          answerRevisionHash,
          generatedDiffsBasedOnQuestionPlanRevision: sourceQuestionPlan.revision,
          generatedDiffsBasedOnAnswerRevisionHash: answerRevisionHash,
          diffs: [diffA, diffB],
          diffReviews: [diffA, diffB].map((diff) => ({
            diffId: tailoringDiffId(diff),
            status: "suggested" as const,
            updatedAt: completedAt
          }))
        });
        data = {
          session: TailoringSessionSchema.parse({
            ...source,
            plan,
            revision: source.revision + 1,
            generatedDiffRevision: source.generatedDiffRevision + 1
          }),
          appliedDiffs: [diffA, diffB]
        };
      } else if (input.toolName === "review_tailoring_diff") {
        data = reviewTailoringDiffCommand({ operationId: input.operationId, ...input.toolInput } as never);
      } else if (input.toolName === "preview_tailoring_changes") {
        data = await service.previewTailoringChanges(input.toolInput, input.operationId);
      } else if (input.toolName === "apply_tailoring_changes") {
        data = await service.applyTailoringChanges(input.toolInput, input.operationId);
      } else {
        throw new Error(`unexpected_tool:${input.toolName}`);
      }
      return {
        ok: true as const,
        operationId: input.operationId,
        toolName: input.toolName,
        data,
        artifactIds: [],
        completedAt
      };
    });
    const save = vi.fn(async (session: AgentSession) => session);
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: { execute } as never,
      persistence: { save } as never,
      repository
    });
    host.adopt(initialSession);

    const initialProjection = getActiveTailoringQuestionProjection(host.getSnapshot().activeSession!);
    expect(initialProjection).toMatchObject({
      interactionId: expect.stringContaining("workflow-interaction:"),
      checkpointId: expect.stringContaining("clarification:"),
      interactionRevision: 0,
      questionId: "q-1"
    });
    expect(host.getSnapshot().activeSession?.taskState?.knownSlots.workflowInteractionDiagnostics).toMatchObject({
      questionProjectionWriters: { count: 1, owners: ["TailoringWorkflowDriver"], invariant: "passed" }
    });

    const choose = async (value: string) => {
      const projection = getActiveTailoringQuestionProjection(host.getSnapshot().activeSession!);
      const option = projection?.options.find((candidate) => candidate.action.type === "answer" && candidate.action.value === value);
      if (!option || option.action.type !== "answer") throw new Error(`question_option_missing:${value}`);
      const result = await host.dispatch({ type: "option", action: option.action }, { pageContext });
      if (!result) throw new Error(`question_transition_missing:${value}`);
      return result;
    };

    await choose("不确定");
    await choose("跳过");
    const q3Session = host.getSnapshot().activeSession!;
    const q3Prepared = await host.prepareRuntimeUserEvent({
      session: q3Session,
      event: { type: "text_message", text: "我在真实项目中完成了接口回归测试和发布核验。" },
      pageContext
    });
    const reviewed = q3Prepared.session;
    const receipts = reviewed.taskState?.knownSlots.tailoringQuestionAnswerReceipts as Array<Record<string, unknown>>;
    expect(receipts).toEqual([
      expect.objectContaining({ questionId: "q-1", disposition: "uncertain" }),
      expect.objectContaining({ questionId: "q-2", disposition: "skipped" }),
      expect.objectContaining({ questionId: "q-3", disposition: "answered" })
    ]);
    const answerTurnIds = new Set(reviewed.messages
      .filter((message) => message.role === "user" && message.metadata?.answerPayload === true)
      .map((message) => message.turnId));
    expect(answerTurnIds).toEqual(new Set(["p45c1-final-question-turn"]));
    expect(reviewed.taskState).toMatchObject({
      stage: "preview_changes",
      completionStatus: "waiting_for_user",
      knownSlots: { remainingDiffCount: 2 }
    });
    expect(reviewed.taskState?.workflowUserInputCheckpoint).toMatchObject({
      kind: "review_decision",
      state: "active",
      interactionId: expect.stringContaining("workflow-interaction:")
    });
    expect(reviewed.messages.filter((message) => message.metadata?.tailoringQuestionProjection === true)).toHaveLength(3);

    const reviewReload = new AgentHostStore({
      kernel: {} as never,
      executor: { execute } as never,
      persistence: { save } as never,
      repository
    });
    reviewReload.adopt({
      ...reviewed,
      messages: reviewed.messages.filter((message) => !message.metadata?.workflowInteractionKind || message.metadata.workflowInteractionKind !== "review_decision")
    });
    expect(reviewReload.getSnapshot().activeSession?.messages.filter((message) =>
      message.metadata?.workflowInteractionKind === "review_decision"
      && message.metadata?.workflowInteractionId === reviewed.taskState?.workflowUserInputCheckpoint?.interactionId
    )).toHaveLength(1);

    const accepted = await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_decision", diffId: tailoringDiffId(diffA), decision: "accept" }
    }, { pageContext });
    expect(accepted?.taskState?.knownSlots).toMatchObject({
      acceptedDiffIds: [tailoringDiffId(diffA)],
      remainingDiffCount: 1
    });

    const confirmationReady = await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_decision", diffId: tailoringDiffId(diffB), decision: "reject" }
    }, { pageContext });
    expect(confirmationReady).toMatchObject({
      taskState: { stage: "confirm_apply", completionStatus: "waiting_for_confirmation" },
      pendingConfirmation: { toolName: "apply_tailoring_changes", status: "pending" },
      pendingToolCall: { toolName: "apply_tailoring_changes" }
    });
    expect(confirmationReady?.taskState?.workflowUserInputCheckpoint).toMatchObject({
      kind: "confirmation",
      state: "active"
    });
    expect(confirmationReady?.messages.some((message) =>
      message.metadata?.workflowInteractionKind === "review_decision"
      && message.metadata?.workflowInteractionState === "resolved"
    )).toBe(true);
    const confirmationReload = new AgentHostStore({
      kernel: {} as never,
      executor: { execute } as never,
      persistence: { save } as never,
      repository
    });
    confirmationReload.adopt({
      ...confirmationReady!,
      messages: confirmationReady!.messages.filter((message) => message.metadata?.workflowInteractionKind !== "confirmation")
    });
    expect(confirmationReload.getSnapshot().activeSession?.messages.filter((message) =>
      message.metadata?.workflowInteractionKind === "confirmation"
    )).toHaveLength(1);

    const completed = await host.dispatch({ type: "confirmation", confirmed: true }, { pageContext });
    expect(completed?.taskState?.completionStatus).toBe("completed");
    expect(completed?.taskState?.stage).toBe("quality_result");
    expect(completed?.messages.some((message) =>
      message.metadata?.workflowInteractionKind === "confirmation"
      && message.metadata?.workflowInteractionState === "resolved"
    )).toBe(true);
    expect(completed?.taskState?.knownSlots.qualityResult).toMatchObject({
      acceptedDiffIds: [tailoringDiffId(diffA)],
      acceptedDiffCount: 1,
      changedFieldPaths: [`summary.${summary.id}.text`]
    });
    expect(completed?.messages.some((message) =>
      message.role === "assistant"
      && message.content.includes("已生成岗位定制简历")
      && message.options?.some((option) => option.label === "打开岗位简历")
    )).toBe(true);
    expect(completed?.taskState?.knownSlots.workflowInteractionDiagnostics).toMatchObject({
      questionProjectionWriters: { count: 1, owners: ["TailoringWorkflowDriver"], invariant: "passed" }
    });

    const completedReload = new AgentHostStore({
      kernel: {} as never,
      executor: { execute } as never,
      persistence: { save } as never,
      repository
    });
    completedReload.adopt(completed!);
    expect(completedReload.getSnapshot().activeSession?.taskState).toMatchObject({
      stage: "quality_result",
      completionStatus: "completed"
    });
    expect(completedReload.getSnapshot().activeSession?.taskState?.workflowUserInputCheckpoint).toBeUndefined();

    const jobBranches = (await repository.listResumeBranches(demoCareerProfile.id))
      .filter((branch) => branch.branchPurpose === "job_specific");
    expect(jobBranches).toHaveLength(1);
    const jobBranch = jobBranches[0];
    const jobRevision = await repository.getResumeRevision(jobBranch.currentRevisionId!);
    expect(jobBranch.sourceBranchId).toBe(general.branch.id);
    expect(jobBranch.currentRevisionId).toBeTruthy();
    expect(jobRevision?.id).toBe(jobBranch.currentRevisionId);
    expect(jobBranch.structuredContentItems?.find((item) => item.id === summary.id)?.data).toMatchObject({
      sectionType: "summary",
      text: acceptedSummary
    });
    expect(jobRevision?.snapshot.structuredContentItems?.find((item) => item.id === summary.id)?.data).toMatchObject({
      sectionType: "summary",
      text: acceptedSummary
    });
    expect(await repository.getResumeBranch(general.branch.id)).toMatchObject({
      id: general.branch.id,
      currentRevisionId: general.branch.currentRevisionId
    });
  });

  it("keeps one visible question through same-turn runtime events beyond 15 seconds", async () => {
    vi.useFakeTimers();
    const source = loopSession();
    const question = source.messages.find((message) => message.metadata?.tailoringQuestionId === "q-1");
    if (!question?.turnId) throw new Error("question_turn_missing");
    const narrationSession = AgentSessionSchema.parse({
      ...source,
      messages: [...source.messages, {
        id: "same-turn-narration",
        turnId: question.turnId,
        role: "assistant" as const,
        content: "旁路叙述不应回收当前问题。",
        kind: "text" as const,
        type: "text" as const,
        status: "complete" as const,
        createdAt: "2026-08-21T00:00:00.100Z"
      }]
    });
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save: async (session: AgentSession) => session } as never
    });
    host.adopt(narrationSession);
    const before = host.getSnapshot().activeSession!.messages.find((message) => message.id === question.id);
    expect(before).toMatchObject({
      id: question.id,
      turnId: question.turnId,
      createdAt: question.createdAt
    });

    const shell = await host.beginRuntimeShell({
      session: host.getSnapshot().activeSession!,
      userMessage: "",
      runtimeId: "hermes",
      turnId: question.turnId,
      appendUserMessage: false
    });
    const event = (type: "progress" | "text_delta" | "tool_call_started" | "tool_call_completed" | "turn_completed", data?: unknown) => ({
      type,
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      ...(type === "text_delta" ? { delta: "迟到的模型叙述" } : {}),
      ...(type === "progress" ? { message: "仍在处理" } : {}),
      ...(type === "tool_call_started" ? { toolName: "get_agent_task_context", operationId: "question-race-tool" } : {}),
      ...(type === "tool_call_completed" ? {
        toolName: "get_agent_task_context",
        operationId: "question-race-tool",
        data: { result: { ok: true, data: {} } }
      } : {}),
      ...(type === "turn_completed" ? { message: "旁路完成" } : {}),
      ...(data !== undefined ? { data } : {})
    }) as never;
    await host.applyRuntimeEvent(event("progress"), shell.assistantMessageId);
    await host.applyRuntimeEvent(event("text_delta"), shell.assistantMessageId);
    await host.applyRuntimeEvent(event("tool_call_started"), shell.assistantMessageId);
    await host.applyRuntimeEvent(event("tool_call_completed"), shell.assistantMessageId);
    await host.applyRuntimeEvent(event("turn_completed"), shell.assistantMessageId);
    await vi.advanceTimersByTimeAsync(16_000);

    const finalSession = host.getSnapshot().activeSession!;
    const visibleQuestions = finalSession.messages.filter((message) =>
      message.metadata?.tailoringQuestionProjection === true
      && message.metadata?.tailoringQuestionId === "q-1"
      && message.metadata?.retracted !== true
    );
    expect(visibleQuestions).toHaveLength(1);
    expect(visibleQuestions[0]).toMatchObject({
      id: question.id,
      turnId: question.turnId,
      createdAt: question.createdAt,
      content: question.content
    });
  });

  it("reads the canonical post-Q3 session before generate_changes", async () => {
    const source = loopSession();
    const persisted = new Map<string, AgentSession>();
    const answerCommitIds = new Set<string>();
    const events: string[] = [];
    const execute = vi.fn(async (input: {
      toolName: string;
      toolInput: Record<string, unknown>;
      operationId: string;
    }) => {
      events.push(input.toolName);
      if (input.toolName !== "generate_tailoring_changes") throw new Error(`unexpected_tool:${input.toolName}`);
      const tailoring = input.toolInput.session as {
        plan: Parameters<typeof isTailoringQuestionPlanComplete>[0];
      };
      expect(tailoring.plan.questionPlan?.status).toBe("ready_for_generation");
      expect(tailoring.plan.answerReceipts?.map((receipt) => [receipt.questionId, receipt.questionPlanRevision])).toEqual([
        ["q-1", 1],
        ["q-2", 2],
        ["q-3", 3]
      ]);
      expect(isTailoringQuestionPlanComplete(tailoring.plan)).toBe(true);
      return {
        ok: false as const,
        operationId: input.operationId,
        toolName: input.toolName,
        artifactIds: [],
        error: { code: "probe_generate_failure", message: "只验证 Driver 输入。", recoverable: true },
        completedAt: new Date().toISOString()
      };
    });
    const persistence = {
      save: vi.fn(async (value: AgentSession) => {
        events.push("save");
        const previous = persisted.get(value.id);
        persisted.set(value.id, structuredClone(value));
        const answer = [...value.messages].reverse().find((message) =>
          message.role === "user" && message.metadata?.answerPayload === true
        );
        if (answer && !answerCommitIds.has(answer.id)) {
          answerCommitIds.add(answer.id);
          // Model the stale object that caused the incident: save succeeds,
          // but its return value is the pre-write snapshot. The canonical get
          // below is the only value allowed into the Driver.
          return previous ?? value;
        }
        return value;
      }),
      get: vi.fn(async (sessionId: string) => {
        events.push("get");
        const value = persisted.get(sessionId);
        return value ? structuredClone(value) : undefined;
      })
    };
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: { execute } as never,
      persistence: persistence as never
    });
    host.adopt(source);

    const choose = async (value: string) => {
      const projection = getActiveTailoringQuestionProjection(host.getSnapshot().activeSession!);
      const option = projection?.options.find((candidate) => candidate.action.type === "answer" && candidate.action.value === value);
      if (!option || option.action.type !== "answer") throw new Error(`question_option_missing:${value}`);
      await host.dispatch({ type: "option", action: option.action }, { pageContext });
    };
    await choose("跳过");
    await choose("跳过");
    const prepared = await host.prepareRuntimeUserEvent({
      session: host.getSnapshot().activeSession!,
      event: { type: "text_message", text: "我在真实项目中完成了接口回归测试。" },
      pageContext
    });

    const generateIndex = events.indexOf("generate_tailoring_changes");
    const canonicalReadIndex = events.lastIndexOf("get");
    expect(canonicalReadIndex).toBeGreaterThan(-1);
    expect(canonicalReadIndex).toBeLessThan(generateIndex);
    expect(prepared.session.taskState?.knownSlots.canonicalWorkflowFailure).toMatchObject({
      code: "probe_generate_failure",
      stage: "generate_changes"
    });
  });

  it("applies a bound answer button once when two clicks race", async () => {
    const session = loopSession();
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: {
        save: async (value: AgentSession) => {
          await Promise.resolve();
          return value;
        }
      } as never
    });
    host.adopt(session);
    const projection = getActiveTailoringQuestionProjection(host.getSnapshot().activeSession!);
    const option = projection?.options.find((candidate) => candidate.action.type === "answer" && candidate.action.value === "跳过");
    if (!option || option.action.type !== "answer") throw new Error("bound_skip_option_missing");

    const [first, second] = await Promise.all([
      host.dispatch({ type: "option", action: option.action }, { pageContext }),
      host.dispatch({ type: "option", action: option.action }, { pageContext })
    ]);
    const result = host.getSnapshot().activeSession ?? first ?? second;
    if (!result) throw new Error("raced_transition_missing");
    expect(result.messages.filter((message) => message.role === "user" && message.metadata?.answerPayload === true)).toHaveLength(1);
    expect(new Set(result.messages
      .filter((message) => message.role === "user" && message.metadata?.answerPayload === true)
      .map((message) => message.turnId))).toEqual(new Set(["p45c1-race-question-turn"]));
    expect(result.messages.filter((message) =>
      message.role === "assistant" && message.metadata?.tailoringQuestionId === "q-1"
    )).toHaveLength(1);
    expect(result.taskState?.knownSlots.tailoringQuestionAnswerReceipts).toMatchObject([
      { questionId: "q-1", disposition: "skipped" }
    ]);
    expect(getActiveTailoringQuestionProjection(result)?.questionId).toBe("q-2");
  });

  it("does not let delayed same-session hydration roll back a live question", async () => {
    const source = loopSession();
    const live = AgentSessionSchema.parse({
      ...source,
      sessionRevision: 4,
      updatedAt: "2026-08-21T00:00:04.000Z"
    });
    const stale = AgentSessionSchema.parse({
      ...source,
      sessionRevision: 3,
      updatedAt: "2026-08-21T00:00:03.000Z"
    });
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save: async (value: AgentSession) => value } as never
    });

    host.adopt(live);
    host.adopt(stale);

    expect(host.getSnapshot().activeSession).toMatchObject({
      sessionRevision: 4
    });
    expect(host.getSnapshot().activeSession?.updatedAt).not.toBe(stale.updatedAt);
    const projection = getActiveTailoringQuestionProjection(host.getSnapshot().activeSession!);
    const option = projection?.options.find((candidate) => candidate.action.type === "answer" && candidate.action.value === "跳过");
    if (!option || option.action.type !== "answer") throw new Error("delayed_hydration_option_missing");

    const result = await host.dispatch({ type: "option", action: option.action }, { pageContext });

    expect(result?.taskState?.knownSlots.activeQuestionId).toBe("q-2");
    expect(result?.messages.filter((message) => message.role === "user" && message.metadata?.answerPayload === true)).toHaveLength(1);
    expect(result?.messages.some((message) => message.errorCode === "tailoring_interaction_not_consumed")).toBe(false);
  });

  it("does not invoke the Driver when the answer write loses its CAS race", async () => {
    const source = loopSession();
    const persisted = structuredClone(source);
    const execute = vi.fn(async () => {
      throw new Error("driver_should_not_run_after_rejected_answer");
    });
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: { execute } as never,
      persistence: {
        save: async (value: AgentSession) => value,
        get: async () => structuredClone(persisted)
      } as never
    });
    host.adopt(source);
    const projection = getActiveTailoringQuestionProjection(host.getSnapshot().activeSession!);
    const option = projection?.options.find((candidate) => candidate.action.type === "answer" && candidate.action.value === "跳过");
    if (!option || option.action.type !== "answer") throw new Error("cas_race_option_missing");

    const result = await host.dispatch({ type: "option", action: option.action }, { pageContext });

    expect(execute).not.toHaveBeenCalled();
    expect(result?.messages.some((message) => message.errorCode === "tailoring_interaction_not_consumed")).toBe(false);
    expect(result?.messages.filter((message) => message.role === "user" && message.metadata?.answerPayload === true)).toHaveLength(0);
  });

  it("rebases a typed tailoring answer after a CAS rejection", async () => {
    const source = loopSession();
    let persisted = structuredClone(source);
    let answerSaveCount = 0;
    const persistence = {
      save: vi.fn(async (value: AgentSession) => {
        const answer = [...value.messages].reverse().find((message) =>
          message.role === "user" && message.metadata?.answerPayload === true
        );
        if (answer) {
          answerSaveCount += 1;
          if (answerSaveCount === 1) {
            persisted = AgentSessionSchema.parse({
              ...persisted,
              sessionRevision: persisted.sessionRevision + 1,
              updatedAt: "2026-08-21T00:00:01.000Z"
            });
            return structuredClone(persisted);
          }
        }
        persisted = structuredClone(value);
        return structuredClone(value);
      }),
      get: vi.fn(async () => structuredClone(persisted))
    };
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: persistence as never
    });
    host.adopt(source);

    const text = "我在真实项目中负责接口行为、错误处理和并发问题的回归验证。";
    const prepared = await host.prepareRuntimeUserEvent({
      session: source,
      event: { type: "text_message", text },
      pageContext
    });

    expect(answerSaveCount).toBeGreaterThanOrEqual(2);
    expect(prepared.deterministicTerminal).toBe(true);
    expect(prepared.session.messages).toContainEqual(expect.objectContaining({
      role: "user",
      content: text,
      metadata: expect.objectContaining({ answerPayload: true })
    }));
    expect(getActiveTailoringQuestionProjection(prepared.session)?.questionId).toBe("q-2");
  });

  it("does not route an uncommitted typed answer into the Driver", async () => {
    const source = loopSession();
    const execute = vi.fn(async () => {
      throw new Error("driver_should_not_run_after_uncommitted_text_answer");
    });
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: { execute } as never,
      persistence: {
        save: async (value: AgentSession) => value,
        get: async () => structuredClone(source)
      } as never
    });
    host.adopt(source);

    await expect(host.prepareRuntimeUserEvent({
      session: source,
      event: { type: "text_message", text: "这段输入必须保留，不能被吞掉。" },
      pageContext
    })).rejects.toMatchObject({ code: "tailoring_answer_not_committed" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("retries a failed generation checkpoint without replaying resolved questions", async () => {
    const source = loopSession();
    let retryInput: AgentSession | undefined;
    const runTurn = vi.fn(async (input: { session: AgentSession }) => {
      retryInput = input.session;
      return {
        trajectory: {
          workflowId: input.session.taskState?.workflowId ?? "tailor_resume",
          startedAt: "2026-08-21T00:00:00.000Z",
          completedAt: "2026-08-21T00:00:01.000Z",
          outcome: "completed" as const,
          toolCalls: [],
          artifacts: [],
          observations: []
        },
        taskState: input.session.taskState
      };
    });
    const execute = vi.fn(async (input: { toolName: string; operationId: string }) => ({
      ok: false as const,
      operationId: input.operationId,
      toolName: input.toolName,
      artifactIds: [],
      error: { code: "generate_changes_probe_failure", message: "生成阶段故障", recoverable: true },
      completedAt: new Date().toISOString()
    }));
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute } as never,
      persistence: { save: async (value: AgentSession) => value } as never
    });
    host.adopt(source);
    const choose = async (value: string) => {
      const projection = getActiveTailoringQuestionProjection(host.getSnapshot().activeSession!);
      const option = projection?.options.find((candidate) => candidate.action.type === "answer" && candidate.action.value === value);
      if (!option || option.action.type !== "answer") throw new Error(`question_option_missing:${value}`);
      await host.dispatch({ type: "option", action: option.action }, { pageContext });
    };
    await choose("跳过");
    await choose("跳过");
    await host.prepareRuntimeUserEvent({
      session: host.getSnapshot().activeSession!,
      event: { type: "text_message", text: "我在真实项目中完成了接口回归测试。" },
      pageContext
    });
    const failed = host.getSnapshot().activeSession!;
    expect(failed.taskState?.stage).toBe("generate_changes");
    const retried = await host.dispatch({
      type: "option",
      action: { type: "retry_current_step" }
    }, { pageContext });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(retryInput?.taskState?.stage).toBe("generate_changes");
    expect(retryInput?.taskState?.knownSlots.tailoringSession).toMatchObject({
      plan: { answerReceipts: [
        { questionId: "q-1" },
        { questionId: "q-2" },
        { questionId: "q-3" }
      ] }
    });
    expect(retried?.messages.filter((message) => message.role === "user" && message.metadata?.answerPayload === true)).toHaveLength(3);
    expect(retried?.messages.filter((message) =>
      message.role === "assistant" && message.metadata?.tailoringQuestionProjection === true && message.metadata?.retracted !== true
    )).toHaveLength(3);
  });
});

function loopSession(): AgentSession {
  const base = AgentRuntime.create("tailor_resume", "generate_changes", "P4.5c.1 race fixture");
  const seed = new AgentTaskStateReducer().create(base, "generate_job_specific_resume");
  const now = "2026-08-21T00:00:00.000Z";
  const questions = ["q-1", "q-2", "q-3"].map((id, index) => ({
    id,
    question: `你是否有 ${id} 的真实经历？`,
    requirementText: `${id} 的结构化岗位要求`,
    requirementIds: [`requirement-${id}`],
    sourceItemIds: ["item-1"],
    relatedItemIds: ["item-1"],
    candidateClaim: `${id} 的候选事实`,
    targetFieldPaths: ["summary.text"],
    answerType: "text" as const,
    options: [
      { id: "skip", label: "跳过", value: "跳过" },
      { id: "uncertain", label: "不确定", value: "不确定" }
    ],
    status: index === 0 ? "active" as const : "pending" as const,
    updatedAt: now
  }));
  const tailoringSession = {
    id: "p45c1-race-tailoring-session",
    plan: {
      clarificationQuestions: questions,
      clarificationAnswers: [],
      answerReceipts: [],
      questionPlan: {
        id: "p45c1-race-question-plan",
        sessionId: "p45c1-race-tailoring-session",
        revision: 1,
        questionIds: questions.map((question) => question.id),
        activeQuestionId: "q-1",
        answeredQuestionIds: [],
        skippedQuestionIds: [],
        uncertainQuestionIds: [],
        status: "asking"
      }
    }
  };
  const taskState: AgentTaskState = {
    ...seed,
    rootGoal: "generate_job_specific_resume",
    activeGoal: "clarify_tailoring",
    workflowId: "tailor_resume",
    stage: "clarify_unsupported_facts",
    completionStatus: "waiting_for_user",
    completionType: "transactional",
    selectedEntities: {
      ...seed.selectedEntities,
      profileId: "profile-race",
      resumeId: "resume-race",
      jobId: "job-race",
      tailoringSessionId: "p45c1-race-tailoring-session"
    },
    knownSlots: {
      ...seed.knownSlots,
      tailoringSession,
      questionPlan: tailoringSession.plan.questionPlan,
      activeQuestionId: "q-1"
    },
    updatedAt: now
  };
  return AgentSessionSchema.parse(attachTaskStateOptions(
    projectTaskStateIntoSession({
      ...base,
      activeTurn: {
        id: "p45c1-race-question-turn",
        sessionId: base.id,
        status: "waiting_for_user",
        startedAt: now
      }
    }, taskState),
    taskState
  ));
}
