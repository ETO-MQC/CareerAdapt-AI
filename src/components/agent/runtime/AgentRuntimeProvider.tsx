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
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import { HttpHermesBridgeTransport, toRuntimeHealth } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { CareerAdaptMcpBridgeClient } from "@/agent/mcp/CareerAdaptMcpBridgeClient";
import { RuntimeStatusStore } from "@/agent/runtime/runtimeStatus";
import { resolveCareerSessionBinding, type CareerSessionBinding } from "@/agent/runtime/careerSessionBinding";
import { WorkspaceRepository } from "@/services/storage/repositories";

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
      return state.startTurn({
        session,
        userMessage: input.userMessage,
        pageContext: input.pageContext,
        turnId: input.turnId,
        runtimeId: "native",
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
    const statusBeforeTurn = runtimeStatus.getSnapshot();
    const canStartHermesShell = runtime.id === "hermes"
      && statusBeforeTurn.status === "ready"
      && statusBeforeTurn.mcpConnected !== false
      && Boolean(input.userMessage.trim())
      && Boolean(input.session);
    const runtimeShell = canStartHermesShell && input.session
      ? await state.beginRuntimeShell({
          session: input.session,
          userMessage: input.userMessage,
          runtimeId: "hermes",
          turnId: input.turnId
        })
      : undefined;
    const runtimeInput: AgentRuntimeTurnInput = {
      ...input,
      ...(runtimeShell ? {
        session: runtimeShell.session,
        turnId: runtimeShell.turnId
      } : {}),
      metadata: {
        ...(input.metadata ?? {}),
        telemetry: true,
        runtimeId: runtime.id,
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
            assistantMessageId: runtimeShell.assistantMessageId
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
      for await (const event of runtime.runTurn(runtimeInput)) {
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
  return {
    service,
    registry,
    executor,
    store,
    eventBus: new AgentEventBus(),
    runtimeEventBus,
    runTurn,
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

const AgentRuntimeContext = createContext<AgentHost | undefined>(undefined);

export function AgentRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [host] = useState(createAgentHost);
  useEffect(() => {
    let active = true;
    host.runtimeStatus.update({ status: host.runtimeRouter.configurationSnapshot.agentRuntime === "hermes" ? "starting" : "ready" });
    const boot = async () => {
      await host.mcpBridge.start(
        host.careerToolGateway,
        (status) => {
          if (active) host.runtimeStatus.recordMcp(status);
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
        }
      );
      if (!active || host.runtimeRouter.configurationSnapshot.agentRuntime !== "hermes") return;
      try {
        const health = await host.hermesRuntime.health();
        if (!active) return;
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
        if (!active) return;
        host.runtimeStatus.update({ status: "unavailable", activeRuntime: "native", reason: error instanceof Error ? error.message : "hermes_health_failed" });
      }
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
