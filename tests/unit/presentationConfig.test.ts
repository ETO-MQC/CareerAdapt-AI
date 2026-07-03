import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { createRuleRequirementMatches } from "@/domain/match/matcher";
import { mapBranchToResumeDocument } from "@/domain/resumeDocument/mapper";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { ResumePresentationConfigSchema, type ResumePresentationConfig, type ResumeRenderSectionType } from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) {
    return;
  }
  db.close();
  await db.delete();
  db = undefined;
});

describe("V2 G1a resume presentation config", () => {
  it("rejects duplicate hidden ids and duplicate order ids at schema level", () => {
    expect(() => ResumePresentationConfigSchema.parse({
      schemaVersion: "resume-presentation-v1",
      branchId: "branch",
      templateId: "classic-technical",
      contentRevision: {
        branchRevision: 0,
        currentRevisionId: "revision"
      },
      sectionOrder: ["summary", "skills", "experience", "certificates"],
      itemOrderBySection: {
        experience: ["item-1", "item-1"]
      },
      hiddenItemIds: ["item-2", "item-2"],
      presentationRevision: 0,
      updatedAt: "2026-07-03T00:00:00.000Z"
    })).toThrow();
  });

  it("persists display-only config without creating ResumeRevision and guards idempotency/conflicts", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG1aPresentationDb");
    const initial = await repository.getResumePresentationConfig(branch.id);
    const revisionsBefore = await repository.listResumeRevisions(branch.id);
    const itemId = branch.contentItems[0].id;

    const nextConfig = nextPresentationConfig(initial, branch, {
      hiddenItemIds: [itemId]
    });
    const saved = await repository.saveResumePresentationConfig({
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      expectedPresentationRevision: initial.presentationRevision,
      operationId: "g1a-hide-item",
      nextConfig
    });
    const duplicate = await repository.saveResumePresentationConfig({
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      expectedPresentationRevision: initial.presentationRevision,
      operationId: "g1a-hide-item",
      nextConfig
    });

    expect(saved.config.hiddenItemIds).toEqual([itemId]);
    expect(saved.config.presentationRevision).toBe(1);
    expect(duplicate.idempotent).toBe(true);
    expect(await repository.listResumeRevisions(branch.id)).toHaveLength(revisionsBefore.length);

    const conflictConfig = nextPresentationConfig(saved.config, branch, {
      hiddenItemIds: []
    });
    await expect(repository.saveResumePresentationConfig({
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      expectedPresentationRevision: initial.presentationRevision,
      operationId: "g1a-conflict",
      nextConfig: conflictConfig
    })).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("rejects hiding all visible content and rejects invalid branches", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG1aPresentationGuardDb");
    const initial = await repository.getResumePresentationConfig(branch.id);
    await expect(repository.saveResumePresentationConfig({
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      expectedPresentationRevision: initial.presentationRevision,
      operationId: "g1a-hide-all",
      nextConfig: nextPresentationConfig(initial, branch, {
        hiddenItemIds: branch.contentItems.filter((item) => item.visible).map((item) => item.id)
      })
    })).rejects.toThrow("resume_presentation_requires_visible_content");

    const archived = await repository.archiveResumeBranch({
      branchId: branch.id,
      expectedRevision: branch.revision,
      operationId: "g1a-archive",
      confirmedImpact: true
    });
    await expect(repository.saveResumePresentationConfig({
      branchId: archived.branch.id,
      expectedBranchRevision: archived.branch.revision,
      expectedRevisionId: archived.branch.currentRevisionId!,
      expectedPresentationRevision: initial.presentationRevision,
      operationId: "g1a-archived-save",
      nextConfig: nextPresentationConfig(initial, archived.branch, {
        templateId: "modern-operations"
      })
    })).rejects.toThrow("archived_resume_branch_read_only");
  });

  it("applies presentation order and hidden ids to ResumeDocument and RenderModel", async () => {
    const { branch, job } = await createBranchFixture("CareerAdaptG1aMapperDb");
    const document = mapBranchToResumeDocument({
      branch,
      profile: demoCareerProfile,
      job,
      templateId: "classic-technical"
    });
    const sortableSection = document.sections.find((section) => section.blocks.length >= 2);
    if (!sortableSection) {
      throw new Error("fixture requires at least two blocks in one section");
    }
    const [first, second] = sortableSection.blocks;
    const config = ResumePresentationConfigSchema.parse({
      schemaVersion: "resume-presentation-v1",
      branchId: branch.id,
      templateId: "modern-operations",
      contentRevision: {
        branchRevision: branch.revision,
        currentRevisionId: branch.currentRevisionId!
      },
      sectionOrder: ["summary", "skills", "experience", "certificates"],
      itemOrderBySection: {
        [sortableSection.type]: [second.contentItemId, first.contentItemId]
      },
      hiddenItemIds: [first.contentItemId],
      presentationRevision: 1,
      updatedAt: "2026-07-03T00:00:00.000Z"
    });

    const configuredDocument = mapBranchToResumeDocument({
      branch,
      profile: demoCareerProfile,
      job,
      templateId: config.templateId,
      presentationConfig: config
    });
    const configuredSection = configuredDocument.sections.find((section) => section.type === sortableSection.type)!;
    const renderModel = mapBranchToResumeRenderModel({
      branch,
      profile: demoCareerProfile,
      job,
      presentationConfig: config
    });

    expect(configuredSection.blocks[0].contentItemId).toBe(second.contentItemId);
    expect(configuredDocument.blocks.find((block) => block.contentItemId === first.contentItemId)).toMatchObject({
      presentationHidden: true,
      visible: false,
      hiddenReason: "hidden_by_presentation"
    });
    expect(renderModel.sections.flatMap((section) => section.blocks).some((block) => block.sourceItemId === first.contentItemId)).toBe(false);
    expect(renderModel.safety.excludedItemIds).toContain(first.contentItemId);
  });
});

async function createBranchFixture(dbNamePrefix: string) {
  db = new CareerAdaptDb(`${dbNamePrefix}-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const job = demoJobDescriptions[0];
  const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, "2026-07-03T00:00:00.000Z");
  await repository.saveProfile(demoCareerProfile);
  await repository.saveJobDescription(job);
  await repository.saveRuleRequirementMatches({ profile: demoCareerProfile, job, matches });
  const draft = await repository.createJobAdaptationDraft({
    profile: demoCareerProfile,
    job,
    matches,
    operationId: `g1a-draft-${crypto.randomUUID()}`
  });
  const created = await repository.createResumeBranchFromDraft({
    draftId: draft.draft.id,
    expectedDraftRevision: draft.draft.revision,
    operationId: `g1a-branch-${crypto.randomUUID()}`,
    name: "G1a presentation branch"
  });
  return { repository, branch: created.branch, job };
}

function nextPresentationConfig(
  current: ResumePresentationConfig,
  branch: { revision: number; currentRevisionId?: string | null },
  patch: Partial<Pick<ResumePresentationConfig, "templateId" | "hiddenItemIds">> & {
    itemOrderBySection?: Partial<Record<ResumeRenderSectionType, string[]>>;
  }
): ResumePresentationConfig {
  if (!branch.currentRevisionId) {
    throw new Error("fixture_branch_current_revision_missing");
  }
  return {
    ...current,
    ...patch,
    contentRevision: {
      branchRevision: branch.revision,
      currentRevisionId: branch.currentRevisionId
    },
    presentationRevision: current.presentationRevision + 1,
    updatedAt: "2026-07-03T00:00:00.000Z"
  };
}
