import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
