"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { AgentEventBus } from "@/agent/runtime/agentEventBus";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { AgentHostStore, getActiveTailoringQuestionProjection, type TailoringAnswerBinding } from "@/agent/runtime/AgentHostStore";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { CareerToolGateway, CareerToolGatewayExecutor, type CareerToolContract } from "@/agent/tools/CareerToolGateway";
import { AgentRuntimeEventBus } from "@/agent/runtime/agentRuntimeEventBus";
import type { AgentRuntimeTurnInput } from "@/agent/runtime/agentRuntime";
import type { RuntimeUserEvent } from "@/agent/runtime/RuntimeUserEvent";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import { HttpHermesBridgeTransport, toRuntimeHealth } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { CareerAdaptMcpBridgeClient } from "@/agent/mcp/CareerAdaptMcpBridgeClient";
import { RuntimeStatusStore } from "@/agent/runtime/runtimeStatus";
import { resolveCareerSessionBinding, type CareerSessionBinding } from "@/agent/runtime/careerSessionBinding";
import { WorkspaceRepository } from "@/services/storage/repositories";
import {
  notifyHermesRendererReady,
  readHermesStartSettings,
  requestHermesStart,
  subscribeHermesStatus
} from "@/services/agent/hermesControl";
import {
  isHermesRuntimeFailureCode,
  type HermesFailureLayer,
  type HermesRunFailureInput
} from "@/agent/runtime/hermes/hermesRunReliability";
import { isCareerDomainPreconditionCode } from "@/agent/runtime/careerContextBindingResolver";
import { createIncidentTraceId, createRunStopReason, type RuntimeFailureSnapshot, type RunStopReason } from "@/agent/runtime/hermes/hermesIncidentTrace";

function createAgentHost() {
  const repository = new WorkspaceRepository();
  const service = new BrowserAgentToolService(repository);
  const registry = createAgentToolRegistry(service);
  const rawExecutor = new AgentExecutor(registry);
  const hostStateRef: { current?: AgentHostStore } = {};
  const careerToolGateway = new CareerToolGateway({
    registry,
    executor: rawExecutor,
    verifySessionBinding: async (binding, input) => verifyBrowserCareerBinding(repository, binding, input),
    getAuthoritativeTaskState: () => hostStateRef.current?.getSnapshot().activeSession?.taskState,
    getUserMessageForTurn: (turnId) => hostStateRef.current?.getUserMessageForTurn(turnId)
  });
  const executor = new CareerToolGatewayExecutor(registry, careerToolGateway);
  const store = new AgentSessionStore(repository);
  const runtimeEventBus = new AgentRuntimeEventBus();
  const state = new AgentHostStore({ executor, persistence: store, repository: store.getWorkspaceRepository() });
  hostStateRef.current = state;
  const hermesTransport = new HttpHermesBridgeTransport();
  const hermesRuntime = new HermesCareerAgentRuntime({
    transport: hermesTransport,
    careerToolGateway
  });
  const runtimeStatus = new RuntimeStatusStore({
    preferredRuntime: "hermes",
    activeRuntime: "hermes",
    status: "starting",
    mcpServer: "careeradapt",
    mcpConnected: false,
    discoveredToolCount: 0,
    resumePreviewAvailable: careerToolGateway.listContracts().some((contract) => contract.name === "career.tailoring.preview_changes" || contract.name === "career.preview.review_diff"),
    pdfExportAvailable: careerToolGateway.listContracts().some((contract) => contract.name === "career.export.resume")
  });
  const mcpBridge = new CareerAdaptMcpBridgeClient();
  let healthRefreshInFlight: Promise<Awaited<ReturnType<typeof hermesRuntime.health>>> | undefined;
  const refreshHermesHealth = async () => {
    if (healthRefreshInFlight) return healthRefreshInFlight;
    healthRefreshInFlight = (async () => {
      let health: Awaited<ReturnType<typeof hermesRuntime.health>> | undefined;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        health = await hermesRuntime.health();
        if (health.available || attempt === 3) break;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      if (!health) throw new Error("hermes_health_empty");
      const runtimeHealth = toRuntimeHealth(health, {
        mcpConnected: health.mcpConnected ?? false,
        mcpToolCount: health.discoveredToolCount ?? 0,
        careerSkillsLoaded: health.runtimeHealth?.careerSkillsLoaded ?? false
      });
      runtimeStatus.recordHealth(runtimeHealth);
      runtimeStatus.update({
        version: health.version,
        ...(runtimeStatus.getSnapshot().supervisorOwned ? {} : { provider: health.provider }),
        mcpServer: health.mcpServer ?? "careeradapt",
        health: runtimeHealth,
        roadshowMode: health.roadshowMode === true
      });
      return health;
    })();
    try {
      return await healthRefreshInFlight;
    } finally {
      healthRefreshInFlight = undefined;
    }
  };
  const startHermes = async () => {
    runtimeStatus.update({ status: "starting", activeRuntime: "hermes", reason: "hermes_starting" });
    try {
      const result = await requestHermesStart();
      if (result.snapshot) runtimeStatus.recordSupervisorStatus(result.snapshot);
      if (!result.ok) return { ok: false as const, reason: result.reason ?? "hermes_companion_start_failed" };
      let health: Awaited<ReturnType<typeof hermesRuntime.health>> | undefined;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          health = await refreshHermesHealth();
          if (health.available) break;
        } catch {
          // The companion may still be completing its startup handshake.
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      if (!health?.available) {
        if (result.snapshot) return { ok: true as const, reason: result.reason };
        throw new Error("hermes_companion_not_ready");
      }
      return { ok: true as const };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "hermes_companion_start_failed";
      if (!runtimeStatus.getSnapshot().supervisorOwned) {
        runtimeStatus.update({ status: "unavailable", activeRuntime: "hermes", reason });
      }
      return { ok: false as const, reason };
    }
  };
  const shouldKeepHermesSessionBinding = (sessionId: string) => {
    const session = state.getSnapshot().activeSession;
    if (!session || session.id !== sessionId) return false;
    return session.activeTurn?.status === "waiting_for_user"
      || session.activeTurn?.status === "waiting_for_confirmation"
      || Boolean(session.pendingConfirmation)
      || session.taskState?.completionStatus === "waiting_for_user"
      || session.taskState?.completionStatus === "waiting_for_confirmation"
      || ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun?.status ?? "");
  };
  const runtimeOperationId = (input: AgentRuntimeTurnInput) => {
    const supplied = input.metadata?.turnOperationId;
    if (typeof supplied === "string" && supplied.trim()) return supplied;
    const reattach = input.metadata?.reattachRunId;
    if (typeof reattach === "string" && reattach.trim()) return `reattach:${input.sessionId}:${reattach}`;
    return `turn:${input.sessionId}:${crypto.randomUUID()}`;
  };
  const runtimeOperationKind = (input: AgentRuntimeTurnInput): "user_turn" | "retry" | "regenerate" | "runtime_continuation" => {
    if (input.metadata?.turnOperationKind === "retry") return "retry";
    if (input.metadata?.turnOperationKind === "regenerate") return "regenerate";
    if (input.metadata?.turnOperationKind === "user_turn") return "user_turn";
    return "runtime_continuation";
  };
  const runTurn = (input: AgentRuntimeTurnInput): Promise<AgentSession | undefined> => {
    const operationId = runtimeOperationId(input);
    const claimed = input.metadata?.turnOperationClaimed === true;
    const claim = claimed
      ? undefined
      : state.claimTurnOperation({
          sessionId: input.sessionId,
          operationId,
          kind: runtimeOperationKind(input),
          turnId: input.turnId
        });
    // A different operation id can lose the session-scoped single-flight
    // race to an already active operation. In that case `claim.operation` is
    // the authoritative receipt; the requested id is intentionally absent
    // from the registry.
    if (claim && !claim.accepted) return claim.operation.promise as Promise<AgentSession | undefined>;
    const operation = state.getTurnOperation(operationId);
    if (!operation) throw new Error("turn_operation_claim_missing");
    if (operation.cancelled) {
      state.finishTurnOperation(operationId);
      return Promise.resolve(state.getSnapshot().activeSession);
    }
    const promise = runTurnOnce({
      ...input,
      signal: input.signal ? AbortSignal.any([input.signal, operation.controller.signal]) : operation.controller.signal,
      metadata: {
        ...(input.metadata ?? {}),
        turnOperationId: operationId,
        turnOperationKind: operation.kind,
        turnOperationClaimed: true
      }
    }).then(
      (result) => {
        state.finishTurnOperation(operationId);
        return result;
      },
      (error) => {
        state.finishTurnOperation(operationId, "failed");
        throw error;
      }
    );
    state.attachTurnOperation(operationId, promise);
    return promise;
  };
  const runTurnOnce = async (input: AgentRuntimeTurnInput) => {
    const controllerState = state.getTurnControllerState(input.sessionId);
    const activeOperation = typeof input.metadata?.turnOperationId === "string"
      ? state.getTurnOperation(input.metadata.turnOperationId)
      : undefined;
    input = {
      ...input,
      metadata: {
        ...(input.metadata ?? {}),
        requestState: controllerState,
        controllerState,
        ...(activeOperation?.state === "pending_start" && activeOperation.turnId ? { existingPendingTurnId: activeOperation.turnId } : {}),
        ...(input.session?.activeTurn?.id ? { existingActiveTurnId: input.session.activeTurn.id } : {})
      }
    };
    // The UI consumes one stable event protocol. Hermes is the sole semantic
    // production runtime; this host only owns persistence and presentation.
    const runtime = hermesRuntime;
    const runtimeUserEvent = input.metadata?.runtimeUserEvent as RuntimeUserEvent | undefined;
    const incidentTraceId = typeof input.metadata?.incidentTraceId === "string" && input.metadata.incidentTraceId.trim()
      ? input.metadata.incidentTraceId
      : createIncidentTraceId();
    // Normal text is intentionally passed through unchanged. A task/workflow
    // exists only after Hermes invokes a Career facade or the user starts an
    // explicit workflow action.
    const runtimeTaskPrepared = false;
    const runtimeRequest = input;
    const canStartHermesShell = runtime.id === "hermes"
      && (Boolean(runtimeRequest.userMessage.trim()) || Boolean(runtimeUserEvent))
      && Boolean(runtimeRequest.session);
    const reattachingHermesRun = runtime.id === "hermes"
      && Boolean(input.session?.hermesRun)
      && ["queued", "running", "waiting_for_approval", "stopping"].includes(input.session?.hermesRun?.status ?? "")
      && !input.userMessage.trim()
      && input.metadata?.reattachRunId === input.session?.hermesRun?.runId
      && (input.turnId ?? input.session?.activeTurn?.id) === input.session?.hermesRun?.turnId;
    const reattachAssistant = reattachingHermesRun
      ? input.session?.messages.findLast((message) =>
          message.role === "assistant"
          && message.turnId === input.session?.hermesRun?.turnId
          && (!input.session?.activeTurn?.visibleAssistantMessageId || message.id === input.session.activeTurn.visibleAssistantMessageId)
        )
      : undefined;
    const reattachedAttempt = reattachingHermesRun
      ? input.session?.activeTurn?.runtimeAttempts?.find((attempt) => attempt.runId === input.session?.hermesRun?.runId)
      : undefined;
    const existingAttemptNumbers = runtimeRequest.session?.activeTurn?.runtimeAttempts?.map((attempt) => attempt.attemptNumber) ?? [];
    const requestedAttemptNumber = typeof input.metadata?.attemptNumber === "number" && Number.isInteger(input.metadata.attemptNumber)
      ? Math.max(1, input.metadata.attemptNumber)
      : Math.max(1, ...existingAttemptNumbers.map((value) => value + 1));
    const attemptNumber = reattachedAttempt?.attemptNumber ?? requestedAttemptNumber;
    const attemptTraceId = typeof input.metadata?.attemptTraceId === "string" && input.metadata.attemptTraceId.trim()
      ? input.metadata.attemptTraceId
      : reattachedAttempt?.traceId ?? `${incidentTraceId}:attempt-${Math.max(1, attemptNumber)}`;
    const runtimeShellTurnId = runtimeRequest.turnId
      ?? (reattachingHermesRun ? runtimeRequest.session?.hermesRun?.turnId : undefined);
    const claimedOperation = typeof runtimeRequest.metadata?.turnOperationId === "string"
      ? state.getTurnOperation(runtimeRequest.metadata.turnOperationId)
      : undefined;
    if (input.signal?.aborted || claimedOperation?.cancelled) {
      return state.getSnapshot().activeSession ?? runtimeRequest.session;
    }
    const runtimeShell = canStartHermesShell && runtimeRequest.session
        ? await state.beginRuntimeShell({
            session: runtimeRequest.session,
            userMessage: runtimeRequest.userMessage,
            runtimeId: "hermes",
            turnId: runtimeShellTurnId,
            signal: input.signal,
            ...(typeof input.metadata?.prePersistedUserMessageId === "string"
            ? { userMessageId: input.metadata.prePersistedUserMessageId, appendUserMessage: false }
            : {}),
          runtimeDiagnostics: {
            preferredRuntime: "hermes",
            attemptedRuntime: "hermes",
            finalRuntime: "hermes",
            fallbackUsed: false,
            incidentTraceId,
            hermesRunId: runtimeRequest.session.activeTurn?.hermesRunId,
            nextHermesRunId: runtimeRequest.session.activeTurn?.nextHermesRunId,
            runtimeAttempts: runtimeRequest.session.activeTurn?.runtimeAttempts ?? [],
            primaryCausalChain: runtimeRequest.session.activeTurn?.primaryCausalChain,
            secondaryRecoveryFailures: runtimeRequest.session.activeTurn?.secondaryRecoveryFailures,
            runtimeFailureDiagnostics: runtimeRequest.session.activeTurn?.runtimeFailureDiagnostics,
            runtimeFailureAt: runtimeRequest.session.activeTurn?.runtimeFailureAt,
            runtimeFailureSnapshot: runtimeRequest.session.activeTurn?.runtimeFailureSnapshot,
            ...(input.metadata?.recoveryReason && typeof input.metadata.recoveryReason === "string" ? { recoveryAttempted: true } : {}),
            turnStartSnapshot: runtimeStartSnapshot(runtimeStatus.getSnapshot()),
            recoveryAttempted: input.metadata?.runtimeRecoveryAttempted === true
              || input.metadata?.transportReattachAttempted === true
              || input.metadata?.semanticRetryAttempted === true,
            executionOwner: input.metadata?.executionOwner === "deterministic_transition"
              ? "deterministic_transition"
              : runtimeUserEvent ? "runtime_continuation" : "hermes"
          }
        })
        : reattachingHermesRun && runtimeRequest.session && reattachAssistant
          ? {
            session: runtimeRequest.session,
            turnId: runtimeRequest.session.hermesRun!.turnId,
            assistantMessageId: reattachAssistant.id,
            userMessageId: runtimeRequest.session.activeTurn?.userMessageId ?? ""
          }
        : undefined;
    const runtimeInput: AgentRuntimeTurnInput = {
      ...runtimeRequest,
      ...(runtimeShell ? {
        session: runtimeShell.session,
        turnId: runtimeShell.turnId
      } : {}),
      metadata: {
        ...(input.metadata ?? {}),
        incidentTraceId,
        attemptTraceId,
        attemptNumber,
        telemetry: true,
        ...(runtimeTaskPrepared ? { runtimeTaskPrepared: true } : {}),
        runtimeId: runtime.id,
        preferredRuntime: runtime.id,
        attemptedRuntime: runtime.id,
        finalRuntime: runtime.id,
        workflowId: runtimeRequest.session?.taskState?.workflowId ?? runtimeRequest.session?.workflowState?.workflowId,
        workflowStage: runtimeRequest.session?.taskState?.stage ?? runtimeRequest.session?.workflowState?.step,
        rootGoal: runtimeRequest.session?.taskState?.rootGoal,
        ...(runtimeRequest.session?.taskState?.workflowId === "compose_resume" ? {
          confirmed: runtimeRequest.session.taskState.knownSlots.resumeCompositionExplicitConfirmation === true,
          confirmationCount: runtimeRequest.session.taskState.knownSlots.resumeCompositionExplicitConfirmation === true ? 1 : 0
        } : {}),
        ...(runtimeShell ? {
          runtimeShellMessageId: runtimeShell.assistantMessageId,
          runtimeShellUserMessageId: runtimeShell.userMessageId
        } : {}),
        ...(input.metadata?.tailoringAnswerBinding && typeof input.metadata.tailoringAnswerBinding === "object"
          ? { tailoringAnswerBinding: input.metadata.tailoringAnswerBinding }
          : {}),
        ...(typeof input.metadata?.prePersistedUserMessageId === "string"
          ? { prePersistedUserMessageId: input.metadata.prePersistedUserMessageId }
          : {})
      }
    };
    let sessionBindingSet = false;
    if (input.signal?.aborted || state.getTurnOperation(String(input.metadata?.turnOperationId ?? ""))?.cancelled) {
      return state.getSnapshot().activeSession ?? runtimeInput.session;
    }
    if (typeof input.metadata?.turnOperationId === "string") {
      state.setTurnOperationState(input.metadata.turnOperationId, "running");
    }
    try {
      if (runtime.id === "hermes") {
        if (runtimeShell) {
          const tailoringAnswer = readTailoringAnswerBinding(runtimeInput.metadata?.tailoringAnswerBinding);
          await mcpBridge.setConfirmationContext({
            sessionId: runtimeInput.sessionId,
            turnId: runtimeShell.turnId,
            taskId: runtimeInput.session?.id,
            assistantMessageId: runtimeShell.assistantMessageId,
            userMessageId: runtimeShell.userMessageId,
            sourceUserMessageId: runtimeShell.userMessageId,
            incidentTraceId,
            ...(tailoringAnswer ? { tailoringAnswer } : {})
          }).catch(() => undefined);
        }
        const binding = resolveCareerSessionBinding({
          sessionId: runtimeInput.sessionId,
          session: runtimeInput.session,
          pageContext: runtimeInput.pageContext
        });
        if (binding) {
          await mcpBridge.setSessionBinding(binding);
          sessionBindingSet = true;
        }
      }
      const eventStream = runtime.runTurn(runtimeInput);
      for await (const event of eventStream) {
        const rawEventData = event.data && typeof event.data === "object" && !Array.isArray(event.data)
          ? event.data as Record<string, unknown>
          : undefined;
        const rawRuntimeFailureCode = event.type === "turn_failed" ? event.error?.code : undefined;
        const rawRuntimeFailureDiagnostics = runtimeFailureInput(rawEventData?.diagnostics);
        const runtimeFailureCode = rawRuntimeFailureCode;
        const eventData = runtimeFailureCode
          ? {
              ...(rawEventData ?? {}),
              incidentTraceId,
              ...(rawEventData?.failureSnapshot ? {} : {
                  failureSnapshot: runtimeFailureSnapshotFromStatus(runtimeStatus.getSnapshot(), {
                    safeErrorCode: runtimeFailureCode,
                    hermesRunId: rawRuntimeFailureDiagnostics.hermesRunId,
                    reasonCode: runtimeFailureCode,
                    lastEvent: event.type,
                    createdAt: runtimeInput.session?.activeTurn?.startedAt
                  })
              })
            }
          : rawEventData;
        const observedEvent = eventData
          ? { ...event, data: eventData }
          : event;
        if (runtimeShell && eventData?.fallbackUsed !== true) {
          await state.applyRuntimeEvent(observedEvent, runtimeShell.assistantMessageId);
        }
        runtimeEventBus.emit(observedEvent);
        if (event.type === "turn_completed" || event.type === "turn_failed") {
          runtimeStatus.recordTurn({ runtimeId: runtime.id, turnId: event.turnId, data: observedEvent.data });
          if (isHermesRuntimeFailureCode(runtimeFailureCode) && !isCareerDomainPreconditionCode(runtimeFailureCode)) {
            runtimeStatus.recordRunFailure({
              code: runtimeFailureCode,
              message: event.error?.message,
              retryable: event.error?.recoverable,
              incidentTraceId,
              attemptTraceId,
              ...runtimeFailureInput(eventData?.diagnostics)
            });
            void refreshHermesHealth().catch(() => undefined);
          }
        }
      }
    } finally {
      if (runtime.id === "hermes") await mcpBridge.setConfirmationContext(undefined).catch(() => undefined);
      if (sessionBindingSet && !shouldKeepHermesSessionBinding(runtimeInput.sessionId)) {
        await mcpBridge.setSessionBinding(undefined).catch(() => undefined);
      }
      runtimeStatus.recordBridgeRequestTraces(hermesRuntime.getDiagnostics().bridgeRequestTraces);
    }
    return state.getSnapshot().activeSession;
  };
  const userEventOperationId = (session: AgentSession, event: RuntimeUserEvent) => {
    const stateVersion = session.taskState?.updatedAt ?? session.updatedAt;
    if (event.type === "retry") return `retry:${session.id}:${session.activeTurn?.id ?? session.taskState?.stage ?? "workflow"}:${stateVersion}`;
    if (event.type === "regenerate") return `regenerate:${session.id}:${event.messageId}:${stateVersion}`;
    return `event:${session.id}:${crypto.randomUUID()}`;
  };
  const runUserEvent = (
    event: RuntimeUserEvent,
    input: Omit<AgentRuntimeTurnInput, "sessionId" | "userMessage"> & { sessionId?: string; userMessage?: string }
  ): Promise<AgentSession | undefined> => {
    const session = input.session ?? state.getSnapshot().activeSession;
    if (!session) throw new Error("agent_session_required");
    const activeSession = state.getSnapshot().activeSession;
    const workflowAnswer = event.type === "option_selected"
      && event.action.type === "answer"
      && event.action.field.startsWith("tailoring-question:");
    const workflowTextAnswer = event.type === "text_message"
      && Boolean(event.text.trim())
      && Boolean(getActiveTailoringQuestionProjection(
        activeSession?.id === session.id ? activeSession : session
      ));
    if (workflowAnswer || workflowTextAnswer || event.type === "artifact_action" || event.type === "confirmation" || event.type === "workflow_control") {
      return runUserEventOnce(event, input);
    }
    const operationId = typeof input.metadata?.turnOperationId === "string"
      ? input.metadata.turnOperationId
      : userEventOperationId(session, event);
    const claim = state.claimTurnOperation({
      sessionId: input.sessionId ?? session.id,
      operationId,
      kind: event.type === "retry" ? "retry" : event.type === "regenerate" ? "regenerate" : "user_turn",
      turnId: input.turnId
    });
    if (!claim.accepted) return claim.operation.promise as Promise<AgentSession | undefined>;
    const promise = runUserEventOnce(event, {
      ...input,
      session,
      sessionId: input.sessionId ?? session.id,
      metadata: {
        ...(input.metadata ?? {}),
        turnOperationId: operationId,
        turnOperationKind: event.type === "retry" ? "retry" : event.type === "regenerate" ? "regenerate" : "user_turn",
        turnOperationClaimed: true
      }
    }).then(
      (result) => {
        state.finishTurnOperation(operationId);
        return result;
      },
      (error) => {
        state.finishTurnOperation(operationId, "failed");
        throw error;
      }
    );
    state.attachTurnOperation(operationId, promise);
    return promise;
  };
  const runUserEventOnce = async (event: RuntimeUserEvent, input: Omit<AgentRuntimeTurnInput, "sessionId" | "userMessage"> & { sessionId?: string; userMessage?: string }) => {
    const session = input.session ?? state.getSnapshot().activeSession;
    if (!session) throw new Error("agent_session_required");
    if (
      event.type === "workflow_control"
      && (event.action.type === "cancel_workflow" || event.action.type === "pause_workflow")
      && session.hermesRun
      && ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun.status)
    ) {
      await interruptRun(session.id, createRunStopReason({
        requestedBy: "user",
        reasonCode: event.action.type === "cancel_workflow" ? "workflow_cancelled" : "workflow_paused",
        sourceComponent: "AgentRuntimeProvider.runUserEvent",
        sessionId: session.id,
        logicalTurnId: session.activeTurn?.id,
        runId: session.hermesRun.runId,
        incidentTraceId: session.activeTurn?.incidentTraceId
      }));
    }
    if (event.type === "confirmation" && session.hermesRun?.status === "waiting_for_approval") {
      await hermesRuntime.approve(session.id, event.confirmed);
      return runTurn({
        ...input,
        sessionId: input.sessionId ?? session.id,
        session,
        userMessage: "",
        metadata: {
          ...(input.metadata ?? {}),
          runtimeUserEvent: event,
          reattachRunId: session.hermesRun.runId
        }
      });
    }
    if (event.type === "confirmation" && session.pendingConfirmation) {
      // Explicit Career writes are Host-owned transactions. A confirmation
      // click must not open a new Hermes planning turn to decide whether the
      // already-reviewed write should happen.
      return state.resolveConfirmation(event.confirmed, input.pageContext, session);
    }
    if (event.type === "confirmation") {
      // A stale confirmation event must not be reinterpreted as a new AI turn.
      // The card is Host-owned; if its transaction is no longer present, keep
      // the current session instead of sending an unscoped approval to Hermes.
      return session;
    }
    if (event.type === "artifact_action") {
      // Artifact decisions are already typed, scoped to a concrete artifact,
      // and recorded in the Host ledger. Inline tailoring acceptance must be
      // immediate: sending it through Hermes would create a redundant
      // narration turn and could make a deterministic review look like a
      // second planning decision.
      if (session.hermesRun && ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun.status)) {
        await interruptRun(session.id, createRunStopReason({
          requestedBy: "user",
          reasonCode: "artifact_action_superseded_run",
          sourceComponent: "AgentRuntimeProvider.runUserEvent",
          sessionId: session.id,
          logicalTurnId: session.activeTurn?.id,
          runId: session.hermesRun.runId,
          incidentTraceId: session.activeTurn?.incidentTraceId
        })).catch(() => undefined);
      }
      return state.dispatchRuntimeUserEvent({ session, event, pageContext: input.pageContext });
    }
    const prepared = await state.prepareRuntimeUserEvent({ session, event, pageContext: input.pageContext });
    if (prepared.event.type === "confirmation" && prepared.deterministicTransitionApplied && prepared.session.pendingConfirmation) {
      return state.resolveConfirmation(prepared.event.confirmed, input.pageContext, prepared.session);
    }
    if (prepared.deterministicTransitionApplied && prepared.session.pendingConfirmation) return prepared.session;
    if (prepared.deterministicTerminal && prepared.event.type === "confirm_resume_composition") {
      return state.executeConfirmedResumeComposition({
        session: prepared.session,
        command: prepared.event,
        pageContext: input.pageContext,
        turnId: prepared.turnId
      });
    }
    if (prepared.deterministicTerminal) return prepared.session;
    const deterministicEvent = event.type === "entity_selected"
      || event.type === "option_selected" && ["select_entity", "task_decision", "answer", "retry_current_step"].includes(event.action.type)
      || event.type === "retry";
    if (deterministicEvent && !prepared.deterministicTransitionApplied) return prepared.session;
    return runTurn({
      ...input,
      sessionId: input.sessionId ?? session.id,
      session: prepared.session,
      userMessage: prepared.userMessage,
      ...(prepared.turnId ? { turnId: prepared.turnId } : {}),
      metadata: {
        ...(input.metadata ?? {}),
        executionOwner: prepared.executionOwner,
        runtimeEventPrepared: prepared.deterministicTransitionApplied,
        runtimeUserEvent: prepared.event,
        ...(prepared.prePersistedUserMessageId ? { prePersistedUserMessageId: prepared.prePersistedUserMessageId } : {}),
        ...(prepared.tailoringAnswerBinding ? { tailoringAnswerBinding: prepared.tailoringAnswerBinding } : {})
      }
    });
  };
  const interruptRun = async (sessionId = state.getSnapshot().activeSessionId, reason?: RunStopReason) => {
    if (!sessionId) return;
    const current = state.getSnapshot().activeSession;
    const stopReason = reason ?? createRunStopReason({
      requestedBy: "user",
      reasonCode: "user_interrupt",
      sourceComponent: "AgentRuntimeProvider.interruptRun",
      sessionId,
      logicalTurnId: current?.id === sessionId ? current.activeTurn?.id : undefined,
      runId: current?.id === sessionId ? current.hermesRun?.runId : undefined,
      incidentTraceId: current?.id === sessionId ? current.activeTurn?.incidentTraceId : undefined
    });
    try {
      if (current?.id === sessionId && current.hermesRun?.runId) {
        runtimeStatus.recordRunState("stopping", current.hermesRun.runId);
        const stopped = await hermesRuntime.stopCurrentRun(current.hermesRun.runId, stopReason);
        runtimeStatus.recordRunState(stopped.status === "failed" ? "failed" : "completed");
      } else {
        await hermesRuntime.interrupt(sessionId, stopReason);
      }
    } finally {
      state.interrupt(sessionId, stopReason);
    }
  };
  return {
    service,
    registry,
    executor,
    store,
    eventBus: new AgentEventBus(),
    runtimeEventBus,
    runTurn,
    runUserEvent,
    state,
    careerToolGateway,
    hermesRuntime,
    runtimeStatus,
    mcpBridge,
    refreshHermesHealth,
    startHermes,
    interruptRun
  };
}

export type AgentHost = ReturnType<typeof createAgentHost>;

function runtimeStartSnapshot(status: ReturnType<RuntimeStatusStore["getSnapshot"]>): RuntimeFailureSnapshot {
  const capturedAt = new Date().toISOString();
  const supervisor = status.supervisorSnapshot;
  return {
    capturedAt,
    supervisor: supervisor
      ? {
          overallState: supervisor.overallState,
          processReady: supervisor.processReady,
          apiReady: supervisor.apiReady,
          providerReady: supervisor.providerReady,
          careerMcpReady: supervisor.careerMcpReady,
          toolSurfaceReady: supervisor.toolSurfaceReady,
          runReady: supervisor.runReady,
          reasonCode: supervisor.reasonCode,
          activeRunId: supervisor.activeRunId,
          restartAttempt: supervisor.restartAttempt,
          capturedAt,
          maintenancePending: supervisor.maintenancePending
        }
      : {
          overallState: status.supervisorState ?? (status.status === "ready" ? "ready" : "starting"),
          processReady: status.processReady === true,
          apiReady: status.apiReady === true,
          providerReady: status.providerReady === true,
          careerMcpReady: status.careerMcpReady === true,
          toolSurfaceReady: status.toolSurfaceReady === true,
          runReady: status.runReady !== false,
          reasonCode: status.reasonCode,
          activeRunId: status.activeRunId,
          restartAttempt: status.restartAttempt ?? 0,
          capturedAt
        },
    ...(status.health ? { runtimeHealth: status.health as unknown as Record<string, unknown> } : {}),
    run: {
      runId: status.activeRunId,
      status: "not_started"
    }
  };
}

function runtimeFailureSnapshotFromStatus(
  status: ReturnType<RuntimeStatusStore["getSnapshot"]>,
  input: { safeErrorCode: string; hermesRunId?: string; reasonCode: string; lastEvent?: string; createdAt?: string }
): RuntimeFailureSnapshot {
  const snapshot = runtimeStartSnapshot(status);
  return {
    ...snapshot,
    capturedAt: new Date().toISOString(),
    supervisor: {
      ...snapshot.supervisor,
      // A failed run is a turn-scoped failure. Keep the supervisor's global
      // readiness truthful so the next user turn can retry without a fake
      // process restart or Native fallback.
      activeRunId: input.hermesRunId ?? snapshot.supervisor.activeRunId
    },
    run: {
      ...snapshot.run,
      runId: input.hermesRunId ?? snapshot.run.runId,
      ...(input.lastEvent ? { lastEvent: input.lastEvent } : {}),
      status: "failed",
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      updatedAt: new Date().toISOString()
    }
  };
}

function runtimeFailureInput(value: unknown): Partial<HermesRunFailureInput> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const layer = ["companion", "session", "provider", "mcp", "run_start", "bridge_http", "response"].includes(String(record.failureLayer))
    ? String(record.failureLayer) as HermesFailureLayer
    : undefined;
  const safeErrorCategories = [
    "provider_auth",
    "provider_request_invalid",
    "model_not_found",
    "tool_schema_invalid",
    "context_overflow",
    "provider_timeout",
    "mcp_tool_failure",
    "hermes_internal_failure",
    "transport_failure",
    "unknown"
  ] as const;
  return {
    ...(typeof record.httpStatus === "number" ? { httpStatus: record.httpStatus } : {}),
    ...(layer ? { failureLayer: layer } : {}),
    ...(typeof record.upstreamErrorCode === "string" ? { upstreamErrorCode: record.upstreamErrorCode } : {}),
    ...(typeof record.upstreamErrorType === "string" ? { upstreamErrorType: record.upstreamErrorType } : {}),
    ...(safeErrorCategories.includes(record.safeErrorCategory as typeof safeErrorCategories[number]) ? { safeErrorCategory: record.safeErrorCategory as typeof safeErrorCategories[number] } : {}),
    ...(record.safeMessageCategory === "auth" || record.safeMessageCategory === "invalid_request" || record.safeMessageCategory === "conflict" || record.safeMessageCategory === "provider" || record.safeMessageCategory === "transport" || record.safeMessageCategory === "unknown" ? { safeMessageCategory: record.safeMessageCategory } : {}),
    ...(typeof record.hermesSessionId === "string" ? { hermesSessionId: record.hermesSessionId } : {}),
    ...(typeof record.hermesRunId === "string" ? { hermesRunId: record.hermesRunId } : {}),
    ...(typeof record.activeRunId === "string" ? { activeRunId: record.activeRunId } : {}),
    ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
    ...(typeof record.requestedTurnId === "string" ? { requestedTurnId: record.requestedTurnId } : {}),
    ...(typeof record.requestState === "string" ? { requestState: record.requestState } : {}),
    ...(typeof record.controllerState === "string" ? { controllerState: record.controllerState } : {}),
    ...(typeof record.existingPendingTurnId === "string" ? { existingPendingTurnId: record.existingPendingTurnId } : {}),
    ...(typeof record.existingActiveTurnId === "string" ? { existingActiveTurnId: record.existingActiveTurnId } : {}),
    ...(record.runStartKind === "new" || record.runStartKind === "reattach" ? { runStartKind: record.runStartKind } : {}),
    ...(record.runPhase === "before_run_start" || record.runPhase === "after_run_start" ? { runPhase: record.runPhase } : {}),
    ...(typeof record.companionConnected === "boolean" ? { companionConnected: record.companionConnected } : {}),
    ...(typeof record.providerStatus === "string" ? { providerStatus: record.providerStatus } : {}),
    ...(typeof record.provider === "string" ? { provider: record.provider } : {}),
    ...(typeof record.model === "string" ? { model: record.model } : {}),
    ...(typeof record.lastHermesEventType === "string" ? { lastHermesEventType: record.lastHermesEventType } : {}),
    ...(typeof record.toolName === "string" ? { toolName: record.toolName } : {}),
    ...(typeof record.mcpConnected === "boolean" ? { mcpConnected: record.mcpConnected } : {}),
    ...(typeof record.latencyMs === "number" ? { latencyMs: record.latencyMs } : {}),
    ...(typeof record.incidentTraceId === "string" ? { incidentTraceId: record.incidentTraceId } : {}),
    ...(typeof record.attemptTraceId === "string" ? { attemptTraceId: record.attemptTraceId } : {})
  };
}

function readTailoringAnswerBinding(value: unknown): TailoringAnswerBinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.checkpointId !== "string"
    || typeof candidate.questionId !== "string"
    || typeof candidate.questionPlanId !== "string"
    || typeof candidate.questionPlanRevision !== "number"
    || typeof candidate.answer !== "string"
  ) return undefined;
  return {
    checkpointId: candidate.checkpointId,
    questionId: candidate.questionId,
    questionPlanId: candidate.questionPlanId,
    questionPlanRevision: candidate.questionPlanRevision,
    answer: candidate.answer
  };
}

const AgentRuntimeContext = createContext<AgentHost | undefined>(undefined);

export function AgentRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [host] = useState(createAgentHost);
  useEffect(() => {
    let active = true;
    let lastObservedMcpHealthKey: string | undefined;
    host.runtimeStatus.update({ status: "starting", activeRuntime: "hermes" });
    const unsubscribeHermesStatus = subscribeHermesStatus((snapshot) => {
      if (active) host.runtimeStatus.recordSupervisorStatus(snapshot);
    });
    const boot = async () => {
      await host.mcpBridge.start(
        host.careerToolGateway,
        (status) => {
          if (!active) return;
          host.runtimeStatus.recordMcp(status);
          const healthKey = `${status.connected ? "connected" : "disconnected"}:${status.discoveredToolCount}:${status.reason ?? ""}`;
          if (!status.connected) lastObservedMcpHealthKey = undefined;
          if (status.connected && status.discoveredToolCount > 0 && healthKey !== lastObservedMcpHealthKey) {
            lastObservedMcpHealthKey = healthKey;
            void host.refreshHermesHealth().catch(() => undefined);
          }
        },
        async (confirmation) => {
          if (!active || host.state.getSnapshot().activeSession?.id !== confirmation.sessionId) return;
          await host.state.applyRuntimeEvent({
            type: "approval_required",
            sessionId: confirmation.sessionId,
            turnId: confirmation.turnId,
            timestamp: new Date().toISOString(),
            toolName: confirmation.toolName,
            operationId: confirmation.operationId,
            message: "这项 Career 操作需要用户确认后才能继续。",
            data: {
              input: confirmation.input,
              contract: confirmation.contract
            }
          }, confirmation.assistantMessageId);
        },
        async ({ request, result, confirmationContext }) => {
          if (!active || !confirmationContext) return;
          const context = host.state.getSnapshot().activeSession;
          if (!context || context.id !== confirmationContext.sessionId) return;
          const assistant = context.messages.find((message) => message.id === confirmationContext.assistantMessageId)
            ?? context.messages.findLast((message) => message.role === "assistant" && message.turnId === confirmationContext.turnId);
          if (!assistant) return;
          const contract = host.careerToolGateway.listContracts().find((candidate) => candidate.name === request.name);
          await host.state.applyRuntimeEvent({
            type: result.ok ? "tool_call_completed" : "tool_call_failed",
            sessionId: confirmationContext.sessionId,
            turnId: confirmationContext.turnId,
            timestamp: new Date().toISOString(),
            toolName: request.name,
            operationId: request.operationId,
            ...(result.ok ? {} : {
              error: {
                code: result.error?.code ?? "career_tool_failed",
                message: result.error?.message ?? "Career 工具执行没有完成。",
                recoverable: result.error?.recoverable ?? false
              }
            }),
            data: { result, contract, ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}), ...(request.logicalToolOperationId ? { logicalToolOperationId: request.logicalToolOperationId } : {}) }
          }, assistant.id);
        }
      );
      if (!active) return;
      // The renderer-owned Browser Domain Host is the first valid point at
      // which Hermes can start. This handshake is deliberately after MCP
      // registration and carries the current local provider settings.
      const rendererReady = await notifyHermesRendererReady(readHermesStartSettings());
      if (!active) return;
      if (rendererReady?.snapshot) host.runtimeStatus.recordSupervisorStatus(rendererReady.snapshot);
      if (rendererReady?.ok === false) return;
      // Electron and Web Supervisor both use this renderer-ready signal. The
      // ownership boundary differs by environment, but the browser MCP/domain
      // host is required before either path can report Hermes as ready.
      if (rendererReady === undefined) {
        await host.refreshHermesHealth().catch(() => undefined);
        if (!active) return;
        return;
      }
      await host.refreshHermesHealth().catch(() => undefined);
    };
    void boot();
    return () => {
      active = false;
      unsubscribeHermesStatus();
      void host.mcpBridge.stop();
    };
  }, [host]);
  useEffect(() => {
    const persist = () => { void host.state.persistActiveSessionSnapshot(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      persist();
    };
  }, [host]);
  return <AgentRuntimeContext.Provider value={host}>{children}</AgentRuntimeContext.Provider>;
}

export function useAgentHost() {
  const host = useContext(AgentRuntimeContext);
  if (!host) throw new Error("useAgentHost must be used within AgentRuntimeProvider.");
  return host;
}

async function verifyBrowserCareerBinding(
  repository: WorkspaceRepository,
  binding: CareerSessionBinding,
  input: unknown,
  contract?: CareerToolContract
) {
  const profile = await repository.getProfile(binding.profileId);
  if (!profile || profile.personId !== binding.personId || profile.archivedAt || profile.trashedAt) {
    return { valid: false, code: "career_session_binding_profile_not_found", message: "固定的资料版本已不存在或已归档。" };
  }
  if ((profile.profileVersionNumber ?? 1) !== binding.profileVersionNumber || profile.version !== binding.profileRevision) {
    if (contract?.readWrite === "read") return { valid: true };
    return { valid: false, code: "career_session_binding_stale_revision", message: "固定的资料版本已更新，请基于最新版本继续。" };
  }
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  if (typeof value.resumeId === "string") {
    const branch = await repository.getResumeBranch(value.resumeId);
    if (!branch || branch.profileId !== binding.profileId) {
      return { valid: false, code: "career_session_binding_resume_mismatch", message: "该简历不属于当前 Agent Session 固定的资料版本。" };
    }
  }
  return { valid: true };
}
