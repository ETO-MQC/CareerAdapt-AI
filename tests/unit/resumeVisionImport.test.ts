import { afterEach, describe, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { ResumeImportOrchestrator } from "@/services/resumeImport/ResumeImportOrchestrator";
import { readResumeImportSemanticPreference, writeResumeImportSemanticPreference } from "@/services/preferences/resumeImportAi";
import { AGENT_RESUME_IMPORT_ACCEPT } from "@/agent/capabilities/AgentProductCapabilityManifest";

const mocks = vi.hoisted(() => ({ vision: vi.fn(), pdf: vi.fn() }));
vi.mock("@/services/resumeImport/visionExtraction", () => ({ extractResumeVision: mocks.vision }));
vi.mock("@/services/pdf/extractText", () => ({ extractTextFromPdfBuffer: mocks.pdf }));
let db: CareerAdaptDb | undefined;
afterEach(async () => { if (db) { await db.delete(); db.close(); db = undefined; } vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear(); });

describe("AI-first resume image and scanned-PDF import", () => {
  it("defaults to AI while honoring an explicit local choice", () => {
    expect(readResumeImportSemanticPreference()).toBe("ai");
    writeResumeImportSemanticPreference("local");
    expect(readResumeImportSemanticPreference()).toBe("local");
    expect(AGENT_RESUME_IMPORT_ACCEPT).toContain(".png");
  });
  it.each(["pdf", "png"])("maps %s visual source through canonical fields without writing formal facts before review", async (extension) => {
    db = new CareerAdaptDb(`vision-import-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    mocks.pdf.mockResolvedValue({ ok: false, code: "no_text_layer", message: "扫描件" });
    mocks.vision.mockResolvedValue({ pageCount: 1, emptyPages: [], blocks: [
      { id: "vision:p1:b0", page: 1, text: "个人技能", rawText: "个人技能", blockType: "heading", order: 0, sourceEngine: "vision_ai", sourceEngineVersion: "test/model", extractionConfidence: 0.5 },
      { id: "vision:p1:b1", page: 1, text: "Python", rawText: "Python", blockType: "paragraph", order: 1, sourceEngine: "vision_ai", sourceEngineVersion: "test/model", extractionConfidence: 0.5 }
    ] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, task: "resume-document-mapper", promptVersion: "test", output: {
      resume: { schemaVersion: "careeradapt-resume-v2", basics: {}, sections: [
        { id: "skills", sectionType: "skills", title: "个人技能", order: 0, visible: true,
          items: [{ id: "python", sectionType: "skills", name: "Python" }] }
      ] }, sourceRefs: [{ path: "/sections/0/items/0", blockIds: ["vision:p1:b1"], confidenceLevel: "high", confidenceReason: "原页可读", needsConfirmation: true }]
    }, meta: { provider: "test", model: "test", latencyMs: 1 } }))));
    const file = new File([extension === "pdf" ? "%PDF-1.7\nmock-scanned-page" : "mock-image"], `resume.${extension}`, {
      type: extension === "pdf" ? "application/pdf" : "image/png"
    });
    const result = await new ResumeImportOrchestrator(repository).prepare({ file, fileName: file.name, mimeType: file.type, size: file.size }, { semanticMode: "ai" });
    expect(mocks.vision).toHaveBeenCalledOnce();
    expect(result.routingDecision.route).toBe("vision_ai");
    expect(result.draft.sourceKind).toBe(extension === "pdf" ? "scanned_pdf" : "image");
    expect(result.draft.qualityReport?.recommendedRoute).toBe("ai_text");
    expect(result.draft.sourceBlocks.every((block) => block.sourceEngine === "vision_ai")).toBe(true);
    expect(JSON.stringify(result.draft.sections)).toContain("Python");
    expect((await repository.getImportedResumeDraft(result.importId))?.status).toBe("reviewing");
    expect(await db.profiles.count()).toBe(0); expect(await db.resumeBranches.count()).toBe(0);
  });
  it("does not send a scanned PDF to a remote model in local-only mode", async () => {
    db = new CareerAdaptDb(`vision-local-${crypto.randomUUID()}`);
    mocks.pdf.mockResolvedValue({ ok: false, code: "no_text_layer", message: "扫描件" });
    const file = new File(["%PDF-1.7\nmock-scanned-page"], "resume.pdf", { type: "application/pdf" });
    await expect(new ResumeImportOrchestrator(new WorkspaceRepository(db)).prepare({ file, fileName: file.name, mimeType: file.type, size: file.size }, { semanticMode: "local" }))
      .rejects.toMatchObject({ code: "resume_import_ocr_required" });
    expect(mocks.vision).not.toHaveBeenCalled();
  });
});
