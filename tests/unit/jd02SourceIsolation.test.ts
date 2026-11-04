import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import { profileLimitedToResume } from "@/domain/match/resumeSource";
import { checkRequirementMatchResumeSourceStale, checkRequirementMatchStale, createRuleRequirementMatches } from "@/domain/match/matcher";

function fixture() {
  const profile = structuredClone(demoCareerProfile);
  const branch = buildGeneralBranchFromProfile({ profile, operationId: "jd02", name: "test", includeProfileFacts: true, includeProfileBasics: true }).branch;
  const selected = branch.contentItems.find(item => item.factRefs.some(ref => ref.type === "experience_fact"))!;
  const ref = selected.factRefs.find(ref => ref.type === "experience_fact")!;
  branch.contentItems = [{ ...selected, factRefs: [ref] }];
  branch.structuredContentItems = undefined;
  return { profile, branch, ref };
}
describe("JD02 exact resume source isolation", () => {
  it("includes F1 without admitting F2 in the same experience", () => {
    const { profile, branch, ref } = fixture();
    const result = profileLimitedToResume(profile, branch);
    expect(result.experiences.flatMap(item => item.facts.map(fact => fact.id))).toEqual([ref.factId]);
    expect(result.skills).toEqual([]);
  });
  it("excludes hidden items", () => {
    const { profile, branch } = fixture(); branch.contentItems[0].visible = false;
    expect(profileLimitedToResume(profile, branch).experiences).toEqual([]);
  });
  it("rejects another profile even with identical fact identifiers", () => {
    const { profile, branch } = fixture(); branch.profileId = "other";
    expect(profileLimitedToResume(profile, branch).experiences).toEqual([]);
  });
  it("invalidates matcher version and exact revision binding", () => {
    const { profile, branch } = fixture(); const job = demoJobDescriptions[0];
    const match = createRuleRequirementMatches({ profile, job })[0];
    expect(checkRequirementMatchStale(match, { profile, job, matcherVersion: "next" }).isStale).toBe(true);
    expect(checkRequirementMatchResumeSourceStale({ ...match, sourceResumeBranchId: branch.id, sourceResumeBranchRevision: branch.revision, sourceResumeRevisionId: branch.currentRevisionId ?? undefined }, { branchId: branch.id, branchRevision: branch.revision + 1, revisionId: "next" }).isStale).toBe(true);
  });
  it("invalidates a different profile or job even when versions and contents coincide", () => {
    const { profile } = fixture(); const job = demoJobDescriptions[0]; const match = createRuleRequirementMatches({ profile, job })[0];
    expect(checkRequirementMatchStale(match, { profile: { ...profile, id: "other-profile" }, job }).isStale).toBe(true);
    expect(checkRequirementMatchStale(match, { profile, job: { ...job, id: "other-job" } }).isStale).toBe(true);
  });

});
