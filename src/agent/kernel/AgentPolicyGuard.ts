import { stableHashText } from "@/services/security/text";
import type { AgentModelToolCall } from "@/agent/model/agentModel";
import type { AgentToolDefinition } from "@/agent/contracts/agentTool";

export class AgentPolicyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AgentPolicyError";
  }
}

export class AgentPolicyGuard {
  private readonly callHashes = new Set<string>();

  validate(input: {
    call: AgentModelToolCall;
    allowedTools: AgentToolDefinition[];
    toolCallCount: number;
    maxToolCalls: number;
  }) {
    if (input.toolCallCount >= input.maxToolCalls) {
      throw new AgentPolicyError("agent_tool_budget_exceeded", "Tool call budget exceeded.");
    }
    const tool = input.allowedTools.find((candidate) => candidate.name === input.call.name);
    if (!tool) throw new AgentPolicyError("agent_tool_not_allowed", "Requested tool is not available in the current workflow step.");
    const parsedInput = tool.inputSchema.parse(input.call.arguments);
    const callHash = stableHashText(`${tool.name}:${stableStringify(parsedInput)}`);
    if (this.callHashes.has(callHash)) {
      throw new AgentPolicyError("agent_duplicate_tool_call", "Equivalent tool call was already executed in this turn.");
    }
    this.callHashes.add(callHash);
    return { tool, input: parsedInput, callHash };
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
