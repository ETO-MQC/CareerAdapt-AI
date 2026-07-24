import type { AgentSession } from "@/agent/contracts/agentSession";

export function AgentHistoryDialog(props: {
  open: boolean;
  sessions: AgentSession[];
  onClose(): void;
  onSelect(session: AgentSession): void;
}) {
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
        <div className="agent-history-list">
          {props.sessions.length === 0 ? <p>还没有保存的 AI 任务。</p> : props.sessions.map((session) => (
            <button type="button" key={session.id} onClick={() => props.onSelect(session)}>
              <strong>{session.title}</strong>
              <span>{session.workflowState.status} · {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.updatedAt))}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
