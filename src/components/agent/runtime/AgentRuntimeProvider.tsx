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

function createAgentHost() {
  const repository = new WorkspaceRepository();
  const service = new BrowserAgentToolService(repository);
  const registry = createAgentToolRegistry(service);
  const rawExecutor = new AgentExecutor(registry);
  const careerToolGateway = new CareerToolGateway({
    registry,
    executor: rawExecutor,
    verifySessionBinding: async (binding, input) => verifyBrowserCareerBinding(repository, binding, input)
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
    const statusBeforeTurn = runtimeStatus.getSnapshot();
    const canStartHermesShell = runtime.id === "hermes"
      && statusBeforeTurn.status === "ready"
      && statusBeforeTurn.mcpConnected !== false
      && (Boolean(runtimeRequest.userMessage.trim()) || Boolean(runtimeUserEvent))
      && Boolean(runtimeRequest.session);
    const reattachingHermesRun = runtime.id === "hermes"
      && Boolean(input.session?.hermesRun)
      && ["queued", "running", "waiting_for_approval", "stopping"].includes(input.session?.hermesRun?.status ?? "")
      && !input.userMessage.trim();
    const reattachAssistant = reattachingHermesRun
      ? input.session?.messages.findLast((message) => message.role === "assistant" && message.turnId === input.session?.hermesRun?.turnId)
      : undefined;
    const runtimeShell = canStartHermesShell && runtimeRequest.session
      ? await state.beginRuntimeShell({
          session: runtimeRequest.session,
          userMessage: runtimeRequest.userMessage,
          runtimeId: "hermes",
          turnId: runtimeRequest.turnId,
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
          ? allowedToolManifestForStep(
              runtimeRequest.session.taskState.workflowId,
              runtimeRequest.session.taskState.stage,
              registry.manifest()
            ).map((tool) => String(tool.name))
          : [],
        allowedCareerToolNames: runtimeRequest.session?.taskState
          ? [
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
        } else if (eventData) {
          if (eventData.fallbackUsed === true) runtimeStatus.update({ activeRuntime: "native", status: "ready" });
          else if (runtime.id === "hermes") runtimeStatus.update({ activeRuntime: "hermes", status: "ready" });
        }
      }
    } finally {
      if (runtime.id === "hermes") mcpBridge.setConfirmationContext(undefined);
      if (sessionBindingSet) await mcpBridge.setSessionBinding(undefined).catch(() => undefined);
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
    const prepared = await state.prepareRuntimeUserEvent({ session, event, pageContext: input.pageContext });
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
    mcpBridge
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
    let healthRefreshInFlight: Promise<void> | undefined;
    host.runtimeStatus.update({ status: host.runtimeRouter.configurationSnapshot.agentRuntime === "hermes" ? "starting" : "ready" });
    const refreshHermesHealth = async () => {
      if (healthRefreshInFlight) return healthRefreshInFlight;
      healthRefreshInFlight = (async () => {
        try {
          let health: Awaited<ReturnType<typeof host.hermesRuntime.health>> | undefined;
          for (let attempt = 0; attempt < 4; attempt += 1) {
            health = await host.hermesRuntime.health();
            const mcpReady = health.mcpConnected === true && (health.discoveredToolCount ?? 0) > 0;
            if (mcpReady || attempt === 3) break;
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
          if (!health || !active) return;
          const runtimeHealth = toRuntimeHealth(health, {
            mcpConnected: health.mcpConnected ?? false,
            mcpToolCount: health.discoveredToolCount ?? 0,
            careerSkillsLoaded: health.runtimeHealth?.careerSkillsLoaded ?? false
          });
          host.runtimeStatus.recordHealth(runtimeHealth);
          host.runtimeStatus.update({
            version: health.version,
            provider: health.provider,
            mcpServer: health.mcpServer ?? "careeradapt",
            health: runtimeHealth,
            roadshowMode: health.roadshowMode === true
          });
        } catch (error) {
          if (active) host.runtimeStatus.update({ status: "unavailable", activeRuntime: "native", reason: error instanceof Error ? error.message : "hermes_health_failed" });
        } finally {
          healthRefreshInFlight = undefined;
        }
      })();
      return healthRefreshInFlight;
    };
    const boot = async () => {
      await host.mcpBridge.start(
        host.careerToolGateway,
        (status) => {
          if (!active) return;
          host.runtimeStatus.recordMcp(status);
          if (status.connected && status.discoveredToolCount > 0) void refreshHermesHealth();
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
        async ({ request, result }) => {
          if (!active || !result.ok) return;
          const context = host.state.getSnapshot().activeSession;
          const confirmationContext = context?.activeTurn;
          if (!context || !confirmationContext) return;
          const assistant = context.messages.findLast((message) => message.role === "assistant" && message.turnId === confirmationContext.id);
          if (!assistant) return;
          const contract = host.careerToolGateway.listContracts().find((candidate) => candidate.name === request.name);
          await host.state.applyRuntimeEvent({
            type: "tool_call_completed",
            sessionId: context.id,
            turnId: confirmationContext.id,
            timestamp: new Date().toISOString(),
            toolName: request.name,
            operationId: request.operationId,
            data: { result, contract }
          }, assistant.id);
        }
      );
      if (!active || host.runtimeRouter.configurationSnapshot.agentRuntime !== "hermes") return;
      await refreshHermesHealth();
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
