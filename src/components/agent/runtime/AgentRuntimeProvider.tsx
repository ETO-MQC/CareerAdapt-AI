"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { AgentKernel } from "@/agent/kernel/AgentKernel";
import { AgentObservationCache } from "@/agent/kernel/AgentObservationCache";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { HttpAgentModel } from "@/agent/model/httpAgentModel";
import { AgentEventBus } from "@/agent/runtime/agentEventBus";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { NativeCareerAgentRuntime } from "@/agent/runtime/NativeCareerAgentRuntime";
import { createAgentRuntimeRouter } from "@/agent/runtime/AgentRuntimeRouter";
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
import { allowedToolManifestForStep } from "@/agent/workflows/workflowRegistry";
import {
  getHermesStatus,
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
import { hermesProductionToolNames } from "@/agent/runtime/hermes/HermesCareerToolCatalog";
import { isReadOnlyCareerQuestion } from "@/agent/runtime/AgentTurnIntent";
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
    getAuthoritativeTaskState: () => hostStateRef.current?.getSnapshot().activeSession?.taskState
  });
  const executor = new CareerToolGatewayExecutor(registry, careerToolGateway);
  const store = new AgentSessionStore(repository);
  const runtimeEventBus = new AgentRuntimeEventBus();
  const kernel = new AgentKernel({
    model: new HttpAgentModel(),
    executor,
    toolResolver: new AgentToolResolver(registry),
    observationCache: new AgentObservationCache()
  });
  const state = new AgentHostStore({ kernel, executor, persistence: store, repository: store.getWorkspaceRepository() });
  hostStateRef.current = state;
  const nativeRuntime = new NativeCareerAgentRuntime({
    runTurn: async (input) => {
      const runtimeShellMessageId = typeof input.metadata?.runtimeShellMessageId === "string"
        ? input.metadata.runtimeShellMessageId
        : undefined;
      const runtimeShellUserMessageId = typeof input.metadata?.runtimeShellUserMessageId === "string"
        ? input.metadata.runtimeShellUserMessageId
        : undefined;
      const hasRuntimeShell = Boolean(runtimeShellMessageId && runtimeShellUserMessageId);
      const session = hasRuntimeShell && state.getSnapshot().activeSession?.id === input.sessionId
        ? state.getSnapshot().activeSession
        : input.session?.id === input.sessionId
          ? input.session
          : state.getSnapshot().activeSession?.id === input.sessionId
            ? state.getSnapshot().activeSession
            : undefined;
      if (!session) throw Object.assign(new Error("runtime_session_required"), { code: "runtime_session_required" });
      const runtimeUserEvent = input.metadata?.runtimeUserEvent as RuntimeUserEvent | undefined;
      if (
        runtimeUserEvent
        && input.metadata?.runtimeEventPrepared === true
        && ["entity_selected", "option_selected", "retry"].includes(runtimeUserEvent.type)
      ) {
        if (
          runtimeUserEvent.type === "option_selected"
          && runtimeUserEvent.action.type === "answer"
          && runtimeUserEvent.action.field.startsWith("tailoring-question:")
        ) {
          const userMessage = [...session.messages].reverse().find((message) => message.role === "user")?.content ?? "";
          return state.startTurn({
            session,
            userMessage,
            userMessageId: session.activeTurn?.userMessageId,
            appendUserMessage: false,
            pageContext: input.pageContext,
            turnId: input.turnId,
            runtimeDiagnostics: runtimeDiagnosticsFromMetadata(input.metadata)
          });
        }
        return state.continueRuntimeEvent({
          session,
          event: runtimeUserEvent,
          pageContext: input.pageContext,
          turnId: input.turnId ?? `native-runtime-${crypto.randomUUID()}`,
          runtimeDiagnostics: runtimeDiagnosticsFromMetadata(input.metadata)
        });
      }
      if (runtimeUserEvent && !["text_message", "quick_action_started"].includes(runtimeUserEvent.type)) {
        return state.dispatchRuntimeUserEvent({
          session,
          event: runtimeUserEvent,
          pageContext: input.pageContext
        });
      }
      const preparedTask = input.metadata?.runtimeTaskPrepared === true && session.taskState
        ? {
            rootGoal: session.taskState.rootGoal,
            workflowId: session.taskState.workflowId,
            stage: session.taskState.stage
          }
        : undefined;
      const quickTask = runtimeUserEvent?.type === "quick_action_started"
        ? runtimeUserEvent.task
        : undefined;
      return state.startTurn({
        session,
        userMessage: input.userMessage,
        pageContext: input.pageContext,
        turnId: input.turnId,
        runtimeId: "native",
        runtimeDiagnostics: runtimeDiagnosticsFromMetadata(input.metadata),
        typedTask: quickTask ?? preparedTask,
        ...(hasRuntimeShell ? {
          userMessageId: runtimeShellUserMessageId,
          assistantMessageId: runtimeShellMessageId,
          appendUserMessage: false,
          updateExistingUserMessage: true
        } : {})
      });
    },
    pause: async (sessionId) => {
      if (state.getSnapshot().activeSession?.id === sessionId) state.setPaused(true);
    },
    interrupt: async (sessionId, reason) => state.interrupt(sessionId, reason),
    resume: async (sessionId) => {
      if (state.getSnapshot().activeSession?.id === sessionId) state.setPaused(false);
    }
  });
  const hermesTransport = new HttpHermesBridgeTransport();
  const hermesRuntime = new HermesCareerAgentRuntime({
    transport: hermesTransport,
    careerToolGateway
  });
  const configuredRuntime = typeof window !== "undefined" && window.localStorage.getItem("careerad-agent-runtime") === "native"
    ? "native" as const
    : "hermes" as const;
  const runtimeStatus = new RuntimeStatusStore({
    preferredRuntime: configuredRuntime,
    activeRuntime: configuredRuntime,
    status: configuredRuntime === "hermes" ? "starting" : "ready",
    mcpServer: "careeradapt",
    mcpConnected: false,
    discoveredToolCount: 0,
    resumePreviewAvailable: careerToolGateway.listContracts().some((contract) => contract.name === "career.tailoring.preview_changes" || contract.name === "career.preview.review_diff"),
    pdfExportAvailable: careerToolGateway.listContracts().some((contract) => contract.name === "career.export.resume")
  });
  const mcpBridge = new CareerAdaptMcpBridgeClient();
  const runtimeRouter = createAgentRuntimeRouter({
    native: nativeRuntime,
    hermes: hermesRuntime,
    configuration: { agentRuntime: configuredRuntime }
  });
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
        provider: health.provider,
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
  const runTurn = async (input: AgentRuntimeTurnInput) => {
    // The UI consumes only this stable event protocol.  Native and Hermes can
    // change their internals without changing the workspace submission path.
    const runtime = runtimeRouter.active();
    const runtimeUserEvent = input.metadata?.runtimeUserEvent as RuntimeUserEvent | undefined;
    const incidentTraceId = typeof input.metadata?.incidentTraceId === "string" && input.metadata.incidentTraceId.trim()
      ? input.metadata.incidentTraceId
      : createIncidentTraceId();
    const skipHermesReadOnlyPlanner = runtime.id === "hermes" && isReadOnlyCareerQuestion(input.userMessage);
    const preparedSession = input.session && input.userMessage.trim() && runtimeUserEvent?.type !== "quick_action_started" && !skipHermesReadOnlyPlanner
      ? await state.prepareRuntimeTask({
          session: input.session,
          userMessage: input.userMessage,
          references: undefined
        })
      : input.session;
    const runtimeTaskPrepared = Boolean(preparedSession && preparedSession !== input.session);
    const runtimeRequest = preparedSession && preparedSession !== input.session
      ? { ...input, session: preparedSession }
      : input;
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
    const runtimeShell = canStartHermesShell && runtimeRequest.session
      ? await state.beginRuntimeShell({
          session: runtimeRequest.session,
          userMessage: runtimeRequest.userMessage,
          runtimeId: "hermes",
          turnId: runtimeShellTurnId,
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
        workflowId: runtimeRequest.session?.taskState?.workflowId ?? runtimeRequest.session?.workflowState.workflowId,
        workflowStage: runtimeRequest.session?.taskState?.stage ?? runtimeRequest.session?.workflowState.step,
        rootGoal: runtimeRequest.session?.taskState?.rootGoal,
        ...(runtimeRequest.session?.taskState?.workflowId === "compose_resume" ? {
          confirmed: runtimeRequest.session.taskState.knownSlots.resumeCompositionExplicitConfirmation === true,
          confirmationCount: runtimeRequest.session.taskState.knownSlots.resumeCompositionExplicitConfirmation === true ? 1 : 0
        } : {}),
        allowedToolNames: runtime.id === "hermes"
          ? careerToolGateway.listContracts()
            .filter((contract) => hermesProductionToolNames().has(contract.name))
            .map((contract) => contract.sourceToolName)
          : runtimeRequest.session?.taskState
            ? runtimeRequest.session.taskState.workflowId === "tailor_existing_resume"
              ? careerToolGateway.listContracts().map((contract) => contract.sourceToolName)
              : allowedToolManifestForStep(
                  runtimeRequest.session.taskState.workflowId,
                  runtimeRequest.session.taskState.stage,
                  registry.manifest()
                ).map((tool) => String(tool.name))
            : [],
        allowedCareerToolNames: runtime.id === "hermes"
          ? [...hermesProductionToolNames()]
          : runtimeRequest.session?.taskState
            ? runtimeRequest.session.taskState.workflowId === "tailor_existing_resume"
              ? careerToolGateway.listContracts().map((contract) => contract.name)
              : [
                ...allowedToolManifestForStep(
                  runtimeRequest.session.taskState.workflowId,
                  runtimeRequest.session.taskState.stage,
                  registry.manifest()
                ).flatMap((tool) => {
                  const stable = careerToolGateway.getStableNameForSource(String(tool.name));
                  return stable ? [stable] : [];
                }),
                ...(runtimeRequest.session.taskState.workflowId === "compose_resume"
                  && ["review_composition", "confirm_create"].includes(runtimeRequest.session.taskState.stage)
                  ? ["career.workflow.compose_resume"]
                  : [])
              ]
            : [],
        ...(runtime.id === "hermes" ? { requireCareerSessionBinding: true } : {}),
        ...(runtimeShell ? {
          runtimeShellMessageId: runtimeShell.assistantMessageId,
          runtimeShellUserMessageId: runtimeShell.userMessageId
        } : {})
      }
    };
    let sessionBindingSet = false;
    let recoveryInput: AgentRuntimeTurnInput | undefined;
    let toolsExecuted = false;
    try {
      if (runtime.id === "hermes") {
        if (runtimeShell) {
          mcpBridge.setConfirmationContext({
            sessionId: runtimeInput.sessionId,
            turnId: runtimeShell.turnId,
            assistantMessageId: runtimeShell.assistantMessageId,
            userMessageId: runtimeShell.userMessageId,
            incidentTraceId
          });
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
      const eventStream = runtimeUserEvent
        ? runtimeRouter.runUserEvent(runtimeUserEvent, runtimeInput)
        : runtime.runTurn(runtimeInput);
      for await (const event of eventStream) {
        const rawEventData = event.data && typeof event.data === "object" && !Array.isArray(event.data)
          ? event.data as Record<string, unknown>
          : undefined;
        if (["tool_call_requested", "tool_call_started", "tool_call_completed", "tool_call_failed"].includes(event.type)) {
          toolsExecuted = true;
        }
        const rawRuntimeFailureCode = event.type === "turn_failed" ? event.error?.code : undefined;
        const rawRuntimeFailureDiagnostics = runtimeFailureInput(rawEventData?.diagnostics);
        const rawRunHandle = rawEventData?.runHandle && typeof rawEventData.runHandle === "object" && !Array.isArray(rawEventData.runHandle)
          ? rawEventData.runHandle as Record<string, unknown>
          : {};
        const runStartedBeforeFailure = Boolean(
          rawRunHandle.runId
          || rawEventData?.runId
          || runtimeInput.session?.hermesRun?.runId
          || rawRuntimeFailureDiagnostics.hermesRunId
        );
        const runtimeFailureCode = rawRuntimeFailureCode === "hermes_unavailable_before_turn" && runStartedBeforeFailure
          ? "hermes_run_failed_after_start"
          : rawRuntimeFailureCode;
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
          if (isHermesRuntimeFailureCode(runtimeFailureCode)) {
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
          if (
            runtime.id === "hermes"
            && event.type === "turn_failed"
            && !input.metadata?.runtimeRecoveryAttempted
            && !input.metadata?.semanticRetryAttempted
            && !toolsExecuted
            && (isUnexpectedTransientCancellation(runtimeFailureCode) || isTransientTerminalFailure(runtimeFailureCode, event.error?.recoverable, eventData?.diagnostics))
          ) {
            try {
              const health = await refreshHermesHealth();
              if (health.available && health.runtimeHealth?.runReady !== false) {
                const current = state.getSnapshot().activeSession;
                if (current?.id === runtimeInput.sessionId) {
                  const recoveryAttemptNumber = (current.activeTurn?.runtimeAttempts?.length ?? 0) + 1;
                  recoveryInput = {
                    ...runtimeInput,
                    session: current,
                    userMessage: "",
                    metadata: {
                      ...(runtimeInput.metadata ?? {}),
                      runtimeUserEvent: { type: "retry", action: { type: "retry_current_step" } },
                      attemptTraceId: `${incidentTraceId}:attempt-${Math.max(2, recoveryAttemptNumber)}`,
                      attemptNumber: Math.max(2, recoveryAttemptNumber),
                      executionOwner: "runtime_continuation",
                      runtimeRecoveryAttempted: true,
                      runtimeRecoveryKind: "retry",
                      semanticRetryAttempted: true,
                      semanticRetryUserMessage: runtimeInput.userMessage || input.userMessage,
                      primaryFailureCode: runtimeFailureCode,
                      recoveryReason: "unexpected_transient_upstream_cancel",
                      reattachRunId: undefined
                    }
                  };
                }
              }
            } catch {
              // The original failure remains the authoritative result when
              // the bounded health check cannot establish a safe retry.
            }
          }
        } else if (eventData?.fallbackUsed === true) {
          // Kept only for legacy/test adapters; production Hermes turns never
          // reach this branch because the router does not switch personas.
          runtimeStatus.update({ activeRuntime: "hermes", status: "ready" });
        }
      }
    } finally {
      if (runtime.id === "hermes") mcpBridge.setConfirmationContext(undefined);
      if (sessionBindingSet && !shouldKeepHermesSessionBinding(runtimeInput.sessionId)) {
        await mcpBridge.setSessionBinding(undefined).catch(() => undefined);
      }
      runtimeStatus.recordBridgeRequestTraces(hermesRuntime.getDiagnostics().bridgeRequestTraces);
    }
    if (recoveryInput) return runTurn(recoveryInput);
    return state.getSnapshot().activeSession;
  };
  const runUserEvent = async (event: RuntimeUserEvent, input: Omit<AgentRuntimeTurnInput, "sessionId" | "userMessage"> & { sessionId?: string; userMessage?: string }) => {
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
    if (prepared.deterministicTerminal && prepared.event.type === "confirm_resume_composition") {
      return state.executeConfirmedResumeComposition({
        session: prepared.session,
        command: prepared.event,
        pageContext: input.pageContext,
        turnId: prepared.turnId
      });
    }
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
        runtimeUserEvent: prepared.event
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
      await hermesRuntime.interrupt(sessionId, stopReason);
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
    kernel,
    state,
    careerToolGateway,
    hermesRuntime,
    runtimeRouter,
    runtimeStatus,
    mcpBridge,
    refreshHermesHealth,
    startHermes,
    interruptRun
  };
}

export type AgentHost = ReturnType<typeof createAgentHost>;

function isUnexpectedTransientCancellation(code?: string) {
  return code === "hermes_run_cancelled_upstream"
    || code === "hermes_run_cancelled"
    || code === "hermes_run_stopped_unexpected"
    || code === "hermes_upstream_cancelled";
}

function isTransientTerminalFailure(code: string | undefined, recoverable: boolean | undefined, diagnostics: unknown) {
  if (code !== "hermes_run_failed") return false;
  if (recoverable === true) return true;
  const record = diagnostics && typeof diagnostics === "object" && !Array.isArray(diagnostics)
    ? diagnostics as Record<string, unknown>
    : {};
  return record.retryable === true;
}

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
      overallState: "degraded",
      reasonCode: input.reasonCode,
      runReady: false,
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
  return {
    ...(typeof record.httpStatus === "number" ? { httpStatus: record.httpStatus } : {}),
    ...(layer ? { failureLayer: layer } : {}),
    ...(typeof record.upstreamErrorCode === "string" ? { upstreamErrorCode: record.upstreamErrorCode } : {}),
    ...(typeof record.hermesSessionId === "string" ? { hermesSessionId: record.hermesSessionId } : {}),
    ...(typeof record.hermesRunId === "string" ? { hermesRunId: record.hermesRunId } : {}),
    ...(typeof record.requestedTurnId === "string" ? { requestedTurnId: record.requestedTurnId } : {}),
    ...(record.runStartKind === "new" || record.runStartKind === "reattach" ? { runStartKind: record.runStartKind } : {}),
    ...(record.runPhase === "before_run_start" || record.runPhase === "after_run_start" ? { runPhase: record.runPhase } : {}),
    ...(typeof record.companionConnected === "boolean" ? { companionConnected: record.companionConnected } : {}),
    ...(typeof record.providerStatus === "string" ? { providerStatus: record.providerStatus } : {}),
    ...(typeof record.mcpConnected === "boolean" ? { mcpConnected: record.mcpConnected } : {}),
    ...(typeof record.latencyMs === "number" ? { latencyMs: record.latencyMs } : {}),
    ...(typeof record.incidentTraceId === "string" ? { incidentTraceId: record.incidentTraceId } : {}),
    ...(typeof record.attemptTraceId === "string" ? { attemptTraceId: record.attemptTraceId } : {})
  };
}

function runtimeDiagnosticsFromMetadata(metadata?: Record<string, unknown>) {
  const value = metadata ?? {};
  const runtime = (candidate: unknown): "native" | "hermes" | undefined => candidate === "native" || candidate === "hermes" ? candidate : undefined;
  return {
    incidentTraceId: typeof value.incidentTraceId === "string" ? value.incidentTraceId : undefined,
    preferredRuntime: runtime(value.preferredRuntime),
    attemptedRuntime: runtime(value.attemptedRuntime),
    finalRuntime: runtime(value.finalRuntime) ?? "native",
    executionOwner: value.executionOwner === "native" || value.executionOwner === "hermes" || value.executionOwner === "deterministic_transition" || value.executionOwner === "runtime_continuation"
      ? value.executionOwner
      : undefined,
    fallbackUsed: value.fallbackUsed === true,
    fallbackReasonCode: typeof value.fallbackReasonCode === "string" ? value.fallbackReasonCode : undefined,
    hermesRunId: typeof value.hermesRunId === "string" ? value.hermesRunId : undefined,
    nextHermesRunId: typeof value.nextHermesRunId === "string" ? value.nextHermesRunId : undefined,
    firstEventAt: typeof value.firstEventAt === "string" ? value.firstEventAt : undefined,
    runtimeFailureAt: typeof value.runtimeFailureAt === "string" ? value.runtimeFailureAt : undefined
  };
}

const AgentRuntimeContext = createContext<AgentHost | undefined>(undefined);

export function AgentRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [host] = useState(createAgentHost);
  useEffect(() => {
    let active = true;
    let lastObservedMcpHealthKey: string | undefined;
    host.runtimeStatus.update({ status: host.runtimeRouter.configurationSnapshot.agentRuntime === "hermes" ? "starting" : "ready" });
    const unsubscribeHermesStatus = subscribeHermesStatus((snapshot) => {
      if (active) host.runtimeStatus.recordSupervisorStatus(snapshot);
    });
    void getHermesStatus().then((snapshot) => {
      if (active && snapshot) host.runtimeStatus.recordSupervisorStatus(snapshot);
    }).catch(() => undefined);
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
      if (!active || host.runtimeRouter.configurationSnapshot.agentRuntime !== "hermes") return;
      // The renderer-owned Browser Domain Host is the first valid point at
      // which Hermes can start. This handshake is deliberately after MCP
      // registration and carries the current local provider settings.
      const rendererReady = await notifyHermesRendererReady(readHermesStartSettings());
      if (rendererReady?.snapshot) host.runtimeStatus.recordSupervisorStatus(rendererReady.snapshot);
      if (!active) return;
      if (rendererReady?.ok === false) return;
      // Electron's renderer-ready IPC is the authoritative startup owner.
      // Browser/web mode has no renderer handshake, so it starts through the
      // existing control route exactly once here.
      if (rendererReady === undefined) {
        const started = await host.startHermes();
        if (!active || !started.ok) return;
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
