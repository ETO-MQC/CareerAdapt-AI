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
    const task = session.taskState;
    return {
      working: {
        workflowId: task?.workflowId ?? session.workflowState.workflowId,
        step: task?.stage ?? session.workflowState.step,
        rootGoal: task?.rootGoal,
        activeGoal: task?.activeGoal,
        selectedEntities: task?.selectedEntities,
        pendingDecision: task?.pendingDecision
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
