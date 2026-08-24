import type { AgentStreamEvent } from "@/agent/runtime/agentSse";
import type { AbortTrace } from "./hermes/hermesIncidentTrace";

export type SessionExecutionStatus =
  | "running"
  | "waiting_for_confirmation"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "paused";

export type TurnControllerState =
  | "idle"
  | "pending_start"
  | "running"
  | "waiting_for_user"
  | "interrupting"
  | "completed"
  | "failed";

export type TurnOperationKind = "user_turn" | "retry" | "regenerate" | "runtime_continuation";

export type SessionExecution = {
  sessionId: string;
  controller: AbortController;
  promise?: Promise<unknown>;
  status: SessionExecutionStatus;
  activeTurnId?: string;
  operationId?: string;
  startedAt: string;
  lastProgressAt: string;
  stalled: boolean;
  streamEvents: AgentStreamEvent[];
  pendingInputCount: number;
  generation: number;
};

export type TurnOperation = {
  sessionId: string;
  operationId: string;
  turnId?: string;
  kind: TurnOperationKind;
  state: TurnControllerState;
  controller: AbortController;
  cancelled?: boolean;
  /** A stable receipt promise is available before the real async work starts. */
  promise: Promise<unknown>;
  actualPromise?: Promise<unknown>;
  startedAt: string;
  generation?: number;
};

export type TurnOperationClaim = {
  accepted: boolean;
  existing: boolean;
  operation: TurnOperation;
};

type Deferred = {
  promise: Promise<unknown>;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
};

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function isLiveState(state: TurnControllerState) {
  return state === "pending_start" || state === "running" || state === "waiting_for_user" || state === "interrupting";
}

/**
 * The single session-scoped lifecycle owner.
 *
 * `executions` preserves the existing stream/abort instrumentation API. The
 * operation registry is the Codex-style pending-start/single-flight layer
 * above it: it is claimed synchronously and therefore exists before a fetch,
 * Hermes run_start, or any other asynchronous preflight can begin.
 */
export class TurnController {
  readonly executions = new Map<string, SessionExecution>();
  readonly operations = new Map<string, TurnOperation>();
  private readonly activeOperationBySession = new Map<string, string>();
  private readonly deferredByOperation = new Map<string, Deferred>();
  private nextGeneration = 0;

  claim(input: {
    sessionId: string;
    operationId: string;
    kind: TurnOperationKind;
    turnId?: string;
    startedAt?: string;
  }): TurnOperationClaim {
    const current = this.operations.get(input.operationId);
    if (current) {
      return { accepted: false, existing: true, operation: current };
    }

    const activeId = this.activeOperationBySession.get(input.sessionId);
    const active = activeId ? this.operations.get(activeId) : undefined;
    if (active && isLiveState(active.state)) {
      return { accepted: false, existing: false, operation: active };
    }

    for (const [operationId, operation] of this.operations) {
      if (operation.sessionId === input.sessionId && !isLiveState(operation.state)) {
        this.operations.delete(operationId);
        this.deferredByOperation.delete(operationId);
      }
    }

    const pending = deferred();
    const operation: TurnOperation = {
      sessionId: input.sessionId,
      operationId: input.operationId,
      turnId: input.turnId,
      kind: input.kind,
      state: "pending_start",
      controller: new AbortController(),
      promise: pending.promise,
      startedAt: input.startedAt ?? new Date().toISOString()
    };
    this.operations.set(input.operationId, operation);
    this.deferredByOperation.set(input.operationId, pending);
    this.activeOperationBySession.set(input.sessionId, input.operationId);
    return { accepted: true, existing: false, operation };
  }

  getOperation(operationId: string) {
    return this.operations.get(operationId);
  }

  isCancelled(operationId: string) {
    return this.operations.get(operationId)?.cancelled === true;
  }

  getActiveOperation(sessionId: string) {
    const operationId = this.activeOperationBySession.get(sessionId);
    return operationId ? this.operations.get(operationId) : undefined;
  }

  attachOperationPromise(operationId: string, promise: Promise<unknown>) {
    const operation = this.operations.get(operationId);
    const receipt = this.deferredByOperation.get(operationId);
    if (!operation || !receipt) return operation;
    operation.actualPromise = promise;
    if (operation.state === "pending_start") operation.state = "running";
    void promise.then(receipt.resolve, receipt.reject);
    return operation;
  }

  setOperationState(operationId: string, state: TurnControllerState) {
    const operation = this.operations.get(operationId);
    if (operation) operation.state = state;
    return operation;
  }

  getState(sessionId: string): TurnControllerState {
    return this.getActiveOperation(sessionId)?.state ?? "idle";
  }

  begin(input: {
    sessionId: string;
    activeTurnId?: string;
    startedAt?: string;
    pendingInputCount?: number;
    operationId?: string;
    controller?: AbortController;
  }) {
    const now = input.startedAt ?? new Date().toISOString();
    const operation = input.operationId ? this.operations.get(input.operationId) : undefined;
    const execution: SessionExecution = {
      sessionId: input.sessionId,
      controller: input.controller ?? operation?.controller ?? new AbortController(),
      status: "running",
      activeTurnId: input.activeTurnId,
      operationId: input.operationId,
      startedAt: now,
      lastProgressAt: now,
      stalled: false,
      streamEvents: [],
      pendingInputCount: input.pendingInputCount ?? 0,
      generation: ++this.nextGeneration
    };
    this.executions.set(input.sessionId, execution);
    if (operation) {
      operation.generation = execution.generation;
      operation.turnId = input.activeTurnId ?? operation.turnId;
      if (operation.state === "pending_start") operation.state = "running";
    }
    return execution;
  }

  attachPromise(sessionId: string, promise: Promise<unknown>) {
    const execution = this.executions.get(sessionId);
    if (execution) {
      execution.promise = promise;
      if (execution.operationId) this.attachOperationPromise(execution.operationId, promise);
    }
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
    const operation = this.getActiveOperation(sessionId);
    if (operation) {
      operation.state = status === "waiting_for_user"
        ? "waiting_for_user"
        : status === "failed"
          ? "failed"
          : status === "completed" || status === "paused" ? "completed" : "running";
    }
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
    const operation = this.getActiveOperation(sessionId);
    if (operation && isLiveState(operation.state)) {
      operation.cancelled = true;
      operation.state = "interrupting";
      operation.controller.abort(reason);
      if (!operation.actualPromise) {
        operation.state = "completed";
        this.deferredByOperation.get(operation.operationId)?.resolve(undefined);
        if (this.activeOperationBySession.get(sessionId) === operation.operationId) {
          this.activeOperationBySession.delete(sessionId);
        }
      }
    }
    const execution = this.executions.get(sessionId);
    execution?.controller.abort(reason);
    return execution ?? operation;
  }

  finish(sessionId: string, status?: SessionExecutionStatus, generation?: number, operationId?: string) {
    const execution = this.executions.get(sessionId);
    if (execution && generation !== undefined && execution.generation !== generation) return execution;
    if (execution && status) execution.status = status;
    if (execution) execution.stalled = false;
    if (execution) this.executions.delete(sessionId);

    const activeId = operationId ?? execution?.operationId ?? this.activeOperationBySession.get(sessionId);
    const operation = activeId ? this.operations.get(activeId) : undefined;
    if (operation && (generation === undefined || operation.generation === undefined || operation.generation === generation)) {
      // A lower-level runtime may first publish the failed terminal state and
      // then call the shared cleanup path without a status argument. Cleanup
      // must not erase that failure as "completed".
      operation.state = status === "failed" || operation.state === "failed" ? "failed" : "completed";
      if (!operation.actualPromise) this.resolveOperation(operation.operationId, undefined);
      this.deferredByOperation.delete(operation.operationId);
      if (this.activeOperationBySession.get(sessionId) === operation.operationId) {
        this.activeOperationBySession.delete(sessionId);
      }
    }
    return execution ?? operation;
  }

  private resolveOperation(operationId: string, value: unknown) {
    this.deferredByOperation.get(operationId)?.resolve(value);
  }
}
