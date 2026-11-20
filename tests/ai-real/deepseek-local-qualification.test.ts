import { expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";
import type { AgentModelMessage, AgentModelTool } from "@/agent/model/agentModel";

const apiKey = process.env.CAREERADAPT_DEEPSEEK_API_KEY;
if (!apiKey) throw new Error("CAREERADAPT_DEEPSEEK_API_KEY is required for the explicit real-provider suite");
const provider = new OpenAiCompatibleProvider({ provider: "openai-compatible", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", apiKey });
const tools: AgentModelTool[] = [
  { name: "get_profile", description: "Read the confirmed synthetic profile", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_job", description: "Read the saved synthetic job", inputSchema: { type: "object", properties: {}, additionalProperties: false } }
];

it("performs thinking-mode multiple tool calls with provider continuation state", async () => {
  const messages: AgentModelMessage[] = [{ role: "user", content: "请调用 get_profile 和 get_job，读取后只根据两份结果总结匹配，不要推测未提供的事实。" }];
  const called = new Set<string>();
  let answer = "";
  for (let turn = 0; turn < 4; turn++) {
    const result = await provider.completeWithTools({ systemPrompt: "按用户要求调用工具，事实必须来自工具结果。", messages, tools, thinkingMode: "enabled" });
    if (!result.toolCalls?.length) { answer = result.text ?? ""; break; }
    expect(typeof result.reasoningContent).toBe("string");
    messages.push({ role: "assistant", content: result.text ?? "", toolCalls: result.toolCalls, reasoningContent: result.reasoningContent });
    for (const call of result.toolCalls) {
      expect(["get_profile", "get_job"]).toContain(call.name);
      expect(call.arguments).toEqual({});
      called.add(call.name);
      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(call.name === "get_profile"
        ? { experience: "示例科技产品运营实习，整理用户反馈" }
        : { requirement: "用户反馈整理，掌握 SQL 为加分项" }) });
    }
  }
  expect([...called].sort()).toEqual(["get_job", "get_profile"]);
  expect(answer.length).toBeGreaterThan(0);
  expect(answer).toContain("反馈");
}, 90_000);

it("parses structured candidate-shaped JSON in non-thinking mode", async () => {
  const result = await provider.invoke({ systemPrompt: "只返回 JSON 对象，不得添加没有来源的经历。",
    userPrompt: '将“我在示例科技做产品运营实习，负责整理用户反馈”转成 JSON，包含 organization 和 responsibility。',
    maxOutputChars: 4000, thinkingMode: "disabled", signal: AbortSignal.timeout(60_000) });
  expect(result.finishReason).toBe("stop");
  expect(JSON.stringify(result.output)).toContain("示例科技");
  expect(JSON.stringify(result.output)).toContain("反馈");
}, 70_000);

it("continues a streamed thinking-mode tool call without exposing reasoning as text", async () => {
  const messages: AgentModelMessage[] = [{ role: "user", content: "先调用 get_profile，再根据工具结果简要回答。" }];
  const events = [];
  for await (const event of provider.streamTurn({ systemPrompt: "先使用工具，回答只基于工具结果。", messages, tools, thinkingMode: "enabled" })) events.push(event);
  const callEvent = events.find(event => event.type === "tool_call_complete");
  const finish = events.find(event => event.type === "finish");
  expect(callEvent?.type).toBe("tool_call_complete");
  expect(finish?.type).toBe("finish");
  if (callEvent?.type !== "tool_call_complete" || finish?.type !== "finish") throw new Error("missing streamed tool call");
  expect(callEvent.call.name).toBe("get_profile");
  expect(callEvent.call.arguments).toEqual({});
  expect(typeof finish.reasoningContent).toBe("string");
  messages.push({ role: "assistant", content: "", toolCalls: [callEvent.call], reasoningContent: finish.reasoningContent });
  messages.push({ role: "tool", toolCallId: callEvent.call.id, content: JSON.stringify({ experience: "示例科技产品运营实习，整理用户反馈" }) });
  const result = await provider.completeWithTools({ systemPrompt: "先使用工具，回答只基于工具结果。", messages, tools, thinkingMode: "enabled" });
  expect(result.text).toContain("反馈");
}, 90_000);
