import { describe, expect, it } from "vitest";
import {
  branchSessionFromEditedUserMessage,
  prepareSessionForAssistantRegeneration
} from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";

describe("agent message branch editing", () => {
  it("replaces the original user message, preserves its prior version and retracts the old branch", () => {
    const initial = AgentRuntime.create("conversation", "conversation");
    const session = {
      ...initial,
      conversationSummary: "old summary",
      messages: [
        {
          id: "user-1",
          turnId: "turn-1",
          role: "user" as const,
          content: "旧问题",
          createdAt: "2026-07-28T00:00:00.000Z"
        },
        {
          id: "tool-1",
          role: "tool" as const,
          content: "旧工具步骤",
          createdAt: "2026-07-28T00:00:00.500Z"
        },
        {
          id: "assistant-1",
          turnId: "turn-1",
          role: "assistant" as const,
          content: "旧回答",
          createdAt: "2026-07-28T00:00:01.000Z"
        },
        {
          id: "user-2",
          turnId: "turn-2",
          role: "user" as const,
          content: "旧分支追问",
          createdAt: "2026-07-28T00:00:02.000Z"
        }
      ]
    };

    const edited = branchSessionFromEditedUserMessage(session, "user-1", "新问题");

    expect(edited?.messages[0]).toMatchObject({
      id: "user-1",
      content: "新问题",
      revisions: [{ content: "旧问题", createdAt: "2026-07-28T00:00:00.000Z" }]
    });
    expect(edited?.messages[1].metadata?.retracted).toBe(true);
    expect(edited?.messages[2].metadata?.retracted).toBe(true);
    expect(edited?.conversationSummary).toBe("");
    expect(edited?.workflowState).toEqual(initial.workflowState);
  });

  it("keeps multiple prior versions in chronological order", () => {
    const initial = AgentRuntime.create("conversation", "conversation");
    const session = {
      ...initial,
      messages: [{
        id: "user-1",
        role: "user" as const,
        content: "版本一",
        createdAt: "2026-07-28T00:00:00.000Z"
      }]
    };

    const versionTwo = branchSessionFromEditedUserMessage(session, "user-1", "版本二");
    const versionThree = versionTwo
      ? branchSessionFromEditedUserMessage(versionTwo, "user-1", "版本三")
      : undefined;

    expect(versionThree?.messages[0].revisions?.map((revision) => revision.content))
      .toEqual(["版本一", "版本二"]);
  });

  it("creates a fresh branch when resending unchanged content without adding a fake revision", () => {
    const initial = AgentRuntime.create("conversation", "conversation");
    const session = {
      ...initial,
      conversationSummary: "old summary",
      messages: [
        {
          id: "user-1",
          turnId: "turn-1",
          role: "user" as const,
          content: "请重新回答这个问题",
          createdAt: "2026-07-28T00:00:00.000Z"
        },
        {
          id: "assistant-1",
          turnId: "turn-1",
          role: "assistant" as const,
          content: "旧回答",
          createdAt: "2026-07-28T00:00:01.000Z"
        }
      ]
    };

    const resent = branchSessionFromEditedUserMessage(
      session,
      "user-1",
      "请重新回答这个问题"
    );

    expect(resent).toBeDefined();
    expect(resent?.messages[0]).toMatchObject({
      id: "user-1",
      content: "请重新回答这个问题"
    });
    expect(resent?.messages[0].revisions).toBeUndefined();
    expect(resent?.messages[1].metadata?.retracted).toBe(true);
    expect(resent?.conversationSummary).toBe("");
  });

  it("prepares regeneration from the user message that owns the selected AI reply", () => {
    const initial = AgentRuntime.create("conversation", "conversation");
    const session = {
      ...initial,
      conversationSummary: "old summary",
      messages: [
        {
          id: "user-1",
          role: "user" as const,
          content: "原问题",
          createdAt: "2026-07-28T00:00:00.000Z"
        },
        {
          id: "tool-regenerate",
          role: "tool" as const,
          content: "旧工具步骤",
          createdAt: "2026-07-28T00:00:00.500Z"
        },
        {
          id: "assistant-1",
          role: "assistant" as const,
          content: "要重新生成的回答",
          createdAt: "2026-07-28T00:00:01.000Z"
        },
        {
          id: "user-2",
          role: "user" as const,
          content: "旧分支追问",
          createdAt: "2026-07-28T00:00:02.000Z"
        }
      ]
    };

    const prepared = prepareSessionForAssistantRegeneration(session, "assistant-1");

    expect(prepared).toMatchObject({
      userMessageId: "user-1",
      userMessage: "原问题",
      session: { conversationSummary: "" }
    });
    expect(prepared?.session.messages[0].metadata?.retracted).not.toBe(true);
    expect(prepared?.session.messages[1].metadata?.retracted).toBe(true);
    expect(prepared?.session.messages[2].metadata?.retracted).not.toBe(true);
    expect(prepared?.session.messages[3].metadata?.retracted).toBe(true);
  });

  it("restores a domain turn checkpoint before historical regeneration", () => {
    const initial = AgentRuntime.create("tailor_existing_resume", "choose_job");
    const reducer = new AgentTaskStateReducer();
    const before = { ...reducer.create(initial, "create_tailored_resume"), stage: "choose_job" };
    const later = { ...before, stage: "clarify_unsupported_facts", selectedEntities: { ...before.selectedEntities, jobId: "job-1", tailoringSessionId: "tailoring-1" } };
    const session = {
      ...initial,
      taskState: later,
      workflowState: { ...initial.workflowState, step: "answer_questions" },
      messages: [
        { id: "user-job", role: "user" as const, content: "第一个", createdAt: "2026-08-02T00:00:00.000Z" },
        { id: "assistant-job", role: "assistant" as const, content: "已选择岗位", createdAt: "2026-08-02T00:00:01.000Z" },
        { id: "user-later", role: "user" as const, content: "继续", createdAt: "2026-08-02T00:00:02.000Z" }
      ],
      turnCheckpoints: [{
        turnId: "turn-job", userMessageId: "user-job", taskStateBefore: before,
        workflowStateBefore: initial.workflowState, selectedEntitiesBefore: before.selectedEntities,
        artifactRefsBefore: [], createdAt: "2026-08-02T00:00:00.000Z"
      }]
    };
    const prepared = prepareSessionForAssistantRegeneration(session, "assistant-job");
    expect(prepared?.blocked).not.toBe(true);
    expect(prepared?.session.taskState?.stage).toBe("choose_job");
    expect(prepared?.session.taskState?.selectedEntities.tailoringSessionId).toBeUndefined();
  });

  it("refuses unsafe legacy domain regeneration without a checkpoint", () => {
    const initial = AgentRuntime.create("tailor_existing_resume", "answer_questions");
    const current = { ...new AgentTaskStateReducer().create(initial, "create_tailored_resume"), stage: "clarify_unsupported_facts" };
    const prepared = prepareSessionForAssistantRegeneration({
      ...initial,
      taskState: current,
      messages: [
        { id: "user-old", role: "user", content: "第一个", createdAt: "2026-08-02T00:00:00.000Z" },
        { id: "assistant-old", role: "assistant", content: "旧岗位已选择", createdAt: "2026-08-02T00:00:01.000Z" },
        { id: "user-new", role: "user", content: "回答当前问题", createdAt: "2026-08-02T00:00:02.000Z" }
      ]
    }, "assistant-old");
    expect(prepared?.blocked).toBe(true);
    expect(prepared?.session.messages.at(-1)?.content).toContain("无法安全重生成");
    expect(prepared?.session.messages.at(-1)?.options?.map((option) => option.action.type)).toEqual(["retry_current_step", "new_tailoring_task"]);
  });
});
