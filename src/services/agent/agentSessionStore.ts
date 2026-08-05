import { serializeAgentSession, type AgentSession } from "@/agent/contracts/agentSession";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type { ProfileIntakeSourceTurn } from "@/domain/profileIntake/ProfileIntakeSourceTurn";
import type { ImportedResumeDraft } from "@/domain/schemas";

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

  saveProfileIntakeSourceTurn(turn: ProfileIntakeSourceTurn) {
    return this.repository.saveProfileIntakeSourceTurn(turn);
  }

  updateProfileIntakeSourceTurn(
    identity: Pick<ProfileIntakeSourceTurn, "sessionId" | "messageId" | "turnId">,
    patch: Partial<Omit<ProfileIntakeSourceTurn, "sessionId" | "messageId" | "turnId">>
  ) {
    return this.repository.updateProfileIntakeSourceTurn(identity, patch);
  }

  getProfileIntakeSourceTurn(identity: Pick<ProfileIntakeSourceTurn, "sessionId" | "messageId" | "turnId">) {
    return this.repository.getProfileIntakeSourceTurn(identity);
  }

  listProfileIntakeSourceTurns(sessionId?: string) {
    return this.repository.listProfileIntakeSourceTurns(sessionId);
  }

  getImportedResumeDraft(importId: string) {
    return this.repository.getImportedResumeDraft(importId);
  }

  saveImportedResumeDraft(draft: ImportedResumeDraft, expectedRevision?: number) {
    return this.repository.saveImportedResumeDraft(draft, expectedRevision);
  }

  saveAgentProtocolDiagnostic(diagnostic: Record<string, unknown>) {
    return this.repository.saveAgentProtocolDiagnostic(diagnostic);
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

  async exportJson(id: string) {
    const session = await this.get(id);
    if (!session) throw Object.assign(new Error("Agent session not found."), { code: "agent_session_not_found" });
    return JSON.stringify(serializeAgentSession(session), null, 2);
  }
}
