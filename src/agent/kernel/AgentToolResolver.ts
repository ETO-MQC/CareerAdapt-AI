import type { AgentToolDefinition } from "@/agent/contracts/agentTool";
import type { AgentToolRegistry } from "@/agent/tools/registry";
import { allowedToolManifestForStep, getWorkflowDefinition } from "@/agent/workflows/workflowRegistry";
import type { AgentSkill } from "./AgentSkillRegistry";
import type { AgentSession, AgentTaskState } from "@/agent/contracts/agentSession";
import { LegacyAgentCapabilityAdapter } from "./AgentCapabilityBroker";
import { AgentToolEligibility } from "./AgentToolEligibility";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { z } from "zod";

const ROUTE_B_EXACT_TOOL_EXCLUSIONS = new Set([
  "get_agent_task_context",
  "search_agent_sessions",
  "skills_list",
  "skill_view"
]);

export class AgentToolResolver {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly legacyCapabilityAdapter = new LegacyAgentCapabilityAdapter(),
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
    const workflowToolNames = workflowAllowed
      .map((tool) => String(tool.name))
      .filter((name) =>
        workflowId !== "tailor_existing_resume"
        || !ROUTE_B_EXACT_TOOL_EXCLUSIONS.has(name)
      );
    const diagnosticTurn = isRuntimeFailureQuestion(input.userMessage, taskState);
    if (diagnosticTurn) {
      for (const name of ["get_agent_current_task", "get_agent_last_failure", "get_agent_runtime_status"]) {
        if (!workflowToolNames.includes(name)) workflowToolNames.push(name);
      }
    }
    const capabilityToolNames = workflow
      ? workflowToolNames
      : input.session && input.userMessage !== undefined
        ? this.legacyCapabilityAdapter.allowedToolNames({
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

  narrowReadTools(names: string[]) {
    const requested = new Set(names);
    return this.registry.list().filter((tool) =>
      requested.has(tool.name) && tool.risk === "read"
    );
  }
}

function isRuntimeFailureQuestion(message: string | undefined, taskState?: AgentTaskState) {
  return Boolean(
    message
    && /^(?:为什么|为何|怎么回事)[？?。！!]?$/u.test(message.trim())
    && taskState?.selectedEntities.resumeId
    && taskState.selectedEntities.jobId
  );
}
