import { afterEach, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { projectBusinessWorkflowProgress as progress } from "@/agent/runtime/businessWorkflowProgress";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";

let db: CareerAdaptDb;
afterEach(async () => { db?.close(); if (db) await db.delete(); });
async function setup() {
  db = new CareerAdaptDb(`ux012-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const persistence = new AgentSessionStore(repository);
  const registry = createAgentToolRegistry(new BrowserAgentToolService(repository));
  const host = new AgentHostStore({ repository, persistence, executor: new AgentExecutor(registry) });
  const initial = await persistence.save(AgentRuntime.createConversationSession());
  host.adopt(initial);
  const shell = await host.beginRuntimeShell({ session: initial, userMessage: "请检查当前简历，保留原始输入", runtimeId: "hermes" });
  const event = { sessionId: initial.id, turnId: shell.turnId, timestamp: new Date().toISOString() };
  return { host, repository, persistence, shell, event, initial };
}

it("persists a tool failure before publishing it and rejects a later model success claim without TaskState", async () => {
  const { host, persistence, shell, event, initial } = await setup();
  await host.applyRuntimeEvent({ ...event, type: "tool_call_failed", toolName: "career.workflow.compose_resume", operationId: "failed-op",
    error: { code: "invalid_params", message: "参数不完整", recoverable: true } }, shell.assistantMessageId);
  expect((await persistence.get(initial.id))?.activeTurn?.toolFailures).toHaveLength(1);
  const final = await host.applyRuntimeEvent({ ...event, type: "turn_completed", message: "已经全部完成并保存。" }, shell.assistantMessageId);
  expect(final?.activeTurn?.status).toBe("failed");
  expect(final?.messages.find(m => m.id === shell.assistantMessageId)?.content).not.toContain("全部完成");
  expect(progress(final!).state).toBe("failed");
  expect(final?.messages.some(m => m.role === "user" && m.content.includes("保留原始输入"))).toBe(true);
});

it("does not publish an actionable checkpoint when session persistence fails", async () => {
  const { host, persistence, shell, event } = await setup();
  const before = host.getSnapshot().activeSession;
  vi.spyOn(persistence, "save").mockRejectedValueOnce(new Error("simulated disk failure"));
  await expect(host.applyRuntimeEvent({ ...event, type: "tool_call_failed", toolName: "career.workflow.job_intake", operationId: "op",
    error: { code: "parse_failed", message: "岗位解析失败", recoverable: true } }, shell.assistantMessageId)).rejects.toThrow("simulated disk failure");
  expect(host.getSnapshot().activeSession).toEqual(before);
});

it("quarantines wrong Run/turn/session handles so background work cannot finish the foreground task", async () => {
  const { host, shell, event, initial } = await setup();
  const handle = { runId: "foreground", hermesSessionId: "hermes", careerAgentSessionId: initial.id, turnId: shell.turnId,
    status: "running", startedAt: event.timestamp, lastEventAt: event.timestamp };
  await host.applyRuntimeEvent({ ...event, type: "progress", data: { runHandle: handle } }, shell.assistantMessageId);
  const before = host.getSnapshot().activeSession;
  for (const wrong of [{ ...handle, runId: "background" }, { ...handle, turnId: "other" }, { ...handle, careerAgentSessionId: "other" }]) {
    await host.applyRuntimeEvent({ ...event, type: "turn_completed", message: "后台完成", data: { runHandle: { ...wrong, status: "completed" } } }, shell.assistantMessageId);
    expect(host.getSnapshot().activeSession).toEqual(before);
  }
  await host.applyRuntimeEvent({ ...event, turnId: "old-turn", type: "turn_failed" }, shell.assistantMessageId);
  expect(host.getSnapshot().activeSession).toEqual(before);
});

it("restores a read-only facade receipt before narration and completes without creating a Revision", async () => {
  const { host, persistence, repository, shell, event, initial } = await setup();
  const call = vi.fn(async () => ({ ok: true, data: { sourceReview: { findings: [] } }, artifacts: [],
    receipt: { operationId: "review-op", idempotencyKey: "review-op", toolName: "career.resume.plan_composition", status: "completed" as const, completedAt: event.timestamp } }));
  const facade = await executeCareerWorkflowFacade("career.workflow.compose_resume", {
    mode: "general", profileId: "review-profile", expectedProfileRevision: 1, sourceResumeId: "review-source", reviewOnly: true
  }, { agentSessionId: initial.id }, "review-op", call);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]).toEqual(expect.arrayContaining(["career.resume.plan_composition", expect.objectContaining({ reviewOnly: true })]));
  await host.applyRuntimeEvent({ ...event, type: "tool_call_completed", toolName: "career.workflow.compose_resume", operationId: "review-op",
    data: { result: { ok: true, data: facade.data } } }, shell.assistantMessageId);
  const saved = await persistence.get(initial.id);
  expect(saved?.activeTurn?.workflowCheckpoint?.facadeObservation).toMatchObject({ kind: "resume_review", hasCompletedReceipt: true });
  expect(progress(saved!).state).toBe("processing");
  const final = await host.applyRuntimeEvent({ ...event, type: "turn_completed", message: "审阅完成" }, shell.assistantMessageId);
  expect(progress(final!)).toMatchObject({ state: "completed", label: "只读审阅已完成" });
  expect(await repository.listResumeBranches()).toHaveLength(0);
});

it("creates a durable composition task from an authoritative proposal in a new conversation", async () => {
  const { host, persistence, repository, shell, event, initial } = await setup();
  expect(host.getSnapshot().activeSession?.taskState).toBeUndefined();
  await host.applyRuntimeEvent({ ...event, type: "tool_call_completed", toolName: "career.workflow.compose_resume", operationId: "compose-plan",
    data: { result: { ok: true, data: { status: "waiting_for_confirmation", workflowStage: "review_composition",
      workflowCheckpoint: { kind: "resume_composition", checkpointId: "source-backed-plan", profileId: "confirmed-profile",
        expectedProfileRevision: 1, mode: "general", proposal: { title: "已确认来源提案" } } } } } }, shell.assistantMessageId);
  const saved = await persistence.get(initial.id);
  expect(saved?.taskState).toMatchObject({ workflowId: "compose_resume", rootGoal: "compose_resume", stage: "review_composition",
    completionStatus: "waiting_for_confirmation", selectedEntities: { profileId: "confirmed-profile" },
    knownSlots: { resumeCompositionCheckpoint: { checkpointId: "source-backed-plan" } } });
  expect(progress(saved!).state).toBe("awaiting_confirmation");
  expect(await repository.listResumeBranches()).toHaveLength(0);
});

it("accepts only a known pending bridge receipt after model completion and corrects a false success", async () => {
  const { host, shell, event, initial, persistence } = await setup();
  const handle = { runId: "foreground", hermesSessionId: "hermes", careerAgentSessionId: initial.id, turnId: shell.turnId,
    status: "running", startedAt: event.timestamp, lastEventAt: event.timestamp };
  await host.applyRuntimeEvent({ ...event, type: "tool_call_started", toolName: "career.workflow.resume_export", operationId: "export-op", data: { runHandle: handle } }, shell.assistantMessageId);
  await host.applyRuntimeEvent({ ...event, type: "turn_completed", message: "已经完成导出", data: { runHandle: { ...handle, status: "completed" } } }, shell.assistantMessageId);
  expect(progress(host.getSnapshot().activeSession!).state).toBe("processing");
  await host.applyRuntimeEvent({ ...event, type: "tool_call_failed", toolName: "career.workflow.resume_export", operationId: "export-op",
    data: { runHandle: handle }, error: { code: "pdf_failed", message: "导出失败", recoverable: true } }, shell.assistantMessageId);
  const saved = await persistence.get(initial.id);
  expect(saved?.activeTurn?.status).toBe("failed");
  expect(saved?.hermesRun?.status).toBe("completed");
  expect(saved?.messages.find(m => m.id === shell.assistantMessageId)?.content).not.toContain("已经完成导出");
  expect(progress(saved!).state).toBe("partial");
  const before = host.getSnapshot().activeSession;
  await host.applyRuntimeEvent({ ...event, type: "text_delta", delta: "旧的迟到叙述" }, shell.assistantMessageId);
  expect(host.getSnapshot().activeSession).toEqual(before);
});
