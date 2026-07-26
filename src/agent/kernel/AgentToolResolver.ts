import type { AgentToolDefinition } from "@/agent/contracts/agentTool";
import type { AgentToolRegistry } from "@/agent/tools/registry";
import { allowedToolManifestForStep, getWorkflowDefinition } from "@/agent/workflows/workflowRegistry";
import type { AgentSkill } from "./AgentSkillRegistry";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { AgentCapabilityBroker } from "./AgentCapabilityBroker";
import { AgentToolEligibility } from "./AgentToolEligibility";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { z } from "zod";

export class AgentToolResolver {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly broker = new AgentCapabilityBroker(),
    private readonly eligibility = new AgentToolEligibility()
  ) {}

  allowedTools(input: {
    workflowId: string;
    step: string;
    skills: AgentSkill[];
    session?: AgentSession;
    userMessage?: string;
  }) {
    const manifest = this.registry.manifest();
    const taskState = input.session
      ? input.session.taskState ?? new AgentTaskStateReducer().create(input.session)
      : undefined;
    const workflowId = taskState?.workflowId ?? input.workflowId;
    const step = taskState?.stage ?? input.step;
    const workflow = getWorkflowDefinition(workflowId);
    const workflowAllowed = workflow
      ? allowedToolManifestForStep(workflowId, step, manifest)
      : [];
    const workflowToolNames = workflowAllowed.map((tool) => String(tool.name));
    const capabilityToolNames =
      input.session && input.userMessage !== undefined
        ? this.broker.allowedToolNames({
            session: input.session,
            userMessage: input.userMessage,
            workflowToolNames
          })
        : workflowToolNames.length
          ? workflowToolNames
          : ["get_active_profile", "get_profile", "search_profile_facts"];
    if (!input.session) {
      const allowedNames = new Set(capabilityToolNames);
      return manifest.filter((tool) => allowedNames.has(String(tool.name))).map((tool) => this.registry.require(String(tool.name)));
    }
    return this.eligibility.eligible({
      tools: this.registry.list(),
      workflowToolNames,
      capabilityToolNames,
      taskState: taskState!
    });
  }

  modelManifest(tools: AgentToolDefinition[]) {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>
    }));
  }
}
