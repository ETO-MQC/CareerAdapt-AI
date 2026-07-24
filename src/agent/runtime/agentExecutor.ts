import type { AgentConfirmation } from "../contracts/agentSession";
import type { AgentToolResult } from "../contracts/agentTool";
import { AgentToolRegistry } from "../tools/registry";

export class AgentConfirmationRequiredError extends Error {
  readonly code = "agent_confirmation_required";

  constructor(readonly confirmation: AgentConfirmation) {
    super("This tool call requires explicit user confirmation.");
  }
}

export class AgentExecutor {
  private readonly results = new Map<string, AgentToolResult>();

  constructor(private readonly registry: AgentToolRegistry) {}

  getCachedResult(operationId: string) {
    return this.results.get(operationId);
  }

  getDefinition(toolName: string) {
    return this.registry.require(toolName);
  }

  async execute(input: {
    toolName: string;
    toolInput: unknown;
    operationId: string;
    signal?: AbortSignal;
    confirmed?: boolean;
    confirmationCount?: number;
  }) {
    const cached = this.results.get(input.operationId);
    if (cached) {
      if (cached.toolName !== input.toolName) throw Object.assign(new Error("operation_id_conflict"), { code: "operation_id_conflict" });
      return cached;
    }

    const tool = this.registry.require(input.toolName);
    const confirmationCount = input.confirmationCount ?? (input.confirmed ? 1 : 0);
    const requiredConfirmations = tool.risk === "destructive" ? 2 : tool.requiresConfirmation ? 1 : 0;
    if (confirmationCount < requiredConfirmations) {
      const now = new Date().toISOString();
      throw new AgentConfirmationRequiredError({
        id: `confirmation-${input.operationId}`,
        operationId: input.operationId,
        toolName: input.toolName,
        title: confirmationTitle(input.toolName),
        description: tool.description,
        destructive: tool.risk === "destructive",
        status: "pending",
        requestedAt: now
      });
    }

    const result = await this.registry.execute(input.toolName, input.toolInput, input.operationId, input.signal);
    if (tool.idempotent || result.ok) this.results.set(input.operationId, result);
    return result;
  }
}

function confirmationTitle(toolName: string) {
  const titles: Record<string, string> = {
    commit_resume_import: "确认写入简历与资料库",
    commit_job: "确认保存岗位",
    answer_tailoring_question: "确认使用你补充的能力信息",
    apply_tailoring_changes: "确认应用简历修改"
  };
  return titles[toolName] ?? "确认执行此操作";
}
