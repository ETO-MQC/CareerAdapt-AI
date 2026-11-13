import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore, attachTaskStateOptions, branchSessionFromEditedUserMessage } from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer, normalizeAgentTaskState } from "@/agent/runtime/AgentTaskStateReducer";
import { projectTaskStateIntoSession } from "@/agent/runtime/projectTaskStateToWorkflowState";
import type { AgentSession } from "@/agent/contracts/agentSession";

const pageContext = { pathname: "/ai-workspace", query: {} };
afterEach(() => vi.useRealTimers());

function fixture() {
  const initial = AgentRuntime.createConversationSession();
  const reducer = new AgentTaskStateReducer();
  const task = normalizeAgentTaskState({
    ...reducer.create(initial, "create_tailored_resume", { workflowId: "tailor_existing_resume", step: "choose_job" }),
    selectedEntities: { profileId: "profile", resumeId: "resume" },
    knownSlots: {
      jobCandidates: [
        { id: "job-ai", title: "AI大模型应用开发工程师", company: "华为", order: 1 },
        { id: "job-dev", title: "开发工程师2", company: "华为", order: 2 }
      ],
      jobCandidateSetRevision: "candidates-1"
    },
    completionStatus: "waiting_for_user"
  });
  let session = projectTaskStateIntoSession(initial, task);
  session.messages = [{ id: "choose", role: "assistant", content: "请选择岗位", status: "complete", createdAt: session.createdAt }];
  session = attachTaskStateOptions(session, task);
  const save = vi.fn(async (value: AgentSession) => value);
  const host = new AgentHostStore({ executor: {} as never, persistence: { save } as never });
  host.adopt(session);
  return { host, session };
}

describe("H3 current candidate selection", () => {
  it("marks a Hermes shell stalled only after progress stops and clears it on progress", async () => {
    vi.useFakeTimers();
    const host = new AgentHostStore({ executor: {} as never, persistence: { save: vi.fn(async (value: AgentSession) => value) } as never, stallThresholdMs: 100 });
    const session = AgentRuntime.createConversationSession();
    host.adopt(session);
    const shell = await host.beginRuntimeShell({ session, userMessage: "测试", runtimeId: "hermes" });
    await vi.advanceTimersByTimeAsync(100);
    expect(host.getSnapshot().stalled).toBe(true);
    await host.applyRuntimeEvent({ type: "text_delta", sessionId: session.id, turnId: shell.turnId, timestamp: new Date().toISOString(), delta: "进展" }, shell.assistantMessageId);
    expect(host.getSnapshot().stalled).toBe(false);
    await host.applyRuntimeEvent({ type: "turn_completed", sessionId: session.id, turnId: shell.turnId, timestamp: new Date().toISOString(), message: "完成" }, shell.assistantMessageId);
    await vi.advanceTimersByTimeAsync(100);
    expect(host.getSnapshot().stalled).toBe(false);
  });
  it("persists a choice checkpoint after a saved-job list in an application request", async () => {
    const host = new AgentHostStore({ executor: {} as never, persistence: { save: vi.fn(async (value: AgentSession) => value) } as never });
    const session = AgentRuntime.createConversationSession();
    host.adopt(session);
    const shell = await host.beginRuntimeShell({ session, userMessage: "我想应聘岗位里面那个华为岗位", runtimeId: "hermes" });
    await host.applyRuntimeEvent({
      type: "tool_call_completed", sessionId: session.id, turnId: shell.turnId, timestamp: new Date().toISOString(),
      toolName: "career.job.list", operationId: "list-jobs", data: { result: { ok: true, data: { jobs: [
        { id: "job-ai", title: "AI大模型应用开发工程师", company: "华为" },
        { id: "job-dev", title: "开发工程师2", company: "华为" }
      ] } } }
    }, shell.assistantMessageId);
    const listed = host.getSnapshot().activeSession!;
    expect(listed.taskState?.workflowUserInputCheckpoint?.kind).toBe("job_choice");
    expect(listed.taskState?.completionStatus).toBe("waiting_for_user");
    await host.applyRuntimeEvent({ type: "turn_completed", sessionId: session.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), message: "请选择岗位。" }, shell.assistantMessageId);
    const completed = host.getSnapshot().activeSession!;
    expect(completed.activeTurn?.status).toBe("waiting_for_user");
    expect(completed.messages.flatMap(message => message.options ?? []).filter(option => option.action.type === "select_entity")).toHaveLength(2);
    const selected = await host.prepareRuntimeUserEvent({ session: completed, event: { type: "text_message", text: "AI大模型应用开发工程师" }, pageContext });
    expect(selected.deterministicTerminal).toBe(true);
    expect(selected.session.activeTurn?.status).toBe("completed");
    expect(selected.session.activeJobId).toBe("job-ai");
    expect(selected.session.messages.at(-1)?.content).toContain("已选择岗位");
  });

  it.each(["1", "第一个", "AI大模型应用开发工程师", "华为那个AI大模型岗位"])("binds %s to the authoritative job", async text => {
    const { host, session } = fixture();
    const result = await host.prepareRuntimeUserEvent({ session, event: { type: "text_message", text }, pageContext });
    expect(result.deterministicTransitionApplied).toBe(true);
    expect(result.session.taskState?.selectedEntities.jobId).toBe("job-ai");
    expect(result.session.activeJobId).toBe("job-ai");
    expect(result.session.taskState?.workflowUserInputCheckpoint).toBeUndefined();
  });

  it("re-prompts on ambiguity and leaves a nonmatch as an ordinary turn", async () => {
    const { host, session } = fixture();
    const ambiguous = await host.prepareRuntimeUserEvent({ session, event: { type: "text_message", text: "华为" }, pageContext });
    expect(ambiguous.deterministicTerminal).toBe(true);
    expect(ambiguous.session.taskState?.selectedEntities.jobId).toBeUndefined();
    expect(ambiguous.session.messages.at(-1)?.content).toContain("多个候选");
    expect(ambiguous.session.messages.at(-1)?.options).toHaveLength(2);
    const unmatched = await host.prepareRuntimeUserEvent({ session: ambiguous.session, event: { type: "text_message", text: "今天天气如何" }, pageContext });
    expect(unmatched.deterministicTransitionApplied).toBe(false);
    expect(unmatched.userMessage).toBe("今天天气如何");
  });

  it("resolves 好 against the active confirmation checkpoint", async () => {
    const { host } = fixture();
    const session = host.getSnapshot().activeSession!;
    const task = normalizeAgentTaskState({ ...session.taskState!, stage: "confirm_apply", completionStatus: "waiting_for_confirmation", knownSlots: { pendingConfirmation: { operationId: "operation-h3", toolName: "career.workflow.tailor_resume" } } });
    const waiting = projectTaskStateIntoSession({ ...session, pendingConfirmation: { id: "confirm", operationId: "operation-h3", toolName: "career.workflow.tailor_resume", title: "确认", description: "当前操作", requestedAt: session.createdAt, status: "pending", destructive: false }, pendingToolCall: { operationId: "operation-h3", toolName: "career.workflow.tailor_resume", input: {} } }, task);
    host.adopt(waiting);
    const result = await host.prepareRuntimeUserEvent({ session: waiting, event: { type: "text_message", text: "好" }, pageContext });
    expect(result.event).toEqual({ type: "confirmation", confirmed: true });
    expect(result.deterministicTransitionApplied).toBe(true);
    expect(result.userMessage).toBe("");
    expect(result.session.messages.at(-1)).toMatchObject({ role: "user", content: "好", metadata: { workflowCheckpointKind: "confirmation" } });
  });

  it("uses the selected context at the edit boundary and does not pull later selections backwards", () => {
    const { session } = fixture();
    const before = session.taskState!;
    const after = { ...before, selectedEntities: { ...before.selectedEntities, jobId: "job-ai", revisionId: "revision" }, knownSlots: { ...before.knownSlots, targetSnapshot: { id: "snapshot-before-answer" } } };
    const fitArtifact = { id: "fit", kind: "job_fit_overview" as const, title: "岗位匹配", entityType: "job" as const, entityId: "job-ai", status: "active" as const,
      createdAt: session.createdAt, updatedAt: session.createdAt, binding: { sessionId: session.id, branchId: session.activeBranchId, workflowId: "analyze_job_fit", jobId: "job-ai", resumeBranchId: "resume", revisionId: "revision" } };
    session.messages = [
      { id: "choose-job", role: "user", content: "第一个", branchId: session.activeBranchId, createdAt: session.createdAt },
      { id: "reply", role: "user", content: "好", branchId: session.activeBranchId, parentMessageId: "choose-job", createdAt: session.createdAt }
    ];
    session.conversationBranches = [{ id: session.activeBranchId, status: "active", createdAt: session.createdAt, headMessageId: "reply" }];
    session.activeHeadMessageId = "reply";
    session.taskState = after;
    session.activeJobId = "job-ai";
    session.turnCheckpoints = [
      { turnId: "turn-choice", userMessageId: "choose-job", taskStateBefore: before, workflowStateBefore: session.workflowState!, selectedEntitiesBefore: before.selectedEntities, artifactRefsBefore: [], createdAt: session.createdAt },
      { turnId: "turn-reply", userMessageId: "reply", taskStateBefore: after, workflowStateBefore: session.workflowState!, selectedEntitiesBefore: after.selectedEntities, artifactRefsBefore: [fitArtifact], createdAt: session.createdAt }
    ];
    const editReply = branchSessionFromEditedUserMessage(session, "reply", "继续")!;
    expect(editReply.taskState?.selectedEntities.jobId).toBe("job-ai");
    expect(editReply.taskState?.knownSlots.targetSnapshot).toEqual({ id: "snapshot-before-answer" });
    expect(editReply.activeJobId).toBe("job-ai");
    expect(editReply.activeBranchId).not.toBe(session.activeBranchId);
    expect(editReply.artifactRefs[0]?.binding).toMatchObject({ sessionId: session.id, branchId: editReply.activeBranchId, jobId: "job-ai", revisionId: "revision" });
    const editChoice = branchSessionFromEditedUserMessage(session, "choose-job", "第二个")!;
    expect(editChoice.taskState?.selectedEntities.jobId).toBeUndefined();
    expect(editChoice.activeJobId).toBeUndefined();
    expect(editChoice.taskState?.knownSlots.targetSnapshot).toBeUndefined();
  });

  it("promotes a selected job to the fit workflow without losing the selected entities", async () => {
    const { host, session } = fixture();
    session.taskState = { ...session.taskState!, workflowId: "entity_selection", rootGoal: "conversation", goal: "conversation", completionStatus: "completed", selectedEntities: { profileId: "profile", resumeId: "resume", resumeRevisionId: "revision", jobId: "job-ai" } };
    session.activeJobId = "job-ai";
    host.adopt(session);
    const shell = await host.beginRuntimeShell({ session, userMessage: "帮我分析匹配度", runtimeId: "hermes" });
    await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: session.id, turnId: shell.turnId, timestamp: new Date().toISOString(),
      toolName: "career.workflow.job_fit", operationId: "fit", data: { result: { ok: true, data: {
        status: "completed", workflowStage: "explain_job_fit", workflowCheckpoint: { kind: "job_fit", profileId: "profile", resumeId: "resume", jobId: "job-ai", result: { dependencies: { profileId: "profile", resumeId: "resume", resumeRevisionId: "revision", jobId: "job-ai" } } }
      } } } }, shell.assistantMessageId);
    expect(host.getSnapshot().activeSession?.taskState).toMatchObject({ workflowId: "analyze_job_fit", selectedEntities: { profileId: "profile", resumeId: "resume", revisionId: "revision", jobId: "job-ai" } });
    expect(host.getSnapshot().activeSession?.artifactRefs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "job_fit_overview", entityId: "job-ai", binding: expect.objectContaining({ sessionId: session.id, jobId: "job-ai", resumeBranchId: "resume", revisionId: "revision" }) })]));
  });

  it("does not replace an explicitly selected job merely because another detail was read", async () => {
    const { host } = fixture();
    const session = host.getSnapshot().activeSession!;
    const selected = projectTaskStateIntoSession(session, normalizeAgentTaskState({ ...session.taskState!,
      stage: "analyze_fit", completionStatus: "active", selectedEntities: { profileId: "profile", resumeId: "resume", jobId: "job-ai" } }));
    host.adopt(selected);
    const shell = await host.beginRuntimeShell({ session: selected, userMessage: "比较岗位", runtimeId: "hermes" });
    await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: session.id, turnId: shell.turnId, timestamp: new Date().toISOString(), toolName: "career.job.get", operationId: "read-other", data: { result: { ok: true, data: { job: { id: "job-dev", title: "开发工程师2" } } } } }, shell.assistantMessageId);
    expect(host.getSnapshot().activeSession?.taskState?.selectedEntities.jobId).toBe("job-ai");
  });

  it("recovers only an earlier completed checkpoint when the edited answer lacks one", () => {
    const { session } = fixture();
    const before = session.taskState!;
    const after = { ...before, completionStatus: "completed" as const, selectedEntities: { ...before.selectedEntities, jobId: "job-ai" },
      knownSlots: { nextAction: { kind: "provisional" }, resumeCompositionProposal: { unsaved: true } } };
    session.messages = [
      { id: "first", role: "user", content: "第一个", turnId: "choice-turn", branchId: session.activeBranchId, createdAt: session.createdAt },
      { id: "confirmed", role: "assistant", content: "已选择岗位", turnId: "choice-turn", status: "complete", branchId: session.activeBranchId, parentMessageId: "first", createdAt: session.createdAt },
      { id: "answer", role: "user", content: "好", branchId: session.activeBranchId, parentMessageId: "confirmed", createdAt: session.createdAt }
    ];
    session.activeHeadMessageId = "answer";
    session.taskState = after;
    session.turnCheckpoints = [{ turnId: "choice-turn", userMessageId: "first", taskStateBefore: before, taskStateAfter: after,
      workflowStateBefore: session.workflowState!, workflowStateAfter: session.workflowState!, selectedEntitiesBefore: before.selectedEntities,
      artifactRefsBefore: [], artifactRefsAfter: [], createdAt: session.createdAt, completedAt: session.createdAt }];
    const edited = branchSessionFromEditedUserMessage(session, "answer", "继续")!;
    expect(edited.taskState?.selectedEntities.jobId).toBe("job-ai");
    expect(edited.activeJobId).toBe("job-ai");
    expect(edited.taskState?.knownSlots.nextAction).toBeUndefined();
    expect(edited.taskState?.knownSlots.resumeCompositionProposal).toBeUndefined();
    const earlierEdit = branchSessionFromEditedUserMessage(session, "first", "第二个")!;
    expect(earlierEdit.taskState?.selectedEntities.jobId).toBeUndefined();
  });
});
