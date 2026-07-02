import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import {
  checkRequirementMatchStale,
  computeCandidateSetHash,
  createRuleRequirementMatches,
  recallCandidatesForRequirement,
  resolveEffectiveMatch,
  validateEvaluationReferences,
  validateManualOverride,
  type MatchValidationError
} from "@/domain/match/matcher";
import { MatchEvaluationSchema, type ManualMatchOverride } from "@/domain/schemas";

const TEST_TIME = "2026-07-02T10:00:00.000Z";

describe("stage C1 matcher", () => {
  it("separates match level from risk level and resolves effective evaluation consistently", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const first = matches[0];

    expect(first.ruleEvaluation.matchLevel).toBeDefined();
    expect(first.ruleEvaluation.riskLevel).toBeDefined();
    expect(first.ruleEvaluation).not.toHaveProperty("status");
    expect(resolveEffectiveMatch(first)).toEqual(first.ruleEvaluation);
  });

  it("uses discriminated evidence refs and rejects IDs outside the formal profile whitelist", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const effective = resolveEffectiveMatch(matches[0]);

    expect(effective.evidenceRefs[0].type).toBe("experience_fact");

    const invalidEvaluation = MatchEvaluationSchema.parse({
      ...effective,
      evidenceRefs: [
        {
          type: "experience_fact",
          experienceId: "not-in-profile",
          factId: "not-in-profile",
          factQuote: "fake",
          factText: "fake"
        }
      ]
    });

    expect(() => validateEvaluationReferences(invalidEvaluation, { profile: demoCareerProfile, job })).toThrowError(
      expect.objectContaining({ code: "experience_fact_not_confirmed_or_missing" } satisfies Partial<MatchValidationError>)
    );
  });

  it("does not use resumeDraft text as evidence when no confirmed facts are available", () => {
    const profileWithoutFacts = {
      ...demoCareerProfile,
      experiences: demoCareerProfile.experiences.map((experience) => ({
        ...experience,
        facts: []
      })),
      skills: [],
      certificates: []
    };
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: profileWithoutFacts, job }, TEST_TIME);

    expect(matches.every((match) => match.ruleEvaluation.matchLevel === "none")).toBe(true);
    expect(matches.every((match) => match.ruleEvaluation.evidenceRefs.length === 0)).toBe(true);
  });

  it("keeps candidateSetHash stable across candidate order and whitespace changes", () => {
    const job = demoJobDescriptions[0];
    const requirement = job.requirements[0];
    const candidates = recallCandidatesForRequirement(demoCareerProfile, requirement);
    const reversedWithWhitespace = [...candidates].reverse().map((candidate) => ({
      ...candidate,
      ref: {
        ...candidate.ref,
        factText: `  ${candidate.ref.factText.replace(/\s+/g, "   ")}  `
      }
    }));

    const firstHash = computeCandidateSetHash({
      profileVersion: demoCareerProfile.version,
      jobVersion: job.updatedAt,
      matcherVersion: "evidence-matcher.v1",
      requirement,
      candidates
    });
    const secondHash = computeCandidateSetHash({
      profileVersion: demoCareerProfile.version,
      jobVersion: job.updatedAt,
      matcherVersion: "evidence-matcher.v1",
      requirement,
      candidates: reversedWithWhitespace
    });

    expect(firstHash).toBe(secondHash);
  });

  it("detects stale matches when profile version changes", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const staleProfile = { ...demoCareerProfile, version: demoCareerProfile.version + 1 };
    const stale = checkRequirementMatchStale(matches[0], { profile: staleProfile, job });

    expect(stale.isStale).toBe(true);
  });

  it("requires manual override evidence for non-none and allows none only with a reason", () => {
    const job = demoJobDescriptions[0];
    const match = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME)[0];
    const previousEvaluation = resolveEffectiveMatch(match);
    const nonNoneWithoutEvidence: ManualMatchOverride = {
      id: "manual-invalid",
      previousEvaluation,
      nextEvaluation: {
        source: "manual",
        matchLevel: "strong",
        riskLevel: "low",
        risks: [],
        evidenceRefs: [],
        explanation: "认为强匹配",
        evaluatedAt: TEST_TIME
      },
      reason: "认为强匹配",
      overriddenAt: TEST_TIME,
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    expect(() => validateManualOverride(nonNoneWithoutEvidence, { profile: demoCareerProfile, job })).toThrowError(
      expect.objectContaining({ code: "manual_non_none_requires_evidence" } satisfies Partial<MatchValidationError>)
    );

    const noneWithReason: ManualMatchOverride = {
      ...nonNoneWithoutEvidence,
      id: "manual-none",
      nextEvaluation: {
        ...nonNoneWithoutEvidence.nextEvaluation,
        matchLevel: "none",
        riskLevel: "medium",
        evidenceRefs: [],
        explanation: "没有正式事实可支持该要求。"
      },
      reason: "没有正式事实可支持该要求。"
    };

    expect(() => validateManualOverride(noneWithReason, { profile: demoCareerProfile, job })).not.toThrow();
  });
});
