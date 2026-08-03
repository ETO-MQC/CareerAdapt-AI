"use client";

import type { AgentConfirmation, AgentMessage } from "@/agent/contracts/agentSession";
import type { AgentOption } from "@/agent/contracts/agentActions";
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clipboard,
  Edit3,
  History,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  RotateCcw,
  Undo2,
  UserRound,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgentConfirmationCard } from "./AgentConfirmationCard";
import { AgentMarkdown } from "./AgentMarkdown";

export function AgentConversation({
  messages,
  onUndoLastUser,
  onRegenerate,
  onEditUserMessage,
  onContinueFromMessage,
  onCopyMessage,
  onOption,
  confirmation,
  confirmationBusy,
  onConfirmation,
  children
}: {
  messages: AgentMessage[];
  onUndoLastUser?(): void;
  onRegenerate?(message: AgentMessage): Promise<void> | void;
  onEditUserMessage?(message: AgentMessage, content: string): Promise<void> | void;
  onContinueFromMessage?(message: AgentMessage): void;
  onCopyMessage?(message: AgentMessage): void;
  onOption?(option: AgentOption): void;
  confirmation?: AgentConfirmation;
  confirmationBusy?: boolean;
  onConfirmation?(confirmed: boolean): void;
  children?: React.ReactNode;
}) {
  const visibleMessages = messages.filter((message) =>
    message.role !== "system" && message.metadata?.retracted !== true
  );
  const conversationItems = groupConversationItems(visibleMessages);
  const confirmationMessageId = confirmation
    ? [...visibleMessages].reverse().find((message) =>
        message.role === "assistant"
        && message.kind !== "assistant_thinking"
        && (!confirmation.turnId || message.turnId === confirmation.turnId)
      )?.id
    : undefined;
  const latestMessageContent = visibleMessages.at(-1)?.content;
  const latestAssistantMessage = visibleMessages.findLast((message) =>
    message.role === "assistant" && !isStreamingMessage(message)
  );
  const endRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ messageId: string; content: string }>();
  const [historyMessageId, setHistoryMessageId] = useState<string>();
  const [editSaving, setEditSaving] = useState(false);
  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView !== "function") return;
    // Streaming can update several times per second. Re-starting a smooth
    // scroll for every delta makes the whole conversation appear to flicker.
    endRef.current.scrollIntoView({ block: "end", behavior: "auto" });
  }, [visibleMessages.length, latestMessageContent]);
  return (
    <section className="agent-conversation" aria-label="AI 对话" aria-live="polite">
      <div className="agent-conversation-inner">
        {conversationItems.map((item) => {
          if (item.type === "activity") {
            return <AgentActivityGroup key={item.id} messages={item.messages} />;
          }
          if (item.type === "assistant_turn") {
            if (item.message.kind === "error_status" || item.message.type === "error") {
              return (
                <div key={item.id} className="agent-error-turn">
                  <AgentActivityGroup messages={item.activity} />
                  <AgentErrorStatus message={item.message} />
                </div>
              );
            }
            return (
              <AgentMessageRow
                key={item.id}
                message={item.message}
                activity={item.activity}
                editingContent={editing?.messageId === item.message.id ? editing.content : undefined}
                historyOpen={historyMessageId === item.message.id}
                editSaving={editSaving}
                onBeginEdit={(content) => {
                  setHistoryMessageId(undefined);
                  setEditing({ messageId: item.message.id, content });
                }}
                onEditChange={(content) => setEditing((current) =>
                  current?.messageId === item.message.id ? { ...current, content } : current
                )}
                onCancelEdit={() => setEditing(undefined)}
                onConfirmEdit={async () => {
                  if (!editing || editing.messageId !== item.message.id || !editing.content.trim()) return;
                  setEditSaving(true);
                  const pending = onEditUserMessage?.(item.message, editing.content.trim());
                  setEditing(undefined);
                  try {
                    await pending;
                  } finally {
                    setEditSaving(false);
                  }
                }}
                onToggleHistory={() => setHistoryMessageId((current) =>
                  current === item.message.id ? undefined : item.message.id
                )}
                onContinueFromMessage={onContinueFromMessage}
                onCopyMessage={onCopyMessage}
                onRegenerate={onRegenerate}
                onOption={onOption}
                confirmation={item.message.id === confirmationMessageId ? confirmation : undefined}
                confirmationBusy={confirmationBusy}
                onConfirmation={onConfirmation}
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
              editingContent={editing?.messageId === message.id ? editing.content : undefined}
              historyOpen={historyMessageId === message.id}
              editSaving={editSaving}
              onBeginEdit={(content) => {
                setHistoryMessageId(undefined);
                setEditing({ messageId: message.id, content });
              }}
              onEditChange={(content) => setEditing((current) =>
                current?.messageId === message.id ? { ...current, content } : current
              )}
              onCancelEdit={() => setEditing(undefined)}
              onConfirmEdit={async () => {
                if (!editing || editing.messageId !== message.id || !editing.content.trim()) return;
                setEditSaving(true);
                const pending = onEditUserMessage?.(message, editing.content.trim());
                setEditing(undefined);
                try {
                  await pending;
                } finally {
                  setEditSaving(false);
                }
              }}
              onToggleHistory={() => setHistoryMessageId((current) =>
                current === message.id ? undefined : message.id
              )}
              onContinueFromMessage={onContinueFromMessage}
              onCopyMessage={onCopyMessage}
              onRegenerate={onRegenerate}
              onOption={onOption}
              confirmation={message.id === confirmationMessageId ? confirmation : undefined}
              confirmationBusy={confirmationBusy}
              onConfirmation={onConfirmation}
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
            {onRegenerate && latestAssistantMessage ? (
              <button type="button" onClick={() => void onRegenerate(latestAssistantMessage)}>
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
  const cheapContextDiscovery = messages.length > 0
    && messages.every((message) => ["get_active_profile", "list_resumes", "list_jobs"].includes(message.toolName ?? ""));
  return (
    <details className={`agent-tool-status-row is-${running ? "running" : failed ? "failed" : "complete"}`} open={failed || undefined}>
      <summary role="status">
        <span className="agent-tool-status-icon" aria-hidden="true">
          <LoaderCircle className={`is-running is-spinning${running ? " is-visible" : ""}`} />
          <AlertCircle className={`is-failed${failed ? " is-visible" : ""}`} />
          <CheckCircle2 className={`is-complete${!running && !failed ? " is-visible" : ""}`} />
        </span>
        <strong>{running
          ? cheapContextDiscovery ? "正在加载简历和岗位信息" : "正在执行任务步骤"
          : failed
            ? "部分任务步骤需要处理"
            : cheapContextDiscovery ? "已加载简历和岗位信息" : `已完成 ${messages.length} 个任务步骤`}</strong>
      </summary>
      <ul className="agent-tool-activity-list">
        {messages.map((message) => {
          const state = message.metadata?.activityState ?? message.status;
          const failed = state === "failed";
          const running = state === "running" || state === "pending";
          return (
            <li key={message.id} className={failed ? "is-failed" : running ? "is-running" : "is-complete"}>
              <strong>{failed ? "未完成" : running ? "进行中" : "已完成"}</strong>
              <span>{toolStatus(message)}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export const AgentConversationTimeline = AgentConversation;

function AgentMessageRow({
  message,
  activity,
  editingContent,
  historyOpen,
  editSaving,
  onBeginEdit,
  onEditChange,
  onCancelEdit,
  onConfirmEdit,
  onToggleHistory,
  onContinueFromMessage,
  onCopyMessage,
  onRegenerate,
  onOption,
  confirmation,
  confirmationBusy,
  onConfirmation
}: {
  message: AgentMessage;
  activity?: AgentMessage[];
  editingContent?: string;
  historyOpen?: boolean;
  editSaving?: boolean;
  onBeginEdit(content: string): void;
  onEditChange(content: string): void;
  onCancelEdit(): void;
  onConfirmEdit(): void;
  onToggleHistory(): void;
  onContinueFromMessage?(message: AgentMessage): void;
  onCopyMessage?(message: AgentMessage): void;
  onRegenerate?(message: AgentMessage): Promise<void> | void;
  onOption?(option: AgentOption): void;
  confirmation?: AgentConfirmation;
  confirmationBusy?: boolean;
  onConfirmation?(confirmed: boolean): void;
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
      data-message-id={message.id}
      data-message-role={message.role}
      data-message-status={message.status ?? message.kind ?? "complete"}
    >
      {!isUser && activity?.length ? <AgentActivityGroup messages={activity} /> : null}
      <div className="agent-message-main">
        {!isUser ? <AgentAvatar role="assistant" /> : null}
        <div className="agent-message-stack">
          {isUser && editingContent !== undefined ? (
            <AgentInlineMessageEditor
              content={editingContent}
              saving={Boolean(editSaving)}
              onCancel={onCancelEdit}
              onChange={onEditChange}
              onConfirm={onConfirmEdit}
            />
          ) : (
            <AgentMessageBubble message={message} />
          )}
          {isUser && message.metadata?.executionState === "queued" ? (
            <small className="agent-message-queue-state" role="status">已排队</small>
          ) : null}
          {isUser && historyOpen ? (
            <AgentMessageVersionHistory
              message={message}
              onEditVersion={onBeginEdit}
              onClose={onToggleHistory}
            />
          ) : null}
          <AgentConfirmationResolution message={message} />
          {confirmation ? (
            <AgentConfirmationCard
              busy={confirmationBusy}
              title={confirmation.title}
              description={confirmation.description}
              destructive={confirmation.destructive}
              onCancel={() => onConfirmation?.(false)}
              onConfirm={() => onConfirmation?.(true)}
            />
          ) : null}
          {message.options?.length ? (
            <div className="agent-message-options" aria-label="可选回答">
              {message.options.map((option) => (
                <button key={option.id} type="button" onClick={() => onOption?.(option)}>
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {editingContent === undefined ? (
            <AgentMessageActions
              message={message}
              activity={activity}
              onBeginEdit={() => onBeginEdit(message.content)}
              onToggleHistory={onToggleHistory}
              onContinueFromMessage={onContinueFromMessage}
              onCopyMessage={onCopyMessage}
              onRegenerate={onRegenerate}
            />
          ) : null}
        </div>
        {isUser ? <AgentAvatar role="user" /> : null}
      </div>
    </article>
  );
}

function AgentConfirmationResolution({ message }: { message: AgentMessage }) {
  const resolution = message.metadata?.confirmationResolution;
  if (resolution !== "confirmed" && resolution !== "rejected" && resolution !== "superseded") return null;
  const confirmed = resolution === "confirmed";
  return (
    <div className={`agent-confirmation-resolution is-${resolution}`} role="status">
      {confirmed ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
      <span>
        {confirmed
          ? "您已确认"
          : resolution === "rejected"
            ? "您已取消"
            : "已根据您的纠正重新核对"}
      </span>
    </div>
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
      {message.role === "user" && message.references?.length ? (
        <div className="agent-message-reference">
          <strong>回复 AI</strong>
          <span>“{message.references[0].excerpt ?? "已引用一条回复"}”</span>
        </div>
      ) : null}
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

function AgentInlineMessageEditor(props: {
  content: string;
  saving: boolean;
  onCancel(): void;
  onChange(content: string): void;
  onConfirm(): void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.content]);

  return (
    <div className="agent-inline-message-editor">
      <label className="sr-only" htmlFor="agent-inline-message-edit">编辑消息</label>
      <textarea
        ref={textareaRef}
        id="agent-inline-message-edit"
        aria-label="编辑消息"
        autoFocus
        rows={1}
        value={props.content}
        disabled={props.saving}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <div className="agent-inline-message-editor-actions">
        <button type="button" disabled={props.saving} onClick={props.onCancel}>
          <X aria-hidden="true" />取消
        </button>
        <button
          className="is-primary"
          type="button"
          disabled={props.saving || !props.content.trim()}
          onClick={props.onConfirm}
        >
          <Check aria-hidden="true" />{props.saving ? "发送中…" : "确认并重发"}
        </button>
      </div>
    </div>
  );
}

function AgentMessageVersionHistory(props: {
  message: AgentMessage;
  onEditVersion(content: string): void;
  onClose(): void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(props.onClose);
  const titleId = `agent-message-history-${props.message.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  useEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);
  const versions = [
    {
      id: "current",
      content: props.message.content,
      createdAt: props.message.updatedAt ?? props.message.createdAt,
      current: true
    },
    ...[...(props.message.revisions ?? [])]
      .reverse()
      .map((revision) => ({ ...revision, current: false }))
  ];
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="agent-message-version-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) props.onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="agent-message-version-history"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <h2 id={titleId}>消息历史版本</h2>
            <p>查看这条消息的当前内容与此前版本。</p>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="关闭历史版本" onClick={props.onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <ol>
          {versions.map((version, index) => (
            <li key={version.id}>
              <div>
                <strong>{version.current ? "当前版本" : `历史版本 ${versions.length - index}`}</strong>
                <time dateTime={version.createdAt}>{formatMessageVersionTime(version.createdAt)}</time>
              </div>
              <p>{version.content}</p>
              {!version.current ? (
                <button type="button" onClick={() => props.onEditVersion(version.content)}>
                  恢复此版本并编辑
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>,
    document.body
  );
}

function formatMessageVersionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function AgentMessageActions({
  message,
  activity,
  onBeginEdit,
  onToggleHistory,
  onContinueFromMessage,
  onCopyMessage,
  onRegenerate
}: {
  message: AgentMessage;
  activity?: AgentMessage[];
  onBeginEdit(): void;
  onToggleHistory(): void;
  onContinueFromMessage?(message: AgentMessage): void;
  onCopyMessage?(message: AgentMessage): void;
  onRegenerate?(message: AgentMessage): Promise<void> | void;
}) {
  const isUser = message.role === "user";
  const disabled = isStreamingMessage(message);
  return (
    <div className="agent-message-actions" aria-label={isUser ? "用户消息操作" : "AI 消息操作"}>
      {isUser ? (
        <>
          <button type="button" title="编辑并重发" aria-label="编辑并重发" onClick={onBeginEdit}>
            <Edit3 aria-hidden="true" />
          </button>
          <button type="button" title="历史版本" aria-label="历史版本" onClick={onToggleHistory}>
            <History aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <button type="button" title="重新生成" aria-label="重新生成" disabled={disabled} onClick={() => void onRegenerate?.(message)}>
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
          onBeginEdit={onBeginEdit}
          onToggleHistory={onToggleHistory}
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
  onBeginEdit,
  onToggleHistory,
  onContinueFromMessage,
  onCopyMessage
}: {
  message: AgentMessage;
  activity?: AgentMessage[];
  disabled: boolean;
  onBeginEdit(): void;
  onToggleHistory(): void;
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
            <button type="button" role="menuitem" disabled={disabled} onClick={() => run(onBeginEdit)}>
              编辑并重新发送
            </button>
            <button type="button" role="menuitem" disabled={disabled} onClick={() => run(onToggleHistory)}>
              查看历史版本
            </button>
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
    create_resume_from_profile: "独立通用简历已创建",
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
  if (looksLikeInternalAgentPayload(text)) {
    return "我已完成必要的内部核对，但不会展示内部工具或 JSON。请直接告诉我想处理的求职任务。";
  }
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text || "我已经收到。请继续补充你的真实情况，我会按步骤和你核对。";
}

function looksLikeInternalAgentPayload(text: string) {
  const candidate = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    return typeof record.tool === "string"
      || typeof record.toolName === "string"
      || typeof record.tool_name === "string"
      || (typeof record.input === "object" && record.input !== null && ("tool" in record || "name" in record));
  } catch {
    return /(?:^|\n)\s*[\[{]\s*["'](?:tool|toolName|tool_name|function)["']\s*:/i.test(text);
  }
}
