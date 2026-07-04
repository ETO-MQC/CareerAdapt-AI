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
  it("recovers from corrupt stored presentation config without crashing", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG1aCorruptDb");

    // Write corrupt JSON to appMeta directly
    const corruptMeta = {
      key: `resumePresentationConfig:${branch.id}`,
      value: { not: "a valid config" },
      updatedAt: "2026-07-03T00:00:00.000Z"
    };
    await (repository as unknown as { db: { appMeta: { put: (meta: unknown) => Promise<unknown> } } }).db.appMeta.put(corruptMeta);

    // Should not throw — falls back to default config
    const config = await repository.getResumePresentationConfig(branch.id);
    expect(config.branchId).toBe(branch.id);
    expect(config.templateId).toBe("classic-technical");
    expect(config.presentationRevision).toBe(0);
    expect(config.hiddenItemIds).toEqual([]);
  });

  it("recovers from corrupt schema version in stored presentation config", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG1aBadSchemaDb");

    // Write config with wrong schemaVersion
    const badMeta = {
      key: `resumePresentationConfig:${branch.id}`,
      value: {
        schemaVersion: "wrong-version",
        branchId: branch.id,
        templateId: "classic-technical",
        contentRevision: { branchRevision: 0, currentRevisionId: "x" },
        presentationRevision: 5,
        hiddenItemIds: ["fake-id"],
        updatedAt: "2026-07-03T00:00:00.000Z"
      },
      updatedAt: "2026-07-03T00:00:00.000Z"
    };
    await (repository as unknown as { db: { appMeta: { put: (meta: unknown) => Promise<unknown> } } }).db.appMeta.put(badMeta);

    const config = await repository.getResumePresentationConfig(branch.id);
    expect(config.branchId).toBe(branch.id);
    expect(config.presentationRevision).toBe(0);
  });

  it("distinguishes ExportRecords by presentation version when branchRevision is the same", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG1aExportPresentationDb");
    const initial = await repository.getResumePresentationConfig(branch.id);
    const sortableItem = branch.contentItems.find((item) => item.visible);
    if (!sortableItem) {
      throw new Error("fixture requires at least one visible item");
    }

    // Export with default config
    const export1 = await repository.createResumeExportRecord({
      operationId: `export-pres-${crypto.randomUUID()}`,
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "fits",
      exportStatus: "print_invoked",
      fileName: "test-1.pdf",
      presentationRevision: initial.presentationRevision,
      presentationSnapshot: {
        templateId: initial.templateId,
        itemOrderBySection: initial.itemOrderBySection,
        hiddenItemIds: initial.hiddenItemIds
      }
    });

    // Export with hidden item
    const export2 = await repository.createResumeExportRecord({
      operationId: `export-pres-${crypto.randomUUID()}`,
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      templateId: "modern-operations",
      overflowStatus: "fits",
      exportStatus: "print_invoked",
      fileName: "test-2.pdf",
      presentationRevision: initial.presentationRevision + 1,
      presentationSnapshot: {
        templateId: "modern-operations",
        itemOrderBySection: initial.itemOrderBySection,
        hiddenItemIds: [sortableItem.id]
      }
    });

    expect(export1.record.branchRevision).toBe(export2.record.branchRevision);
    expect(export1.record.presentationRevision).toBe(0);
    expect(export2.record.presentationRevision).toBe(1);
    expect(export1.record.presentationSnapshot?.templateId).toBe("classic-technical");
    expect(export2.record.presentationSnapshot?.templateId).toBe("modern-operations");
    expect(export2.record.presentationSnapshot?.hiddenItemIds).toContain(sortableItem.id);
    expect(export1.record.presentationSnapshot?.hiddenItemIds).toEqual([]);
  });

  it("accepts ExportRecords without presentation fields for backward compatibility", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG1aExportCompatDb");

    const result = await repository.createResumeExportRecord({
      operationId: `export-compat-${crypto.randomUUID()}`,
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "fits",
      exportStatus: "print_invoked",
      fileName: "test-compat.pdf"
    });

    expect(result.record.presentationRevision).toBeUndefined();
    expect(result.record.presentationSnapshot).toBeUndefined();
  });

  it("filters stale presentation hidden ids when content items change", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG1aStaleHiddenDb");
    const initial = await repository.getResumePresentationConfig(branch.id);
    const visibleItems = branch.contentItems.filter((item) => item.visible);
    if (visibleItems.length < 2) {
      throw new Error("fixture requires at least two visible items");
    }

    // Hide first item
    const nextConfig = nextPresentationConfig(initial, branch, {
      hiddenItemIds: [visibleItems[0].id]
    });
    await repository.saveResumePresentationConfig({
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      expectedPresentationRevision: initial.presentationRevision,
      operationId: "g1a-stale-hide",
      nextConfig
    });

    // Simulate stale item id in stored config
    const staleConfig = {
      ...nextConfig,
      presentationRevision: nextConfig.presentationRevision + 1,
      hiddenItemIds: [visibleItems[0].id, "nonexistent-item-id-12345"]
    };
    await (repository as unknown as { db: { appMeta: { put: (meta: unknown) => Promise<unknown> } } }).db.appMeta.put({
      key: `resumePresentationConfig:${branch.id}`,
      value: staleConfig,
      updatedAt: "2026-07-03T00:00:00.000Z"
    });

    // Should not crash and should filter out the stale id
    const loaded = await repository.getResumePresentationConfig(branch.id);
    expect(loaded.hiddenItemIds).toContain(visibleItems[0].id);
    expect(loaded.hiddenItemIds).not.toContain("nonexistent-item-id-12345");
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
