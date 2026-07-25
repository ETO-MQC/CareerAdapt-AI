import { describe, expect, it } from "vitest";
import { AgentPlannerActionSchema } from "@/agent/runtime/agentRuntime";
import { normalizeAgentPlannerAction } from "@/agent/runtime/normalizeAgentPlannerAction";

describe("normalizeAgentPlannerAction", () => {
  it("normalizes common action and tool call aliases", () => {
    const normalized = normalizeAgentPlannerAction({
      action: "tool_call",
      call: {
        tool_name: "read_resume",
        operation_id: "operation-123",
        arguments: { resumeId: "resume-1" },
        reasoning: "display-only"
      }
    });

    expect(normalized).toEqual({
      type: "tool_call",
      calls: [{
        toolName: "read_resume",
        operationId: "operation-123",
        input: { resumeId: "resume-1" }
      }]
    });
  });

  it("strips display fields and preserves useful choices on ask_user", () => {
    const normalized = normalizeAgentPlannerAction({
      action: "ask_clarification",
      content: "选择继续方式",
      reasoning: "hidden",
      nextStep: "hidden",
      options: [
        { value: "existing", label: "使用现有简历", description: "ignored" },
        "从零创建"
      ]
    });

    expect(AgentPlannerActionSchema.parse(normalized)).toEqual({
      type: "ask_user",
      message: "选择继续方式",
      options: [
        { id: "option-使用现有简历", label: "使用现有简历", action: { type: "answer", field: "choice", value: "existing" } },
        { id: "option-从零创建", label: "从零创建", action: { type: "answer", field: "choice", value: "从零创建" } }
      ]
    });
  });

  it.each([
    ["complete", "workflow_complete"],
    ["failed", "workflow_failed"]
  ])("maps %s to %s", (alias, expected) => {
    const normalized = normalizeAgentPlannerAction({
      action: alias,
      content: "done",
      code: "failed"
    });
    expect((normalized as { type: string }).type).toBe(expected);
  });
});
