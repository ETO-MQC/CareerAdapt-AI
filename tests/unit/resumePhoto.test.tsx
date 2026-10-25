import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoCareerProfile } from "@/data/demoProfile";
import { ResumeBasicsV2Schema, ResumeBranchBasicsSchema, ResumePresentationConfigSchema } from "@/domain/schemas";
import { LocalResumePhotoSchema, ResumePhotoSchema } from "@/domain/schemas/resumePhoto";
import { prepareResumePhoto, validateResumePhotoFile } from "@/services/resumePhoto";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { exportCareerAdaptResumeJsonV2 } from "@/domain/resumeImport/jsonV2Adapter";
import { migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";
import { resumeTemplates } from "@/components/resume/templates/templateRegistry";
import { createP48bTemplateFixtures } from "../fixtures/resume-v2/p4.8bTemplateFixtures";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import { buildResumeImportConfirmation } from "@/domain/resumeImport/confirm";
import { CareerAdaptResumeJsonV2Schema } from "@/domain/schemas";

const PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=";
let db: CareerAdaptDb | undefined;
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); if (db) { db.close(); await db.delete(); db = undefined; } });

describe("resume photo contract", () => {
  it("keeps JSON photo source evidence through explicit import confirmation without profile writes", () => {
    const resume = CareerAdaptResumeJsonV2Schema.parse({ schemaVersion: "careeradapt-resume-v2", basics: { name: "匿名候选人", photo: PHOTO }, sections: [{ id: "summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ id: "summary-1", sectionType: "summary", text: "关注可靠工程交付。" }] }] });
    const draft = createImportedResumeDraftFromStructuredJson({ canonicalResume: resume, source: { fileName: "photo.json", mimeType: "application/json", pageCount: 1, fileHash: "photo-json-test-123456" } });
    expect(draft.basics.photo?.value).toBe(PHOTO);
    expect(draft.basics.photo?.sourceBlockIds.length).toBeGreaterThan(0);
    expect(() => buildResumeImportConfirmation({ draft, operationId: "photo-json-unconfirmed", newProfileName: "匿名候选人" })).toThrow("resume_import_photo_unconfirmed");
    draft.basics.photo!.userConfirmed = true;
    const confirmed = buildResumeImportConfirmation({ draft, operationId: "photo-json-import", newProfileName: "匿名候选人" });
    expect(confirmed.branch.resumeBasics?.photo).toBe(PHOTO);
    expect(confirmed.firstRevision.snapshot.resumeBasics?.photo).toBe(PHOTO);
    expect(confirmed.profile.structuredBasics?.photo).toBeUndefined();
    expect(exportCareerAdaptResumeJsonV2({ branch: confirmed.branch, profile: confirmed.profile }).basics.photo).toBe(PHOTO);
  });
  it("keeps old missing/HTTP photos readable and rejects unsafe, oversized or non-raster values", () => {
    expect(ResumeBasicsV2Schema.parse({}).photo).toBeUndefined();
    expect(ResumeBranchBasicsSchema.parse({}).photo).toBeUndefined();
    expect(ResumePhotoSchema.parse("https://example.com/old-photo.jpg")).toContain("https:");
    expect(ResumeBasicsV2Schema.parse({ photo: PHOTO }).photo).toBe(PHOTO);
    for (const photo of ["", "javascript:alert(1)", "blob:https://example.com/id", "data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,YQ==", `data:image/png;base64,${"A".repeat(800_000)}`]) {
      expect(ResumePhotoSchema.safeParse(photo).success, photo.slice(0, 50)).toBe(false);
    }
    expect(LocalResumePhotoSchema.safeParse("https://example.com/photo.jpg").success).toBe(false);
  });

  it("rejects wrong types, empty/large files and decoding failures", async () => {
    for (const file of [{ type: "image/svg+xml", size: 10 }, { type: "image/png", size: 0 }, { type: "image/jpeg", size: 6_000_000 }]) expect(() => validateResumePhotoFile(file)).toThrow();
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("corrupt")));
    await expect(prepareResumePhoto(new File(["bad"], "bad.png", { type: "image/png" }))).rejects.toThrow("无法读取");
  });

  it("downsamples to 600px and re-encodes locally, closing decoded resources", async () => {
    const bitmap = { width: 2400, height: 3200, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage: draw } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PHOTO);
    expect(await prepareResumePhoto(new File(["image"], "photo.png", { type: "image/png" }))).toBe(PHOTO);
    expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 450, 600);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it.each(resumeTemplates.map(template => [template.id, template] as const))("%s renders exactly the declared photo capability with show/hide and continuation", (_id, template) => {
    const model = structuredClone(createP48bTemplateFixtures()[0].model);
    model.candidate.photo = PHOTO;
    const config = ResumePresentationConfigSchema.parse({ schemaVersion: "resume-presentation-v1", branchId: model.branchId, templateId: template.id, contentRevision: { branchRevision: model.branchRevision, currentRevisionId: model.branchCurrentRevisionId }, presentationRevision: 0, updatedAt: new Date().toISOString(), pagination: { showPhoto: true } });
    const render = (showPhoto: boolean, continuation = false) => renderToStaticMarkup(template.render(model, { presentationConfig: { ...config, pagination: { ...config.pagination, showPhoto } }, pagination: { pageNumber: continuation ? 2 : 1, pageCount: 2, isContinuation: continuation } }));
    expect(render(true).includes('class="resume-candidate-photo"')).toBe(template.capabilities.supportsPhoto);
    expect(render(false)).not.toContain('class="resume-candidate-photo"');
    expect(render(true, true)).not.toContain('class="resume-candidate-photo"');
    delete model.candidate.photo;
    expect(render(true)).not.toContain('class="resume-candidate-photo"');
  });

  it("saves/reopens/replaces/removes through revisions without changing profile, sibling or content", async () => {
    db = new CareerAdaptDb(`photo-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(demoCareerProfile);
    const create = (operationId: string) => repository.createGeneralResumeBranch({ profileId: demoCareerProfile.id, operationId, name: operationId, includeProfileBasics: true, includeProfileFacts: true });
    const first = await create("photo-first");
    const second = await create("photo-second");
    const profileBefore = await repository.getProfile(demoCareerProfile.id);
    const saved = await repository.editResumeBranchBasics({ branchId: first.branch.id, expectedRevision: first.branch.revision, operationId: "photo-upload", basics: { photo: PHOTO } });
    expect(saved.branch.revision).toBe(first.branch.revision + 1);
    const reopened = await new WorkspaceRepository(db).getResumeBranch(first.branch.id);
    expect(reopened?.resumeBasics?.photo).toBe(PHOTO);
    expect(migrateResumeBranchToV2(reopened!).resumeBasics?.photo).toBe(PHOTO);
    const model = mapBranchToResumeRenderModel({ branch: reopened!, profile: profileBefore! });
    expect(model.candidate.photo).toBe(PHOTO);
    expect(exportCareerAdaptResumeJsonV2({ branch: reopened!, profile: profileBefore! }).basics.photo).toBe(PHOTO);
    await expect(repository.editResumeBranchBasics({ branchId: first.branch.id, expectedRevision: first.branch.revision, operationId: "photo-stale", basics: { photo: undefined } })).rejects.toThrow();
    const replacement = PHOTO.replace("image/png", "image/jpeg");
    const changed = await repository.editResumeBranchBasics({ branchId: first.branch.id, expectedRevision: saved.branch.revision, operationId: "photo-replace", basics: { photo: replacement } });
    expect(changed.branch.resumeBasics?.photo).toBe(replacement);
    const removed = await repository.editResumeBranchBasics({ branchId: first.branch.id, expectedRevision: changed.branch.revision, operationId: "photo-remove", basics: { photo: undefined } });
    const roundTrip = JSON.parse(JSON.stringify(removed.branch));
    expect(mapBranchToResumeRenderModel({ branch: roundTrip, profile: profileBefore! }).candidate.photo).toBeUndefined();
    expect(exportCareerAdaptResumeJsonV2({ branch: removed.branch, profile: profileBefore! }).basics.photo).toBeUndefined();
    expect(removed.branch.contentItems).toEqual(first.branch.contentItems);
    expect(await repository.getProfile(demoCareerProfile.id)).toEqual(profileBefore);
    expect(await repository.getResumeBranch(second.branch.id)).toEqual(second.branch);
    const undone = await repository.undoResumeBranch({ branchId: first.branch.id, expectedRevision: removed.branch.revision, operationId: "photo-undo" });
    expect(undone.branch.resumeBasics?.photo).toBe(replacement);
  });
});
