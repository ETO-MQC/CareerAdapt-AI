import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { useWorkspace } from "@/services/workspace/useWorkspace";
vi.mock("@/services/career/CareerContextStore", () => ({ useCareerContextStore: () => ({ loading: false, profiles: [], refresh: async () => undefined }) }));
import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AgentConversationTimeline, normalizeAgentMessageText } from "@/components/agent/AgentConversation";
import type { AgentMessage } from "@/agent/contracts/agentSession";
it("J6 hides internal activity names and only shows saved status with business proof", () => {
  const messages: AgentMessage[] = [{ id: "user", role: "user", turnId: "turn-1", content: "先保存岗位", createdAt: "2026-11-07T00:00:00Z" },
    { id: "assistant", role: "assistant", turnId: "turn-1", content: "岗位信息正在核对。", createdAt: "2026-11-07T00:00:01Z" },
    { id: "activity", role: "tool", kind: "tool_status", status: "complete", turnId: "turn-1", content: "career.workflow.job_intake operationId=hidden",
      toolName: "career.workflow.job_intake", metadata: { activityState: "complete" }, createdAt: "2026-11-07T00:00:02Z" }];
  const { container, rerender } = render(<AgentConversationTimeline messages={messages} />);
  expect(container.textContent).not.toMatch(/career\.workflow|operationId|hidden/);
  expect(container.textContent).not.toContain("已完成岗位保存");
  rerender(<AgentConversationTimeline messages={messages.map(message => message.id === "activity"
    ? { ...message, metadata: { activityState: "complete", businessCommitted: true } } : message)} />);
  expect(screen.getAllByText("已完成岗位保存").length).toBeGreaterThan(0);
  expect(screen.getByText("先保存岗位")).toBeVisible();
});
it.each(["agent_confirmation_required", "Tool execution failed", "career.workflow.job_intake", "operationId: private"])("humanizes internal status %s", text => {
  expect(normalizeAgentMessageText(text)).not.toContain(text);
});

it("J4 a mounted Job List observes an actual Repository update without explicit refetch", async () => {
  const db = new CareerAdaptDb(`JobListHotfix-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const now = new Date().toISOString();
  await repository.saveJobDescription({ id: "live-job", title: "订阅岗位", company: null,
    rawText: "岗位职责：负责业务分析与数据整理。", source: "manual", requirements: [], createdAt: now, updatedAt: now });
  function Probe() {
    const workspace = useWorkspace(repository);
    const job = workspace.jobs.find(job => job.id === "live-job");
    return <output>{job ? `${job.title} · ${job.company ?? "公司待补充"}` : "加载中"}</output>;
  }
  const view = render(<Probe />);
  try {
    await waitFor(() => expect(screen.getByText("订阅岗位 · 公司待补充")).toBeVisible());
    await repository.completeJobCompany({ jobId: "live-job", company: "华为", expectedRevision: now, operationId: "live-company", userMessageId: "user-source" });
    await waitFor(() => expect(screen.getByText("订阅岗位 · 华为")).toBeVisible());
  } finally { view.unmount(); db.close(); await db.delete(); }
});
