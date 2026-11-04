import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import type { ResumeTailoringDiff } from "@/domain/schemas";
import { TailoringSessionSchema } from "@/services/jobs/tailoringCommands";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createTailoringSessionCommand, reviewTailoringDiffCommand } from "@/services/jobs/tailoringCommands";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";

let db: CareerAdaptDb;
afterEach(async () => { db?.close(); if (db) await db.delete(); });
async function fixture() {
  db = new CareerAdaptDb(`JD03-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  await repository.saveProfile(demoCareerProfile);
  const general = buildGeneralBranchFromProfile({ profile: demoCareerProfile, operationId: "jd03-source", name: "通用简历", includeProfileBasics: true, includeProfileFacts: true });
  await repository.saveResumeBranch(general.branch);
  await db.resumeRevisions.put(general.firstRevision);
  const jobs = ["jd03-a", "jd03-b"].map(id => ({ ...demoJobDescriptions[0], id, title: id }));
  for (const job of jobs) await repository.saveJobDescription(job);
  const summary = general.branch.structuredContentItems!.find(item => item.data.sectionType === "summary")!;
  if (summary.data.sectionType !== "summary") throw new Error("summary fixture missing");
  const fact = demoCareerProfile.experiences[0].facts[0];
  const diff: ResumeTailoringDiff = { target: { sectionId: "summary", itemId: summary.id, fieldPath: "text" }, operation: "replace", original: summary.data.text,
    value: "基于已核验经历，突出与目标岗位相关的交付能力。", reason: "保留真实职责与定性交付", requirementIds: [], targetKeywords: [], supportLevel: "verified",
    evidenceRefs: [{ type: "experience_fact", experienceId: demoCareerProfile.experiences[0].id, factId: fact.id, factQuote: fact.statement, factText: fact.statement }] };
  const sessionFor = (index: number) => {
    const created = createTailoringSessionCommand({ operationId: `jd03-session-${index}`, profile: demoCareerProfile, branch: general.branch, job: jobs[index] }).session;
    return TailoringSessionSchema.parse({ ...created, plan: { ...created.plan, diffs: [diff], diffReviews: [] } });
  };
  return { repository, service: new BrowserAgentToolService(repository), general, jobs, diff, sessionFor };
}

describe("JD-03 formal isolated revision acceptance", () => {
  it("applies only reviewed changes to two independent jobs, replays idempotently and restores exact lineage after reopening", async () => {
    const f = await fixture();
    const sourceBefore = await f.repository.getResumeBranch(f.general.branch.id);
    const profileBefore = await f.repository.getProfile(demoCareerProfile.id);
    const apply = async (index: number) => {
      const reviewed = reviewTailoringDiffCommand({ operationId: `jd03-review-${index}`, session: f.sessionFor(index), diffId: tailoringDiffId(f.diff), decision: "accept" });
      return f.service.applyTailoringChanges({ session: reviewed.session, selectedDiffs: reviewed.selectedDiffs, confirmedRequirementIds: [] }, `jd03-apply-${index}`);
    };
    const aResult = await apply(0);
    const a = { branch: (await f.repository.getResumeBranch(aResult.resultResumeId))!, revision: await f.repository.getResumeRevision(aResult.resultResumeRevisionId) };
    const aBefore = await f.repository.getResumeBranch(a.branch.id);
    const bResult = await apply(1);
    const b = { branch: (await f.repository.getResumeBranch(bResult.resultResumeId))! };
    expect(a.branch.id).not.toBe(b.branch.id);
    expect(a.branch.jobId).toBe(f.jobs[0].id);
    expect(b.branch.jobId).toBe(f.jobs[1].id);
    expect(await f.repository.getResumeBranch(a.branch.id)).toEqual(aBefore);
    expect(a.branch.sourceBranchId).toBe(f.general.branch.id);
    expect(a.branch.sourceRevisionId).toBe(f.general.firstRevision.id);
    expect(a.revision?.snapshot.structuredContentItems).toEqual(a.branch.structuredContentItems);
    expect(aResult.artifactReceipt.acceptedDiffIds).toEqual([tailoringDiffId(f.diff)]);
    const revisionCount = await db.resumeRevisions.count();
    const repeated = await apply(0);
    expect(repeated.resultResumeRevisionId).toBe(a.revision?.id);
    expect(repeated.artifactReceipt).toEqual(aResult.artifactReceipt);
    expect(await db.resumeRevisions.count()).toBe(revisionCount);
    expect(await f.repository.getResumeBranch(f.general.branch.id)).toEqual(sourceBefore);
    expect(await f.repository.getProfile(demoCareerProfile.id)).toEqual(profileBefore);
    const name = db.name;
    db.close();
    db = new CareerAdaptDb(name);
    const restored = new WorkspaceRepository(db);
    expect(await restored.getResumeBranch(a.branch.id)).toEqual(aBefore);
    expect((await restored.getResumeRevision(a.revision!.id))?.snapshot).toEqual(a.revision!.snapshot);
  });
  it("does not write rejected or unresolved proposals even when a caller supplies them in selectedDiffs", async () => {
    const f = await fixture();
    const before = await db.resumeRevisions.count();
    for (const decision of [undefined, "reject"] as const) {
      const session = decision ? reviewTailoringDiffCommand({ operationId: "jd03-reject", session: f.sessionFor(0), diffId: tailoringDiffId(f.diff), decision }).session : f.sessionFor(0);
      await expect(f.service.applyTailoringChanges({ session, selectedDiffs: [f.diff], confirmedRequirementIds: [] }, `jd03-no-write-${decision}`)).rejects.toMatchObject({ code: "tailoring_no_selected_changes" });
    }
    expect(await db.resumeRevisions.count()).toBe(before);
    expect((await f.repository.listResumeBranches(demoCareerProfile.id)).filter(branch => branch.branchPurpose === "job_specific")).toEqual([]);
  });
});
