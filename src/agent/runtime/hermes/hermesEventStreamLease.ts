export type EventStreamLeaseState = "opening" | "active" | "closed" | "failed";

export type EventStreamLease = {
  runId: string;
  consumerId: string;
  sessionId: string;
  logicalTurnId: string;
  openedAt: string;
  state: EventStreamLeaseState;
  lastEventAt?: string;
  closedAt?: string;
  failureCode?: string;
};

export class EventStreamLeaseConflictError extends Error {
  readonly code = "hermes_event_stream_active";
  readonly retryable = true;

  constructor(readonly activeLease: EventStreamLease) {
    super("当前 Hermes run 已有活动事件消费者；静默期间不会创建第二个事件流。");
  }
}

/** At most one active consumer for session + logical turn + run. */
export class EventStreamLeaseRegistry {
  private readonly leases = new Map<string, EventStreamLease>();

  acquire(input: { runId: string; consumerId: string; sessionId: string; logicalTurnId: string }) {
    const key = leaseKey(input.sessionId, input.logicalTurnId, input.runId);
    const current = this.leases.get(key);
    if (current && (current.state === "opening" || current.state === "active")) {
      throw new EventStreamLeaseConflictError(current);
    }
    const lease: EventStreamLease = {
      ...input,
      openedAt: new Date().toISOString(),
      state: "opening"
    };
    this.leases.set(key, lease);
    return lease;
  }

  activate(lease: EventStreamLease) {
    return this.update(lease, { state: "active" });
  }

  touch(lease: EventStreamLease) {
    return this.update(lease, { lastEventAt: new Date().toISOString() });
  }

  close(lease: EventStreamLease) {
    return this.update(lease, { state: "closed", closedAt: new Date().toISOString() });
  }

  fail(lease: EventStreamLease, failureCode: string) {
    return this.update(lease, { state: "failed", failureCode, closedAt: new Date().toISOString() });
  }

  get(sessionId: string, logicalTurnId: string, runId: string) {
    return this.leases.get(leaseKey(sessionId, logicalTurnId, runId));
  }

  private update(lease: EventStreamLease, patch: Partial<EventStreamLease>) {
    const key = leaseKey(lease.sessionId, lease.logicalTurnId, lease.runId);
    const current = this.leases.get(key);
    if (!current || current.consumerId !== lease.consumerId) return lease;
    const next = { ...current, ...patch };
    this.leases.set(key, next);
    Object.assign(lease, next);
    return next;
  }
}

function leaseKey(sessionId: string, logicalTurnId: string, runId: string) {
  return `${sessionId}\u001f${logicalTurnId}\u001f${runId}`;
}

