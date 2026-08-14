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
import { requestHermesStart } from "@/services/agent/hermesControl";
import { isRoadshowReady } from "@/agent/runtime/runtimeHealth";
import { isHermesRuntimeFailureCode } from "@/agent/runtime/hermes/hermesRunReliability";
import { hermesProductionToolNames } from "@/agent/runtime/hermes/HermesCareerToolCatalog";

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
    interrupt: async (sessionId) => state.interrupt(sessionId),
    resume: async (sessionId) => {
      if (state.getSnapshot().activeSession?.id === sessionId) state.setPaused(false);
    }
  });
  const hermesRuntime = new HermesCareerAgentRuntime({
    transport: new HttpHermesBridgeTransport(),
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
        const runtimeHealth = toRuntimeHealth(health, {
          mcpConnected: health.mcpConnected ?? false,
          mcpToolCount: health.discoveredToolCount ?? 0,
          careerSkillsLoaded: health.runtimeHealth?.careerSkillsLoaded ?? false
        });
        const ready = isRoadshowReady(runtimeHealth);
        if (ready || attempt === 3) break;
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
    const activeSession = state.getSnapshot().activeSession;
    const activeHermesRun = activeSession?.hermesRun;
    const restartTurnId = activeSession?.activeTurn?.id;
    const retryCheckpointAfterRestart = Boolean(
      activeHermesRun
      && restartTurnId
      && activeSession?.activeTurn?.status === "running"
      && ["queued", "running"].includes(activeHermesRun.status)
    );
    if (activeHermesRun && ["queued", "running", "waiting_for_approval", "stopping"].includes(activeHermesRun.status)) {
      await hermesRuntime.interrupt(activeSession.id).catch(() => undefined);
    }
    runtimeStatus.update({ status: "starting", activeRuntime: "hermes", reason: "hermes_starting" });
    try {
      const result = await requestHermesStart();
      if (!result.ok) throw new Error(result.reason ?? "hermes_companion_start_failed");
      let health: Awaited<ReturnType<typeof hermesRuntime.health>> | undefined;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          health = await refreshHermesHealth();
          if (health.available && (!health.runtimeHealth || isRoadshowReady(health.runtimeHealth))) break;
        } catch {
          // The companion may still be completing its startup handshake.
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      if (!health?.available) throw new Error("hermes_companion_not_ready");
      if (health.runtimeHealth && !isRoadshowReady(health.runtimeHealth)) {
        return { ok: false as const, reason: "hermes_career_registry_not_ready" };
      }
      if (retryCheckpointAfterRestart && activeSession && restartTurnId) {
        const current = state.getSnapshot().activeSession;
        if (current?.id === activeSession.id && current.activeTurn?.id === restartTurnId) {
          // Restarting an active semantic run resumes the same persisted
          // checkpoint with an empty user message. beginRuntimeShell reuses
          // the existing assistant shell, so this does not create a second
          // user message or assistant bubble.
          void runTurn({
            sessionId: current.id,
            turnId: restartTurnId,
            userMessage: "",
            session: current,
            pageContext: { query: {} },
            metadata: {
              runtimeUserEvent: { type: "retry", action: { type: "retry_current_step" } },
              executionOwner: "runtime_continuation",
              runtimeRecoveryAttempted: true
            }
          }).catch(() => undefined);
        }
      }
      return { ok: true as const };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "hermes_companion_start_failed";
      runtimeStatus.update({ status: "unavailable", activeRuntime: "hermes", reason });
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
    const preparedSession = input.session && input.userMessage.trim() && runtimeUserEvent?.type !== "quick_action_started"
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
    const runtimeShell = canStartHermesShell && runtimeRequest.session
      ? await state.beginRuntimeShell({
          session: runtimeRequest.session,
          userMessage: runtimeRequest.userMessage,
          runtimeId: "hermes",
          turnId: runtimeRequest.turnId
            ?? (reattachingHermesRun ? runtimeRequest.session.hermesRun?.turnId : undefined),
          runtimeDiagnostics: {
            preferredRuntime: "hermes",
            attemptedRuntime: "hermes",
            finalRuntime: "hermes",
            fallbackUsed: false,
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
        allowedToolNames: runtimeRequest.session?.taskState
          ? runtime.id === "hermes"
            ? careerToolGateway.listContracts()
              .filter((contract) => hermesProductionToolNames().has(contract.name))
              .map((contract) => contract.sourceToolName)
            : runtimeRequest.session.taskState.workflowId === "tailor_existing_resume"
              ? careerToolGateway.listContracts().map((contract) => contract.sourceToolName)
              : allowedToolManifestForStep(
                  runtimeRequest.session.taskState.workflowId,
                  runtimeRequest.session.taskState.stage,
                  registry.manifest()
                ).map((tool) => String(tool.name))
          : [],
        allowedCareerToolNames: runtimeRequest.session?.taskState
          ? runtime.id === "hermes"
            ? [...hermesProductionToolNames()]
            : runtimeRequest.session.taskState.workflowId === "tailor_existing_resume"
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
    try {
      if (runtime.id === "hermes") {
        if (runtimeShell) {
          mcpBridge.setConfirmationContext({
            sessionId: runtimeInput.sessionId,
            turnId: runtimeShell.turnId,
            assistantMessageId: runtimeShell.assistantMessageId,
            userMessageId: runtimeShell.userMessageId
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
        const eventData = event.data && typeof event.data === "object" && !Array.isArray(event.data)
          ? event.data as Record<string, unknown>
          : undefined;
        if (runtimeShell && eventData?.fallbackUsed !== true) {
          await state.applyRuntimeEvent(event, runtimeShell.assistantMessageId);
        }
        runtimeEventBus.emit(event);
        if (event.type === "turn_completed" || event.type === "turn_failed") {
          runtimeStatus.recordTurn({ runtimeId: runtime.id, turnId: event.turnId, data: event.data });
          const runtimeFailureCode = event.type === "turn_failed" ? event.error?.code : undefined;
          if (isHermesRuntimeFailureCode(runtimeFailureCode)) {
            runtimeStatus.update({ activeRuntime: "hermes", status: "unavailable", reason: runtimeFailureCode });
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
    }
    return state.getSnapshot().activeSession;
  };
  const runUserEvent = async (event: RuntimeUserEvent, input: Omit<AgentRuntimeTurnInput, "sessionId" | "userMessage"> & { sessionId?: string; userMessage?: string }) => {
    const session = input.session ?? state.getSnapshot().activeSession;
    if (!session) throw new Error("agent_session_required");
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
        await hermesRuntime.interrupt(session.id).catch(() => undefined);
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
    startHermes
  };
}

export type AgentHost = ReturnType<typeof createAgentHost>;

function runtimeDiagnosticsFromMetadata(metadata?: Record<string, unknown>) {
  const value = metadata ?? {};
  const runtime = (candidate: unknown): "native" | "hermes" | undefined => candidate === "native" || candidate === "hermes" ? candidate : undefined;
  return {
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
          if (!active || !result.ok || !confirmationContext) return;
          const context = host.state.getSnapshot().activeSession;
          if (!context || context.id !== confirmationContext.sessionId) return;
          const assistant = context.messages.find((message) => message.id === confirmationContext.assistantMessageId)
            ?? context.messages.findLast((message) => message.role === "assistant" && message.turnId === confirmationContext.turnId);
          if (!assistant) return;
          const contract = host.careerToolGateway.listContracts().find((candidate) => candidate.name === request.name);
          await host.state.applyRuntimeEvent({
            type: "tool_call_completed",
            sessionId: confirmationContext.sessionId,
            turnId: confirmationContext.turnId,
            timestamp: new Date().toISOString(),
            toolName: request.name,
            operationId: request.operationId,
            data: { result, contract, ...(request.logicalToolOperationId ? { logicalToolOperationId: request.logicalToolOperationId } : {}) }
          }, assistant.id);
        }
      );
      if (!active || host.runtimeRouter.configurationSnapshot.agentRuntime !== "hermes") return;
      // Electron starts the bundled companion before the window is shown, but
      // the renderer is the first place that can read the user's local AI
      // settings. Reconcile those settings on every app open so a packaged
      // install never depends on a separately launched Hermes process.
      const started = await host.startHermes();
      if (!active || !started.ok) return;
      await host.refreshHermesHealth().catch(() => undefined);
    };
    void boot();
    return () => {
      active = false;
      void host.mcpBridge.stop();
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
