import { ArrowLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentMarkdown } from "./AgentMarkdown";
import { activeBranchMessages } from "@/agent/runtime/activeBranchContext";
import { getAgentSessionDisplayTitle, type AgentSession } from "@/agent/contracts/agentSession";

export function AgentHistoryDialog(props: {
  open: boolean;
  sessions: AgentSession[];
  onClose(): void;
  onSelect(session: AgentSession): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => previous?.focus();
  }, [props.open]);
  const [query, setQuery] = useState("");
  const [inspection, setInspection] = useState<{ sessionId: string; branchId: string }>();
  const inspectedSession = props.sessions.find((session) => session.id === inspection?.sessionId);
  const inspectedBranch = inspectedSession?.conversationBranches.find((branch) => branch.id === inspection?.branchId);
  // A read-only projection: historical retraction hides old context from the
  // model, but must not hide it from the user inspecting a previous branch.
  const inspectedMessages = inspectedSession && inspectedBranch ? activeBranchMessages({
    ...inspectedSession, activeBranchId: inspectedBranch.id, activeHeadMessageId: inspectedBranch.headMessageId,
    messages: inspectedSession.messages.map((message) => ({ ...message,
      metadata: { ...message.metadata, retracted: false, branchMessageState: undefined }
    }))
  }).filter((message) => (message.role === "user" || message.role === "assistant") && !["tool_status", "assistant_thinking"].includes(message.kind ?? message.type ?? "")) : [];

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return props.sessions;
    return props.sessions.filter((session) => [
      getAgentSessionDisplayTitle(session),
      session.title,
      session.conversationSummary,
      ...session.messages.map((message) => message.content)
    ].join("\n").toLowerCase().includes(normalizedQuery));
  }, [props.sessions, query]);

  if (!props.open) return null;
  return (
    <div className="agent-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) props.onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="agent-history-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-history-title" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); props.onClose(); }
        if (event.key !== "Tab") return;
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input, select")];
        const first = focusable[0]; const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <header>
          <h2 id="agent-history-title">历史记录</h2>
          <button className="icon-button" type="button" aria-label="关闭历史记录" onClick={props.onClose}>×</button>
        </header>
        {inspectedSession ? <div className="agent-history-inspection">
          <button type="button" onClick={() => setInspection(undefined)}><ArrowLeft aria-hidden="true" />返回任务列表</button>
          <label>查看会话分支
            <select aria-label="查看会话分支" value={inspection?.branchId} onChange={(event) => setInspection({ sessionId: inspectedSession.id, branchId: event.target.value })}>
              {inspectedSession.conversationBranches.map((branch, index) => <option key={branch.id} value={branch.id}>{branch.id === inspectedSession.activeBranchId ? "当前分支" : `历史分支 ${index + 1}`}</option>)}
            </select>
          </label>
          <p>只读历史记录，当前任务与执行上下文保持不变。</p>
          <div className="agent-history-transcript" aria-label="分支历史记录">
            {inspectedMessages.map((message) => <article key={message.id} data-history-message-id={message.id}>
              <strong>{message.role === "user" ? "你" : "AI 助手"}</strong>
              <AgentMarkdown>{message.content}</AgentMarkdown>
            </article>)}
          </div>
        </div> : <>
        <label className="agent-history-search">
          <Search aria-hidden="true" />
          <span className="sr-only">搜索历史记录</span>
          <input
            name="agent-history-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索历史记录…"
            aria-label="搜索历史记录"
          />
        </label>
        <div className="agent-history-list">
          {props.sessions.length === 0 ? <p>还没有保存的 AI 任务。</p> : filteredSessions.length === 0 ? <p>没有找到匹配的历史记录。</p> : filteredSessions.map((session) => (
            <div className="agent-history-entry" key={session.id} data-history-session-id={session.id}>
              <button type="button" onClick={() => props.onSelect(session)}>
                <strong>{getAgentSessionDisplayTitle(session)}</strong>
                <span>{session.workflowState?.status ?? "conversation"} · {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.updatedAt))}</span>
              </button>
              <button type="button" aria-label={`查看分支：${getAgentSessionDisplayTitle(session)}`} onClick={() => setInspection({ sessionId: session.id, branchId: session.activeBranchId })}>查看记录与分支</button>
            </div>
          ))}
        </div>
        </>}
      </section>
    </div>
  );
}
