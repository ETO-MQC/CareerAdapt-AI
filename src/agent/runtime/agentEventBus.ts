import { AgentEventSchema, type AgentEvent } from "../contracts/agentEvent";

export type AgentEventListener = (event: AgentEvent) => void;

export class AgentEventBus {
  private readonly listeners = new Set<AgentEventListener>();

  subscribe(listener: AgentEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(rawEvent: AgentEvent) {
    const event = AgentEventSchema.parse(rawEvent);
    for (const listener of this.listeners) listener(event);
    return event;
  }
}
