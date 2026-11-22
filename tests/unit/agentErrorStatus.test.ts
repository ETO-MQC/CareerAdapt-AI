import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import {
  replaceErrorForRegenerate,
  taskToWorkflowView,
  upsertAgentErrorStatus
} from "@/components/agent/AgentWorkspace";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";

describe("agent error status", () => {
  it("only projects a result revision as a created tailoring version", () => {
    const session = AgentRuntime.create("test", "start");
    const task = new AgentTaskStateReducer().create(session, "create_tailored_resume");
    const pending = { ...session, taskState: { ...task, selectedEntities: { ...task.selectedEntities,
      resumeId: "source-branch", revisionId: "source-revision" } } };
    expect(taskToWorkflowView(pending)).toMatchObject({ resumeId: "source-branch", appliedRevisionId: undefined });
    const completed = { ...pending, taskState: { ...pending.taskState, selectedEntities: { ...pending.taskState.selectedEntities,
      resultResumeId: "result-branch", resultResumeRevisionId: "result-revision" } } };
    expect(taskToWorkflowView(completed)).toMatchObject({ resumeId: "result-branch", appliedRevisionId: "result-revision" });
  });
  it("deduplicates the same session, user message and error code", () => {
    const session = AgentRuntime.create("test", "start");
    const first = upsertAgentErrorStatus(session, {
      userMessageId: "user-1",
      errorCode: "planner_timeout",
      status: "failed",
      content: "failed"
    });
    const retrying = upsertAgentErrorStatus(first, {
      userMessageId: "user-1",
      errorCode: "planner_timeout",
      status: "retrying",
      content: "retrying"
    });

    expect(retrying.messages).toHaveLength(1);
    expect(retrying.messages[0]).toMatchObject({
      kind: "error_status",
      status: "retrying",
      content: "retrying"
    });
  });

  it("regenerate removes the prior user/error pair", () => {
    const session = AgentRuntime.create("test", "start");
    const user = {
      id: "user-1",
      role: "user" as const,
      content: "try",
      createdAt: new Date().toISOString()
    };
    const withError = upsertAgentErrorStatus({
      ...session,
      messages: [user]
    }, {
      userMessageId: user.id,
      errorCode: "planner_timeout",
      status: "failed",
      content: "failed"
    });

    expect(replaceErrorForRegenerate(withError).messages).toEqual([]);
  });
});
