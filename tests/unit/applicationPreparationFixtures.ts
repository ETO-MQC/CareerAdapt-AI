import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import type { ApplicationPreparationContext } from "@/domain/applicationPreparation";
import { createRuleRequirementMatches } from "@/domain/match/matcher";
import type { ApplicationPreparationPack, ResumeBranch } from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

export const APPLICATION_PREPARATION_TEST_TIME = "2026-07-06T08:00:00.000Z";

export async function setupApplicationPreparationFixture(options: { withExport?: boolean } = {}) {
  const db = new CareerAdaptDb(`CareerAdaptG6bDb-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const job = demoJobDescriptions[0];
  const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, APPLICATION_PREPARATION_TEST_TIME);
  await repository.saveProfile(demoCareerProfile);
  await repository.saveJobDescription(job);
  await repository.saveRuleRequirementMatches({ profile: demoCareerProfile, job, matches });
  const draft = await repository.createJobAdaptationDraft({
    profile: demoCareerProfile,
    job,
    matches,
    operationId: `g6b-draft-${crypto.randomUUID()}`
  });
  const createdBranch = await repository.createResumeBranchFromDraft({
    draftId: draft.draft.id,
    expectedDraftRevision: draft.draft.revision,
    operationId: `g6b-branch-${crypto.randomUUID()}`,
    name: "G6b Application Materials Branch"
  });
  let exportRecordId: string | undefined;
  if (options.withExport ?? true) {
    const exportRecord = await repository.createResumeExportRecord({
      operationId: `g6b-export-${crypto.randomUUID()}`,
      branchId: createdBranch.branch.id,
      expectedBranchRevision: createdBranch.branch.revision,
      expectedRevisionId: createdBranch.branch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "fits_one_page",
      exportStatus: "direct_pdf_success",
      fileName: "g6b.pdf",
      actualPageCount: 1,
      requestedMaxPages: 1,
      pagePolicy: "one_page_strict"
    });
    exportRecordId = exportRecord.record.id;
  }
  const application = await repository.createApplicationFromBranch({
    branchId: createdBranch.branch.id,
    expectedBranchRevision: createdBranch.branch.revision,
    expectedRevisionId: createdBranch.branch.currentRevisionId!,
    operationId: `g6b-application-${crypto.randomUUID()}`
  });
  const loaded = await repository.loadApplicationPreparationPack(application.application.id);
  if (!loaded.context || !loaded.pack) {
    throw new Error("application_preparation_fixture_failed");
  }
  return {
    db,
    repository,
    profile: demoCareerProfile,
    job,
    branch: createdBranch.branch,
    application: application.application,
    context: loaded.context as ApplicationPreparationContext,
    pack: loaded.pack as ApplicationPreparationPack,
    exportRecordId
  };
}

export async function cleanupApplicationPreparationFixture(db: CareerAdaptDb | undefined) {
  if (!db) {
    return;
  }
  db.close();
  await db.delete();
}

export async function createSecondApplication(repository: WorkspaceRepository): Promise<{ branch: ResumeBranch; applicationId: string }> {
  const job = demoJobDescriptions[1];
  const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, APPLICATION_PREPARATION_TEST_TIME);
  await repository.saveJobDescription(job);
  await repository.saveRuleRequirementMatches({ profile: demoCareerProfile, job, matches });
  const draft = await repository.createJobAdaptationDraft({
    profile: demoCareerProfile,
    job,
    matches,
    operationId: `g6b-second-draft-${crypto.randomUUID()}`
  });
  const createdBranch = await repository.createResumeBranchFromDraft({
    draftId: draft.draft.id,
    expectedDraftRevision: draft.draft.revision,
    operationId: `g6b-second-branch-${crypto.randomUUID()}`,
    name: "G6b Second Application Branch"
  });
  const application = await repository.createApplicationFromBranch({
    branchId: createdBranch.branch.id,
    expectedBranchRevision: createdBranch.branch.revision,
    expectedRevisionId: createdBranch.branch.currentRevisionId!,
    operationId: `g6b-second-application-${crypto.randomUUID()}`
  });
  return {
    branch: createdBranch.branch,
    applicationId: application.application.id
  };
}
