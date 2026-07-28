export function AgentConfirmationCard(props: {
  title: string;
  description: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <section className={`agent-confirmation is-inline ${props.destructive ? "agent-confirmation-destructive" : ""}`} aria-labelledby="agent-confirmation-title">
      <div>
        <h3 id="agent-confirmation-title">{props.title}</h3>
        <p>{props.description}</p>
      </div>
      <div className="agent-confirmation-actions">
        <button type="button" disabled={props.busy} onClick={props.onCancel}>取消</button>
        <button className="is-confirm" type="button" disabled={props.busy} onClick={props.onConfirm}>
          {props.busy ? "处理中…" : "确认"}
        </button>
      </div>
    </section>
  );
}
