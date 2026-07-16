import { afterEach, describe, expect, it, vi } from "vitest";
import { extractTextFromDocxBuffer } from "@/domain/resumeImport/docx";
import { benchmarkResumeOcrAdapter, createLocalPaddleOcrAdapter } from "@/domain/resumeImport/ocrAdapter";
import { createImportedResumeDraftFromPdf, createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import { buildResumeImportConfirmation } from "@/domain/resumeImport/confirm";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type { PdfPageText, StructuredResumeDraft } from "@/domain/schemas";

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
      expect.arrayContaining(["work", "project", "skills"])
    );
    expect(draft.sections.map((section) => section.sectionType)).not.toContain("experience");
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
      draft: confirmAllFieldCandidates(draft),
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

    const saved = await repository.saveImportedResumeDraft(confirmAllFieldCandidates(draft), 0);
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

  it("normalizes structured JSON into the same imported resume draft review model", () => {
    const structuredDraft: StructuredResumeDraft = {
      schemaVersion: "structured-resume-draft-v1",
      basics: {
        name: "陈同学",
        email: "demo.student@example.com",
        summary: "数据分析方向学生。"
      },
      sections: [{
        title: "项目与经历",
        sectionType: "experience",
        items: ["使用 Stata 清洗 31 个省级样本。"]
      }]
    };

    const draft = createImportedResumeDraftFromStructuredJson({
      importId: "resume-import-json",
      source: {
        fileName: "resume.json",
        mimeType: "application/json",
        fileHash: "structured-json-hash-123456",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      structuredDraft,
      now: TEST_TIME
    });

    expect(draft.schemaVersion).toBe("resume-import-v2");
    if (draft.schemaVersion !== "resume-import-v2") throw new Error("expected a v2 import draft");
    expect(draft.qualityReport.schemaVersion).toBe("resume-import-quality-v2");
    expect(draft.sourceBlocks.every((block) => block.sourceEngine === "json_mapper")).toBe(true);
    expect(draft.source.mimeType).toBe("application/json");
    expect(draft.basics.name?.value).toBe("陈同学");
    expect(draft.sections[0]?.sectionType).toBe("experience");
    expect(draft.sections[0]?.items[0]?.sourceStatus).toBe("user_confirmed_modified");
  });

  it("extracts plain text from a stored DOCX document.xml entry", async () => {
    const xml = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
      "<w:body>",
      "<w:p><w:r><w:t>陈同学</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>项目与经历</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>使用 Excel 整理数据。</w:t></w:r></w:p>",
      "</w:body></w:document>"
    ].join("");

    const result = await extractTextFromDocxBuffer(createStoredDocx(xml));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.text : "").toContain("陈同学");
    expect(result.ok ? result.text : "").toContain("使用 Excel 整理数据。");
  });

  it("keeps local OCR behind a health-checked adapter with an explicit fallback", async () => {
    const file = new File(["fixture"], "scan.png", { type: "image/png" });
    const adapter = createLocalPaddleOcrAdapter({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        ok: false,
        engine: "paddleocr-vl-local",
        configured: true,
        modelAvailable: true,
        runtimeAvailable: false,
        message: "PaddleOCR runtime is not installed."
      }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch
    });
    const result = await adapter.recognize(file);
    const benchmark = await benchmarkResumeOcrAdapter(adapter);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("engine_unavailable");
    expect(benchmark.classification).toBe("B");
    expect(benchmark.supported).toBe(false);
    expect(benchmark.recommendation).toBe("use_manual_fallback");
    expect(benchmark.model.name).toBe("PaddleOCR-VL-1.6");
    expect(benchmark.conclusion).toContain("人工核对");
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

function confirmAllFieldCandidates<T extends ReturnType<typeof createImportedResumeDraftFromPdf>>(draft: T): T {
  if (draft.schemaVersion !== "resume-import-v2") return draft;
  return {
    ...draft,
    fieldCandidates: draft.fieldCandidates.map((candidate) => ({ ...candidate, needsConfirmation: false, userConfirmed: true }))
  } as T;
}

function createStoredDocx(documentXml: string) {
  const fileName = new TextEncoder().encode("word/document.xml");
  const data = new TextEncoder().encode(documentXml);
  const localHeaderLength = 30 + fileName.length;
  const centralDirectoryOffset = localHeaderLength + data.length;
  const centralHeaderLength = 46 + fileName.length;
  const output = new Uint8Array(centralDirectoryOffset + centralHeaderLength + 22);
  const view = new DataView(output.buffer);
  let offset = 0;

  view.setUint32(offset, 0x04034b50, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 8, 0, true);
  view.setUint32(offset + 18, data.length, true);
  view.setUint32(offset + 22, data.length, true);
  view.setUint16(offset + 26, fileName.length, true);
  output.set(fileName, offset + 30);
  output.set(data, localHeaderLength);

  offset = centralDirectoryOffset;
  view.setUint32(offset, 0x02014b50, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 6, 20, true);
  view.setUint16(offset + 10, 0, true);
  view.setUint32(offset + 20, data.length, true);
  view.setUint32(offset + 24, data.length, true);
  view.setUint16(offset + 28, fileName.length, true);
  view.setUint32(offset + 42, 0, true);
  output.set(fileName, offset + 46);

  offset += centralHeaderLength;
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, 1, true);
  view.setUint16(offset + 10, 1, true);
  view.setUint32(offset + 12, centralHeaderLength, true);
  view.setUint32(offset + 16, centralDirectoryOffset, true);
  return output.buffer;
}
