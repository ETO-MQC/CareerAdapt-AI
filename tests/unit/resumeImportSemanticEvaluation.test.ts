import { describe, expect, it } from "vitest";
import { evaluateResumeSemanticRecall } from "@/domain/resumeImport/semanticEvaluation";

describe("P4.3c semantic recall gate", () => {
  const expected = {
    identityFields: 3,
    education: 1,
    work: 2,
    project: 3,
    skills: 5,
    bullets: 8,
    unclassified: 0
  };

  it("does not accept schema validity without semantic completeness", () => {
    expect(evaluateResumeSemanticRecall({
      expected,
      detected: { ...expected, work: 1, project: 2, bullets: 6 },
      unsupportedInsertions: 0,
      silentSourceBlockLoss: 0
    })).toMatchObject({
      experienceProjectEntityRecall: 2 / 3,
      bulletRecall: 0.75,
      pass: false
    });
  });

  it("requires zero unsupported insertion and zero silent block loss", () => {
    expect(evaluateResumeSemanticRecall({
      expected,
      detected: expected,
      unsupportedInsertions: 1,
      silentSourceBlockLoss: 0
    }).pass).toBe(false);
    expect(evaluateResumeSemanticRecall({
      expected,
      detected: expected,
      unsupportedInsertions: 0,
      silentSourceBlockLoss: 1
    }).pass).toBe(false);
  });

  it("passes only the Beta recall boundary", () => {
    expect(evaluateResumeSemanticRecall({
      expected,
      detected: expected,
      unsupportedInsertions: 0,
      silentSourceBlockLoss: 0
    }).pass).toBe(true);
  });
});
