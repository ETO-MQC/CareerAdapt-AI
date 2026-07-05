import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { createRuleRequirementMatches } from "@/domain/match/matcher";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import {
  ResumePdfExportRequestSchema,
  ResumePresentationConfigSchema
} from "@/domain/schemas";
import { buildResumePdfFileName, contentDispositionAttachment, isSafePdfFileName, PDF_MIME_TYPE } from "@/services/export/filename";
import { createResumePdfExportRequest, stableStringify, verifyExportSnapshotHash } from "@/services/export/snapshot";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) {
    return;
  }
  db.close();
  await db.delete();
  db = undefined;
});

describe("V2 G3a direct PDF export", () => {
  it("builds safe Windows filenames without internal ids or duplicate extensions", () => {
    const filename = buildResumePdfFileName({
      candidateName: " 陈:同/学.pdf ",
      jobTitle: " 数据*分析?实习生 ",
      templateName: "稳重技术",
      date: "2026-07-04T12:00:00.000Z"
    });

    expect(filename).toBe("陈_同_学_数据_分析_实习生_稳重技术_20260704.pdf");
    expect(filename).not.toContain("classic-technical");
    expect(filename).not.toContain(".pdf.pdf");
    expect(isSafePdfFileName(filename)).toBe(true);
    expect(contentDispositionAttachment(filename)).toContain("filename*=");
  });

  it("uses safe fallbacks and limits filename length", () => {
    const filename = buildResumePdfFileName({
      candidateName: "   ",
      jobTitle: "",
      templateName: "A".repeat(200),
      date: "2026-07-04T12:00:00.000Z"
    });

    expect(filename.startsWith("CareerAdapt_Resume_")).toBe(true);
    expect(filename.endsWith(".pdf")).toBe(true);
    expect(filename.length).toBeLessThanOrEqual(120);
    expect(isSafePdfFileName(filename)).toBe(true);
  });

  it("validates export request schema and rejects unsafe filenames or template ids", async () => {
    const { branch, presentationConfig, job } = await createBranchFixture("CareerAdaptG3aSchemaDb");
    const renderModel = mapBranchToResumeRenderModel({
      branch,
      profile: demoCareerProfile,
      job,
      presentationConfig
    });
    const request = createResumePdfExportRequest({
      exportId: "v2-g3a-direct-test",
      renderModel,
      presentationConfig,
      generatedAt: "2026-07-04T12:00:00.000Z",
      filename: buildResumePdfFileName({
        candidateName: renderModel.candidate.name,
        jobTitle: renderModel.jobTitle,
        templateName: "技术",
        date: "2026-07-04T12:00:00.000Z"
      }),
      overflowStatus: "fits"
    });

    expect(ResumePdfExportRequestSchema.safeParse(request).success).toBe(true);
    expect(verifyExportSnapshotHash(request.snapshot)).toBe(true);
    expect(ResumePdfExportRequestSchema.safeParse({
      ...request,
      snapshot: { ...request.snapshot, filename: "../resume.pdf" }
    }).success).toBe(false);
    expect(ResumePdfExportRequestSchema.safeParse({
      ...request,
      snapshot: { ...request.snapshot, templateId: "deleted-template" }
    }).success).toBe(false);
  });

  it("keeps snapshot hashes stable and changes them when presentation config changes", async () => {
    const { branch, presentationConfig, job } = await createBranchFixture("CareerAdaptG3aHashDb");
    const renderModel = mapBranchToResumeRenderModel({
      branch,
      profile: demoCareerProfile,
      job,
      presentationConfig
    });
    const baseInput = {
      exportId: "v2-g3a-direct-hash",
      renderModel,
      generatedAt: "2026-07-04T12:00:00.000Z",
      filename: "陈同学_数据分析实习生_技术_20260704.pdf",
      overflowStatus: "fits" as const
    };
    const first = createResumePdfExportRequest({ ...baseInput, presentationConfig });
    const second = createResumePdfExportRequest({ ...baseInput, presentationConfig });
    const changed = createResumePdfExportRequest({
      ...baseInput,
      presentationConfig: {
        ...presentationConfig,
        theme: { ...presentationConfig.theme, accentColor: "blue" }
      }
    });

    expect(first.snapshot.snapshotHash).toBe(second.snapshot.snapshotHash);
    expect(first.snapshot.snapshotHash).not.toBe(changed.snapshot.snapshotHash);
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("records direct PDF success with frozen historical revision after concurrent edits", async () => {
    const { repository, branch, presentationConfig } = await createBranchFixture("CareerAdaptG3aHistoricalDb");
    const edited = await repository.editResumeBranch({
      branchId: branch.id,
      expectedRevision: branch.revision,
      operationId: "g3a-edit-after-export-start",
      edits: [{ itemId: branch.contentItems[0].id, text: branch.contentItems[0].text }]
    });

    const record = await repository.createResumeExportRecord({
      operationId: "g3a-direct-success",
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      templateId: presentationConfig.templateId,
      overflowStatus: "fits",
      exportStatus: "direct_pdf_success",
      exportMethod: "direct_pdf",
      fileName: "陈同学_数据分析实习生_技术_20260704.pdf",
      mimeType: PDF_MIME_TYPE,
      fileSize: 12345,
      startedAt: "2026-07-04T12:00:00.000Z",
      completedAt: "2026-07-04T12:00:01.000Z",
      presentationRevision: presentationConfig.presentationRevision,
      presentationSnapshot: {
        templateId: presentationConfig.templateId,
        sectionOrder: presentationConfig.sectionOrder,
        itemOrderBySection: presentationConfig.itemOrderBySection,
        hiddenItemIds: presentationConfig.hiddenItemIds,
        typography: presentationConfig.typography,
        spacing: presentationConfig.spacing,
        theme: presentationConfig.theme,
        sectionStyleOverrides: presentationConfig.sectionStyleOverrides
      },
      snapshotHash: "snapshot-hash-123",
      pdfContentHash: "pdf-hash-123",
      allowHistoricalRevision: true
    });

    expect(edited.branch.revision).toBeGreaterThan(branch.revision);
    expect(record.record.exportStatus).toBe("direct_pdf_success");
    expect(record.record.exportMethod).toBe("direct_pdf");
    expect(record.record.branchRevision).toBe(branch.revision);
    expect(record.record.revisionId).toBe(branch.currentRevisionId);
    expect(record.record.fileSize).toBe(12345);
    expect(record.record.pdfContentHash).toBe("pdf-hash-123");
  });

  it("keeps old ExportRecords compatible and blocks success records for overflow", async () => {
    const { repository, branch } = await createBranchFixture("CareerAdaptG3aCompatDb");
    const legacy = await repository.createResumeExportRecord({
      operationId: "g3a-legacy-print",
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "fits",
      exportStatus: "print_invoked",
      fileName: "legacy.pdf"
    });
    const failed = await repository.createResumeExportRecord({
      operationId: "g3a-direct-failed",
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "fits",
      exportStatus: "failed",
      exportMethod: "direct_pdf",
      fileName: "failed.pdf",
      failureCode: "pdf_generation_failed"
    });

    expect(legacy.record.exportMethod).toBeUndefined();
    expect(failed.record.exportStatus).toBe("failed");
    expect(failed.record.failureCode).toBe("pdf_generation_failed");
    await expect(repository.createResumeExportRecord({
      operationId: "g3a-direct-overflow-success",
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: branch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "overflow",
      exportStatus: "direct_pdf_success",
      fileName: "bad.pdf"
    })).rejects.toThrow("export_overflow_blocked");
  });
});

async function createBranchFixture(dbNamePrefix: string) {
  db = new CareerAdaptDb(`${dbNamePrefix}-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const job = demoJobDescriptions[0];
  const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, "2026-07-04T00:00:00.000Z");
  await repository.saveProfile(demoCareerProfile);
  await repository.saveJobDescription(job);
  await repository.saveRuleRequirementMatches({ profile: demoCareerProfile, job, matches });
  const draft = await repository.createJobAdaptationDraft({
    profile: demoCareerProfile,
    job,
    matches,
    operationId: `g3a-draft-${crypto.randomUUID()}`
  });
  const created = await repository.createResumeBranchFromDraft({
    draftId: draft.draft.id,
    expectedDraftRevision: draft.draft.revision,
    operationId: `g3a-branch-${crypto.randomUUID()}`,
    name: "G3a direct PDF branch"
  });
  const presentationConfig = ResumePresentationConfigSchema.parse(await repository.getResumePresentationConfig(created.branch.id));
  return { repository, branch: created.branch, presentationConfig, job };
}
