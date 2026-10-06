import { describe, expect, it } from "vitest";
import {
  assessmentStatusFromMatchLevel,
  deriveCoverage,
  deriveMatchSummary,
  deriveOverallFit,
  explicitHardGateLanguage,
  isConfirmedHardGate,
  requirementFactKind,
  tierFromPriority,
  type DerivableAssessment,
  type DerivableRequirement
} from "@/domain/jobAssets/matchDerivation";

function req(requirementId: string, tier: "S" | "A" | "B" | "C", kind: "fact" | "inference"): DerivableRequirement {
  return { requirementId, tier, kind };
}

function assess(requirementId: string, status: DerivableAssessment["status"]): DerivableAssessment {
  return { requirementId, status };
}

describe("V4-P1 stage 3: overall fit derivation (096 anchors)", () => {
  it("returns insufficient_evidence when no S/A material is bound", () => {
    expect(deriveOverallFit([req("r1", "B", "fact")], [assess("r1", "matched")])).toBe("insufficient_evidence");
    expect(deriveOverallFit([], [])).toBe("insufficient_evidence");
  });

  it("returns weak when any S-tier factual requirement is missing", () => {
    const fit = deriveOverallFit(
      [req("s1", "S", "fact"), req("a1", "A", "fact")],
      [assess("s1", "missing"), assess("a1", "matched")]
    );
    expect(fit).toBe("weak");
  });

  it("returns insufficient_evidence when unclear is everything or strictly dominates (2× rule)", () => {
    // 1/2 unclear：2×1 > 2 不成立，参考算法继续向下评估 → moderate
    const halfUnclear = deriveOverallFit(
      [req("a1", "A", "fact"), req("a2", "A", "fact")],
      [assess("a1", "unclear"), assess("a2", "matched")]
    );
    expect(halfUnclear).toBe("moderate");

    // 3/4 unclear：2×3 > 4 成立 → insufficient_evidence
    const dominatingUnclear = deriveOverallFit(
      [req("a1", "A", "fact"), req("a2", "A", "fact"), req("a3", "A", "fact"), req("a4", "A", "fact")],
      [assess("a1", "unclear"), assess("a2", "unclear"), assess("a3", "unclear"), assess("a4", "matched")]
    );
    expect(dominatingUnclear).toBe("insufficient_evidence");

    const allUnclear = deriveOverallFit(
      [req("a1", "A", "fact")],
      [assess("a1", "unclear")]
    );
    expect(allUnclear).toBe("insufficient_evidence");
  });

  it("returns insufficient_evidence for pure inference material without any positive signal", () => {
    const fit = deriveOverallFit(
      [req("a1", "A", "inference"), req("a2", "A", "inference")],
      [assess("a1", "missing"), assess("a2", "unclear")]
    );
    expect(fit).toBe("insufficient_evidence");
  });

  it("returns weak when factual A requirements are mostly missing", () => {
    const fit = deriveOverallFit(
      [req("a1", "A", "fact"), req("a2", "A", "fact"), req("a3", "A", "fact")],
      [assess("a1", "missing"), assess("a2", "missing"), assess("a3", "matched")]
    );
    expect(fit).toBe("weak");
  });

  it("returns strong when factual material has no gaps, S all matched, and A matched dominates partial", () => {
    const fit = deriveOverallFit(
      [req("s1", "S", "fact"), req("a1", "A", "fact"), req("a2", "A", "fact"), req("b1", "B", "fact")],
      [assess("s1", "matched"), assess("a1", "matched"), assess("a2", "partial"), assess("b1", "missing")]
    );
    expect(fit).toBe("strong");
  });

  it("returns moderate as the default otherwise", () => {
    const fit = deriveOverallFit(
      [req("s1", "S", "fact"), req("a1", "A", "fact")],
      [assess("s1", "matched"), assess("a1", "partial")]
    );
    expect(fit).toBe("moderate");
  });
});

describe("V4-P1 stage 3: bilingual hard gate mapping", () => {
  it("detects explicit hard-gate language in English and Chinese quotes", () => {
    expect(explicitHardGateLanguage("Must have 3 years of Go experience")).toBe(true);
    expect(explicitHardGateLanguage("Bachelor degree required")).toBe(true);
    expect(explicitHardGateLanguage("3年以上后端经验")).toBe(true);
    expect(explicitHardGateLanguage("本科及以上学历，必须熟悉分布式系统")).toBe(true);
    expect(explicitHardGateLanguage("资格证书齐全者优先")).toBe(true);
  });

  it("does not fire on descriptive language without a hard gate", () => {
    expect(explicitHardGateLanguage("熟悉 Go 语言生态")).toBe(false);
    expect(explicitHardGateLanguage("良好的沟通能力")).toBe(false);
  });

  it("applies the canonical confirmed-hard-gate rule (S + fact + missing + high confidence + rationale + explicit language)", () => {
    expect(isConfirmedHardGate({
      tier: "S", kind: "fact", status: "missing", tierConfidence: "high",
      tierRationale: "学历是硬性门槛", tierEvidence: "Bachelor degree required"
    })).toBe(true);

    expect(isConfirmedHardGate({
      tier: "S", kind: "fact", status: "missing", tierConfidence: "low",
      tierRationale: "依据不足", tierEvidence: "Bachelor degree required"
    })).toBe(false);
    expect(isConfirmedHardGate({
      tier: "S", kind: "fact", status: "missing", tierConfidence: "high",
      tierRationale: "学历是硬性门槛", tierEvidence: "良好沟通"
    })).toBe(false);
    expect(isConfirmedHardGate({
      tier: "S", kind: "fact", status: "matched", tierConfidence: "high",
      tierRationale: "已满足", tierEvidence: "Bachelor degree required"
    })).toBe(false);
    expect(isConfirmedHardGate({
      tier: "A", kind: "fact", status: "missing", tierConfidence: "high",
      tierRationale: "非 S 级", tierEvidence: "Bachelor degree required"
    })).toBe(false);
  });

  it("maps existing priorities and kinds onto tiers and fact kinds with an explicit v1 policy", () => {
    expect(tierFromPriority("must")).toBe("S");
    expect(tierFromPriority("high")).toBe("A");
    expect(tierFromPriority("medium")).toBe("B");
    expect(tierFromPriority("nice_to_have")).toBe("C");
    expect(tierFromPriority("uncertain")).toBe("C");

    expect(requirementFactKind({ hardConstraint: true, kind: "responsibility" })).toBe("fact");
    expect(requirementFactKind({ hardConstraint: false, kind: "education" })).toBe("fact");
    expect(requirementFactKind({ hardConstraint: false, kind: "soft_skill" })).toBe("inference");
  });

  it("maps existing match levels without replacing them", () => {
    expect(assessmentStatusFromMatchLevel("strong")).toBe("matched");
    expect(assessmentStatusFromMatchLevel("partial")).toBe("partial");
    expect(assessmentStatusFromMatchLevel("weak")).toBe("unclear");
    expect(assessmentStatusFromMatchLevel("needs_confirmation")).toBe("unclear");
    expect(assessmentStatusFromMatchLevel("none")).toBe("missing");
  });
});

describe("V4-P1 stage 3: coverage derivation (matched + 0.5 × partial)", () => {
  it("computes the ratio and buckets with unclear excluded from the denominator", () => {
    const coverage = deriveCoverage([
      assess("r1", "matched"), assess("r2", "matched"), assess("r3", "matched"),
      assess("r4", "partial"), assess("r5", "missing"),
      assess("r6", "unclear")
    ]);
    expect(coverage.counts).toEqual({ total: 6, matched: 3, partial: 1, missing: 1, unclear: 1 });
    expect(coverage.ratio).toBeCloseTo((3 + 0.5) / 5);
    expect(coverage.value).toBe("most");
  });

  it("buckets full/most/partial/little at the documented thresholds", () => {
    const allMatched = deriveCoverage([assess("a", "matched"), assess("b", "matched")]);
    expect(allMatched.value).toBe("full");

    const mostly = deriveCoverage([assess("a", "matched"), assess("b", "matched"), assess("c", "missing"), assess("d", "partial")]);
    expect(mostly.ratio).toBe((2 + 0.5) / 4);
    expect(mostly.value).toBe("partial");

    const little = deriveCoverage([assess("a", "missing"), assess("b", "missing"), assess("c", "matched")]);
    expect(little.value).toBe("little");
  });

  it("returns unknown when nothing is assessable, even with unclear entries", () => {
    const coverage = deriveCoverage([assess("a", "unclear"), assess("b", "unclear")]);
    expect(coverage.value).toBe("unknown");
    expect(coverage.ratio).toBeUndefined();
    expect(coverage.counts.unclear).toBe(2);
  });
});

describe("V4-P1 stage 3: match summary with algorithm metadata", () => {
  it("carries the versioned algorithm block required by v4-plan §7.4", () => {
    const summary = deriveMatchSummary(
      [req("s1", "S", "fact")],
      [assess("s1", "matched")],
      [],
      { generatedAt: "2026-10-06T00:00:00.000Z", inputJobVersion: "job:v3", inputResumeRevision: "rev:9" }
    );
    expect(summary.algorithm).toEqual({
      algorithmId: "careeradapt-match-derivation-v1",
      algorithmVersion: 1,
      generatedAt: "2026-10-06T00:00:00.000Z",
      inputJobVersion: "job:v3",
      inputResumeRevision: "rev:9"
    });
    expect(summary.overallFit).toBe("strong");
    expect(summary.hardGateCandidates).toEqual([]);
  });
});
