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
});
