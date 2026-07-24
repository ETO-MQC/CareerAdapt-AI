export function AgentConfirmationCard(props: {
  title: string;
  description: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <section className={`agent-confirmation ${props.destructive ? "agent-confirmation-destructive" : ""}`} aria-labelledby="agent-confirmation-title">
      <div>
        <p className="eyebrow">需要确认</p>
        <h3 id="agent-confirmation-title">{props.title}</h3>
        <p>{props.description}</p>
      </div>
      <div className="agent-confirmation-actions">
        <button className="secondary-button" type="button" disabled={props.busy} onClick={props.onCancel}>取消</button>
        <button className="primary-button" type="button" disabled={props.busy} onClick={props.onConfirm}>
          {props.busy ? "处理中…" : "确认并继续"}
        </button>
      </div>
    </section>
  );
}
