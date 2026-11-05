import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AgentConversationTimeline } from "@/components/agent/AgentConversation";
import { AgentJobTarget } from "@/components/agent/AgentJobTarget";
import { ProfileIntakeReviewProjectionSchema } from "@/domain/profileIntake/ProfileIntakeReviewProjection";
import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { classifyTurnIntent } from "@/agent/runtime/AgentTurnIntent";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";

it.each(["帮我完善我的个人资料", "请修改我的个人资料库", "帮我更新资料库：我获得了一项奖项"])("routes explicit intake: %s", text => {
  expect(classifyTurnIntent({ text }).newTask?.goal).toBe("profile_intake");
});
it.each(["查看我的个人资料", "帮我修改简历，不要更新我的个人资料库", "这段材料仅用于当前简历"])("does not turn reads or resume scope into intake: %s", text => {
  expect(classifyTurnIntent({ text }).newTask?.goal).not.toBe("profile_intake");
});
it("offers actionable provisional candidates while clarifying, without a commit action", () => {
  const projection = ProfileIntakeReviewProjectionSchema.parse({
    importId: "ux-import", draftRevision: 1, phase: "clarifying", sourceMessageId: "message", sourceTurnId: "turn",
    sourceContentHash: "12345678", extractionStatus: "structured_ai", candidates: [{
      id: "candidate", sectionType: "project", sourceSpan: { start: 0, end: 8 }, sourceQuote: "参与匿名课程项目",
      professionalText: "参与匿名课程项目", structuredItem: { id: "item", sectionType: "project", title: "匿名课程项目" },
      uncertainFields: [], confidence: 0.9, needsConfirmation: true, status: "proposed", canAccept: true
    }], reviewProgress: { total: 1, proposed: 1, valid: 1, uncertain: 0, accepted: 0, ignored: 0, rejected: 0, reviewed: 0 }
  });
  const action = vi.fn();
  const { rerender } = render(<AgentConversationTimeline messages={[]} profileIntakeProjection={projection} onArtifactAction={action} />);
  expect(screen.getByRole("region", { name: "经历候选核对" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^采用$/ }));
  expect(action).toHaveBeenCalledWith({ type: "profile_intake_candidate_decision", candidateId: "candidate", decision: "accept" });
  expect(screen.queryByRole("button", { name: "完成整理并保存到资料库" })).toBeNull();
  rerender(<AgentConversationTimeline messages={[]} profileIntakeProjection={{ ...projection, phase: "completed" }} />);
  expect(screen.queryByRole("region", { name: "经历候选核对" })).toBeNull();
});
it("binds an analyze-only JD snapshot to the Host target display and rejects a stale display", async () => {
  const rawText = "公司：匿名公司\n岗位：数据分析师\n任职要求\n必须掌握 Python 或 R。\n必须掌握 Python 和 SQL。\n加分项\n熟悉 Java。";
  const analysis = analyzeJobDescriptionV4({ rawText });
  const call = vi.fn(async () => ({ ok: true, data: { graph: analysis.graph, candidateTitle: "数据分析师", candidateCompany: "匿名公司" }, artifacts: [], receipt: { operationId: "parse", toolName: "career.job.parse", idempotencyKey: "parse", status: "completed" as const, completedAt: "2026-11-05T00:00:00.000Z" } }));
  const result = await executeCareerWorkflowFacade("career.workflow.job_intake", { rawText, persistence: "analyze_only" }, {}, "ux-op", call);
  const target = result.data.workflowCheckpoint.targetSnapshot as { id: string; rawText: string };
  expect(target.rawText).toBe(rawText);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0]).toBeDefined();
  const task = AgentTaskStateSchema.parse({ rootGoal: "ingest_job", workflowId: "job_ingestion", stage: "completed",
    selectedEntities: { targetSnapshotId: target.id }, knownSlots: { targetSnapshot: target }, updatedAt: "2026-11-05T00:00:00.000Z" });
  const { rerender } = render(<AgentJobTarget task={task} />);
  expect(screen.getByRole("region", { name: "当前目标岗位" })).toHaveAttribute("data-target-id", target.id);
  expect(screen.getAllByText(/Python 或 R/)[0]).toBeInTheDocument();
  rerender(<AgentJobTarget task={{ ...task, selectedEntities: { targetSnapshotId: "another-target" } }} />);
  expect(screen.queryByRole("region", { name: "当前目标岗位" })).toBeNull();
});

it("keeps identity metadata out of requirements without dropping unfamiliar sections", () => {
  const analysis = analyzeJobDescriptionV4({ rawText: "公司：匿名甲公司 UX011-JD\n岗位：数据分析师\n任职要求\n必须掌握 Python 或 R。\n必须掌握 Python 和 SQL。\n加分项\n熟悉 Java。" });
  expect(analysis.graph.requirements).toHaveLength(3);
  expect(analysis.graph.requirements.map(row => row.statement).join(" ")).not.toContain("公司：");
});
