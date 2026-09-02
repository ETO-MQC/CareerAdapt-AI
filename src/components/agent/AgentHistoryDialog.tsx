import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { getAgentSessionDisplayTitle, type AgentSession } from "@/agent/contracts/agentSession";

export function AgentHistoryDialog(props: {
  open: boolean;
  sessions: AgentSession[];
  onClose(): void;
  onSelect(session: AgentSession): void;
}) {
  const [query, setQuery] = useState("");

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
      <section className="agent-history-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-history-title">
        <header>
          <h2 id="agent-history-title">历史记录</h2>
          <button className="icon-button" type="button" aria-label="关闭历史记录" onClick={props.onClose}>×</button>
        </header>
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
            <button type="button" key={session.id} onClick={() => props.onSelect(session)}>
              <strong>{getAgentSessionDisplayTitle(session)}</strong>
              <span>{session.workflowState?.status ?? "conversation"} · {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.updatedAt))}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
