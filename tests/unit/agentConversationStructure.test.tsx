import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("edits a user message in place and only resends after confirmation", async () => {
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
    const assistantRow = timeline.querySelector(".agent-message-row.is-assistant");
    expect(assistantRow).not.toBeNull();
    expect(timeline.querySelector(".agent-avatar.is-user")).not.toBeNull();
    expect(timeline.querySelector(".agent-avatar.is-assistant")).not.toBeNull();
    expect(assistantRow?.querySelector(".agent-message-main > .agent-avatar.is-assistant")).not.toBeNull();
    expect(assistantRow?.querySelector(".agent-message-main > .agent-message-stack")).not.toBeNull();
    expect(timeline.querySelector(".agent-message > span")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "编辑并重发" }));
    const editor = screen.getByRole("textbox", { name: "编辑消息" });
    expect(editor).toHaveValue("你好，我想从零整理经历。");
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.change(editor, { target: { value: "你好，我想先整理最近一段经历。" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("textbox", { name: "编辑消息" })).not.toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "编辑并重发" }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑消息" }), {
      target: { value: "你好，我想先整理最近一段经历。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "确认并重发" }));
    expect(screen.queryByRole("textbox", { name: "编辑消息" })).not.toBeInTheDocument();
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      "你好，我想先整理最近一段经历。"
    ));
    fireEvent.click(screen.getAllByRole("button", { name: "重新生成" })[0]);
    expect(onRegenerate).toHaveBeenCalledWith(expect.objectContaining({ id: "assistant-1" }));
  });

  it("shows message history and can restore an older version into the inline editor", () => {
    render(
      <AgentConversationTimeline
        messages={[{
          id: "user-history",
          role: "user",
          content: "当前版本",
          revisions: [{
            id: "revision-1",
            content: "最初版本",
            createdAt: "2026-07-24T00:00:00.000Z"
          }],
          createdAt: "2026-07-24T00:00:00.000Z",
          updatedAt: "2026-07-24T00:01:00.000Z"
        }]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "历史版本" }));
    expect(screen.getByRole("dialog", { name: "消息历史版本" })).toHaveTextContent("当前版本");
    expect(screen.getByRole("dialog", { name: "消息历史版本" })).toHaveTextContent("最初版本");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "消息历史版本" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "历史版本" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复此版本并编辑" }));
    expect(screen.getByRole("textbox", { name: "编辑消息" })).toHaveValue("最初版本");
    expect(screen.queryByRole("dialog", { name: "消息历史版本" })).not.toBeInTheDocument();
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

  it("shows a compact structured reference without duplicating it into user text", () => {
    render(
      <AgentConversationTimeline
        messages={[{
          id: "user-reference",
          turnId: "turn-reference",
          role: "user",
          content: "这里面的岗位匹配是什么意思？",
          references: [{
            messageId: "assistant-capabilities",
            role: "assistant",
            type: "assistant_message",
            excerpt: "除了刚才展示的资料库读取功能……"
          }],
          createdAt: "2026-07-27T08:00:00.000Z"
        }]}
      />
    );
    expect(screen.getByText("回复 AI")).toBeInTheDocument();
    expect(screen.getByText("这里面的岗位匹配是什么意思？")).toBeInTheDocument();
    expect(screen.getAllByText(/除了刚才展示/)).toHaveLength(1);
  });

  it("places the user message above the AI row and expands running task progress", () => {
    render(
      <AgentConversationTimeline
        messages={[
          {
            id: "user-running",
            turnId: "turn-running",
            role: "user",
            content: "请读取我的资料",
            createdAt: "2026-07-24T00:00:00.000Z"
          },
          {
            id: "tool-running",
            turnId: "turn-running",
            role: "tool",
            content: "正在读取资料库",
            kind: "tool_status",
            type: "tool_status",
            status: "pending",
            metadata: { activityState: "running" },
            createdAt: "2026-07-24T00:00:00.000Z"
          },
          {
            id: "assistant-running",
            turnId: "turn-running",
            role: "assistant",
            content: "正在整理",
            status: "streaming",
            createdAt: "2026-07-24T00:00:01.000Z"
          }
        ]}
      />
    );

    const userRow = document.querySelector(".agent-message-row.is-user");
    const row = document.querySelector(".agent-message-row.is-assistant");
    expect(userRow).not.toBeNull();
    expect(row).not.toBeNull();
    if (userRow && row) {
      expect(userRow.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(row?.firstElementChild).toHaveClass("agent-tool-status-row");
    expect(row?.children[1]).toHaveClass("agent-message-main");
    expect(row?.querySelector<HTMLDetailsElement>(".agent-tool-status-row")?.open).toBe(true);
    expect(row?.querySelector(".agent-tool-status-icon .is-running")).toHaveClass("is-visible");
  });

  it("does not show repeated profile-intake continuation or restore rows", () => {
    const continuation = "教育背景已经记录并自动保存。\n\n接下来介绍一段实习经历吧。先说公司、你的角色和主要工作即可。";
    render(
      <AgentConversationTimeline
        messages={[
          {
            id: "continuation-old",
            turnId: "turn-continuation-old",
            role: "assistant",
            content: continuation,
            kind: "text",
            type: "text",
            status: "complete",
            metadata: { profileIntakeContinuation: true },
            createdAt: "2026-07-24T00:00:01.000Z"
          },
          {
            id: "tool-continuation-old",
            turnId: "turn-continuation-old",
            role: "tool",
            content: "已完成经历核对",
            kind: "tool_status",
            type: "tool_status",
            status: "complete",
            metadata: { activityState: "complete" },
            createdAt: "2026-07-24T00:00:01.000Z"
          },
          {
            id: "continuation-new",
            turnId: "turn-continuation-new",
            role: "assistant",
            content: continuation,
            kind: "text",
            type: "text",
            status: "complete",
            metadata: { profileIntakeContinuation: true },
            createdAt: "2026-07-24T00:00:02.000Z"
          },
          {
            id: "tool-continuation-new",
            turnId: "turn-continuation-new",
            role: "tool",
            content: "已完成经历核对",
            kind: "tool_status",
            type: "tool_status",
            status: "complete",
            metadata: { activityState: "complete" },
            createdAt: "2026-07-24T00:00:02.000Z"
          },
          {
            id: "restore-old",
            role: "assistant",
            content: "上次已整理到教育背景，要继续吗？",
            kind: "text",
            type: "text",
            status: "complete",
            metadata: { intakeRestorePrompt: true, intakeRestoreToken: "old-token" },
            createdAt: "2026-07-24T00:00:03.000Z"
          },
          {
            id: "restore-new",
            role: "assistant",
            content: "上次已整理到教育背景，要继续吗？",
            kind: "text",
            type: "text",
            status: "complete",
            metadata: { intakeRestorePrompt: true, intakeRestoreToken: "new-token" },
            createdAt: "2026-07-24T00:00:04.000Z"
          }
        ]}
      />
    );

    expect(screen.getAllByText(/教育背景已经记录并自动保存/)).toHaveLength(1);
    expect(screen.getAllByText("上次已整理到教育背景，要继续吗？")).toHaveLength(1);
    expect(screen.getAllByText("已完成 1 个任务步骤")).toHaveLength(1);
  });

  it("shows failed tool details and the final error status together", () => {
    render(
      <AgentConversationTimeline
        messages={[
          {
            id: "tool-failed",
            turnId: "turn-failed",
            role: "tool",
            content: "读取指定任务的当前进度未完成：指定会话不存在或已失效。任务信息已保留。",
            kind: "tool_status",
            type: "tool_status",
            toolName: "get_agent_task_context",
            status: "failed",
            metadata: { activityState: "failed" },
            createdAt: "2026-07-28T05:00:00.000Z"
          },
          {
            id: "assistant-failed",
            turnId: "turn-failed",
            role: "assistant",
            content: "自动处理没有完成：连续步骤未能推进。",
            kind: "error_status",
            type: "error",
            status: "failed",
            createdAt: "2026-07-28T05:00:01.000Z"
          }
        ]}
      />
    );

    const activity = document.querySelector<HTMLDetailsElement>(".agent-tool-status-row");
    expect(activity?.open).toBe(true);
    expect(screen.getByText("未完成", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/读取指定任务的当前进度未完成/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("自动处理没有完成");
  });

  it("renders borderless confirmation actions under the matching AI reply and replaces them with resolution status", () => {
    const onConfirmation = vi.fn();
    const message = {
      id: "assistant-confirm",
      turnId: "turn-confirm",
      role: "assistant" as const,
      content: "请确认是否将这项教育经历写入资料库。",
      kind: "text" as const,
      type: "text" as const,
      status: "complete" as const,
      createdAt: "2026-07-28T04:07:26.945Z"
    };
    const { rerender } = render(
      <AgentConversationTimeline
        messages={[message]}
        confirmation={{
          id: "confirmation-1",
          turnId: "turn-confirm",
          operationId: "commit-profile-operation",
          toolName: "commit_profile_intake",
          title: "写入资料库？",
          description: "确认后会保存已经核对的事实。",
          destructive: false,
          status: "pending",
          requestedAt: "2026-07-28T04:07:27.000Z"
        }}
        onConfirmation={onConfirmation}
      />
    );

    const stack = document.querySelector(".agent-message-row.is-assistant .agent-message-stack");
    expect(stack?.querySelector(".agent-confirmation")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^确认$/ }));
    expect(onConfirmation).toHaveBeenCalledWith(true);
    expect(screen.queryByText("您已确认")).not.toBeInTheDocument();

    rerender(
      <AgentConversationTimeline
        messages={[{
          ...message,
          metadata: { confirmationResolution: "confirmed" }
        }]}
      />
    );
    expect(screen.queryByRole("button", { name: /^确认$/ })).not.toBeInTheDocument();
    expect(screen.getByText("您已确认")).toBeInTheDocument();
  });
});
