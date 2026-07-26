export type AgentStreamEvent =
  | { type: "turn_ack"; sessionId?: string }
  | { type: "thinking"; stage: string; label: string }
  | { type: "skill_loaded"; skillId: string; label: string }
  | { type: "assistant_start"; messageId?: string }
  | { type: "assistant_delta"; delta: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "ui_action"; action: unknown }
  | { type: "tool_started"; toolName: string; operationId: string; userLabel: string }
  | { type: "tool_result"; toolName: string; operationId: string; ok: boolean; summary: string; artifactIds?: string[] }
  | { type: "confirmation_required"; confirmation: unknown }
  | { type: "workflow_updated"; workflowState: unknown }
  | { type: "done"; action?: unknown; message?: string }
  | { type: "error"; code: string; message: string };

export type AgentModelWireEvent =
  | { type: "model_text_delta"; delta: string }
  | { type: "model_tool_call_start"; index: number; id: string; name: string }
  | { type: "model_tool_arguments_delta"; index: number; id: string; delta: string }
  | { type: "model_tool_call_complete"; index: number; call: { id: string; name: string; arguments: Record<string, unknown> } }
  | { type: "model_usage"; inputTokens?: number; outputTokens?: number }
  | { type: "model_finish"; stopReason: "final" | "tool_calls" | "ask_user" | "confirmation" | "length" | "error" };

export async function* parseAgentSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AgentStreamEvent | AgentModelWireEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseFrame(frame);
      if (event) yield event;
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  const event = parseFrame(buffer);
  if (event) yield event;
}

export function encodeAgentSseEvent(event: AgentStreamEvent | AgentModelWireEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseFrame(frame: string): AgentStreamEvent | AgentModelWireEvent | undefined {
  const data = frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
  if (!data) return undefined;
  return JSON.parse(data) as AgentStreamEvent | AgentModelWireEvent;
}

