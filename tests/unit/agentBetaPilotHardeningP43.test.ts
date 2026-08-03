import { describe, expect, it, vi } from "vitest";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import {
  resolveCompoundAnswer,
  unresolvedTailoringQuestions
} from "@/agent/runtime/CompoundAnswerResolver";
import type { AgentSession } from "@/agent/contracts/agentSession";

const PAGE_CONTEXT = { pathname: "/ai-workspace", query: {} };

describe("P4.3d one active question per turn", () => {
  const questions = [
    { id: "q-kotlin", question: "是否实际使用 Kotlin，熟练度如何？", answerType: "proficiency" as const },
    { id: "q-db", question: "情侣日记项目使用什么数据库？", answerType: "text" as const },
    { id: "q-live", question: "项目是否正式上线？", answerType: "boolean" as const }
  ];

  it("maps one message only to the currently exposed question", () => {
    expect(resolveCompoundAnswer(
      "Kotlin比较熟练，情侣日记项目用的是SQLite，不过没有正式上线。",
      questions
    )).toEqual({
      answers: [
        { questionId: "q-kotlin", answer: "熟练", proficiency: "proficient", evidenceQuote: "Kotlin比较熟练" }
      ],
      unmatchedText: "情侣日记项目用的是SQLite。不过没有正式上线"
    });
  });

  it("leaves unanswered questions unresolved and preserves a follow-up command", () => {
    const resolution = resolveCompoundAnswer(
      "Kotlin熟练，没有正式上线。顺便帮我把自我评价写得更偏Android一点。",
      questions
    );
    expect(resolution.answers.map((answer) => answer.questionId)).toEqual(["q-kotlin"]);
    expect(resolution.unmatchedText).toBe("没有正式上线。顺便帮我把自我评价写得更偏Android一点");
  });

  it("derives IDs only from the current unresolved set", () => {
    const pending = unresolvedTailoringQuestions({
      knownSlots: {
        tailoringSession: {
          plan: {
            questionPlan: { id: "question-plan-1", revision: 1, questionIds: ["q-kotlin", "q-db", "q-live"], activeQuestionId: "q-kotlin" },
            clarificationQuestions: questions,
            clarificationAnswers: [{ questionId: "q-db", answer: "SQLite" }]
          }
        }
      }
    });
    expect(pending.map((question) => question.id)).toEqual(["q-kotlin"]);
    expect(resolveCompoundAnswer("数据库是MySQL", pending).answers).toEqual([]);
  });
});

describe("P4.3b per-session input serialization", () => {
  it("queues ordinary messages FIFO without aborting the active turn", async () => {
    const base = session();
    const releases: Array<() => void> = [];
    const signals: AbortSignal[] = [];
    const runTurn = vi.fn(async (input: { signal: AbortSignal; userMessage: string }) => {
      signals.push(input.signal);
      await new Promise<void>((resolve) => releases.push(resolve));
      return completedResult(base.taskState!);
    });
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute: vi.fn() } as never,
      persistence: { save: async (value: AgentSession) => value } as never
    });

    const turnA = host.startTurn({ session: base, userMessage: "A", pageContext: PAGE_CONTEXT });
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    const queuedB = await host.startTurn({ session: base, userMessage: "B", pageContext: PAGE_CONTEXT });
    const queuedC = await host.startTurn({ session: queuedB!, userMessage: "C", pageContext: PAGE_CONTEXT });
    expect(signals[0].aborted).toBe(false);
    expect(host.getSnapshot().pendingInputCount).toBe(2);
    expect(queuedC?.messages.filter((message) => message.metadata?.executionState === "queued").map((message) => message.content)).toEqual(["B", "C"]);

    releases.shift()?.();
    await turnA;
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(3));
    releases.shift()?.();
    await vi.waitFor(() => expect(host.getSnapshot().pendingInputCount).toBe(0));
    expect(runTurn.mock.calls.map((call) => call[0].userMessage)).toEqual(["A", "B", "C"]);
  });

  it("keeps explicit supersede separate from the ordinary queue", async () => {
    const base = session();
    let releaseSecond: (() => void) | undefined;
    const runTurn = vi.fn(async (input: { signal: AbortSignal }) => {
      if (runTurn.mock.calls.length === 1) {
        await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
      } else {
        await new Promise<void>((resolve) => { releaseSecond = resolve; });
      }
      return completedResult(base.taskState!);
    });
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute: vi.fn() } as never,
      persistence: { save: async (value: AgentSession) => value } as never
    });
    void host.startTurn({ session: base, userMessage: "原指令", pageContext: PAGE_CONTEXT });
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    const correction = host.startTurn({
      session: base,
      userMessage: "更正指令",
      pageContext: PAGE_CONTEXT,
      supersede: true
    });
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    expect(host.getSnapshot().pendingInputCount).toBe(0);
    releaseSecond?.();
    await correction;
  });

  it("reconstructs persisted queued inputs FIFO on session re-adopt without duplicate execution", async () => {
    const base = session();
    const now = new Date().toISOString();
    const persisted = {
      ...base,
      messages: [
        ...base.messages,
        ...["B", "C"].map((content, index) => ({
          id: `queued-${index + 1}`,
          role: "user" as const,
          content,
          status: "pending" as const,
          metadata: { executionState: "queued", queuedPageContext: PAGE_CONTEXT },
          createdAt: now
        }))
      ]
    };
    const runTurn = vi.fn(async (input: { userMessage: string }) => {
      void input;
      return completedResult(base.taskState!);
    });
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute: vi.fn() } as never,
      persistence: { save: async (value: AgentSession) => value } as never
    });

    host.adopt(persisted);

    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(host.getSnapshot().pendingInputCount).toBe(0));
    expect(runTurn.mock.calls.map((call) => call[0].userMessage)).toEqual(["B", "C"]);
  });

  it("marks legacy queued input recoverable when exact page context is unavailable", async () => {
    const base = session();
    const persisted = {
      ...base,
      messages: [{
        id: "legacy-queued",
        role: "user" as const,
        content: "稍后继续",
        status: "pending" as const,
        metadata: { executionState: "queued" },
        createdAt: new Date().toISOString()
      }]
    };
    const runTurn = vi.fn();
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute: vi.fn() } as never,
      persistence: { save: async (value: AgentSession) => value } as never
    });

    host.adopt(persisted);

    expect(runTurn).not.toHaveBeenCalled();
    expect(host.getSnapshot().activeSession?.messages.find((message) => message.id === "legacy-queued")).toMatchObject({
      status: "recovered",
      metadata: { executionState: "recoverable" }
    });
    expect(host.getSnapshot().activeSession?.messages.at(-1)?.content).toContain("请点击或重新发送以继续");
  });
});

describe("P4.3d authoritative answer writes", () => {
  it("executes at most one answer for one user turn and retains unmatched text", async () => {
    const base = session();
    const questions = [
      { id: "q-kotlin", question: "是否实际使用 Kotlin，熟练度如何？", answerType: "proficiency" },
      { id: "q-db", question: "项目使用什么数据库？", answerType: "text" },
      { id: "q-live", question: "是否正式上线？", answerType: "boolean" }
    ];
    const taskState = {
      ...base.taskState!,
      stage: "clarify_unsupported_facts",
      knownSlots: {
        tailoringSession: {
          id: "tailoring-1",
          revision: 1,
          plan: {
            questionPlan: { id: "question-plan-1", revision: 1, questionIds: ["q-kotlin", "q-db", "q-live"], activeQuestionId: "q-kotlin" },
            clarificationQuestions: questions,
            clarificationAnswers: []
          }
        },
        activeQuestionId: "q-kotlin"
      }
    };
    let concurrentWrites = 0;
    let maximumConcurrentWrites = 0;
    const executedIds: string[] = [];
    const execute = vi.fn(async (input: {
      toolName: string;
      toolInput: { session: { plan: { clarificationAnswers: unknown[] } }; questionId: string; answer: unknown };
    }) => {
      concurrentWrites += 1;
      maximumConcurrentWrites = Math.max(maximumConcurrentWrites, concurrentWrites);
      executedIds.push(input.toolInput.questionId);
      await Promise.resolve();
      concurrentWrites -= 1;
      return {
        ok: true,
        toolName: input.toolName,
        data: {
          session: {
            ...input.toolInput.session,
            plan: {
              ...input.toolInput.session.plan,
              clarificationQuestions: questions,
              clarificationAnswers: [
                ...input.toolInput.session.plan.clarificationAnswers,
                { questionId: input.toolInput.questionId, answer: input.toolInput.answer }
              ]
            }
          }
        },
        artifactIds: []
      };
    });
    const hostRef: { current?: AgentHostStore } = {};
    const runTurn = vi.fn(async () => ({
      ...completedResult(taskState),
      taskState: inputStateWithResolution(hostRef.current?.getSnapshot().activeTask ?? taskState)
    }));
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute } as never,
      persistence: { save: async (value: AgentSession) => value } as never
    });
    hostRef.current = host;

    const result = await host.startTurn({
      session: {
        ...base,
        taskState,
        messages: [{
          id: "assistant-question-kotlin",
          role: "assistant",
          content: "是否实际使用 Kotlin，熟练度如何？",
          kind: "text",
          type: "text",
          status: "complete",
          metadata: { tailoringQuestionId: "q-kotlin", questionPlanId: "question-plan-1", questionPlanRevision: 1 },
          createdAt: "2026-08-02T12:00:00.000Z"
        }]
      },
      userMessage: "Kotlin比较熟练，项目用的是SQLite，不过没有正式上线。顺便导出PDF。",
      pageContext: PAGE_CONTEXT
    });

    expect(executedIds).toEqual(["q-kotlin"]);
    expect(new Set(executedIds).size).toBe(1);
    expect(maximumConcurrentWrites).toBe(1);
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({ userMessage: "项目用的是SQLite。不过没有正式上线。顺便导出PDF" }));
    expect(result?.taskState?.knownSlots.compoundAnswerResolution).toMatchObject({
      answers: [
        { questionId: "q-kotlin", evidenceQuote: "Kotlin比较熟练" }
      ],
      unmatchedText: "项目用的是SQLite。不过没有正式上线。顺便导出PDF"
    });
  });
});

function session() {
  const base = AgentRuntime.create("tailor_existing_resume", "analyze_fit", "Beta hardening");
  return {
    ...base,
    taskState: new AgentTaskStateReducer().create(base, "create_tailored_resume")
  };
}

function completedResult(taskState: NonNullable<AgentSession["taskState"]>) {
  return {
    trajectory: {
      workflowId: taskState.workflowId,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      outcome: "completed" as const,
      toolCalls: [],
      artifacts: [],
      observations: []
    },
    conversationSummary: "",
    taskState: { ...taskState, completionStatus: "completed" as const }
  };
}

function inputStateWithResolution(taskState: NonNullable<AgentSession["taskState"]>) {
  return { ...taskState, completionStatus: "completed" as const };
}
