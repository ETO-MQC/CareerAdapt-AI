import type { AgentStreamEvent } from "@/agent/runtime/agentSse";
import type { AbortTrace } from "./hermes/hermesIncidentTrace";

export type SessionExecutionStatus =
  | "running"
  | "waiting_for_confirmation"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "paused";

export type SessionExecution = {
  sessionId: string;
  controller: AbortController;
  promise?: Promise<unknown>;
  status: SessionExecutionStatus;
  activeTurnId?: string;
  startedAt: string;
  lastProgressAt: string;
  stalled: boolean;
  streamEvents: AgentStreamEvent[];
  pendingInputCount: number;
  generation: number;
};

/**
 * Boundary for a future Tauri/Rust runner. The browser implementation keeps
 * the same session-scoped contract while its fetches remain browser-bound.
 */
export type AgentExecutionAdapter = {
  run?(input: { sessionId: string; turnId?: string; signal: AbortSignal }): Promise<unknown>;
  recover?(input: { sessionId: string; checkpoint?: unknown }): Promise<unknown>;
};

export class AgentExecutionCoordinator {
  readonly executions = new Map<string, SessionExecution>();
  private nextGeneration = 0;

  begin(input: {
    sessionId: string;
    activeTurnId?: string;
    startedAt?: string;
    pendingInputCount?: number;
  }) {
    const now = input.startedAt ?? new Date().toISOString();
    const execution: SessionExecution = {
      sessionId: input.sessionId,
      controller: new AbortController(),
      status: "running",
      activeTurnId: input.activeTurnId,
      startedAt: now,
      lastProgressAt: now,
      stalled: false,
      streamEvents: [],
      pendingInputCount: input.pendingInputCount ?? 0,
      generation: ++this.nextGeneration
    };
    this.executions.set(input.sessionId, execution);
    return execution;
  }

  attachPromise(sessionId: string, promise: Promise<unknown>) {
    const execution = this.executions.get(sessionId);
    if (execution) execution.promise = promise;
    return execution;
  }

  get(sessionId: string) {
    return this.executions.get(sessionId);
  }

  isRunning(sessionId: string) {
    return this.executions.get(sessionId)?.status === "running";
  }

  isCurrent(sessionId: string, generation: number) {
    const execution = this.executions.get(sessionId);
    return Boolean(execution && execution.generation === generation);
  }

  setStatus(sessionId: string, status: SessionExecutionStatus) {
    const execution = this.executions.get(sessionId);
    if (execution) execution.status = status;
    return execution;
  }

  markProgress(sessionId: string, at = new Date().toISOString()) {
    const execution = this.executions.get(sessionId);
    if (!execution) return;
    execution.lastProgressAt = at;
    execution.stalled = false;
    return execution;
  }

  appendStreamEvent(sessionId: string, event: AgentStreamEvent) {
    const execution = this.executions.get(sessionId);
    if (!execution) return;
    execution.streamEvents = [...execution.streamEvents, event].slice(-200);
    return execution;
  }

  setPendingInputCount(sessionId: string, count: number) {
    const execution = this.executions.get(sessionId);
    if (execution) execution.pendingInputCount = count;
  }

  markStalled(sessionId: string, stalled: boolean) {
    const execution = this.executions.get(sessionId);
    if (execution) execution.stalled = stalled;
  }

  interrupt(sessionId: string, reason?: AbortTrace | Record<string, unknown>) {
    const execution = this.executions.get(sessionId);
    execution?.controller.abort(reason);
    return execution;
  }

  finish(sessionId: string, status?: SessionExecutionStatus, generation?: number) {
    const execution = this.executions.get(sessionId);
    if (!execution) return;
    // A stale promise can settle after the next queued turn has claimed the
    // same session. Only the matching generation may clean up the record.
    if (generation !== undefined && execution.generation !== generation) return execution;
    if (status) execution.status = status;
    execution.stalled = false;
    // Terminal executions no longer own a live controller or stream.  Drop
    // the session-scoped entry immediately so a long-lived workspace cannot
    // retain completed promises and stream history indefinitely.
    this.executions.delete(sessionId);
    return execution;
  }
}
