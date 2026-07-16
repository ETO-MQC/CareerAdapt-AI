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

  it("normalizes legacy G1a style placeholders into G1b controlled tokens", () => {
    const parsed = ResumePresentationConfigSchema.parse({
      schemaVersion: "resume-presentation-v1",
      branchId: "branch",
      templateId: "classic-technical",
      contentRevision: {
        branchRevision: 0,
        currentRevisionId: "revision"
      },
      sectionOrder: ["summary", "skills", "experience", "certificates"],
      itemOrderBySection: {},
      hiddenItemIds: [],
      typography: {
        scale: "comfortable",
        lineHeight: "compact"
      },
      spacing: {
        sectionGap: "spacious",
        itemGap: "compact",
        paragraphGap: "normal"
      },
      theme: {
        accentColor: "blue",
        density: "spacious"
      },
      presentationRevision: 0,
      updatedAt: "2026-07-03T00:00:00.000Z"
    });

    expect(parsed.typography).toEqual({
      chineseFont: "system_sans",
      englishFont: "system_sans",
      bodyTextScale: "large",
      titleTextScale: "normal",
      lineHeight: "tight"
    });
    expect(parsed.spacing).toEqual({
      pageMargin: "normal",
      sectionGap: "relaxed",
      itemGap: "tight"
    });
    expect(parsed.theme).toEqual({
      primaryColor: "blue",
      accentColor: "blue",
      dividerColor: "graphite",
      density: "spacious"
    });
    expect(parsed.sectionStyleOverrides).toEqual({});
    expect(parsed.pagination).toEqual({
      pagePolicy: "natural",
      preferredPageCount: 2,
      maximumPageCount: 4,
      overflowBehavior: "warn",
      headerFooter: "none",
      showPhoto: false,
      pageBreakBeforeSections: []
    });
  });

  it("defaults and sanitizes G3b pagination config", () => {
    const parsed = ResumePresentationConfigSchema.parse({
      schemaVersion: "resume-presentation-v1",
      branchId: "branch",
      templateId: "classic-technical",
      contentRevision: {
        branchRevision: 0,
        currentRevisionId: "revision"
      },
      sectionOrder: ["summary", "skills", "experience", "certificates"],
      itemOrderBySection: {},
      hiddenItemIds: [],
      pagination: {
        pagePolicy: "bad-policy",
        pageBreakBeforeSections: ["experience", "experience", "unknown", "skills"]
      },
      presentationRevision: 0,
      updatedAt: "2026-07-03T00:00:00.000Z"
    });

    expect(parsed.pagination).toEqual({
      pagePolicy: "natural",
      preferredPageCount: 2,
      maximumPageCount: 4,
      overflowBehavior: "warn",
      headerFooter: "none",
      showPhoto: false,
      pageBreakBeforeSections: ["experience", "skills"]
    });
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

  it("recovers from unknown template ids in stored presentation config", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG2UnknownTemplateDb");

    await (repository as unknown as { db: { appMeta: { put: (meta: unknown) => Promise<unknown> } } }).db.appMeta.put({
      key: `resumePresentationConfig:${branch.id}`,
      value: {
        schemaVersion: "resume-presentation-v1",
        branchId: branch.id,
        templateId: "deleted-template",
        contentRevision: {
          branchRevision: branch.revision,
          currentRevisionId: branch.currentRevisionId
        },
        sectionOrder: ["summary", "skills", "experience", "certificates"],
        itemOrderBySection: {},
        hiddenItemIds: [],
        presentationRevision: 3,
        updatedAt: "2026-07-04T00:00:00.000Z"
      },
      updatedAt: "2026-07-04T00:00:00.000Z"
    });

    const config = await repository.getResumePresentationConfig(branch.id);
    expect(config.templateId).toBe("classic-technical");
    expect(config.presentationRevision).toBe(0);
  });

  it("switches to new template ids without mutating resume content facts, visibility or order", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG2TemplateSwitchDb");
    const initial = await repository.getResumePresentationConfig(branch.id);
    const revisionsBefore = await repository.listResumeRevisions(branch.id);
    const contentBefore = JSON.stringify(branch.contentItems);
    const firstVisibleId = branch.contentItems.find((item) => item.visible)?.id;
    if (!firstVisibleId) {
      throw new Error("fixture requires visible content");
    }

    const withHidden = await repository.saveResumePresentationConfig({
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      expectedPresentationRevision: initial.presentationRevision,
      operationId: "g2-hide-before-template",
      nextConfig: nextPresentationConfig(initial, branch, {
        hiddenItemIds: [firstVisibleId]
      })
    });
    const nextConfig = nextPresentationConfig(withHidden.config, branch, {
      templateId: "ats-minimal",
      hiddenItemIds: withHidden.config.hiddenItemIds
    });
    const switched = await repository.saveResumePresentationConfig({
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      expectedPresentationRevision: withHidden.config.presentationRevision,
      operationId: "g2-template-ats-minimal",
      nextConfig
    });
    const branchAfter = await repository.getResumeBranch(branch.id);

    expect(switched.config.templateId).toBe("ats-minimal");
    expect(switched.config.hiddenItemIds).toEqual([firstVisibleId]);
    expect(JSON.stringify(branchAfter?.contentItems)).toBe(contentBefore);
    expect(await repository.listResumeRevisions(branch.id)).toHaveLength(revisionsBefore.length);
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
        hiddenItemIds: initial.hiddenItemIds,
        typography: initial.typography,
        spacing: initial.spacing,
        theme: initial.theme,
        sectionStyleOverrides: initial.sectionStyleOverrides
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
        hiddenItemIds: [sortableItem.id],
        typography: {
          chineseFont: "system_sans",
          englishFont: "system_sans",
          bodyTextScale: "small",
          titleTextScale: "large",
          lineHeight: "tight"
        },
        spacing: {
          pageMargin: "normal",
          sectionGap: "tight",
          itemGap: "relaxed"
        },
        theme: {
          primaryColor: "blue",
          accentColor: "blue",
          dividerColor: "graphite",
          density: "compact"
        },
        sectionStyleOverrides: {
          summary: { showTitle: false }
        }
      }
    });

    expect(export1.record.branchRevision).toBe(export2.record.branchRevision);
    expect(export1.record.presentationRevision).toBe(0);
    expect(export2.record.presentationRevision).toBe(1);
    expect(export1.record.presentationSnapshot?.templateId).toBe("classic-technical");
    expect(export2.record.presentationSnapshot?.templateId).toBe("modern-operations");
    expect(export2.record.presentationSnapshot?.hiddenItemIds).toContain(sortableItem.id);
    expect(export1.record.presentationSnapshot?.hiddenItemIds).toEqual([]);
    expect(export2.record.presentationSnapshot?.typography?.bodyTextScale).toBe("small");
    expect(export2.record.presentationSnapshot?.spacing?.itemGap).toBe("relaxed");
    expect(export2.record.presentationSnapshot?.theme?.accentColor).toBe("blue");
    expect(export2.record.presentationSnapshot?.sectionStyleOverrides?.summary?.showTitle).toBe(false);
  });

  it("stores new template ids in ExportRecord presentation snapshots", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG2ExportTemplateDb");
    const initial = await repository.getResumePresentationConfig(branch.id);
    const config = nextPresentationConfig(initial, branch, {
      templateId: "business-consulting"
    });

    const result = await repository.createResumeExportRecord({
      operationId: `g2-export-business-${crypto.randomUUID()}`,
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      templateId: config.templateId,
      overflowStatus: "fits",
      exportStatus: "print_invoked",
      fileName: "business-consulting.pdf",
      presentationRevision: config.presentationRevision,
      presentationSnapshot: {
        templateId: config.templateId,
        itemOrderBySection: config.itemOrderBySection,
        hiddenItemIds: config.hiddenItemIds,
        typography: config.typography,
        spacing: config.spacing,
        theme: config.theme,
        sectionStyleOverrides: config.sectionStyleOverrides
      }
    });

    expect(result.record.templateId).toBe("business-consulting");
    expect(result.record.presentationSnapshot?.templateId).toBe("business-consulting");
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

  it("filters first and hidden sections from page break hints", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG3bBreakFilterDb");
    const initial = await repository.getResumePresentationConfig(branch.id);
    const sectionTypes = Array.from(new Set(branch.contentItems.filter((item) => item.visible).map((item) => contentItemSectionType(item.itemType))));
    const [firstSection] = sectionTypes;
    const nonVisibleSection = (["summary", "skills", "certificates"] as const).find((section) => !sectionTypes.includes(section)) ?? "skills";
    const saved = await repository.saveResumePresentationConfig({
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      expectedPresentationRevision: initial.presentationRevision,
      operationId: "g3b-break-filter-first",
      nextConfig: nextPresentationConfig(initial, branch, {
        pagination: {
          ...initial.pagination,
          pagePolicy: "up_to_two_pages",
          pageBreakBeforeSections: [firstSection, nonVisibleSection]
        }
      })
    });

    expect(saved.config.pagination.pageBreakBeforeSections).toEqual([]);
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
  patch: Partial<Pick<ResumePresentationConfig, "templateId" | "hiddenItemIds" | "pagination">> & {
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

function contentItemSectionType(itemType: string): ResumeRenderSectionType {
  if (itemType === "summary") {
    return "summary";
  }
  if (itemType === "skill") {
    return "skills";
  }
  if (itemType === "certificate") {
    return "certificates";
  }
  return "experience";
}
