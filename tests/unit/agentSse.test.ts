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

  it("parses activity, Skill, tool result, and workflow update events", async () => {
    const frames = [
      { type: "thinking", stage: "planning", label: "正在规划下一步" },
      { type: "skill_loaded", skillId: "jd-analysis", label: "已加载岗位分析方法" },
      { type: "tool_started", toolName: "get_job", operationId: "operation-job-1", userLabel: "正在读取目标岗位" },
      { type: "tool_result", toolName: "get_job", operationId: "operation-job-1", ok: true, summary: "已读取岗位详情。" },
      { type: "workflow_updated", workflowState: { step: "review_result" } }
    ];
    const body = frames.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    const parsed = [];
    for await (const event of parseAgentSseStream(stream(body))) parsed.push(event);
    expect(parsed).toEqual(frames);
  });
});
