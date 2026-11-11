import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentSessionSchema, AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { projectBusinessWorkflowProgress as project } from "@/agent/runtime/businessWorkflowProgress";
import { AgentBusinessProgress } from "@/components/agent/AgentBusinessProgress";

const now = "2026-11-05T00:00:00.000Z";
function session(status: "running" | "completed" | "failed" | "cancelled" | "stopping" = "completed") {
  const initial = AgentRuntime.createConversationSession();
  return AgentSessionSchema.parse({ ...initial,
    activeTurn: { id: "turn", sessionId: initial.id, status: status === "failed" ? "failed" : status === "running" || status === "stopping" ? "running" : "completed", startedAt: now },
    hermesRun: { runId: "run", hermesSessionId: "hermes", careerAgentSessionId: initial.id, turnId: "turn", status, startedAt: now, lastEventAt: now }
  });
}
function task(completionStatus: "active" | "waiting_for_user" | "waiting_for_confirmation" | "completed" = "active") {
  return AgentTaskStateSchema.parse({ rootGoal: "ingest_job", workflowId: "job_ingestion", stage: "parse_job", completionStatus, updatedAt: now });
}

describe("business progress derives from execution evidence", () => {
  it("never accepts model-only completion", () => {
    const s = session();
    s.messages.push({ id: "claim", role: "assistant", content: "已经全部完成并保存", createdAt: now });
    expect(project(s).state).toBe("awaiting_input");
  });
  it("H2 keeps a persisted confirmation actionable when the runtime fails", () => {
    const s = session("failed"); s.taskState = task("waiting_for_confirmation");
    s.activeTurn!.workflowCheckpoint = { facadeObservation: { kind: "resume_composition", toolName: "career.workflow.compose_resume", status: "waiting_for_confirmation" } };
    expect(project(s)).toMatchObject({ state: "awaiting_confirmation", label: "等待你确认：创建通用简历", runtimeStatus: "failed" });
  });
  it("does not complete a business task while its foreground Run is live", () => {
    const s = session("running"); s.taskState = task("completed");
    expect(project(s).state).toBe("processing");
  });
  it("allows a completed read-only facade with a real operation receipt, without a TaskState", () => {
    const s = session(); s.activeTurn!.workflowCheckpoint = { facadeObservation: { kind: "resume_review", status: "completed", hasCompletedReceipt: true } };
    expect(project(s)).toMatchObject({ state: "completed", label: "只读审阅已完成" });
    s.activeTurn!.workflowCheckpoint = { facadeObservation: { kind: "resume_review", status: "completed", hasCompletedReceipt: false } };
    expect(project(s).state).toBe("awaiting_input");
  });
  it("does not let a successful substep finish an incomplete transactional goal", () => {
    const s = session(); s.taskState = AgentTaskStateSchema.parse({ rootGoal: "generate_job_specific_resume", workflowId: "tailor_resume", stage: "generate_plan", updatedAt: now });
    s.activeTurn!.workflowCheckpoint = { facadeObservation: { kind: "job_fit", status: "completed", hasCompletedReceipt: true } };
    expect(project(s).state).toBe("awaiting_input");
  });
  it("separates supplementary input, candidate review and explicit confirmation", () => {
    const s = session(); s.taskState = task("waiting_for_user");
    expect(project(s).state).toBe("awaiting_input");
    s.taskState.knownSlots.profileIntakeReviewProjection = { importId: "draft" };
    expect(project(s).state).toBe("awaiting_review");
    s.taskState.completionStatus = "waiting_for_confirmation";
    expect(project(s).state).toBe("awaiting_confirmation");
  });
  it("projects actual tool stages, never text tool names or percentages", () => {
    const s = session("running");
    s.messages.push({ id: "call", turnId: "turn", role: "assistant", toolName: "career.workflow.job_fit", content: "", status: "pending", createdAt: now });
    expect(project(s).label).toBe("正在匹配已有经历");
    s.messages[0].turnId = "old";
    expect(project(s).label).toBe("正在处理当前任务");
  });
  it("separates an unacknowledged cancellation from a verified cancelled run", () => {
    const s = session("stopping");
    expect(project(s).label).toBe("正在核对取消结果");
    s.hermesRun!.status = "cancelled";
    expect(project(s).state).toBe("cancelled");
    s.hermesRun = undefined; s.activeTurn!.status = "aborted";
    expect(project(s).state).toBe("blocked");
  });
  it.each([
    ["provider_rate_limit", "不会自动重试或切换模型"],
    ["provider_timeout", "核对运行状态和保存回执"],
    ["request_timeout", "核对运行状态和保存回执"]
  ])("preserves recovery semantics for %s", (category, text) => {
    const s = session("failed"); s.activeTurn!.runtimeFailureDiagnostics = { safeErrorCategory: category };
    expect(project(s)).toMatchObject({ state: "failed", detail: expect.stringContaining(text) });
  });
  it.each([
    ["profile_intake_stale_profile", "重新读取当前版本"],
    ["revision_conflict", "重新读取当前版本"],
    ["stale_revision", "重新读取当前版本"],
    ["blocked_high_risk", "核对来源"],
    ["repository_write_failed", "操作尚未完成"]
  ])("never presents %s as completion", (code, text) => {
    const s = session(); s.activeTurn!.toolFailures = [{ toolName: "career.workflow.compose_resume", operationId: "op", code, occurredAt: now }];
    expect(project(s)).toMatchObject({ state: "failed", detail: expect.stringContaining(text) });
  });
  it("keeps export failure separate from the confirmed resume content", () => {
    const s = session(); s.activeTurn!.toolFailures = [{ toolName: "career.workflow.resume_export", operationId: "op", code: "pdf_failed", occurredAt: now }];
    expect(project(s)).toMatchObject({ state: "partial", label: "导出未完成", detail: expect.stringContaining("单独重新导出") });
  });
  it("labels a failed confirmed composition as unsaved while keeping its recovery checkpoint", () => {
    const s = session(); s.taskState = task("waiting_for_user");
    s.taskState.knownSlots.resumeCompositionWriteFailure = { code: "provider_unavailable" };
    s.taskState.knownSlots.resumeCompositionCheckpoint = { checkpointId: "reviewed-plan" };
    expect(project(s)).toMatchObject({ state: "blocked", label: "正式保存未完成" });
    expect(s.taskState.knownSlots.resumeCompositionCheckpoint).toEqual({ checkpointId: "reviewed-plan" });
  });
  it("ignores a background or previous turn's Run status", () => {
    const s = session("failed"); s.activeTurn!.status = "running"; s.hermesRun!.turnId = "background-review";
    expect(project(s)).toMatchObject({ state: "processing" });
    expect(project(s).runtimeStatus).toBeUndefined();
  });
  it("shows the persisted write checkpoint rather than confirmation submission as completion", () => {
    const s = session("running"); s.taskState = task(); s.taskState.knownSlots.artifactWriteCheckpoint = { status: "write_pending" };
    expect(project(s).state).toBe("committing");
  });
  it("retains verified business completion when the later Run fails or is cancelled", () => {
    const s = session("failed"); s.taskState = task("completed");
    expect(project(s)).toMatchObject({ state: "partial", detail: expect.stringContaining("已完成的业务结果仍保留") });
    s.hermesRun!.status = "cancelled";
    expect(project(s).state).toBe("partial");
  });
  it("renders a compact, accessible business status with a concrete recovery instruction", () => {
    const s = session("failed"); s.activeTurn!.runtimeFailureDiagnostics = { safeErrorCategory: "provider_rate_limit" };
    render(<AgentBusinessProgress progress={project(s)} />);
    expect(screen.getByRole("status", { name: "业务进度" })).toHaveAttribute("data-business-state", "failed");
    expect(screen.getByText(/不会自动重试或切换模型/)).toBeVisible();
  });
});
