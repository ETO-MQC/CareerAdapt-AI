import { describe, expect, it } from "vitest";
import { MappingDecisionSchema, NormalizedSourceBlockSchema } from "@/domain/schemas";
import { canSilentlyConfirmMapping, validateMappingDecisions } from "@/domain/resumeImport/mappingValidation";

describe("field-level resume mapping decisions", () => {
  const block = NormalizedSourceBlockSchema.parse({ id: "b1", text: "GPA 3.8 / 4.0", rawText: "GPA 3.8 / 4.0", normalizedText: "GPA 3.8 / 4.0", blockType: "paragraph", order: 0 });

  it("accepts catalog fields and validates exact source provenance", () => {
    const decision = MappingDecisionSchema.parse({ kind: "canonical_field", targetFieldId: "education.gpa", sourceBlockIds: ["b1"], sourceQuote: "GPA 3.8", confidence: 0.98, needsConfirmation: false, mappingReason: "明确 GPA 标签" });
    expect(validateMappingDecisions([decision], [block])).toEqual([]);
    expect(canSilentlyConfirmMapping(decision)).toBe(true);
  });

  it("rejects unknown catalog fields and reports missing source or quote", () => {
    expect(MappingDecisionSchema.safeParse({ kind: "canonical_field", targetFieldId: "education.secret", sourceBlockIds: ["b1"], sourceQuote: "GPA", confidence: 1, needsConfirmation: false, mappingReason: "x" }).success).toBe(false);
    const decision = MappingDecisionSchema.parse({ kind: "unclassified", reason: "含义不明", sourceBlockIds: ["missing"], sourceQuote: "不存在" });
    expect(validateMappingDecisions([decision], [block]).map((issue) => issue.code)).toEqual(["unknown_source"]);
  });

  it("never silently confirms low-confidence output", () => {
    const decision = MappingDecisionSchema.parse({ kind: "canonical_field", targetFieldId: "research.authorRole", sourceBlockIds: ["b1"], sourceQuote: "GPA", confidence: 0.6, needsConfirmation: true, mappingReason: "上下文不完整" });
    expect(canSilentlyConfirmMapping(decision)).toBe(false);
  });
});
