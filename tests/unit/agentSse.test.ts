import { describe, expect, it } from "vitest";
import { parseAgentSseStream } from "@/agent/runtime/agentSse";
import { parseOpenAiCompatibleSse } from "@/ai/providers/openAiSse";

function stream(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}

describe("agent sse parsing", () => {
  it("parses agent stream frames", async () => {
    const events = [];
    for await (const event of parseAgentSseStream(stream([
      "event: assistant_start",
      "data: {\"type\":\"assistant_start\"}",
      "",
      "event: assistant_delta",
      "data: {\"type\":\"assistant_delta\",\"delta\":\"你好\"}",
      "",
      "event: done",
      "data: {\"type\":\"done\",\"message\":\"你好\"}",
      "",
      ""
    ].join("\n")))) events.push(event);
    expect(events).toEqual([
      { type: "assistant_start" },
      { type: "assistant_delta", delta: "你好" },
      { type: "done", message: "你好" }
    ]);
  });

  it("parses OpenAI-compatible delta frames without waiting for JSON response", async () => {
    const deltas = [];
    for await (const delta of parseOpenAiCompatibleSse(stream([
      "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}",
      "",
      "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}",
      "",
      "data: [DONE]",
      "",
      ""
    ].join("\n")))) deltas.push(delta);
    expect(deltas.join("")).toBe("你好");
  });
});
