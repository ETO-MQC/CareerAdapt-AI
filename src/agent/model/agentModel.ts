import { z } from "zod";

export const AgentModelToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown())
}).strict();

export const AgentModelMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
  toolCalls: z.array(AgentModelToolCallSchema).optional()
}).strict();

export const AgentModelToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown())
}).strict();

export const AgentModelResultSchema = z.object({
  text: z.string().optional(),
  toolCalls: z.array(AgentModelToolCallSchema).max(4).optional(),
  stopReason: z.enum(["final", "tool_calls", "ask_user", "confirmation", "length", "error"]),
  usage: z.object({
    inputTokens: z.number().int().min(0).optional(),
    outputTokens: z.number().int().min(0).optional()
  }).strict().optional()
}).strict();

export const AgentModelRequestSchema = z.object({
  systemPrompt: z.string().min(1).max(40_000),
  messages: z.array(AgentModelMessageSchema).min(1).max(80),
  tools: z.array(AgentModelToolSchema).max(32)
}).strict();

export type AgentModelToolCall = z.infer<typeof AgentModelToolCallSchema>;
export type AgentModelMessage = z.infer<typeof AgentModelMessageSchema>;
export type AgentModelTool = z.infer<typeof AgentModelToolSchema>;
export type AgentModelResult = z.infer<typeof AgentModelResultSchema>;
export type AgentModelRequest = z.infer<typeof AgentModelRequestSchema>;

export type AgentModelStreamEvent =
  | { type: "assistant_text_delta"; delta: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "tool_call_arguments_delta"; index: number; id: string; delta: string }
  | { type: "tool_call_complete"; index: number; call: AgentModelToolCall }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "finish"; stopReason: AgentModelResult["stopReason"] };

export interface AgentModel {
  readonly capabilities?: {
    nativeToolStreaming: boolean;
  };
  completeWithTools(request: AgentModelRequest & { signal?: AbortSignal }): Promise<AgentModelResult>;
  streamTurn?(
    request: AgentModelRequest & { signal?: AbortSignal }
  ): AsyncIterable<AgentModelStreamEvent>;
  streamFinalText?(
    request: AgentModelRequest & { draft: string; signal?: AbortSignal }
  ): AsyncIterable<string>;
}
