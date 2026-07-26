import type { AgentToolDefinition } from "@/agent/contracts/agentTool";

export interface ExternalToolProvider {
  listTools(): Promise<AgentToolDefinition[]>;
  execute(toolName: string, input: unknown, operationId: string, signal?: AbortSignal): Promise<unknown>;
}
