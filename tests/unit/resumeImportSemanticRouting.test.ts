import { afterEach, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { ResumeImportOrchestrator } from "@/services/resumeImport/ResumeImportOrchestrator";
import { normalizeResumeMapperBoundaryOutput } from "@/ai/tasks/resumeDocumentMapperOutput";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { inspectResumeItemStructuralIntegrity } from "@/domain/resumeIntegrity";
import { isPoliticalIdentityLabel } from "@/domain/resumeImport/basicClassification";
import { resumeHeadingRepresentedSections } from "@/domain/resumeImport/sectionHeading";

let db: CareerAdaptDb | undefined;
afterEach(async () => { vi.unstubAllGlobals(); if (db) { await db.delete(); db.close(); db = undefined; } });

it("does not treat political identity as a job target and preserves an explicitly stated real target", () => {
  const normalized = normalizeResumeMapperBoundaryOutput({ resume: { schemaVersion: "careeradapt-resume-v2", basics: {
    headline: "中共预备党员", targetRole: "数据分析师"
  }, sections: [] }, sourceRefs: [{ path: "/basics/targetRole", blockIds: ["role"], confidenceLevel: "high", needsConfirmation: false }] },
  [{ id: "role", text: "求职意向：数据分析师" }]);
  expect(normalized.resume.basics.headline).toBe("数据分析师");
  expect(normalized.mapperDiagnostics?.shapeRepairs).toContain("political_identity_not_job_target");
});

it("only filters explicit political identity labels, preserving actual job titles", () => {
  expect(isPoliticalIdentityLabel("政治面貌：中共预备党员")).toBe(true);
  expect(isPoliticalIdentityLabel("党员服务岗")).toBe(false);
  const result = normalizeResumeMapperBoundaryOutput({ resume: { schemaVersion: "careeradapt-resume-v2", basics: { headline: "中共预备党员" }, sections: [] }, sourceRefs: [] }, [{ id: "identity", text: "中共预备党员" }]);
  expect(result.resume.basics.headline).toBeUndefined();
});

it("keeps a role-only campus item healthy without inventing an organization", () => {
  expect(inspectResumeItemStructuralIntegrity({ id: "campus", sectionType: "campus", role: "班长", description: "对接35名同学",
    highlights: [], current: false, customFields: [] }).status).toBe("healthy");
  expect(inspectResumeItemStructuralIntegrity({ id: "work", sectionType: "work", role: "助理", description: "整理资料", highlights: [], current: false, customFields: [] }).status).not.toBe("healthy");
  expect(resumeHeadingRepresentedSections("Skills & Certifications")).toEqual(["skills", "certificates", "languages"]);
  expect(resumeHeadingRepresentedSections("技能与证书")).toEqual(["skills", "certificates", "languages"]);
});

it("imports mixed headings and training into canonical sections, then renders strictly after confirmation", async () => {
  db = new CareerAdaptDb(`semantic-routing-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const blocks = JSON.parse(JSON.parse(String(init?.body)).input.rawText) as Array<{ id: string; text: string }>;
    const refs = (path: string, texts: string[]) => ({ path, blockIds: blocks.filter((block) => texts.includes(block.text)).map((block) => block.id),
      confidenceLevel: "high", needsConfirmation: false });
    const output = normalizeResumeMapperBoundaryOutput({ resume: { schemaVersion: "careeradapt-resume-v2", basics: { name: blocks[0].text, headline: "中共预备党员" }, sections: [
      { sectionType: "campus", title: "校园经历", items: [{ role: "班长", description: "对接35名同学" }] },
      { sectionType: "other", title: "培训经历", items: [{ title: "示例机构", description: "示例机构 2026.07—2026.09 完成数据库实操培训" }] },
      { sectionType: "certificates", title: "证书", items: [{ name: "CET6" }] }
    ] }, sourceRefs: [refs("/basics/name", [blocks[0].text]), refs("/basics/headline", ["中共预备党员"]), refs("/sections/0/items/0", ["班长", "对接35名同学"]),
      refs("/sections/1/items/0", ["示例机构 2026.07—2026.09 完成数据库实操培训"]), refs("/sections/2/items/0", ["CET6"])] }, blocks);
    return new Response(JSON.stringify({ ok: true, task: "resume-document-mapper", promptVersion: "test", output,
      meta: { provider: "test", model: "test", latencyMs: 1 } }));
  }));
  const text = ["匿名同学", "中共预备党员", "校园经历", "班长", "对接35名同学", "培训经历", "示例机构 2026.07—2026.09 完成数据库实操培训", "技能与证书", "CET6"].join("\n\n");
  const file = new File([text], "anonymous.txt", { type: "text/plain" });
  const prepared = await new ResumeImportOrchestrator(repository).prepare({ file, fileName: file.name, mimeType: file.type, size: file.size }, { semanticMode: "ai" });
  expect(prepared.draft.basics.targetRole).toBeUndefined();
  const retained = JSON.stringify(prepared.draft.unclassifiedBlocks);
  expect(retained).not.toContain('"text":"技能与证书"'); expect(retained).not.toContain('"text":"培训经历"');
  expect(prepared.draft.sections.map((section) => section.sectionType)).toEqual(expect.arrayContaining(["campus", "other", "certificates"]));
  const confirmed = await repository.confirmImportedResume({ importId: prepared.importId, expectedDraftRevision: prepared.draftRevision,
    operationId: "semantic-routing-confirm", target: { mode: "new", profileName: "匿名测试", createGeneralResume: true } });
  const branch = await repository.getResumeBranch(confirmed.branchId!);
  const profile = await repository.getProfile(branch!.profileId);
  const model = mapBranchToResumeRenderModel({ branch: branch!, profile: profile! });
  expect(model.schemaVersion).toBe("resume-render-v2");
  if (model.schemaVersion !== "resume-render-v2") throw new Error("expected canonical render model");
  expect(model.compatibilityWarnings).toEqual([]);
  expect(JSON.stringify(model)).toContain("对接35名同学");
});
