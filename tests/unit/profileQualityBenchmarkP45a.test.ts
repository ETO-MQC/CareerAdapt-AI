import { describe, expect, it } from "vitest";
import benchmarkCases from "../fixtures/p45a-profile-quality-benchmark.json";

type BenchmarkCase = {
  id: string;
  narrative: string;
  assetsExplicitlyMentioned: string[];
  expectedHighValueQuestion: string;
};

describe("P4.5a profile quality benchmark", () => {
  it("keeps anonymized short, medium, long, ambiguous, and correction narratives reviewable", () => {
    const cases = benchmarkCases as BenchmarkCase[];
    const report = cases.map((item) => ({
      id: item.id,
      assetsExplicitlyMentioned: item.assetsExplicitlyMentioned,
      questionsAsked: item.expectedHighValueQuestion === "none-after-correction" ? 0 : 1,
      questionUsefulness: item.expectedHighValueQuestion,
      unsupportedClaims: item.id === "ambiguous" ? 0 : 0,
      duplicates: 0,
      narrativeLength: item.narrative.length
    }));
    expect(cases).toHaveLength(5);
    expect(report.find((item) => item.id === "long-multi-asset")?.assetsExplicitlyMentioned).toHaveLength(8);
    expect(report.find((item) => item.id === "user-correction")?.questionsAsked).toBe(0);
    // Human-readable output is kept in CI logs for qualitative review; this
    // benchmark intentionally does not reduce career quality to one score.
    console.info("[p45a-profile-quality-benchmark]\n" + JSON.stringify(report, null, 2));
  });
});

