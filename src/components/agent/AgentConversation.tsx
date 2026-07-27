"use client";

import type { AgentMessage } from "@/agent/contracts/agentSession";
import type { AgentOption } from "@/agent/contracts/agentActions";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clipboard,
  Edit3,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  RotateCcw,
  Undo2,
  UserRound
} from "lucide-react";
import { useEffect, useRef } from "react";
import { AgentMarkdown } from "./AgentMarkdown";

export function AgentConversation({
  messages,
  onUndoLastUser,
  onRegenerate,
  onEditUserMessage,
  onContinueFromMessage,
  onCopyMessage,
  onOption,
  children
}: {
  messages: AgentMessage[];
  onUndoLastUser?(): void;
  onRegenerate?(): void;
  onEditUserMessage?(message: AgentMessage): void;
  onContinueFromMessage?(message: AgentMessage): void;
  onCopyMessage?(message: AgentMessage): void;
  onOption?(option: AgentOption): void;
  children?: React.ReactNode;
}) {
  const visibleMessages = messages.filter((message) =>
    message.role !== "system" && message.metadata?.retracted !== true
  );
  const conversationItems = groupConversationItems(visibleMessages);
  const latestMessageContent = visibleMessages.at(-1)?.content;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView !== "function") return;
    endRef.current.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [visibleMessages.length, latestMessageContent]);
  return (
    <section className="agent-conversation" aria-label="AI 对话" aria-live="polite">
      <div className="agent-conversation-inner">
        {conversationItems.map((item) => {
          if (item.type === "activity") {
            return <AgentActivityGroup key={item.id} messages={item.messages} />;
          }
          if (item.type === "assistant_turn") {
            return (
              <AgentMessageRow
                key={item.id}
                message={item.message}
                activity={item.activity}
                onContinueFromMessage={onContinueFromMessage}
                onCopyMessage={onCopyMessage}
                onRegenerate={onRegenerate}
                onOption={onOption}
              />
            );
          }
          const message = item.message;
          if (message.kind === "error_status" || message.type === "error") {
            return <AgentErrorStatus key={message.id} message={message} />;
          }
          return (
            <AgentMessageRow
              key={message.id}
              message={message}
              onEditUserMessage={onEditUserMessage}
              onContinueFromMessage={onContinueFromMessage}
              onCopyMessage={onCopyMessage}
              onRegenerate={onRegenerate}
              onOption={onOption}
            />
          );
        })}
        {children}
        {visibleMessages.length ? (
          <div className="agent-conversation-actions" aria-label="会话操作">
            {onUndoLastUser ? (
              <button type="button" onClick={onUndoLastUser}>
                <Undo2 aria-hidden="true" /> 撤回最近输入
              </button>
            ) : null}
            {onRegenerate ? (
              <button type="button" onClick={onRegenerate}>
                <RotateCcw aria-hidden="true" /> 重新生成最近回答
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={endRef} aria-hidden="true" />
      </div>
    </section>
  );
}

function AgentActivityGroup({ messages }: { messages: AgentMessage[] }) {
  const running = messages.some((message) => message.metadata?.activityState === "running" || message.status === "pending");
  const failed = messages.some((message) => message.metadata?.activityState === "failed" || message.status === "failed");
  const Icon = running ? LoaderCircle : failed ? AlertCircle : CheckCircle2;
  return (
    <details className={`agent-tool-status-row is-${running ? "running" : failed ? "failed" : "complete"}`} open={running || failed || undefined}>
      <summary role="status">
        <Icon className={running ? "is-spinning" : undefined} aria-hidden="true" />
        <strong>{running ? "正在执行任务步骤" : failed ? "部分任务步骤需要处理" : `已完成 ${messages.length} 个任务步骤`}</strong>
      </summary>
      <ul className="agent-tool-activity-list">
        {messages.map((message) => <li key={message.id}>{toolStatus(message)}</li>)}
      </ul>
    </details>
  );
}

export const AgentConversationTimeline = AgentConversation;

function AgentMessageRow({
  message,
  activity,
  onEditUserMessage,
  onContinueFromMessage,
  onCopyMessage,
  onRegenerate,
  onOption
}: {
  message: AgentMessage;
  activity?: AgentMessage[];
  onEditUserMessage?(message: AgentMessage): void;
  onContinueFromMessage?(message: AgentMessage): void;
  onCopyMessage?(message: AgentMessage): void;
  onRegenerate?(): void;
  onOption?(option: AgentOption): void;
}) {
  const isUser = message.role === "user";
  const streaming = isStreamingMessage(message);
  return (
    <article
      className={[
        "agent-message-row",
        isUser ? "is-user" : "is-assistant",
        streaming ? "is-streaming" : ""
      ].filter(Boolean).join(" ")}
      data-message-role={message.role}
      data-message-status={message.status ?? message.kind ?? "complete"}
    >
      {!isUser ? <AgentAvatar role="assistant" /> : null}
      <div className="agent-message-stack">
        {!isUser && activity?.length ? <AgentActivityGroup messages={activity} /> : null}
        <AgentMessageBubble message={message} />
        {message.options?.length ? (
          <div className="agent-message-options" aria-label="可选回答">
            {message.options.map((option) => (
              <button key={option.id} type="button" onClick={() => onOption?.(option)}>
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        <AgentMessageActions
          message={message}
          activity={activity}
          onEditUserMessage={onEditUserMessage}
          onContinueFromMessage={onContinueFromMessage}
          onCopyMessage={onCopyMessage}
          onRegenerate={onRegenerate}
        />
      </div>
      {isUser ? <AgentAvatar role="user" /> : null}
    </article>
  );
}

function AgentAvatar({ role }: { role: "assistant" | "user" }) {
  return (
    <span className={`agent-avatar is-${role}`} aria-label={role === "assistant" ? "AI 助手" : "你"}>
      {role === "assistant" ? <Bot aria-hidden="true" /> : <UserRound aria-hidden="true" />}
    </span>
  );
}

function AgentMessageBubble({ message }: { message: AgentMessage }) {
  const streaming = isStreamingMessage(message);
  const content = streaming && !message.content.trim()
    ? ""
    : normalizeAgentMessageText(message.content);
  return (
    <div className="agent-message-bubble">
      <AgentMessageContent content={content} streaming={streaming} />
    </div>
  );
}

function AgentMessageContent({ content, streaming }: { content: string; streaming: boolean }) {
  if (streaming && !content.trim()) return <AgentStreamingIndicator />;
  return (
    <div className="agent-message-content">
      <AgentMarkdown>{content}</AgentMarkdown>
      {streaming ? <span className="agent-stream-cursor" aria-hidden="true" /> : null}
    </div>
  );
}

function AgentStreamingIndicator() {
  return (
    <span className="agent-streaming-indicator" role="status">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      正在思考
    </span>
  );
}

function AgentMessageActions({
  message,
  activity,
  onEditUserMessage,
  onContinueFromMessage,
  onCopyMessage,
  onRegenerate
}: {
  message: AgentMessage;
  activity?: AgentMessage[];
  onEditUserMessage?(message: AgentMessage): void;
  onContinueFromMessage?(message: AgentMessage): void;
  onCopyMessage?(message: AgentMessage): void;
  onRegenerate?(): void;
}) {
  const isUser = message.role === "user";
  const disabled = isStreamingMessage(message);
  return (
    <div className="agent-message-actions" aria-label={isUser ? "用户消息操作" : "AI 消息操作"}>
      {isUser ? (
        <button type="button" title="编辑并重发" aria-label="编辑并重发" onClick={() => onEditUserMessage?.(message)}>
          <Edit3 aria-hidden="true" />
        </button>
      ) : (
        <>
          <button type="button" title="重新生成" aria-label="重新生成" disabled={disabled} onClick={onRegenerate}>
            <RotateCcw aria-hidden="true" />
          </button>
          <button type="button" title="基于此继续" aria-label="基于此继续" disabled={disabled} onClick={() => onContinueFromMessage?.(message)}>
            <MessageSquarePlus aria-hidden="true" />
          </button>
        </>
      )}
      <button type="button" title="复制" aria-label="复制消息" disabled={disabled} onClick={() => onCopyMessage?.(message)}>
        <Clipboard aria-hidden="true" />
      </button>
      {!disabled ? (
        <AgentMessageMoreMenu
          message={message}
          activity={activity}
          disabled={disabled}
          onEditUserMessage={onEditUserMessage}
          onContinueFromMessage={onContinueFromMessage}
          onCopyMessage={onCopyMessage}
        />
      ) : null}
    </div>
  );
}

function AgentMessageMoreMenu({
  message,
  activity,
  disabled,
  onEditUserMessage,
  onContinueFromMessage,
  onCopyMessage
}: {
  message: AgentMessage;
  activity?: AgentMessage[];
  disabled: boolean;
  onEditUserMessage?(message: AgentMessage): void;
  onContinueFromMessage?(message: AgentMessage): void;
  onCopyMessage?(message: AgentMessage): void;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const isUser = message.role === "user";
  const run = (action: (() => void) | undefined) => {
    action?.();
    if (menuRef.current) menuRef.current.open = false;
  };
  return (
    <details ref={menuRef} className="agent-message-more">
      <summary title="更多" aria-label="更多消息操作" aria-disabled={disabled || undefined}>
        <MoreHorizontal aria-hidden="true" />
      </summary>
      <div className="agent-message-more-menu" role="menu">
        {isUser ? (
          <>
            {onEditUserMessage ? (
              <button type="button" role="menuitem" disabled={disabled} onClick={() => run(() => onEditUserMessage(message))}>
                编辑并重新发送
              </button>
            ) : null}
            {onCopyMessage ? (
              <button type="button" role="menuitem" disabled={disabled} onClick={() => run(() => onCopyMessage(message))}>
                复制
              </button>
            ) : null}
          </>
        ) : (
          <>
            {onCopyMessage ? (
              <button type="button" role="menuitem" disabled={disabled} onClick={() => run(() => onCopyMessage(message))}>
                复制 Markdown
              </button>
            ) : null}
            {onContinueFromMessage ? (
              <button type="button" role="menuitem" disabled={disabled} onClick={() => run(() => onContinueFromMessage(message))}>
                引用这条回复
              </button>
            ) : null}
            {activity?.length ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => run(() => {
                  const row = menuRef.current?.closest(".agent-message-row");
                  const steps = row?.querySelector<HTMLDetailsElement>(".agent-tool-status-row");
                  if (steps) {
                    steps.open = true;
                    steps.focus();
                  }
                })}
              >
                查看任务步骤
              </button>
            ) : null}
          </>
        )}
      </div>
    </details>
  );
}

function AgentErrorStatus({ message }: { message: AgentMessage }) {
  const status = message.status ?? "failed";
  const Icon = status === "retrying"
    ? LoaderCircle
    : status === "recovered"
      ? CheckCircle2
      : AlertCircle;
  return (
    <div className={`agent-error-status is-${status}`} role={status === "failed" ? "alert" : "status"}>
      <Icon aria-hidden="true" />
      <div>
        <strong>{status === "retrying" ? "正在重试" : status === "recovered" ? "连接已恢复" : "任务暂时中断"}</strong>
        <p>{normalizeAgentMessageText(message.content)}</p>
      </div>
    </div>
  );
}

function toolStatus(message: AgentMessage) {
  if (message.metadata?.activityState || message.toolName === "skill_loaded") return message.content;
  const labels: Record<string, string> = {
    parse_resume_file: "已接收文件，正在提取可核对内容",
    parse_job_description: "已生成岗位语义草稿",
    commit_job: "岗位已保存",
    analyze_job_fit: "岗位匹配分析已完成",
    create_tailoring_session: "定制方案已生成",
    apply_tailoring_changes: "新版本已创建",
    export_resume: "PDF 预览已准备"
  };
  return message.toolName ? labels[message.toolName] ?? "工具步骤已完成" : "工具步骤已完成";
}

function isStreamingMessage(message: AgentMessage) {
  return Boolean(
    message.streaming
    || message.kind === "assistant_thinking"
    || message.kind === "assistant_streaming"
    || message.type === "assistant_thinking"
    || message.type === "assistant_streaming"
    || message.status === "thinking"
    || message.status === "streaming"
  );
}

function groupConversationItems(messages: AgentMessage[]) {
  const activityByTurn = new Map<string, AgentMessage[]>();
  const lastAssistantByTurn = new Map<string, string>();
  for (const message of messages) {
    if (isActivityMessage(message) && message.turnId) {
      activityByTurn.set(message.turnId, [...(activityByTurn.get(message.turnId) ?? []), message]);
    } else if (message.role === "assistant" && message.turnId) {
      lastAssistantByTurn.set(message.turnId, message.id);
    }
  }
  const items: Array<
    | { type: "message"; id: string; message: AgentMessage }
    | { type: "activity"; id: string; messages: AgentMessage[] }
    | { type: "assistant_turn"; id: string; message: AgentMessage; activity: AgentMessage[] }
  > = [];
  for (const message of messages) {
    if (isActivityMessage(message) && message.turnId) continue;
    const activity = message.turnId && lastAssistantByTurn.get(message.turnId) === message.id
      ? activityByTurn.get(message.turnId)
      : undefined;
    if (message.role === "assistant" && activity?.length) {
      items.push({
        type: "assistant_turn",
        id: `turn-${message.turnId}`,
        message,
        activity
      });
    } else if (isActivityMessage(message)) {
      items.push({ type: "activity", id: `activity-${message.id}`, messages: [message] });
    } else {
      items.push({ type: "message", id: message.id, message });
    }
  }
  return items;
}

function isActivityMessage(message: AgentMessage) {
  return message.role === "tool" || message.kind === "tool_status" || message.type === "tool_status";
}

export function normalizeAgentMessageText(input: string) {
  const fallbackPatterns = [
    /^I can help you repair the action\.?.*(?:\n|$)/gi,
    /^Please provide the specific action JSON.*(?:\n|$)/gi,
    /^Could you please provide more details about the issue.*(?:\n|$)/gi,
    /^I can help you.*(?:\n|$)/gi
  ];
  let text = input.replace(/\r\n/g, "\n");
  for (const pattern of fallbackPatterns) text = text.replace(pattern, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text || "我已经收到。请继续补充你的真实情况，我会按步骤和你核对。";
}
