import type { AgentRuntimeEvent } from "./agentRuntime";

export type AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void;

/** Small UI-safe subscription boundary for the stable RuntimeEvent protocol. */
export class AgentRuntimeEventBus {
  private readonly listeners = new Set<AgentRuntimeEventListener>();

  subscribe(listener: AgentRuntimeEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AgentRuntimeEvent) {
    for (const listener of this.listeners) listener(event);
    return event;
  }
}
