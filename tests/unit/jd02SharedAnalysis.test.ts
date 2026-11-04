import { describe, expect, it } from "vitest";
import { jd02Fixture } from "../fixtures/jd02";
import { buildCareerIntelligence, buildProfileCareerIntelligence, capabilityGapView } from "@/domain/jobOptimization/careerIntelligence";
import { analyzeJobFit } from "@/services/jobs/tailoringService";
import { analyzeProfileLibrarySource } from "@/services/jobs/jobResumeSourceModes";
import { createRuleRequirementMatches, checkRequirementMatchStale, validateEvidenceRef } from "@/domain/match/matcher";
describe("JD02 shared analysis", () => {
  it("aligns Fit, formal projection and page by requirementId, refs and explanation", () => {
    const f = jd02Fixture(); const input = { profile: f.profile, branch: f.branches[0].branch, job: f.jobs[0] };
    const shared = buildCareerIntelligence(input); const fit = analyzeJobFit(input); const matches = createRuleRequirementMatches(input);
    expect(fit.candidateEvidenceMatrix).toEqual(shared.candidateEvidenceMatrix);
    expect(matches.map(row => row.requirementId)).toEqual(shared.matrix.evaluations.map(row => row.requirementId));
    expect(matches[0].ruleEvaluation.evidenceRefs).toEqual(shared.matrix.evaluations[0].evidenceRefs);
    expect(matches[0].ruleEvaluation.explanation).toContain(shared.matrix.evaluations[0].explanation);
    expect(shared.evidenceUnits.flatMap(unit => unit.factRefs).every(ref => ref.type === "experience_fact" && ref.factId === "jd02-f1")).toBe(true);
    expect(capabilityGapView(shared, matches[0].requirementId).status).toBe("supported");
  });
  it("keeps profile analysis IDs deterministic across entrypoints and repeated reads", () => {
    const f = jd02Fixture(); const input = { profile: f.profile, job: f.jobs[0] }; const before = JSON.stringify(f);
    expect(analyzeProfileLibrarySource(input).analysisId).toBe(buildProfileCareerIntelligence(input).candidateEvidenceMatrix.analysisId);
    expect(buildProfileCareerIntelligence(input).candidateEvidenceMatrix.analysisId).toBe(buildProfileCareerIntelligence(input).candidateEvidenceMatrix.analysisId);
    expect(JSON.stringify(f)).toBe(before);
  });
  it("invalidates graph changes without an updatedAt change", () => {
    const f = jd02Fixture(); const input = { profile: f.profile, job: f.jobs[0] }; const match = createRuleRequirementMatches(input)[0];
    input.job.requirementGraph!.graphHash = "changed-graph";
    expect(checkRequirementMatchStale(match, input).isStale).toBe(true);
  });
  it("does not invent confirmed absence for no evidence, learning, skip or uncertainty", () => {
    const f = jd02Fixture(); const shared = buildCareerIntelligence({ profile: f.profile, branch: f.branches[1].branch, job: f.jobs[0] });
    expect(capabilityGapView(shared, f.jobs[0].requirements[0].id).status).toBe("insufficient");
  });
  it("rejects invented source text even when formal IDs are valid", () => {
    const f = jd02Fixture(); const match = createRuleRequirementMatches({ profile: f.profile, branch: f.branches[0].branch, job: f.jobs[0] })[0];
    expect(() => validateEvidenceRef({ ...match.ruleEvaluation.evidenceRefs[0], factQuote: "fabricated" }, f.profile)).toThrow("evidence_quote_not_in_confirmed_source");
  });
  it.each(["confirmed_capability", "learning", "familiar"] as const)("distinguishes %s without inventing absence", maturity => {
    const f = jd02Fixture(); f.profile.experiences[0].facts[0].maturity = maturity;
    const shared = buildCareerIntelligence({ profile: f.profile, branch: f.branches[0].branch, job: f.jobs[0] });
    expect(capabilityGapView(shared, f.jobs[0].requirements[0].id).status).toBe(maturity === "confirmed_capability" ? "possible" : "insufficient");
  });

});
