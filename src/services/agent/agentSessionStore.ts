import type { AgentSession } from "@/agent/contracts/agentSession";
import { WorkspaceRepository } from "@/services/storage/repositories";

export class AgentSessionStore {
  constructor(private readonly repository = new WorkspaceRepository()) {}

  save(session: AgentSession) {
    return this.repository.saveAgentSession(session);
  }

  get(sessionId: string) {
    return this.repository.getAgentSession(sessionId);
  }

  list(limit?: number) {
    return this.repository.listAgentSessions(limit);
  }
}
