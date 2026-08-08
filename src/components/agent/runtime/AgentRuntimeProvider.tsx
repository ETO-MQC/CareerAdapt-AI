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
import { CareerToolGateway, CareerToolGatewayExecutor } from "@/agent/tools/CareerToolGateway";
import { AgentRuntimeEventBus } from "@/agent/runtime/agentRuntimeEventBus";
import type { AgentRuntimeTurnInput } from "@/agent/runtime/agentRuntime";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import { HttpHermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { CareerAdaptMcpBridgeClient } from "@/agent/mcp/CareerAdaptMcpBridgeClient";
import { RuntimeStatusStore } from "@/agent/runtime/runtimeStatus";

function createAgentHost() {
  const service = new BrowserAgentToolService();
  const registry = createAgentToolRegistry(service);
  const rawExecutor = new AgentExecutor(registry);
  const careerToolGateway = new CareerToolGateway({ registry, executor: rawExecutor });
  const executor = new CareerToolGatewayExecutor(registry, careerToolGateway);
  const store = new AgentSessionStore();
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
    discoveredToolCount: 0
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
        ...(runtimeShell ? {
          runtimeShellMessageId: runtimeShell.assistantMessageId,
          runtimeShellUserMessageId: runtimeShell.userMessageId
        } : {})
      }
    };
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
      await host.mcpBridge.start(host.careerToolGateway, (status) => {
        if (active) host.runtimeStatus.recordMcp(status);
      });
      if (!active || host.runtimeRouter.configurationSnapshot.agentRuntime !== "hermes") return;
      try {
        const health = await host.hermesRuntime.health();
        if (!active) return;
        const mcpReady = health.mcpConnected !== false;
        host.runtimeStatus.update({
          status: health.available && mcpReady ? "ready" : health.available ? "starting" : "unavailable",
          activeRuntime: health.available && mcpReady ? "hermes" : "native",
          reason: !mcpReady && health.available ? "careeradapt_mcp_not_connected" : health.reason,
          version: health.version,
          provider: health.provider,
          model: health.model,
          contextWindow: health.contextWindow,
          toolCalling: health.toolCalling,
          mcpServer: health.mcpServer ?? "careeradapt",
          mcpConnected: health.mcpConnected,
          discoveredToolCount: health.discoveredToolCount
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
