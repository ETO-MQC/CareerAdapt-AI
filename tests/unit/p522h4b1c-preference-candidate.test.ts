import { describe, expect, it } from "vitest";
import { preparePreferenceCandidate } from "@/agent/workflows/careerPreferenceCandidate";
import { sha256Utf8 } from "@/domain/jobAssets/sha256";

const binding = { personId: "person-1", profileId: "profile-1", profileRevision: 4 };
function interpret(sourceText: string, patch: unknown, intent = "candidate") {
  return preparePreferenceCandidate({ interpretation: { intent, patch, sourceQuote: sourceText }, sourceText,
    sourceUserMessageId: "message-1", sourceTurnId: "turn-1", binding });
}

describe("source-bound preference candidate", () => {
  it.each([
    ["我最近也开始考虑跨境电商运营", { additions: { targetRoles: ["跨境电商运营"] } }],
    ["以后优先郑州", { additions: { targetCities: ["郑州"] } }],
    ["我现在主要看新能源行业", { additions: { industries: ["新能源"] } }],
    ["以后不考虑银行了", { removals: { industries: ["银行"] } }]
  ])("retains current-turn evidence for %s", (text, patch) => {
    const result = interpret(text, patch);
    expect(result).toMatchObject({ kind: "candidate", candidate: { personId: binding.personId, profileId: binding.profileId,
      expectedProfileRevision: 4, sourceUserMessageId: "message-1", sourceTurnId: "turn-1", sourceTextHash: sha256Utf8(text), sourceQuote: text, patch } });
  });
  it.each(["帮我看看上海的岗位", "今天看看跨境电商", "这个深圳岗位怎么样", "先搜一下银行岗位"])("does not retain temporary intent: %s", text => {
    expect(interpret(text, { additions: { targetRoles: [text.includes("银行") ? "银行" : text.includes("深圳") ? "深圳" : text.includes("上海") ? "上海" : "跨境电商"] } })).toEqual({ kind: "none" });
  });
  it("asks for clarification when persistence is ambiguous", () => {
    expect(interpret("上海的岗位也可以看看", { additions: { targetCities: ["上海"] } }, "ambiguous").kind).toBe("clarification");
  });
  it("does not create a durable city candidate for a temporary Shenzhen job", () => {
    expect(interpret("帮我看看深圳这个岗位", { additions: { targetCities: ["深圳"] } })).toEqual({ kind: "none" });
  });
  it("does not use a long-term phrase in another clause to turn a temporary search into memory", () => {
    const text = "以后优先郑州，今天看看上海的岗位";
    expect(interpret(text, { additions: { targetCities: ["上海"] } })).toEqual({ kind: "none" });
  });
  it("clarifies an ambiguous value even when another clause is durable", () => {
    expect(interpret("以后优先郑州，上海的岗位也可以看看", { additions: { targetCities: ["郑州", "上海"] } }).kind).toBe("clarification");
  });
  it("rejects invented source quotes, values, and model-supplied identity", () => {
    expect(() => preparePreferenceCandidate({ interpretation: { intent: "candidate", patch: { additions: { targetCities: ["上海"] } }, sourceQuote: "以后去上海" },
      sourceText: "以后去郑州", sourceUserMessageId: "m", sourceTurnId: "t", binding })).toThrow("preference_source_quote_mismatch");
    expect(() => interpret("以后去郑州", { additions: { targetCities: ["上海"] } })).toThrow("preference_value_not_grounded");
    expect(() => preparePreferenceCandidate({ interpretation: { intent: "candidate", patch: { additions: { targetCities: ["郑州"] } },
      sourceQuote: "以后去郑州", profileId: "other" }, sourceText: "以后去郑州", sourceUserMessageId: "m", sourceTurnId: "t", binding })).toThrow();
  });
});
