"use client";

import { createContext, useContext, useState } from "react";
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
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";

function createAgentHost() {
  const service = new BrowserAgentToolService();
  const registry = createAgentToolRegistry(service);
  const executor = new AgentExecutor(registry);
  const store = new AgentSessionStore();
  const kernel = new AgentKernel({
    model: new HttpAgentModel(),
    executor,
    toolResolver: new AgentToolResolver(registry),
    observationCache: new AgentObservationCache()
  });
  const state = new AgentHostStore({ kernel, executor, persistence: store, repository: store.getWorkspaceRepository() });
  const nativeRuntime = new NativeCareerAgentRuntime({
    runTurn: async (input) => {
      const session = input.session?.id === input.sessionId
        ? input.session
        : state.getSnapshot().activeSession?.id === input.sessionId
          ? state.getSnapshot().activeSession
          : undefined;
      if (!session) throw Object.assign(new Error("runtime_session_required"), { code: "runtime_session_required" });
      return state.startTurn({
        session,
        userMessage: input.userMessage,
        pageContext: input.pageContext
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
  const runtimeRouter = createAgentRuntimeRouter({ native: nativeRuntime });
  const careerToolGateway = new CareerToolGateway({ registry, executor });
  return {
    service,
    registry,
    executor,
    store,
    eventBus: new AgentEventBus(),
    kernel,
    state,
    careerToolGateway,
    runtimeRouter
  };
}

export type AgentHost = ReturnType<typeof createAgentHost>;

const AgentRuntimeContext = createContext<AgentHost | undefined>(undefined);

export function AgentRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [host] = useState(createAgentHost);
  return <AgentRuntimeContext.Provider value={host}>{children}</AgentRuntimeContext.Provider>;
}

export function useAgentHost() {
  const host = useContext(AgentRuntimeContext);
  if (!host) throw new Error("useAgentHost must be used within AgentRuntimeProvider.");
  return host;
}
