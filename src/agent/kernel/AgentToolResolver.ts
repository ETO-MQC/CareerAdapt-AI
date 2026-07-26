import type { AgentToolDefinition } from "@/agent/contracts/agentTool";
import type { AgentToolRegistry } from "@/agent/tools/registry";
import { allowedToolManifestForStep, getWorkflowDefinition } from "@/agent/workflows/workflowRegistry";
import type { AgentSkill } from "./AgentSkillRegistry";
import { z } from "zod";

const safeConversationReads = new Set([
  "list_profiles", "get_active_profile", "get_profile", "search_profile_facts",
  "list_resumes", "get_resume", "get_resume_revision",
  "list_jobs", "get_job", "get_agent_task_context", "search_agent_sessions",
  "parse_job_description", "analyze_job_fit", "create_tailoring_session",
  "preview_tailoring_changes", "skills_list", "skill_view"
]);

export class AgentToolResolver {
  constructor(private readonly registry: AgentToolRegistry) {}

  allowedTools(input: { workflowId: string; step: string; skills: AgentSkill[] }) {
    const manifest = this.registry.manifest();
    const workflow = getWorkflowDefinition(input.workflowId);
    const workflowAllowed = workflow
      ? allowedToolManifestForStep(input.workflowId, input.step, manifest)
      : manifest.filter((tool) => safeConversationReads.has(String(tool.name)));
    const skillTools = new Set(input.skills.flatMap((skill) => skill.relevantTools));
    const procedural = new Set(["skills_list", "skill_view", "get_agent_task_context", "search_agent_sessions"]);
    return workflowAllowed
      .filter((tool) => !input.skills.length || skillTools.has(String(tool.name)) || procedural.has(String(tool.name)))
      .map((tool) => this.registry.require(String(tool.name)));
  }

  modelManifest(tools: AgentToolDefinition[]) {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>
    }));
  }
}
