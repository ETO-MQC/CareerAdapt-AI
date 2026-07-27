import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentConversationTimeline } from "@/components/agent/AgentConversation";

describe("AgentConversationTimeline", () => {
  it("renders workflow interactions inside the conversation timeline", () => {
    render(
      <AgentConversationTimeline messages={[]}>
        <article data-testid="interactive-card">选择简历</article>
      </AgentConversationTimeline>
    );

    const timeline = screen.getByRole("region", { name: "AI 对话" });
    expect(timeline).toContainElement(screen.getByTestId("interactive-card"));
    expect(timeline.querySelector(".agent-task-panel")).toBeNull();
  });

  it("renders mature message rows with avatars and light message actions", () => {
    const onEdit = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <AgentConversationTimeline
        messages={[
          {
            id: "user-1",
            role: "user",
            content: "你好，我想从零整理经历。",
            createdAt: "2026-07-24T00:00:00.000Z"
          },
          {
            id: "assistant-1",
            role: "assistant",
            content: "好的，我们先从最近一段经历开始。",
            status: "complete",
            createdAt: "2026-07-24T00:00:01.000Z"
          }
        ]}
        onEditUserMessage={onEdit}
        onRegenerate={onRegenerate}
      />
    );

    const timeline = screen.getByRole("region", { name: "AI 对话" });
    expect(timeline.querySelector(".agent-message-row.is-user")).not.toBeNull();
    expect(timeline.querySelector(".agent-message-row.is-assistant")).not.toBeNull();
    expect(timeline.querySelector(".agent-avatar.is-user")).not.toBeNull();
    expect(timeline.querySelector(".agent-avatar.is-assistant")).not.toBeNull();
    expect(timeline.querySelector(".agent-message > span")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "编辑并重发" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1" }));
    fireEvent.click(screen.getAllByRole("button", { name: "重新生成" })[0]);
    expect(onRegenerate).toHaveBeenCalled();
  });

  it("shows only available compact overflow actions and exposes task steps contextually", () => {
    const onCopy = vi.fn();
    const onQuote = vi.fn();
    render(
      <AgentConversationTimeline
        messages={[
          {
            id: "tool-1",
            turnId: "turn-1",
            role: "tool",
            content: "已分析岗位匹配",
            kind: "tool_status",
            type: "tool_status",
            status: "complete",
            metadata: { activityState: "complete" },
            createdAt: "2026-07-24T00:00:00.000Z"
          },
          {
            id: "assistant-1",
            turnId: "turn-1",
            role: "assistant",
            content: "## 匹配建议\n\n保留真实证据。",
            status: "complete",
            createdAt: "2026-07-24T00:00:01.000Z"
          }
        ]}
        onCopyMessage={onCopy}
        onContinueFromMessage={onQuote}
      />
    );

    fireEvent.click(screen.getByLabelText("更多消息操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制 Markdown" }));
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ id: "assistant-1" }));

    fireEvent.click(screen.getByLabelText("更多消息操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "引用这条回复" }));
    expect(onQuote).toHaveBeenCalledWith(expect.objectContaining({ id: "assistant-1" }));

    fireEvent.click(screen.getByLabelText("更多消息操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "查看任务步骤" }));
    expect(document.querySelector<HTMLDetailsElement>(".agent-tool-status-row")?.open).toBe(true);
    expect(screen.queryByRole("menuitem", { name: "从这里创建新对话" })).toBeNull();
  });
});
