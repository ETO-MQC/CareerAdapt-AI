import { describe, expect, it } from "vitest";
import {
  canSilentlyAcceptFieldCandidate,
  createDeterministicFieldCandidates,
  validateFieldCandidates
} from "@/domain/resumeImport/fieldCandidates";
import type { NormalizedSourceBlock } from "@/domain/schemas";

function block(id: string, text: string, order: number): NormalizedSourceBlock {
  return {
    id,
    text,
    rawText: text,
    normalizedText: text,
    normalizationActions: [],
    blockType: order === 0 ? "heading" : "paragraph",
    order,
    extractionConfidence: 0.98
  };
}

describe("catalog-driven deterministic field candidates", () => {
  it("maps exact GPA, rank, and dates with source traceability", () => {
    const blocks = [
      block("b0", "教育背景", 0),
      block("b1", "广东财经大学 资产评估 2024年9月—至今", 1),
      block("b2", "GPA：4.95/5.0，专业排名：1/42", 2)
    ];
    const candidates = createDeterministicFieldCandidates(blocks);
    expect(candidates.map((candidate) => candidate.targetFieldId)).toEqual(expect.arrayContaining([
      "education.startDate",
      "education.current",
      "education.gpa",
      "education.gpaScale",
      "education.rankPosition",
      "education.rankTotal"
    ]));
    expect(candidates.find((candidate) => candidate.targetFieldId === "education.startDate")?.dateValue).toMatchObject({
      rawText: "2024年9月",
      precision: "month",
      value: "2024-09"
    });
    expect(validateFieldCandidates(candidates, blocks)).toEqual([]);
  });

  it("requires per-field confirmation when one source block maps to multiple targets", () => {
    const blocks = [block("b0", "教育背景", 0), block("b1", "GPA：3.95/5.0，排名：1/42", 1)];
    const candidates = createDeterministicFieldCandidates(blocks);
    expect(candidates).toHaveLength(4);
    expect(candidates.every((candidate) => candidate.needsConfirmation)).toBe(true);
    expect(candidates.some((candidate) => canSilentlyAcceptFieldCandidate(candidate, candidates, blocks))).toBe(false);
    const explicitlyConfirmed = candidates.map((candidate) => ({ ...candidate, needsConfirmation: false, userConfirmed: true }));
    expect(validateFieldCandidates(explicitlyConfirmed, blocks)).toEqual([]);
  });

  it("detects numeric drift even when an AI-proposed quote is locatable", () => {
    const blocks = [block("b1", "GPA：3.95/5.0", 0)];
    const [candidate] = createDeterministicFieldCandidates(blocks);
    const changed = { ...candidate, value: 3.96, needsConfirmation: false };
    expect(validateFieldCandidates([changed], blocks)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "number_drift" })
    ]));
  });
});
