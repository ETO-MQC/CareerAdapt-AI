import { afterEach, describe, expect, it } from "vitest";
import { createImportedResumeDraftFromPdf } from "@/domain/resumeImport/parser";
import { buildResumeImportConfirmation } from "@/domain/resumeImport/confirm";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type { PdfPageText } from "@/domain/schemas";

const TEST_TIME = "2026-07-05T00:00:00.000Z";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (db) {
    await db.delete();
    db.close();
    db = undefined;
  }
});

describe("V2-G4a resume PDF import", () => {
  it("parses local PDF page text into a reviewable imported resume draft", () => {
    const draft = createImportedResumeDraftFromPdf({
      importId: "resume-import-unit",
      source: {
        sourceSessionId: "pdf-session-unit",
        fileName: "unit-resume.pdf",
        fileHash: "hash-unit-resume-pdf-123456",
        normalizedTextHash: "normalized-hash",
        pageCount: 2,
        extractedAt: TEST_TIME
      },
      pages: createPageTexts(),
      now: TEST_TIME
    });

    expect(draft.status).toBe("reviewing");
    expect(draft.source.mimeType).toBe("application/pdf");
    expect(draft.basics.email?.value).toBe("alex@example.com");
    expect(draft.basics.phone?.value).toContain("13800138000");
    expect(draft.sections.map((section) => section.sectionType)).toEqual(
      expect.arrayContaining(["experience", "skills"])
    );
    expect(draft.sections.flatMap((section) => section.items).every((item) => item.pageRefs.length > 0)).toBe(true);
  });

  it("builds a general branch without jobId and keeps source trace renderable", () => {
    const draft = createImportedResumeDraftFromPdf({
      importId: "resume-import-general",
      source: {
        sourceSessionId: "pdf-session-general",
        fileName: "general.pdf",
        fileHash: "hash-general-resume-pdf-123456",
        pageCount: 2
      },
      pages: createPageTexts(),
      now: TEST_TIME
    });

    const result = buildResumeImportConfirmation({
      draft,
      operationId: "confirm-general",
      now: TEST_TIME
    });
    const renderModel = mapBranchToResumeRenderModel({
      branch: result.branch,
      profile: result.profile
    });

    expect(result.branch.branchPurpose).toBe("general");
    expect(result.branch.jobId).toBeUndefined();
    expect(result.branch.requirementMatchIds).toEqual([]);
    expect(result.firstRevision.source).toBe("import_confirmed");
    expect(renderModel.jobTitle).toBe("通用简历");
    expect(renderModel.sourceTrace.jobId).toBeUndefined();
  });

  it("confirms imported resume draft idempotently and supports later branch edits", async () => {
    db = new CareerAdaptDb(`CareerAdaptImportDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const draft = createImportedResumeDraftFromPdf({
      importId: "resume-import-repository",
      source: {
        sourceSessionId: "pdf-session-repository",
        fileName: "repository.pdf",
        fileHash: "hash-repository-resume-pdf-123456",
        pageCount: 2
      },
      pages: createPageTexts(),
      now: TEST_TIME
    });

    const saved = await repository.saveImportedResumeDraft(draft, 0);
    const first = await repository.confirmImportedResume({
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      operationId: "confirm-repository"
    });
    const duplicate = await repository.confirmImportedResume({
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      operationId: "confirm-repository"
    });
    const branch = await repository.getResumeBranch(first.branchId);
    const edited = await repository.editResumeBranch({
      branchId: first.branchId,
      expectedRevision: branch!.revision,
      operationId: "edit-general-imported-branch",
      edits: [{ itemId: branch!.contentItems[0].id, text: branch!.contentItems[0].text }]
    });

    expect(first.idempotent).toBe(false);
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.branchId).toBe(first.branchId);
    expect(branch?.branchPurpose).toBe("general");
    expect(branch?.jobId).toBeUndefined();
    expect(await repository.getResumePresentationConfig(first.branchId)).toMatchObject({
      branchId: first.branchId,
      presentationRevision: 0
    });
    expect(edited.branch.revision).toBe(1);
  });
});

function createPageTexts(): PdfPageText[] {
  const page1 = [
    "Alex Chen",
    "alex@example.com 13800138000",
    "Summary",
    "Data analyst focused on clean reporting and dashboard automation.",
    "Work Experience",
    "ACME Analytics | Data Analyst",
    "- Built weekly SQL reports for operation teams.",
    "- Maintained Tableau dashboards for sales review."
  ].join("\n");
  const page2 = [
    "Projects",
    "Inventory Forecasting Project",
    "- Built a Python model for stock planning.",
    "Skills",
    "SQL, Python, Tableau"
  ].join("\n");

  return [
    {
      id: "pdf-page-unit-1",
      sessionId: "pdf-session-unit",
      pageNumber: 1,
      extractedPageText: page1,
      cleanedPageText: page1,
      charStart: 0,
      charEnd: page1.length,
      textItemCount: 24,
      warnings: [],
      rawTextHash: "raw-page-1",
      cleanedTextHash: "clean-page-1",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    },
    {
      id: "pdf-page-unit-2",
      sessionId: "pdf-session-unit",
      pageNumber: 2,
      extractedPageText: page2,
      cleanedPageText: page2,
      charStart: page1.length + 1,
      charEnd: page1.length + 1 + page2.length,
      textItemCount: 16,
      warnings: [],
      rawTextHash: "raw-page-2",
      cleanedTextHash: "clean-page-2",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    }
  ];
}
