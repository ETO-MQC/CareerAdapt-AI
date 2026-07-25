"use client";

import type { AgentMessage } from "@/agent/contracts/agentSession";
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
  onOption?(value: string): void;
  children?: React.ReactNode;
}) {
  const visibleMessages = messages.filter((message) => message.role !== "system");
  const latestMessageContent = visibleMessages.at(-1)?.content;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView !== "function") return;
    endRef.current.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [visibleMessages.length, latestMessageContent]);
  return (
    <section className="agent-conversation" aria-label="AI 对话" aria-live="polite">
      <div className="agent-conversation-inner">
        {visibleMessages.map((message) => {
          if (message.kind === "error_status" || message.type === "error") {
            return <AgentErrorStatus key={message.id} message={message} />;
          }
          if (message.role === "tool" || message.kind === "tool_status" || message.type === "tool_status") {
            return (
              <div className="agent-tool-status-row" key={message.id} role="status">
                <span aria-hidden="true" />
                <strong>{toolStatus(message)}</strong>
              </div>
            );
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

export const AgentConversationTimeline = AgentConversation;

function AgentMessageRow({
  message,
  onEditUserMessage,
  onContinueFromMessage,
  onCopyMessage,
  onRegenerate,
  onOption
}: {
  message: AgentMessage;
  onEditUserMessage?(message: AgentMessage): void;
  onContinueFromMessage?(message: AgentMessage): void;
  onCopyMessage?(message: AgentMessage): void;
  onRegenerate?(): void;
  onOption?(value: string): void;
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
        <AgentMessageBubble message={message} />
        {message.options?.length ? (
          <div className="agent-message-options" aria-label="可选回答">
            {message.options.map((option) => (
              <button key={option.value} type="button" onClick={() => onOption?.(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        <AgentMessageActions
          message={message}
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
    <p className="agent-message-content">
      {content}
      {streaming ? <span className="agent-stream-cursor" aria-hidden="true" /> : null}
    </p>
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
  onEditUserMessage,
  onContinueFromMessage,
  onCopyMessage,
  onRegenerate
}: {
  message: AgentMessage;
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
      <button type="button" title="更多" aria-label="更多消息操作">
        <MoreHorizontal aria-hidden="true" />
      </button>
    </div>
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

export function normalizeAgentMessageText(input: string) {
  const fallbackPatterns = [
    /^I can help you repair the action\.?.*(?:\n|$)/gi,
    /^Please provide the specific action JSON.*(?:\n|$)/gi,
    /^Could you please provide more details about the issue.*(?:\n|$)/gi,
    /^I can help you.*(?:\n|$)/gi
  ];
  let text = input.replace(/\r\n/g, "\n");
  for (const pattern of fallbackPatterns) text = text.replace(pattern, "");
  text = text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (/^#{1,6}\s*$/.test(trimmed)) return "";
      if (/^\*{1,3}\s*$/.test(trimmed)) return "";
      if (/^\*{1,2}([^*\n]{1,80})\*{1,2}$/.test(trimmed)) return trimmed.replace(/^\*{1,2}|\*{1,2}$/g, "");
      return line.replace(/(?<!\*)\*(?!\*)/g, "");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || "我已经收到。请继续补充你的真实情况，我会按步骤和你核对。";
}
