import { describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/p43e3-conversation-branch-regression.json";
import { AgentSessionSchema, type AgentSession } from "@/agent/contracts/agentSession";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentHostStore, branchSessionFromEditedUserMessage, prepareSessionForAssistantRegeneration } from "@/agent/runtime/AgentHostStore";
import { appendAgentMessage } from "@/agent/runtime/AgentSessionMessages";
import { activeBranchMessages, buildActiveBranchContext, forkConversationBranch } from "@/agent/runtime/activeBranchContext";

const NOW = "2026-08-04T00:00:00.000Z";

function profileIntakeSession(): AgentSession {
  const base = AgentRuntime.create("guided_profile_intake", "collect_experience");
  const reducer = new AgentTaskStateReducer();
  const taskState = {
    ...reducer.create(base, "profile_intake"),
    rootGoal: "profile_intake",
    activeGoal: "profile_intake",
    workflowId: "guided_profile_intake",
    stage: "collect_experience",
    completionStatus: "waiting_for_user" as const,
    knownSlots: {
      intakeInterviewPlan: { suggestedNextSections: fixture.profileIntakeSectionOptions }
    }
  };
  const sourceId = "assistant-section-options";
  return AgentSessionSchema.parse({
    ...base,
    taskState,
    messages: [{
      id: sourceId,
      role: "assistant",
      content: "接下来你想补充哪一类经历？",
      status: "complete",
      createdAt: NOW,
      optionSet: {
        optionSetId: "profile-intake-options-1",
        optionSetRevision: 1,
        sourceMessageId: sourceId,
        state: "active"
      },
      options: fixture.profileIntakeSectionOptions.map((section) => ({
        id: `section-${section}`,
        label: section,
        action: {
          type: "profile_intake_section_select" as const,
          section: section as "internship" | "project" | "campus" | "skills" | "awards" | "certificates" | "finish",
          sourceMessageId: sourceId,
          optionSetRevision: 1
        }
      }))
    }],
    conversationBranches: [{ id: "root", status: "active", headMessageId: sourceId, createdAt: NOW }],
    activeBranchId: "root",
    activeHeadMessageId: sourceId,
    updatedAt: NOW
  });
}

function conversationSession(): AgentSession {
  const base = AgentRuntime.create("conversation", "conversation");
  return AgentSessionSchema.parse({
    ...base,
    messages: [
      { id: "user-1", branchId: "root", role: "user", content: "原问题", turnId: "turn-1", createdAt: NOW },
      { id: "tool-1", branchId: "root", role: "tool", content: "旧工具回执", operationId: "operation-old-1", toolName: "read_profile", turnId: "turn-1", createdAt: NOW },
      { id: "assistant-1", branchId: "root", role: "assistant", content: "旧回答", turnId: "turn-1", createdAt: NOW },
      { id: "user-2", branchId: "root", role: "user", content: "旧追问", turnId: "turn-2", createdAt: NOW },
      { id: "assistant-2", branchId: "root", role: "assistant", content: "旧追问回答", turnId: "turn-2", createdAt: NOW }
    ],
    conversationBranches: [{ id: "root", status: "active", headMessageId: "assistant-2", createdAt: NOW }],
    activeBranchId: "root",
    activeHeadMessageId: "assistant-2",
    updatedAt: NOW
  });
}

describe("P4.3e.3 conversation branch isolation", () => {
  it("resolves a typed Profile Intake section without a user turn, model call, tool call, or entity mutation", async () => {
    const session = profileIntakeSession();
    const save = vi.fn(async (value: AgentSession) => value);
    const runTurn = vi.fn();
    const execute = vi.fn();
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute } as never,
      persistence: { save } as never
    });
    host.adopt(session);
    save.mockClear();

    const beforeEntities = structuredClone(session.taskState?.selectedEntities);
    const result = await host.dispatch({
      type: "option",
      action: {
        type: "profile_intake_section_select",
        section: "project",
        sourceMessageId: "assistant-section-options",
        optionSetRevision: 1
      }
    }, { pageContext: { pathname: "/ai-workspace", query: {} } });

    expect(runTurn).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(result?.messages.filter((message) => message.role === "user")).toHaveLength(0);
    expect(result?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "好的，我们继续补充项目经历。\n请告诉我项目名称、你承担的角色、主要工作和结果。",
      metadata: { deterministicBoundary: "profile_intake_section_select", requestedSection: "project" }
    });
    expect(result?.messages[0].options).toBeUndefined();
    expect(result?.messages[0].optionSet).toMatchObject({ state: "resolved", resolvedValue: "项目经历" });
    expect(result?.messages[0].metadata?.typedActionResolution).toMatchObject({
      actionType: "profile_intake_section_select",
      section: "project"
    });
    expect(result?.taskState?.knownSlots).toMatchObject({ intakeRequestedSection: "project" });
    expect(result?.taskState?.knownSlots).not.toHaveProperty("intakeActiveQuestion");
    expect(result?.taskState?.selectedEntities).toEqual(beforeEntities);

    const repeated = await host.dispatch({
      type: "option",
      action: {
        type: "profile_intake_section_select",
        section: "project",
        sourceMessageId: "assistant-section-options",
        optionSetRevision: 1
      }
    }, { pageContext: { pathname: "/ai-workspace", query: {} } });
    expect(repeated?.messages).toHaveLength(result?.messages.length ?? -1);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("forks a real branch for user editing and keeps the old branch untouched", () => {
    const session = conversationSession();
    const edited = branchSessionFromEditedUserMessage(session, "user-1", "修改后的问题");
    expect(edited).toMatchObject({ appendUserMessage: true, updateExistingUserMessage: false });
    expect(edited?.userMessageId).not.toBe("user-1");
    expect(edited?.activeBranchId).not.toBe("root");
    expect(edited?.conversationBranches).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "root", status: "superseded" }),
      expect.objectContaining({ parentBranchId: "root", forkedFromMessageId: undefined, status: "active" })
    ]));
    expect(edited?.messages.map((message) => ({ id: message.id, content: message.content })))
      .toEqual(session.messages.map((message) => ({ id: message.id, content: message.content })));
    expect(edited?.messages.some((message) => message.metadata?.retracted === true)).toBe(false);
    expect(activeBranchMessages(edited!)).toEqual([]);
  });

  it("regenerates from a new branch using the checkpoint boundary and excludes all old descendants", () => {
    const session = conversationSession();
    const prepared = prepareSessionForAssistantRegeneration(session, "assistant-1");
    expect(prepared).toMatchObject({
      assistantMessageId: undefined,
      updateExistingUserMessage: false,
      regenerateNarrationOnly: true,
      userMessageId: "user-1"
    });
    expect(prepared?.session.messages.map((message) => ({ id: message.id, content: message.content })))
      .toEqual(session.messages.map((message) => ({ id: message.id, content: message.content })));
    expect(prepared?.session.messages.some((message) => message.metadata?.retracted === true)).toBe(false);
    const context = buildActiveBranchContext(prepared!.session);
    expect(context.messages.map((message) => message.id)).toEqual(["user-1"]);
    expect(context.diagnostics.excludedMessageIds).toEqual(expect.arrayContaining(["tool-1", "assistant-1", "user-2", "assistant-2"]));
    expect(context.diagnostics.includedToolOperationIds).toEqual([]);
  });

  it("supports a new branch head and marks only the superseded option set stale", () => {
    const session = conversationSession();
    const forked = forkConversationBranch(session, { forkedFromMessageId: "user-1", headMessageId: "user-1" });
    const next = appendAgentMessage(forked, "assistant", "新分支回答", {
      id: "new-message",
      optionSet: {
        optionSetId: "stale-test",
        optionSetRevision: 1,
        sourceMessageId: "new-message",
        state: "stale"
      }
    });
    const context = buildActiveBranchContext(next);
    expect(context.messages.map((message) => message.id)).toEqual(["user-1", "new-message"]);
    expect(context.messages.some((message) => message.id === "assistant-1")).toBe(false);
    expect(context.messages.find((message) => message.id === "new-message")?.optionSet?.state).toBe("stale");
  });

  it("keeps regeneration narration to one provider request with no tools", async () => {
    const session = conversationSession();
    const prepared = prepareSessionForAssistantRegeneration(session, "assistant-1")!;
    const runTurn = vi.fn(async (input: { narrationOnly?: boolean; session: AgentSession }) => ({
      text: "新的叙述",
      trajectory: { outcome: "completed" as const, toolCalls: [], errors: [] },
      taskState: input.session.taskState
    }));
    const save = vi.fn(async (value: AgentSession) => value);
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: {} as never,
      persistence: { save } as never
    });
    const result = await host.startTurn({
      session: prepared.session,
      userMessage: prepared.userMessage,
      userMessageId: prepared.userMessageId,
      appendUserMessage: false,
      updateExistingUserMessage: false,
      regenerateNarrationOnly: prepared.regenerateNarrationOnly,
      sourceTurnId: prepared.sourceTurnId,
      regeneratedFromMessageId: prepared.regeneratedFromMessageId,
      pageContext: { pathname: "/ai-workspace", query: {} }
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({ narrationOnly: true }));
    expect(result?.messages.filter((message) => message.role === "user")).toHaveLength(2);
    expect(result?.messages.filter((message) => message.branchId === result?.activeBranchId && message.role === "tool")).toHaveLength(0);
  });
});
