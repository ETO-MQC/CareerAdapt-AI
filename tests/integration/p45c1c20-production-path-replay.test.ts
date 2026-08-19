import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AgentSessionSchema,
  type AgentSession,
  type AgentTaskState
} from "@/agent/contracts/agentSession";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import {
  AgentHostStore,
  attachTaskStateOptions
} from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { projectTaskStateIntoSession } from "@/agent/runtime/projectTaskStateToWorkflowState";
import { currentTurnScopedTargetContext } from "@/agent/runtime/turnScopedTargetContext";
import { mapOfficialHermesEvent } from "@/agent/runtime/hermes/HermesBridgeTransport";
import {
  CareerAdaptMcpBridgeClient,
  normalizeHermesScopedInput
} from "@/agent/mcp/CareerAdaptMcpBridgeClient";
import { CareerAdaptMcpProtocolServer } from "@/agent/mcp/CareerAdaptMcpServer";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { stableHashText } from "@/services/security/text";

const LONG_EXTERNAL_JD = [
  "岗位职责：负责 AI 应用的需求分析、工作流设计、服务接入和交付质量跟踪，协同产品与工程团队完成上线。",
  "工作内容：梳理用户问题，维护岗位语义和证据链，参与工具调用、数据读回和结果复核，持续改进交付流程。",
  "任职资格：熟悉 TypeScript、React 或 Python，具备良好的沟通能力、问题拆解能力和文档表达能力。",
  "Requirements：能够根据业务目标推进跨团队协作，并对结果进行复盘。",
  "补充要求：能够阅读技术文档、维护可追踪的交付记录，并在上线前完成验证和风险说明。"
].join("\n");

const pageContext = { pathname: "/ai-workspace", query: {} };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("P4.5c.1.20 production golden journey replay", () => {
  it("keeps one target context and one logical operation across Hermes, MCP, Browser, Gateway and Facade", async () => {
    const session = tailoringSession("choose_resume_source");
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save: async <T>(value: T) => value } as never
    });
    host.adopt(session);
    const shell = await host.beginRuntimeShell({
      session,
      userMessage: LONG_EXTERNAL_JD,
      runtimeId: "hermes"
    });
    const captured = currentTurnScopedTargetContext(shell.session.taskState, shell.turnId);
    expect(captured).toMatchObject({
      logicalTurnId: shell.turnId,
      sourceMessageId: shell.userMessageId,
      targetText: LONG_EXTERNAL_JD,
      targetTextHash: stableHashText(LONG_EXTERNAL_JD)
    });

    const officialStarted = mapOfficialHermesEvent("tool.started", {
      tool_name: "career.workflow.tailor_resume",
      tool_call_id: "official-tool-1",
      operation_id: "transport-operation-1",
      logical_turn_id: shell.turnId,
      logical_tool_operation_id: "logical-operation-1",
      input: {}
    });
    expect(officialStarted).toMatchObject({
      type: "tool_call_started",
      operationId: "transport-operation-1",
      logicalToolOperationId: "logical-operation-1",
      data: { hermesToolCallArgumentShape: {} }
    });
    await host.applyRuntimeEvent({
      ...officialStarted!,
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString()
    }, shell.assistantMessageId);

    const gateway = new CareerToolGateway(goldenReadRegistry());
    const protocol = new CareerAdaptMcpProtocolServer(gateway, {
      name: "careeradapt",
      version: "p4.5c.1.20",
      requireSessionBinding: true
    });
    const binding = {
      agentSessionId: shell.session.id,
      personId: "person-1",
      profileId: "profile-1",
      profileVersionNumber: 3,
      profileRevision: 3
    };
    const resumeListResponse = await protocol.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "career.resume.list",
        arguments: {},
        _meta: {
          "careeradapt/logicalTurnId": shell.turnId,
          "careeradapt/logicalToolOperationId": "logical-operation-1",
          "careeradapt/sessionBinding": binding
        }
      }
    });
    const resumeList = structuredPayload(resumeListResponse);
    expect(resumeList).toMatchObject({ ok: true, data: { resumes: [{ id: "resume-1", purpose: "general" }] } });
    await host.applyRuntimeEvent({
      type: "tool_call_completed",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      toolName: "career.resume.list",
      operationId: "transport-resume-list",
      data: {
        logicalToolOperationId: "logical-operation-1",
        result: { structuredContent: resumeList }
      }
    }, shell.assistantMessageId);

    const profileResponse = await protocol.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "career.profile.get",
        arguments: { profileId: "profile-1" },
        _meta: {
          "careeradapt/logicalTurnId": shell.turnId,
          "careeradapt/logicalToolOperationId": "logical-operation-1",
          "careeradapt/sessionBinding": binding
        }
      }
    });
    expect(structuredPayload(profileResponse)).toMatchObject({ ok: true, data: { profile: { id: "profile-1" } } });
    await host.applyRuntimeEvent({
      type: "tool_call_completed",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      toolName: "career.profile.get",
      operationId: "transport-profile-get",
      data: {
        logicalToolOperationId: "logical-operation-1",
        result: { structuredContent: structuredPayload(profileResponse) }
      }
    }, shell.assistantMessageId);
    expect(host.getSnapshot().activeSession?.taskState?.selectedEntities.resumeId).toBe("resume-1");
    expect(host.getSnapshot().activeSession?.taskState?.workflowUserInputCheckpoint).toBeUndefined();

    const normalized = normalizeHermesScopedInput(
      "career.workflow.tailor_resume",
      {},
      binding,
      {
        sessionId: shell.session.id,
        turnId: shell.turnId,
        assistantMessageId: shell.assistantMessageId,
        targetContext: captured
      },
      shell.turnId
    );
    expect(normalized).toMatchObject({
      targetText: LONG_EXTERNAL_JD,
      targetContextId: captured?.targetContextId
    });

    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const browserClient = new CareerAdaptMcpBridgeClient();
    const browser = browserClient as unknown as {
      gateway: CareerAdaptMcpGatewayLike;
      bridgeId: string;
      token: string;
      stopped: boolean;
      confirmationContext: unknown;
      execute(request: unknown): Promise<void>;
    };
    browser.gateway = gateway;
    browser.bridgeId = "bridge-golden-1";
    browser.token = "token-golden-1";
    browser.stopped = false;
    browser.confirmationContext = {
      sessionId: shell.session.id,
      turnId: shell.turnId,
      assistantMessageId: shell.assistantMessageId,
      targetContext: captured
    };
    await browser.execute({
      id: "bridge-request-1",
      name: "career.workflow.tailor_resume",
      input: {},
      operationId: "transport-operation-1",
      logicalToolOperationId: "logical-operation-1",
      logicalTurnId: shell.turnId
    });

    const browserCall = fetchMock.mock.calls.at(-1);
    const posted = JSON.parse(String((browserCall?.[1] as RequestInit | undefined)?.body)) as { result?: { diagnostics?: Record<string, unknown>; error?: { diagnostics?: Record<string, unknown> } } };
    const browserDiagnostics = posted.result?.diagnostics ?? posted.result?.error?.diagnostics ?? {};
    expect(browserDiagnostics).toMatchObject({
      browserHandlerArgumentShape: {
        targetText: { present: true, lengthBucket: "length:201-2000" }
      },
      gatewayArgumentShape: {
        targetText: { present: true }
      },
      facadeArgumentShape: {
        targetText: { present: true }
      },
      mcpHttpArgumentShape: {}
    });
    expect(browserDiagnostics.logicalToolOperationId).toBe("logical-operation-1");
    expect(JSON.stringify(browserDiagnostics)).not.toContain(LONG_EXTERNAL_JD);

    const protocolDiagnostics = objectValue(structuredPayload(await protocol.handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "career.workflow.tailor_resume",
        arguments: {},
        _meta: {
          "careeradapt/logicalTurnId": shell.turnId,
          "careeradapt/logicalToolOperationId": "logical-operation-1"
        }
      }
    })).diagnostics);
    expect(protocolDiagnostics).toMatchObject({
      mcpJsonRpcArgumentShape: expect.any(Object),
      mcpHttpArgumentShape: expect.any(Object),
      facadeArgumentShape: expect.any(Object),
      appBuildCommit: expect.not.stringMatching(/^unknown$/u),
      appBuildTimestamp: expect.not.stringMatching(/^unknown$/u),
      careerToolContractVersion: "career-tool-contract-v3"
    });
    const completeness: Record<string, unknown> = {
      ...protocolDiagnostics,
      ...browserDiagnostics,
      hermesToolCallArgumentShape: objectValue(objectValue(objectValue(officialStarted).data).hermesToolCallArgumentShape)
    };
    for (const field of [
      "hermesToolCallArgumentShape",
      "mcpJsonRpcArgumentShape",
      "mcpHttpArgumentShape",
      "browserHandlerArgumentShape",
      "gatewayArgumentShape",
      "facadeArgumentShape",
      "logicalToolOperationId"
    ]) expect(completeness[field]).toBeDefined();
  });

  it("derives one waiting checkpoint and consumes the persisted text answer once", async () => {
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save: async <T>(value: T) => value } as never
    });
    const session = attachTaskStateOptions(clarificationSession(), clarificationSession().taskState!);
    host.adopt(session);
    expect(session.taskState?.workflowUserInputCheckpoint).toMatchObject({ kind: "clarification" });

    const prepared = await host.prepareRuntimeUserEvent({
      session,
      event: { type: "text_message", text: "有的" },
      pageContext
    });
    const answer = prepared.session.messages.find((message) =>
      message.role === "user" && message.metadata?.answerPayload === true
    );
    expect(answer).toMatchObject({ content: "有的", turnId: prepared.turnId });
    expect(prepared.tailoringAnswerBinding).toMatchObject({
      checkpointId: "tailoring-session-1",
      questionId: "q-1",
      answer: "有的"
    });

    host.adopt(prepared.session);
    const continuation = await host.beginRuntimeShell({
      session: prepared.session,
      userMessage: "",
      runtimeId: "hermes",
      appendUserMessage: false
    });
    const answered = tailoringSessionWithoutActiveQuestion();
    await host.applyRuntimeEvent({
      type: "tool_call_completed",
      sessionId: continuation.session.id,
      turnId: continuation.turnId,
      timestamp: new Date().toISOString(),
      toolName: "answer_tailoring_question",
      operationId: "answer-once-1",
      data: { result: { ok: true, data: { session: answered } } }
    }, continuation.assistantMessageId);
    const after = host.getSnapshot().activeSession;
    expect(after?.taskState?.workflowUserInputCheckpoint).toBeUndefined();
    expect(after?.messages.find((message) => message.id === answer?.id)?.metadata).toMatchObject({
      answerConsumedAt: expect.any(String),
      answerOperationId: "answer-once-1"
    });
  });

  it("routes plain text resume choice through the generic checkpoint handler", async () => {
    const base = tailoringSession("choose_resume_source");
    const reducer = new AgentTaskStateReducer();
    const taskState = reducer.reduce(base.taskState!, {
      type: "tool_observation",
      toolName: "list_resumes",
      observation: {
        resumes: [
          { id: "resume-1", profileId: "profile-1", purpose: "general", status: "active", healthy: true, revision: 1 },
          { id: "resume-2", profileId: "profile-1", purpose: "general", status: "active", healthy: true, revision: 2 }
        ]
      }
    });
    expect(taskState).toMatchObject({
      stage: "choose_resume_source",
      completionStatus: "waiting_for_user",
      knownSlots: { resumeSelectionRequired: true }
    });
    const session = attachTaskStateOptions(projectTaskStateIntoSession(base, taskState), taskState);
    expect(session.taskState?.workflowUserInputCheckpoint).toMatchObject({ kind: "resume_choice" });

    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save: async <T>(value: T) => value } as never
    });
    host.adopt(session);
    const prepared = await host.prepareRuntimeUserEvent({
      session,
      event: { type: "text_message", text: "resume-2" },
      pageContext
    });
    expect(prepared.event).toMatchObject({ type: "entity_selected", action: { entityId: "resume-2" } });
    expect(prepared.deterministicTransitionApplied).toBe(true);
    expect(prepared.session.taskState?.selectedEntities.resumeId).toBe("resume-2");
    expect(prepared.session.messages.at(-1)).toMatchObject({ role: "user", content: "resume-2" });
  });

  it("settles canonical validation failure as a recoverable workflow checkpoint", async () => {
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save: async <T>(value: T) => value } as never
    });
    const session = tailoringSession("choose_resume_source");
    host.adopt(session);
    const shell = await host.beginRuntimeShell({
      session,
      userMessage: LONG_EXTERNAL_JD,
      runtimeId: "hermes"
    });
    const diagnostics = {
      toolFailureLayer: "gateway_validation",
      failureScope: "career_workflow",
      safeDomainErrorCode: "schema_validation_failed",
      runtimeHealthy: true,
      mcpHealthy: true,
      logicalToolOperationId: "logical-failure-1"
    };
    await host.applyRuntimeEvent({
      type: "tool_call_completed",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      toolName: "career.workflow.tailor_resume",
      operationId: "validation-operation-1",
      data: {
        logicalToolOperationId: "logical-failure-1",
        result: {
          structuredContent: {
            ok: false,
            error: {
              code: "schema_validation_failed",
              message: "Career workflow input is incomplete.",
              recoverable: false
            },
            diagnostics
          }
        }
      }
    }, shell.assistantMessageId);
    const after = host.getSnapshot().activeSession;
    expect(after?.activeTurn?.status).toBe("waiting_for_user");
    expect(after?.taskState?.workflowUserInputCheckpoint).toMatchObject({
      kind: expect.any(String),
      workflowId: "tailor_resume"
    });
    expect(after?.taskState?.knownSlots.canonicalWorkflowFailure).toMatchObject({
      code: "schema_validation_failed",
      recoverable: true
    });
    const assistant = after?.messages.find((message) => message.id === shell.assistantMessageId);
    expect(assistant?.content).toContain("MCP 与 Hermes 仍处于健康状态");
    expect(assistant?.content).not.toContain("MCP 边界这次没有返回");
    expect(currentTurnScopedTargetContext(after?.taskState, shell.turnId)?.targetTextHash)
      .toBe(stableHashText(LONG_EXTERNAL_JD));
  });
});

type CareerAdaptMcpGatewayLike = {
  listContracts(): ReturnType<CareerToolGateway["listContracts"]>;
  execute(name: string, input: unknown, context: unknown): ReturnType<CareerToolGateway["execute"]>;
};

function structuredPayload(response: unknown) {
  const result = objectValue(objectValue(response).result);
  return objectValue(result.structuredContent);
}

function goldenReadRegistry() {
  const output = z.record(z.string(), z.unknown());
  const input = z.record(z.string(), z.unknown());
  const tool = (name: string, value: Record<string, unknown>) => ({
    name,
    description: name,
    risk: "read" as const,
    requiresConfirmation: false,
    idempotent: true,
    resumable: true,
    inputSchema: input,
    outputSchema: output,
    execute: async () => value
  });
  return new AgentToolRegistry([
    tool("list_resumes", {
      resumes: [{
        id: "resume-1",
        profileId: "profile-1",
        purpose: "general",
        status: "active",
        healthy: true,
        currentRevisionId: "resume-revision-1",
        revision: 1
      }]
    }),
    tool("get_profile", { profile: { id: "profile-1", personId: "person-1", profileRevision: 3 } }),
    tool("list_profiles", { profiles: [{ id: "profile-1", personId: "person-1", profileRevision: 3, version: 3 }] }),
    tool("get_active_profile", { selected: true, profileId: "profile-1", version: 3, profileRevision: 3 })
  ]);
}

function tailoringSession(stage: string): AgentSession {
  const base = AgentRuntime.create("tailor_resume", stage, "P4.5c.1.20 replay");
  const state = new AgentTaskStateReducer().create(base, "generate_job_specific_resume");
  return AgentSessionSchema.parse(projectTaskStateIntoSession(base, {
    ...state,
    rootGoal: "generate_job_specific_resume",
    activeGoal: "resolve_resume_source",
    workflowId: "tailor_resume",
    stage,
    completionType: "transactional",
    selectedEntities: {
      ...state.selectedEntities,
      profileId: "profile-1",
      profileVersion: 3
    },
    updatedAt: new Date().toISOString()
  }));
}

function clarificationSession(): AgentSession {
  const base = AgentRuntime.create("tailor_resume", "clarify_unsupported_facts", "P4.5c.1.20 clarification");
  const state = new AgentTaskStateReducer().create(base, "generate_job_specific_resume") as AgentTaskState;
  const sessionData = tailoringSessionData(true);
  return AgentSessionSchema.parse(projectTaskStateIntoSession(base, {
    ...state,
    rootGoal: "generate_job_specific_resume",
    activeGoal: "clarify_tailoring",
    workflowId: "tailor_resume",
    stage: "clarify_unsupported_facts",
    completionStatus: "active",
    completionType: "transactional",
    selectedEntities: {
      ...state.selectedEntities,
      profileId: "profile-1",
      resumeId: "resume-1",
      jobId: "job-1",
      tailoringSessionId: "tailoring-session-1"
    },
    knownSlots: {
      ...state.knownSlots,
      tailoringSession: sessionData,
      questionPlan: sessionData.plan.questionPlan,
      activeQuestionId: "q-1"
    },
    updatedAt: new Date().toISOString()
  }));
}

function tailoringSessionWithoutActiveQuestion() {
  const session = tailoringSessionData(false);
  return {
    session: {
      ...session,
      plan: {
        ...session.plan,
        questionPlan: {
          ...session.plan.questionPlan,
          activeQuestionId: undefined,
          answeredQuestionIds: ["q-1"],
          status: "complete"
        },
        clarificationAnswers: [{ questionId: "q-1", answer: "有的" }],
        generationStatus: "not_started"
      }
    }
  };
}

function tailoringSessionData(activeQuestion: boolean) {
  return {
    id: "tailoring-session-1",
    plan: {
      clarificationQuestions: [{
        id: "q-1",
        question: "你是否有真实的 AI 交付案例？",
        answerType: "boolean",
        options: [{ id: "yes", label: "有", value: "有" }]
      }],
      questionPlan: {
        id: "question-plan-1",
        sessionId: "tailoring-session-1",
        revision: 1,
        questionIds: ["q-1"],
        activeQuestionId: activeQuestion ? "q-1" : undefined,
        answeredQuestionIds: activeQuestion ? [] : ["q-1"],
        skippedQuestionIds: [],
        status: activeQuestion ? "asking" : "complete"
      },
      clarificationAnswers: activeQuestion ? [] : [{ questionId: "q-1", answer: "有的" }],
      diffs: [],
      diffReviews: [],
      generationStatus: "not_started"
    }
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
