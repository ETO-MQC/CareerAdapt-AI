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

  listArchived(limit?: number) {
    return this.repository.listArchivedAgentSessions(limit);
  }

  archive(id: string) {
    return this.repository.archiveAgentSession(id);
  }

  unarchive(id: string) {
    return this.repository.unarchiveAgentSession(id);
  }

  rename(id: string, title: string) {
    return this.repository.renameAgentSession(id, title);
  }

  delete(id: string) {
    return this.repository.deleteAgentSession(id);
  }
}
