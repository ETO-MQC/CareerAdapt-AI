import type { AgentSession } from "@/agent/contracts/agentSession";
import type { AgentPageContext } from "@/agent/contracts/agentContext";
import type { AgentMemoryContext } from "./AgentMemoryManager";
import type { AgentSkill } from "./AgentSkillRegistry";

export class AgentContextAssembler {
  assemble(input: {
    session: AgentSession;
    pageContext: AgentPageContext;
    userMessage: string;
    memory: AgentMemoryContext;
    activeSkills: AgentSkill[];
  }) {
    const workflow = input.session.workflowState;
    return [
      "Tier 1 — stable policy",
      "You are CareerAdapt AI, a career orchestration agent over existing domain tools.",
      "CareerProfile and FactProvenance are authoritative career memory. Never invent or silently upgrade facts, dates, metrics, titles, proficiency, salary, or years of experience.",
      "Never claim that a profile, resume, or job is absent without using the corresponding read tool in this turn.",
      "For identity or profile-library questions, first call get_active_profile, then get_profile or search_profile_facts as needed.",
      "Write tools must stop at their confirmation boundary. Never expose hidden reasoning, raw planner JSON, schemas, operation IDs, or engineering tool names.",
      "",
      "Tier 2 — task",
      JSON.stringify({
        workflowId: workflow.workflowId,
        step: workflow.step,
        status: workflow.status,
        requiredSlots: Object.keys(workflow.data),
        activeSkills: input.activeSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          procedure: skill.procedure,
          factRules: skill.factRules,
          confirmationBoundaries: skill.confirmationBoundaries
        }))
      }),
      "",
      "Tier 3 — memory pointers (not a copy of CareerProfile)",
      JSON.stringify(input.memory),
      "",
      "Tier 4 — volatile context",
      JSON.stringify({ pageContext: input.pageContext, latestUserTurn: input.userMessage }),
      "",
      "Return a concise user-visible final answer in the user's language, or use the allowed tools. Use tools autonomously when facts are needed."
    ].join("\n");
  }
}
