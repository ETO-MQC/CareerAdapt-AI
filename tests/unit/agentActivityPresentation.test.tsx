import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/agent/contracts/agentSession";
import { AgentConversation } from "@/components/agent/AgentConversation";
import { AgentMarkdown } from "@/components/agent/AgentMarkdown";
import { activityLabel } from "@/components/agent/AgentActivityCard";

const start = "2026-11-10T00:00:00.000Z";
const end = "2026-11-10T00:00:48.000Z";
const user: AgentMessage = { id: "u", turnId: "turn", role: "user", content: "整理岗位", createdAt: start };
const tool: AgentMessage = { id: "t", turnId: "turn", role: "tool", kind: "tool_status", toolName: "career.workflow.job_intake", operationId: "private-operation", content: 'internal toolId secret_error {"raw":true}', status: "pending", createdAt: start };
const answer: AgentMessage = { id: "a", turnId: "turn", role: "assistant", content: "## 岗位分析\n正文\n\n> [!NOTE]\n> 仍需核对来源", status: "complete", createdAt: end };
const details = () => document.querySelector<HTMLDetailsElement>('.agent-tool-status-row')!;

describe("Agent activity presentation", () => {
  it("expands a long run, ticks elapsed time, collapses completion and can be reopened", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(start));
    try {
      const { rerender } = render(<AgentConversation messages={[user, tool]} businessProgress={{ state: "processing", label: "正在整理岗位信息", runtimeStatus: "running" }} />);
      expect(details().open).toBe(true);
      act(() => vi.advanceTimersByTime(48000));
      expect(screen.getByText("已用时 48 秒")).toBeInTheDocument();
      rerender(<AgentConversation messages={[user, { ...tool, status: "complete", metadata: { businessCommitted: true } }, answer]} businessProgress={{ state: "completed", label: "岗位已正式保存", runtimeStatus: "completed" }} />);
      expect(details().open).toBe(false);
      expect(screen.getByText("用时约 48 秒")).toBeInTheDocument();
      fireEvent.click(details().querySelector('summary')!);
      expect(details().open).toBe(true);
      expect(screen.getByText("已保存岗位")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/private-operation|secret_error|toolId|career\.workflow|"raw"/);
    } finally { vi.useRealTimers(); }
  });
  it.each([
    ["awaiting_input", "需要补充公司名称"],
    ["awaiting_confirmation", "等待你明确确认"],
    ["failed", "未保存，请核对后重试"],
    ["cancelled", "本次运行已取消"]
  ] as const)("collapses %s without claiming a save", (state, label) => {
    const { rerender } = render(<AgentConversation messages={[user, tool]} businessProgress={{ state: "processing", label: "正在处理当前任务" }} />);
    rerender(<AgentConversation messages={[user, { ...tool, status: "failed" }, answer]} businessProgress={{ state, label }} />);
    expect(details().open).toBe(false);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("已保存岗位")).toBeNull();
  });
  it("provides a card before tools and never displays raw thinking", () => {
    render(<AgentConversation messages={[user, { ...answer, kind: "assistant_thinking", status: "thinking", content: "private raw reasoning" }]} businessProgress={{ state: "processing", label: "正在处理当前任务" }} />);
    expect(details().open).toBe(true);
    expect(screen.queryByText("private raw reasoning")).toBeNull();
    expect(screen.getAllByText("正在思考").length).toBeGreaterThan(0);
  });
  it("keeps a previous turn independent of the current run", () => {
    render(<AgentConversation messages={[user, { ...tool, status: "complete" }, answer, { ...user, id: "u2", turnId: "next" }, { ...answer, id: "a2", turnId: "next", status: "streaming" }]} businessProgress={{ state: "processing", label: "正在处理当前任务" }} />);
    const cards = document.querySelectorAll<HTMLDetailsElement>('.agent-tool-status-row');
    expect(cards[0].open).toBe(false); expect(cards[1].open).toBe(true);
  });
  it.each([
    ["career.job.list", "检查是否已有相同岗位"],
    ["career.profile.get", "读取资料库"],
    ["career.workflow.tailor_resume", "准备岗位简历优化"],
    ["unknown_private_tool", "处理当前任务"]
  ])("maps %s to safe business text", (toolName, label) => {
    expect(activityLabel({ ...tool, toolName })).toBe(label);
  });
  it("places one process before intermediate and final replies in the same turn", () => {
    render(<AgentConversation messages={[user, { ...answer, id: "intermediate", content: "已开始整理" }, { ...tool, status: "complete" }, answer]} />);
    expect(document.querySelectorAll('.agent-tool-status-row')).toHaveLength(1);
    expect(details().compareDocumentPosition(screen.getByText("已开始整理")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details().compareDocumentPosition(screen.getByRole("heading", { name: "岗位分析" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("uses durable turn times and keeps awaiting Host receipts live after model completion", () => {
    const session = { activeTurn: { id: "turn", sessionId: "session", status: "completed" as const, startedAt: start, completedAt: end }, turnCheckpoints: [] };
    const { rerender } = render(<AgentConversation activitySession={session} messages={[user, tool, answer]} businessProgress={{ state: "processing", label: "正在核对操作结果", runtimeStatus: "completed" }} />);
    expect(details().open).toBe(true);
    rerender(<AgentConversation activitySession={session} messages={[user, { ...tool, status: "complete" }, answer]} businessProgress={{ state: "completed", label: "岗位已正式保存", runtimeStatus: "completed" }} />);
    expect(details().open).toBe(false);
    expect(screen.getByText("用时 48 秒")).toBeInTheDocument();
  });
  it("lets verified recovery supersede an earlier failure without hiding its step", () => {
    render(<AgentConversation messages={[user, { ...tool, status: "failed" }, answer]} businessProgress={{ state: "completed", label: "岗位已正式保存" }} />);
    expect(details()).toHaveClass("is-complete");
    expect(details().open).toBe(false);
    expect(screen.getByText("未完成")).toBeInTheDocument();
  });
  it("renders heading, body and semantic callouts while rejecting unsafe links", () => {
    render(<AgentMarkdown>{"# 主标题\n## 二级标题\n正文\n\n> [!WARNING]\n> 请核对来源\n\n> [!STATUS]\n> 尚未保存\n\n[链接](javascript:alert)"}</AgentMarkdown>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("主标题");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("二级标题");
    expect(screen.getByLabelText("提醒")).toHaveTextContent("请核对来源");
    expect(screen.getByLabelText("状态")).toHaveTextContent("尚未保存");
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("renders the core Assistant Markdown structures as semantic HTML", () => {
    const { container } = render(<AgentMarkdown>{"# 主标题\n## 次标题\n### 三级\n\n**重点**\n\n1. 第一步\n2. 第二步\n\n- 项目一\n- 项目二\n\n| 字段 | 状态 |\n| --- | --- |\n| 简历 | 已确认 |\n\n> 保留来源\n\n`revision`\n\n```json\n{\"ok\":true}\n```\n\n[查看来源](https://example.org/source)"}</AgentMarkdown>);
    for (const level of [1, 2, 3]) expect(screen.getByRole("heading", { level })).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("重点");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(screen.getByRole("table")).toHaveTextContent("已确认");
    expect(container.querySelector("blockquote")).toHaveTextContent("保留来源");
    expect(container.querySelector("pre code")).toHaveTextContent('{"ok":true}');
    expect(screen.getByRole("link", { name: "查看来源" })).toHaveAttribute("href", "https://example.org/source");
  });
});
