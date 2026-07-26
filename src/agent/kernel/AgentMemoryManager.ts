import type { AgentSession } from "@/agent/contracts/agentSession";

export type AgentMemoryContext = {
  working: Record<string, unknown>;
  userPreferences: string[];
  episodic: string[];
  procedural: string[];
  careerProfilePointers: string[];
};

export class AgentMemoryManager {
  retrieve(session: AgentSession): AgentMemoryContext {
    const memory = session.memory;
    return {
      working: {
        workflowId: session.workflowState.workflowId,
        step: session.workflowState.step,
        ...session.workflowState.data
      },
      userPreferences: memory?.userPreferences ?? [],
      episodic: memory?.episodic ?? [],
      procedural: memory?.procedural ?? [],
      careerProfilePointers: [
        session.activeProfileId ? `activeProfileId:${session.activeProfileId}` : "",
        session.activeResumeId ? `activeResumeId:${session.activeResumeId}` : "",
        session.activeJobId ? `activeJobId:${session.activeJobId}` : ""
      ].filter(Boolean)
    };
  }

  compact(context: AgentMemoryContext) {
    return JSON.stringify({
      working: context.working,
      userPreferences: context.userPreferences.slice(-8),
      episodic: context.episodic.slice(-8),
      procedural: context.procedural.slice(-8),
      careerProfilePointers: context.careerProfilePointers
    });
  }
}
