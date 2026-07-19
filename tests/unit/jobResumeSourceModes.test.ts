import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { createRuleRequirementMatches } from "@/domain/match/matcher";
import { analyzeProfileLibrarySource, recommendJobResumeSource } from "@/services/jobs/jobResumeSourceModes";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

describe("job resume source modes", () => {
  it("builds deterministic profile-library recommendations from canonical facts", () => {
    const job = demoJobDescriptions[0];
    const first = analyzeProfileLibrarySource({ profile: demoCareerProfile, job, now: "2026-07-19T08:00:00.000Z" });
    const second = analyzeProfileLibrarySource({ profile: demoCareerProfile, job, now: "2026-07-19T08:00:00.000Z" });

    expect(first.availableItemCount).toBeGreaterThan(0);
    expect(first.availableEvidenceCount).toBeGreaterThan(0);
    expect(first.recommendations.map((item) => [item.id, item.disposition])).toEqual(second.recommendations.map((item) => [item.id, item.disposition]));
    expect(first.coverage.scoreExplanation).toContain("不是 ATS 通过率");
  });

  it("uses an explainable deterministic source recommendation", () => {
    expect(recommendJobResumeSource({ profileItemCount: 12, profileEvidenceCount: 18, generalResumeCount: 1 }).mode).toBe("profile");
    expect(recommendJobResumeSource({ profileItemCount: 3, profileEvidenceCount: 4, generalResumeCount: 1 }).mode).toBe("resume");
  });

  it("creates an independent job branch from selected canonical facts without changing Profile", async () => {
    db = new CareerAdaptDb(`JobResumeSourceModes-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(demoCareerProfile);
    await repository.saveJobDescription(demoJobDescriptions[0]);
    const before = await repository.getProfile(demoCareerProfile.id);
    const analysis = analyzeProfileLibrarySource({ profile: demoCareerProfile, job: demoJobDescriptions[0], now: "2026-07-19T08:00:00.000Z" });
    const selected = analysis.recommendations.filter((item) => item.disposition !== "hide").map((item) => item.id);
    const matches = await repository.saveRuleRequirementMatches({
      profile: demoCareerProfile,
      job: demoJobDescriptions[0],
      matches: createRuleRequirementMatches({ profile: demoCareerProfile, job: demoJobDescriptions[0] })
    });

    const result = await repository.createJobSpecificBranchFromProfile({
      profileId: demoCareerProfile.id,
      jobId: demoJobDescriptions[0].id,
      operationId: "profile-source-mode-create",
      name: "资料库岗位简历",
      selectedCanonicalItemIds: selected,
      requirementMatchIds: matches.map((match) => match.id)
    });

    expect(result.branch).toMatchObject({
      branchPurpose: "job_specific",
      jobId: demoJobDescriptions[0].id,
      sourceProfileVersion: demoCareerProfile.version,
      resumeBasics: expect.objectContaining({ targetRole: demoJobDescriptions[0].title })
    });
    expect(result.branch.structuredContentItems?.map((item) => item.data.id)).toEqual(expect.arrayContaining(selected));
    expect(await repository.getProfile(demoCareerProfile.id)).toEqual(before);
    expect((await repository.listResumeBranches(demoCareerProfile.id)).some((branch) => branch.id === result.branch.id)).toBe(true);
  });
});
