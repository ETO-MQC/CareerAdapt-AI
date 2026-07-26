import type { AgentToolDefinition } from "@/agent/contracts/agentTool";
import type { AgentToolRegistry } from "@/agent/tools/registry";
import { allowedToolManifestForStep, getWorkflowDefinition } from "@/agent/workflows/workflowRegistry";
import type { AgentSkill } from "./AgentSkillRegistry";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { AgentCapabilityBroker } from "./AgentCapabilityBroker";
import { z } from "zod";

export class AgentToolResolver {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly broker = new AgentCapabilityBroker()
  ) {}

  allowedTools(input: {
    workflowId: string;
    step: string;
    skills: AgentSkill[];
    session?: AgentSession;
    userMessage?: string;
  }) {
    const manifest = this.registry.manifest();
    const workflow = getWorkflowDefinition(input.workflowId);
    const workflowAllowed = workflow
      ? allowedToolManifestForStep(input.workflowId, input.step, manifest)
      : [];
    const workflowToolNames = workflowAllowed.map((tool) => String(tool.name));
    const allowedNames = new Set(
      input.session && input.userMessage !== undefined
        ? this.broker.allowedToolNames({
            session: input.session,
            userMessage: input.userMessage,
            workflowToolNames
          })
        : workflowToolNames.length
          ? workflowToolNames
          : ["get_active_profile", "get_profile", "search_profile_facts"]
    );
    return manifest
      .filter((tool) => allowedNames.has(String(tool.name)))
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
