import { describe, expect, it } from "vitest";
import { parseOpenAiJsonSse } from "@/ai/providers/openAiToolSse";

describe("OpenAI native tool SSE", () => {
  it("parses tool-call argument fragments split across network chunks", async () => {
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "commit_job", arguments: '{"title":"AI' } }] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ' 工程师","company":"A"}' } }] }, finish_reason: "tool_calls" }] })}\n\n`,
      "data: [DONE]\n\n"
    ].join("");
    const bytes = new TextEncoder().encode(frames);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 37));
        controller.enqueue(bytes.slice(37, 111));
        controller.enqueue(bytes.slice(111));
        controller.close();
      }
    });
    const payloads = [];
    for await (const payload of parseOpenAiJsonSse(stream)) payloads.push(payload);
    expect(payloads).toHaveLength(2);
    const fragments = payloads.flatMap((payload) => {
      const choices = payload.choices as Array<{ delta?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
      return choices?.[0]?.delta?.tool_calls?.map((call) => call.function?.arguments ?? "") ?? [];
    });
    expect(fragments.join("")).toBe('{"title":"AI 工程师","company":"A"}');
  });
});
