import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import type { AgentMessage } from "@/agent/contracts/agentSession";
import type { AgentHostSnapshot } from "@/agent/runtime/AgentHostStore";
import { agentRunPresentation } from "@/components/agent/workspace/agentRunPresentation";
import { AgentComposer, type ComposerAttachmentDraft } from "@/components/agent/AgentComposer";
import { AgentConversationTimeline } from "@/components/agent/AgentConversation";
import { AgentHistoryDialog } from "@/components/agent/AgentHistoryDialog";
import { AgentMarkdown } from "@/components/agent/AgentMarkdown";

const now = "2026-11-02T00:00:00.000Z";
const tool = (id: string, turnId: string, state = "running"): AgentMessage => ({
  id, turnId, role: "tool", kind: "tool_status", content: `安全步骤 ${id}`,
  toolName: "list_resumes", status: state === "running" ? "pending" : "complete",
  metadata: { activityState: state }, createdAt: now
});

function presentation(turnStatus: AgentHostSnapshot["turnStatus"], runStatus?: "queued" | "running" | "waiting_for_approval" | "stopping" | "completed" | "failed" | "cancelled", stopping = false) {
  const session = AgentRuntime.createConversationSession();
  if (runStatus) session.hermesRun = { runId: "run-1", hermesSessionId: "hermes-1", careerAgentSessionId: session.id, turnId: "turn-1", status: runStatus, startedAt: now, lastEventAt: now };
  return agentRunPresentation({ session, turnStatus, runtimeStatus: "ready", stopping });
}

describe("COMP-01 run projection", () => {
  it.each(["idle", "running", "waiting_for_user", "waiting_for_confirmation", "paused", "completed", "failed"] as const)("projects the real Host state %s", (state) => {
    expect(presentation(state).state).toBe(state);
  });
  it.each(["queued", "waiting_for_approval", "stopping", "cancelled"] as const)("projects Hermes state %s", (state) => {
    expect(presentation("running", state).state).toBe(state);
  });
  it("keeps stop pending ahead of locally fenced cancellation", () => {
    expect(presentation("paused", "cancelled", true)).toMatchObject({ state: "stopping", label: "正在停止", canStop: false });
    expect(presentation("paused", "cancelled")).toMatchObject({ state: "cancelled", label: "已停止", canStop: false });
  });
  it("separates service availability from a completed task", () => {
    const session = AgentRuntime.createConversationSession();
    expect(agentRunPresentation({ session, turnStatus: "idle", runtimeStatus: "unavailable" }).state).toBe("unavailable");
    expect(agentRunPresentation({ session, turnStatus: "completed", runtimeStatus: "unavailable" }).state).toBe("completed");
  });
});

describe("COMP-01 durable transcript", () => {
  it("preserves all 65 messages across duplicate saves, narrowed input and Repository reopening", async () => {
    const db = new CareerAdaptDb(`comp01-history-${crypto.randomUUID()}`);
    try {
      const repository = new WorkspaceRepository(db);
      const session = AgentRuntime.createConversationSession();
      session.messages = Array.from({ length: 65 }, (_, i) => ({ id: `durable-${i}`, branchId: session.activeBranchId, role: i % 2 ? "assistant" : "user", content: `合成历史 ${i}`, createdAt: now }));
      session.activeHeadMessageId = session.messages.at(-1)!.id;
      const saved = await repository.saveAgentSession(session);
      const duplicate = await repository.saveAgentSession(saved);
      await repository.saveAgentSession({ ...duplicate, messages: duplicate.messages.slice(-2) });
      const restored = await new WorkspaceRepository(db).getAgentSession(session.id);
      expect(restored?.messages.map((message) => message.id)).toEqual(session.messages.map((message) => message.id));
      expect(await db.agentMessages.where("sessionId").equals(session.id).count()).toBe(65);
      expect(await db.profiles.count()).toBe(0);
      expect(await db.resumeBranches.count()).toBe(0);
      expect(await db.jobDescriptions.count()).toBe(0);
    } finally { await db.delete(); }
  });
});

describe("COMP-01 timeline", () => {
  it("does not show thinking or live tool indicators after cancellation, retaining the durable source", () => {
    const messages: AgentMessage[] = [tool("cancel-tool", "cancel-turn"),
      { id: "thinking", turnId: "cancel-turn", role: "assistant", content: "", kind: "assistant_thinking", status: "thinking", createdAt: now },
      { id: "partial", turnId: "cancel-turn", role: "assistant", content: "已收到部分材料", kind: "assistant_streaming", status: "streaming", streaming: true, createdAt: now }];
    render(<AgentConversationTimeline messages={messages} interruptedTurnId="cancel-turn" />);
    expect(document.querySelector(".agent-streaming-indicator, .agent-stream-cursor, .agent-tool-status-row.is-running")).toBeNull();
    expect(screen.getByText("已停止 · 回复未完成")).toBeVisible();
    expect(screen.getByText("已收到部分材料")).toBeVisible();
    expect(messages[2].streaming).toBe(true);
    expect(messages[0].metadata?.activityState).toBe("running");
  });
  it("shows an activity-only turn before any assistant delta and groups its tools", () => {
    render(<AgentConversationTimeline messages={[tool("a", "turn-a"), tool("b", "turn-a")]} />);
    expect(document.querySelectorAll(".agent-tool-status-row")).toHaveLength(1);
    expect(document.querySelectorAll(".agent-tool-activity-list li")).toHaveLength(2);
    expect(screen.getByText("正在加载简历和岗位信息")).toBeVisible();
    expect(document.querySelector(".agent-current-tool-step")).toHaveTextContent("安全步骤 b");
  });
  it("keeps unrelated tool turns separate and attaches a completed receipt to its assistant", () => {
    const { rerender } = render(<AgentConversationTimeline messages={[tool("a", "turn-a"), tool("b", "turn-b")]} />);
    expect(document.querySelectorAll(".agent-tool-status-row")).toHaveLength(2);
    rerender(<AgentConversationTimeline messages={[tool("a", "turn-a", "complete"), { id: "answer", turnId: "turn-a", role: "assistant", content: "完成", status: "complete", createdAt: now }]} />);
    expect(document.querySelector(".agent-message-row.is-assistant .agent-tool-status-row")).not.toBeNull();
    expect(document.querySelector<HTMLDetailsElement>(".agent-tool-status-row")?.open).toBe(false);
  });
  it("preserves original assistant prose and code whitespace instead of cleaning Markdown", () => {
    const content = "I can help you write a resume.\n\n```text\na\n\n\nb\n```";
    render(<AgentConversationTimeline messages={[{ id: "markdown", role: "assistant", content, createdAt: now }]} />);
    expect(screen.getByText("I can help you write a resume.")).toBeVisible();
    expect(document.querySelector("pre code")?.textContent).toBe("a\n\n\nb");
  });
  it("renders rich Markdown without activating raw HTML or script links", () => {
    const { container } = render(<AgentMarkdown>{"# 标题\n\n**重点**\n\n> 引用\n\n1. 第一步\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[官网](https://example.com)\n\n[危险](javascript:alert)\n\n<img src=x onerror=alert(1)>"}</AgentMarkdown>);
    expect(screen.getByRole("heading", { name: "标题" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("link", { name: "官网" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: "危险" })).toBeNull();
    expect(container.querySelector("img,script")).toBeNull();
  });
  it("lets the reader inspect history while new deltas arrive and jump back explicitly", () => {
    const messages: AgentMessage[] = [{ id: "read-history", role: "assistant", content: "第一段", createdAt: now }];
    const { container, rerender } = render(<AgentConversationTimeline messages={messages} />);
    const timeline = screen.getByRole("region", { name: "AI 对话" });
    Object.defineProperties(timeline, { scrollHeight: { value: 2000 }, clientHeight: { value: 400 }, scrollTop: { value: 100 } });
    const end = container.querySelector(".agent-conversation-inner > div:last-child") as HTMLElement;
    end.scrollIntoView = vi.fn();
    fireEvent.scroll(timeline);
    rerender(<AgentConversationTimeline messages={[{ ...messages[0], content: "第二段增量" }]} />);
    expect(end.scrollIntoView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "回到最新消息" }));
    expect(end.scrollIntoView).toHaveBeenCalledOnce();
  });
  it("submits an inline question choice through its existing typed action", () => {
    const onOption = vi.fn();
    const option = { id: "python-used", label: "我在项目中用过 Python", action: { type: "answer" as const, field: "python", value: "used" } };
    render(<AgentConversationTimeline messages={[{ id: "question", role: "assistant", content: "岗位提到了 Python，你实际使用过吗？", options: [option], createdAt: now }]} onOption={onOption} />);
    fireEvent.click(screen.getByRole("button", { name: option.label }));
    expect(onOption).toHaveBeenCalledWith(option);
  });
  it("keeps a long visible history above the former 40-message context boundary", () => {
    render(<AgentConversationTimeline messages={Array.from({ length: 65 }, (_, i) => ({ id: `history-${i}`, role: "user", content: `历史内容 ${i}`, createdAt: now }))} />);
    expect(document.querySelectorAll(".agent-message-row")).toHaveLength(65);
    expect(screen.getByText("历史内容 0")).toBeInTheDocument();
    expect(screen.getByText("历史内容 64")).toBeInTheDocument();
  });
});

describe("COMP-01 historical branch inspection", () => {
  it("shows the old assistant branch without selecting it or changing execution context", () => {
    const session = AgentRuntime.createConversationSession();
    session.activeBranchId = "new"; session.activeHeadMessageId = "new-answer";
    session.conversationBranches = [
      { id: "old", status: "superseded", headMessageId: "old-answer", createdAt: now },
      { id: "new", status: "active", headMessageId: "new-answer", createdAt: now }
    ];
    session.messages = [
      { id: "old-question", branchId: "old", role: "user", content: "原来的任务", metadata: { retracted: true }, createdAt: now },
      { id: "old-answer", branchId: "old", role: "assistant", content: "旧分支完整答复", metadata: { retracted: true }, createdAt: now },
      { id: "new-question", branchId: "new", role: "user", content: "编辑后的任务", createdAt: now },
      { id: "new-answer", branchId: "new", role: "assistant", content: "新分支答复", createdAt: now }
    ];
    const original = JSON.stringify(session); const select = vi.fn(); const close = vi.fn();
    render(<AgentHistoryDialog open sessions={[session]} onClose={close} onSelect={select} />);
    fireEvent.click(screen.getByRole("button", { name: /^查看分支：/ }));
    expect(screen.getByText("新分支答复")).toBeVisible();
    expect(screen.queryByText("旧分支完整答复")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "查看会话分支" }), { target: { value: "old" } });
    expect(screen.getByText("旧分支完整答复")).toBeVisible();
    expect(screen.getByText("原来的任务")).toBeVisible();
    expect(screen.queryByText("新分支答复")).toBeNull();
    expect(select).not.toHaveBeenCalled(); expect(JSON.stringify(session)).toBe(original);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
  });
});

describe("COMP-01 composer", () => {
  const base = () => ({ attachments: [] as ComposerAttachmentDraft[], onFilesSelected: vi.fn(), onRemoveAttachment: vi.fn(), onSubmit: vi.fn() });
  it("does not send an IME confirmation or Shift+Enter; Enter sends the text", () => {
    const props = base(); render(<AgentComposer {...props} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "中文任务" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledWith({ text: "中文任务", attachments: [] });
  });
  it("retains every shortcut in the add menu and restores focus on Escape", () => {
    const props = base(); const action = vi.fn(); render(<AgentComposer {...props} onUiAction={action} />);
    const trigger = screen.getByRole("button", { name: "添加材料与工具" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("group", { name: "添加材料与工具" });
    expect(within(menu).getAllByRole("button")).toHaveLength(5);
    fireEvent.click(within(menu).getByRole("button", { name: "选择简历" }));
    expect(action).toHaveBeenCalledWith({ type: "open_resume_picker" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger); fireEvent.keyDown(screen.getByRole("group", { name: "添加材料与工具" }), { key: "Escape" });
    expect(trigger).toHaveFocus();
  });
  it("retains failed attachment metadata; removing it excludes it from the next submission", () => {
    const props = base(); const file = new File(["fixture"], "resume.txt", { type: "text/plain" });
    const attachment: ComposerAttachmentDraft = { clientId: "file-1", file, fileName: file.name, mimeType: file.type, size: file.size, status: "failed", errorCode: "upload_failed" };
    const { rerender } = render(<AgentComposer {...props} draft="继续" attachments={[attachment]} />);
    expect(screen.getByText(/TXT · 1 KB/)).toBeVisible();
    expect(screen.getByText(/失败 · upload_failed/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "移除附件 resume.txt" }));
    expect(props.onRemoveAttachment).toHaveBeenCalledWith("file-1");
    rerender(<AgentComposer {...props} draft="继续" attachments={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(props.onSubmit).toHaveBeenCalledWith({ text: "继续", attachments: [] });
  });
  it("allows queueing and Stop during a run, then disables Stop while awaiting the result", () => {
    const props = base(); const stop = vi.fn(); const { rerender } = render(<AgentComposer {...props} running draft="下一条" onStop={stop} />);
    fireEvent.click(screen.getByRole("button", { name: "排队发送消息" }));
    expect(props.onSubmit).toHaveBeenCalledWith({ text: "下一条", attachments: [] });
    fireEvent.click(screen.getByRole("button", { name: "停止运行" })); expect(stop).toHaveBeenCalledOnce();
    rerender(<AgentComposer {...props} stopping aiStatus="正在停止" />);
    expect(screen.getByRole("button", { name: "正在停止" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "停止运行" })).toBeNull();
  });
});
