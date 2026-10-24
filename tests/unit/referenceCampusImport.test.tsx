import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { referenceCampusResume } from "../fixtures/resume-v2/referenceCampus";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { ResumeImportOrchestrator } from "@/services/resumeImport/ResumeImportOrchestrator";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { ResumeItemV2Schema, ResumePresentationConfigSchema } from "@/domain/schemas";
import { normalizeResumeMapperBoundaryOutput } from "@/ai/tasks/resumeDocumentMapperOutput";
import { projectResumePresentationItem } from "@/domain/resumePresentation/projector";
import { resumeTemplates } from "@/components/resume/templates/templateRegistry";
import { createRenderCoverageReport, presentationCoverage, renderedCoverage } from "@/services/export/renderCoverage";
import { presentationSnapshotFromConfig, presentationConfigFromExportSnapshot } from "@/services/export/snapshot";

let db: CareerAdaptDb | undefined;
afterEach(async () => { if (db) { await db.delete(); db.close(); db = undefined; } });

it("keeps rank percentage separate from ordinal rank at the AI boundary", () => {
  const output = (item: Record<string, unknown>, text: string) => normalizeResumeMapperBoundaryOutput({ resume: { schemaVersion: "careeradapt-resume-v2", basics: {}, sections: [{ sectionType: "education", items: [{ school: "示例大学", ...item }] }] }, sourceRefs: [{ path: "/sections/0/items/0", blockIds: ["e"], confidenceLevel: "high", needsConfirmation: true }] }, [{ id: "e", text }]);
  const fixed = output({ rankPosition: 15 }, "示例大学，专业排名前15%").resume.sections[0].items[0];
  expect(fixed).toMatchObject({ sectionType: "education", rankPercent: 15 });
  expect(fixed).not.toHaveProperty("rankPosition");
  const ordinal = output({ rankPosition: 15, rankTotal: 100 }, "示例大学，排名15/100").resume.sections[0].items[0];
  expect(ordinal).toMatchObject({ rankPosition: 15, rankTotal: 100 });
  expect(ordinal).not.toHaveProperty("rankPercent");
  expect(output({ rankPercent: 15 }, "示例大学，课程共15门").resume.sections[0].items[0]).not.toHaveProperty("rankPercent");
  expect(ResumeItemV2Schema.safeParse({ id: "e", sectionType: "education", rankPercent: 101 }).success).toBe(false);
});

it("accepts AI training fields and explicit skill evidence without inferring skills from certificates", () => {
  const raw = { resume: { schemaVersion: "careeradapt-resume-v2", basics: {}, sections: [
    { sectionType: "training", items: [{ institution: "示例培训机构", title: "数据库实操训练", startDate: "2026-07-01", endDate: "2026-09-01", description: "完成数据库备份恢复训练" }] },
    { sectionType: "skills", items: [{ name: "Excel", level: "熟练", description: "数据透视表" }] },
    { sectionType: "certificates", items: [{ name: "CET6" }] }
  ] }, sourceRefs: [0, 1, 2].map(i => ({ path: `/sections/${i}/items/0`, blockIds: [`b${i}`], confidenceLevel: "high", needsConfirmation: true })) };
  const out = normalizeResumeMapperBoundaryOutput(raw, [
    { id: "b0", text: "示例培训机构 数据库实操训练 2026-07-01—2026-09-01 完成数据库备份恢复训练" },
    { id: "b1", text: "熟练使用 Excel 数据透视表" }, { id: "b2", text: "CET6" }
  ]);
  expect(out.resume.sections[0].items[0]).toMatchObject({ sectionType: "training", institution: "示例培训机构", startDate: "2026-07-01", endDate: "2026-09-01" });
  expect(out.resume.sections[1].items[0]).toMatchObject({ sectionType: "skills", name: "Excel", level: "熟练" });
  expect(out.resume.sections[2].items[0]).toMatchObject({ sectionType: "certificates", name: "CET6" });
});

it("retains grounded day precision and rejects invented or invalid dates", () => {
  const map = (startDate: string, text: string) => normalizeResumeMapperBoundaryOutput({ resume: { schemaVersion: "careeradapt-resume-v2", basics: {}, sections: [{ sectionType: "training", items: [{ institution: "示例机构", startDate }] }] }, sourceRefs: [{ path: "/sections/0/items/0", blockIds: ["d"], confidenceLevel: "high", needsConfirmation: true }] }, [{ id: "d", text }]).resume.sections[0].items[0];
  expect(map("2026-07-01", "示例机构，2026年7月1日开始")).toHaveProperty("startDate", "2026-07-01");
  expect(map("2026-07-01", "示例机构，2026.7.1开始")).toHaveProperty("startDate", "2026-07-01");
  expect(map("2026-07-01", "示例机构，2026年培训")).not.toHaveProperty("startDate");
  expect(map("2026-02-30", "示例机构，2026-02-30")).not.toHaveProperty("startDate");
  expect(map("2026", "示例机构，2026年培训")).toHaveProperty("startDate", "2026");
});

it("preserves daily training dates and rank percentage from import through repository, all templates and snapshot", async () => {
  db = new CareerAdaptDb(`reference-campus-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const file = new File([JSON.stringify(referenceCampusResume())], "anonymous.json", { type: "application/json" });
  const prepared = await new ResumeImportOrchestrator(repository).prepare({ file, fileName: file.name, mimeType: file.type, size: file.size }, { semanticMode: "local" });
  const result = await repository.confirmImportedResume({ importId: prepared.importId, expectedDraftRevision: prepared.draftRevision, operationId: "confirm-reference", target: { mode: "new", profileName: "林同学", createGeneralResume: true } });
  const branch = (await repository.getResumeBranch(result.branchId!))!;
  const profile = (await repository.getProfile(branch.profileId))!;
  const training = branch.structuredContentItems!.find(i => i.data.sectionType === "training")!;
  expect(training.data).toMatchObject({ institution: "示例培训机构", startDate: "2026-07-01", endDate: "2026-09-01" });
  expect(profile.structuredFacts!.find(i => i.data.sectionType === "training")?.data).toEqual(training.data);
  expect(branch.structuredContentItems!.filter(i => i.data.sectionType === "skills")).toHaveLength(3);
  const config = ResumePresentationConfigSchema.parse({ schemaVersion: "resume-presentation-v1", templateId: "campus-reference", branchId: branch.id, contentRevision: { branchRevision: branch.revision, currentRevisionId: branch.currentRevisionId }, departmentPlacement: "inline", sectionStyleOverrides: { training: { titleOverride: "专业培训" } }, presentationRevision: 1, updatedAt: "2026-10-24T00:00:00.000Z" });
  const model = mapBranchToResumeRenderModel({ branch, profile, presentationConfig: config });
  if (model.schemaVersion !== "resume-render-v2") throw new Error("canonical model required");
  expect(model.compatibilityWarnings).toEqual([]);
  expect(model.structuredSections.find(s => s.sectionType === "training")?.title).toBe("专业培训");
  const education = model.structuredSections.find(s => s.sectionType === "education")!.items[0];
  expect(projectResumePresentationItem(education.data).customRows).toContainEqual({ label: "专业排名", value: "前 15%", displayMode: "inline" });
  for (const template of resumeTemplates) {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(template.render(model, { presentationConfig: config }));
    const coverage = presentationCoverage(model);
    const report = createRenderCoverageReport({ source: coverage, presentation: coverage, paginated: coverage, rendered: renderedCoverage(host) });
    expect(report.droppedEntries, template.id).toEqual([]);
    expect(host.textContent).toContain("示例培训机构"); expect(host.textContent).toContain("2026.07.01");
    expect(host.textContent).toContain("前 15%");
  }
  const presentation = presentationSnapshotFromConfig(config);
  const restored = presentationConfigFromExportSnapshot({ presentation, templateId: config.templateId, renderModel: { branchId: branch.id }, filename: "anonymous.pdf" } as never);
  expect(restored.departmentPlacement).toBe("inline");
  expect(restored.sectionStyleOverrides.training).toEqual({ titleOverride: "专业培训" });
});
