import type { ResumeImportProgress } from "@/services/resumeImport/ResumeImportOrchestrator";

type Listener = (progress: ResumeImportProgress) => void;

class AgentImportProgressBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(progress: ResumeImportProgress) {
    for (const listener of this.listeners) listener(progress);
  }
}

export const agentImportProgressBus = new AgentImportProgressBus();
