import { describe, expect, it } from "vitest";
import { normalizeAgentMessageText } from "@/components/agent/AgentConversation";

describe("agent language guard", () => {
  it("removes internal repair/planner fallback prose from visible messages", () => {
    expect(normalizeAgentMessageText("Please provide the specific action JSON.\n请继续补充材料。")).toBe("请继续补充材料。");
    expect(normalizeAgentMessageText("I can help you repair the action.\n已保留当前任务。")).toBe("已保留当前任务。");
  });
});

