import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoCareerProfile } from "@/data/demoProfile";
import { ResumePresentationConfigSchema, type CustomFieldValue } from "@/domain/schemas";
import { FONT_PRESETS } from "@/domain/resumePresentation/fonts";
import { orderContactDetails, resumeContactDetails } from "@/domain/resumePresentation/contacts";
import { presentationSnapshotFromConfig, presentationConfigFromExportSnapshot } from "@/services/export/snapshot";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { exportCareerAdaptResumeJsonV2 } from "@/domain/resumeImport/jsonV2Adapter";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import { buildResumeImportConfirmation } from "@/domain/resumeImport/confirm";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { resumeTemplates } from "@/components/resume/templates/templateRegistry";
import { createP48bTemplateFixtures } from "../fixtures/resume-v2/p4.8bTemplateFixtures";

let db: CareerAdaptDb | undefined;
afterEach(async () => { if (db) { db.close(); await db.delete(); db = undefined; } });
const base = () => ResumePresentationConfigSchema.parse({ schemaVersion: "resume-presentation-v1", branchId: "branch", templateId: "classic-technical", contentRevision: { branchRevision: 1, currentRevisionId: "revision" }, presentationRevision: 1, updatedAt: "2026-10-25T12:00:00.000Z" });

describe("editor reference refinement", () => {
  it("preserves every font preset and contact layout through schema and export snapshot round trips", () => {
    for (const preset of FONT_PRESETS) {
      const config = ResumePresentationConfigSchema.parse({ ...base(), typography: { chineseFont: preset.chineseFont, englishFont: preset.englishFont }, contactOrder: ["email", "break:line", "custom:wechat", "phone"], precision: { titleStyle: "soft", entryStyle: "compact", entryAlignment: "right", headerHeightPx: 40, headerDivider: false } });
      expect(config.typography).toMatchObject({ chineseFont: preset.chineseFont, englishFont: preset.englishFont });
      const presentation = presentationSnapshotFromConfig(config);
      const restored = presentationConfigFromExportSnapshot({ branchId: "branch", templateId: config.templateId, branchRevision: 1, currentRevisionId: "revision", presentationRevision: 1, generatedAt: config.updatedAt, presentation } as Parameters<typeof presentationConfigFromExportSnapshot>[0]);
      expect(restored.contactOrder).toEqual(config.contactOrder); expect(restored.precision).toEqual(config.precision); expect(restored.typography).toEqual(config.typography);
    }
    expect(ResumePresentationConfigSchema.safeParse({ ...base(), contactOrder: ["phone", "phone"] }).success).toBe(false);
    expect(ResumePresentationConfigSchema.safeParse({ ...base(), contactOrder: [""] }).success).toBe(false);
  });

  it("orders contacts and explicit line breaks without dropping unlisted new fields or creating unknown data", () => {
    const details = [{ id: "phone", label: "手机号", value: "10000000000" }, { id: "custom:wechat", label: "微信", value: "demo" }, { id: "email", label: "邮箱", value: "demo@example.com" }];
    expect(orderContactDetails(details, ["email", "break:1", "unknown", "email"])).toEqual([details[2], { id: "break:1", label: "换行", value: "" }, details[0], details[1]]);
    expect(resumeContactDetails({ name: "匿名", email: "", phone: "", location: "", summary: "", links: [], customFields: [{ id: "b", label: "状态", valueType: "boolean", value: false, order: 0, sensitive: false }] }).at(-1)?.value).toBe("否");
  });

  it("keeps current-resume personal fields isolated and preserves their evidence through JSON re-import", async () => {
    db = new CareerAdaptDb(`refinement-${crypto.randomUUID()}`); const repo = new WorkspaceRepository(db);
    await repo.saveProfile(demoCareerProfile);
    const created = await repo.createGeneralResumeBranch({ profileId: demoCareerProfile.id, operationId: "refine-create", name: "字段测试", includeProfileBasics: true, includeProfileFacts: true });
    const fields: CustomFieldValue[] = [{ id: "wechat", label: "微信", value: "demo-wechat", valueType: "string", order: 0, sensitive: false }, { id: "custom", label: "自定义资料", value: "用户确认内容", valueType: "string", order: 1, sensitive: false }];
    const profileBefore = await repo.getProfile(demoCareerProfile.id);
    const saved = await repo.editResumeBranchBasics({ branchId: created.branch.id, expectedRevision: created.branch.revision, operationId: "refine-fields", basics: { customFields: fields } });
    expect((await repo.getResumeBranch(created.branch.id))?.resumeBasics?.customFields).toEqual(fields);
    expect(await repo.getProfile(demoCareerProfile.id)).toEqual(profileBefore);
    const model = mapBranchToResumeRenderModel({ branch: saved.branch, profile: profileBefore! });
    expect(model.candidate.contactDetails).toEqual(expect.arrayContaining([{ id: "custom:wechat", label: "微信", value: "demo-wechat" }]));
    const canonical = exportCareerAdaptResumeJsonV2({ branch: saved.branch, profile: profileBefore! });
    expect(canonical.basics.customFields).toEqual(fields);
    canonical.basics = { name: "匿名候选人", customFields: fields, portfolioLinks: [], otherLinks: [] };
    canonical.sections = [{ id: "summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ id: "summary-1", sectionType: "summary", text: "明确填写的匿名介绍。", customFields: [] }] }];
    const draft = createImportedResumeDraftFromStructuredJson({ canonicalResume: canonical, source: { fileName: "anonymous.json", mimeType: "application/json", fileHash: "refinement-json-source", pageCount: 1 } });
    expect(draft.basics.additionalFields?.[0].sourceBlockIds.length).toBeGreaterThan(0);
    draft.basics.additionalFields?.forEach(field => { field.userConfirmed = true; });
    const confirmed = buildResumeImportConfirmation({ draft, operationId: "refine-reimport" });
    expect(confirmed.branch.resumeBasics?.customFields).toEqual(fields);
  });

  it("renders labels instead of icons and preserves locations in compact entries without dates across all templates", () => {
    const model = structuredClone(createP48bTemplateFixtures()[0].model);
    model.candidate.contactDetails = [{ id: "phone", label: "手机号", value: "10000000000" }, { id: "custom:w", label: "微信", value: "demo-wechat" }];
    for (const section of model.structuredSections) for (const item of section.items) { item.presentation.dateRange = undefined; item.presentation.location = "匿名城市"; }
    for (const template of resumeTemplates) {
      const config = { ...base(), templateId: template.id, precision: { contactIcons: true, titleStyle: "rail" as const, entryStyle: "compact" as const }, contactOrder: ["custom:w", "break:1", "phone"] };
      const markup = renderToStaticMarkup(template.render(model, { presentationConfig: config }));
      expect(markup).toContain("手机号："); expect(markup).toContain("微信："); expect(markup).not.toContain("☎"); expect(markup).toContain("resume-contact-break"); expect(markup).toContain("匿名城市");
      expect(markup.indexOf("demo-wechat")).toBeLessThan(markup.indexOf("10000000000"));
    }
  });
});
