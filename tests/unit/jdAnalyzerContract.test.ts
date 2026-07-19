import { describe, expect, it } from "vitest";
import { stageBTaskRegistry, type JdAnalyzerTaskInput } from "@/ai/tasks/registry";
import { JdAnalyzerOutputSchema, JdDraftPrioritySchema, normalizeJdPriority } from "@/domain/schemas";

const input: JdAnalyzerTaskInput = {
  title: "数据产品经理",
  company: "示例公司",
  rawText: "负责数据产品规划。熟练使用 SQL。英语可作为工作语言。本科及以上学历。三年以上相关经验。有 SaaS 经验者优先。",
  inputHash: "jd-contract-input-hash"
};

function coerce(requirements: Array<Record<string, unknown>>) {
  const definition = stageBTaskRegistry["jd-analyzer"];
  return JdAnalyzerOutputSchema.parse(definition.coerceRawOutput({ requirements }, input));
}

describe("JD analyzer canonical contract", () => {
  it.each(["high", "medium"] as const)("accepts canonical priority %s", (priority) => {
    const output = coerce([{ description: "熟练使用 SQL", category: "tool_or_technology", priority }]);
    expect(output.requirements[0].priority).toBe(priority);
  });

  it("reads legacy priority values without leaking them into the canonical draft", () => {
    expect(JdDraftPrioritySchema.parse("important")).toBe("high");
    expect(JdDraftPrioritySchema.parse("low")).toBe("medium");
    expect(normalizeJdPriority("unexpected")).toBe("uncertain");
  });

  it("normalizes the complete category vocabulary", () => {
    const output = coerce([
      { description: "熟练使用 SQL", category: "tool_or_technology", priority: "high" },
      { description: "英语可作为工作语言", category: "language", priority: "medium" },
      { description: "本科及以上学历", category: "education", priority: "must" },
      { description: "三年以上相关经验", category: "experience_depth", priority: "high" },
      { description: "有 SaaS 经验者优先", category: "preferred", priority: "nice_to_have" }
    ]);
    expect(output.requirements.map((item) => item.category)).toEqual(["tool", "language", "education", "experience", "preferred_skill"]);
  });

  it("repairs a missing sourceQuote before schema parsing with a real JD segment", () => {
    const output = coerce([{ description: "熟练使用 SQL", category: "tool", priority: "high", confidenceLevel: "high", needsConfirmation: false }]);
    expect(output.requirements[0]).toMatchObject({ sourceQuote: "熟练使用 SQL", sourceSpan: { text: "熟练使用 SQL" }, confidenceLevel: "low", needsConfirmation: true });
    expect(input.rawText).toContain(output.requirements[0].sourceQuote);
  });

  it("uses a deterministic source segment when aliases cannot be located", () => {
    const output = coerce([{ description: "模型臆造的要求", quote: "不存在的原文", category: "other", priority: "strange" }]);
    expect(input.rawText).toContain(output.requirements[0].sourceQuote);
    expect(output.requirements[0]).toMatchObject({ confidenceLevel: "low", needsConfirmation: true, priority: "uncertain" });
  });
});
