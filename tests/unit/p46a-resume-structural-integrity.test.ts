import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import {
  BranchContentItemSchema,
  JobDescriptionSchema,
  ResumeBranchSchema,
  ResumeContentItemV2Schema,
  ResumeItemV2Schema,
  type ResumeItemV2,
  type ResumeTailoringDiff
} from "@/domain/schemas";
import { createResumeRevision } from "@/domain/branch/revision";
import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import {
  inspectResumeItemStructuralIntegrity,
  rehydrateLegacyStructuredResumeItem
} from "@/domain/resumeIntegrity";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { resolveResumeTargetRole } from "@/domain/branch/targetRole";
import { presentationSnapshotFromConfig, createResumePdfExportRequest } from "@/services/export/snapshot";
import { renderResumePdfHtml } from "@/services/export/pdfHtml";
import { createResumePaginationPlan } from "@/services/export/pagination";
import { CareerAdaptDb } from "@/services/storage/db";
import { syncStructuredContentItems, WorkspaceRepository } from "@/services/storage/repositories";
import { stableHashText } from "@/services/security/text";

const NOW = "2026-08-24T08:00:00.000Z";
let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  await db?.delete();
  db = undefined;
});

describe("P4.6a resume structural integrity", () => {
  it("rehydrates labeled legacy fields and keeps the diagnostic shape PII-safe", () => {
    const text = [
      "项目名称：项目一",
      "角色：核心开发",
      "开始日期：2024-09",
      "结束日期：2025-06",
      "技术工具：Python、FastAPI",
      "项目背景：用于验证结构化数据处理。",
      "说明：负责服务搭建。",
      "亮点：完成接口实现；保留验证记录。",
      "成果：形成可复用流程。"
    ].join("\n");
    const item = ResumeItemV2Schema.parse({ id: "project-legacy", sectionType: "project", description: text, tools: [], highlights: [], outcomes: [], customFields: [] });
    const initial = inspectResumeItemStructuralIntegrity(item, { origin: "structured", legacyTextProjection: text });
    expect(initial.status).toBe("degraded_structured_item");
    expect(initial.shape).toMatchObject({ sectionType: "project", hasTitle: false, toolCount: 0, highlightCount: 0, outcomeCount: 0 });
    expect(JSON.stringify(initial)).not.toMatch(/项目一|核心开发|负责服务/);

    const repaired = rehydrateLegacyStructuredResumeItem(item, text, { origin: "structured" });
    expect(repaired.report.status).toBe("healthy");
    expect(repaired.item).toMatchObject({
      sectionType: "project",
      title: "项目一",
      role: "核心开发",
      startDate: "2024-09-01",
      endDate: "2025-06-01",
      tools: ["Python", "FastAPI"],
      highlights: ["完成接口实现", "保留验证记录。"],
      outcomes: ["形成可复用流程。"]
    });
    if (repaired.item.sectionType !== "project") throw new Error("project_rehydration_expected");
    expect(repaired.item.description).toBe("负责服务搭建。");
    expect(rehydrateLegacyStructuredResumeItem(repaired.item, undefined).changed).toBe(false);
  });

  it("normalizes evidence-bearing skill names without inventing a capability", () => {
    const narrative = ResumeItemV2Schema.parse({
      id: "skill-fastapi",
      sectionType: "skills",
      name: "FastAPI：基于 FastAPI 构建服务并完成验证。",
      customFields: []
    });
    if (narrative.sectionType !== "skills") throw new Error("skill_fixture_expected");
    const repaired = rehydrateLegacyStructuredResumeItem(narrative, narrative.name, { origin: "structured" });
    expect(repaired.item).toMatchObject({ sectionType: "skills", name: "FastAPI" });
    expect(repaired.item.sectionType === "skills" ? repaired.item.description : undefined).toContain("基于 FastAPI");
    expect(() => rehydrateLegacyStructuredResumeItem(
      ResumeItemV2Schema.parse({ id: "skill-ambiguous", sectionType: "skills", name: "熟悉多种工具并完成项目交付。", customFields: [] }),
      "熟悉多种工具并完成项目交付。",
      { origin: "structured" }
    )).toThrow("resume_structural_integrity_unrecoverable");
  });

  it("rehydrates compact education projections without guessing identity", () => {
    const text = "郑州大学 | 本科 | 计算机科学与技术\n2024-09 - 2028-06";
    const item = ResumeItemV2Schema.parse({ id: "education-compact", sectionType: "education", description: text, customFields: [] });
    const repaired = rehydrateLegacyStructuredResumeItem(item, text, { origin: "structured" });
    expect(repaired.item).toMatchObject({
      sectionType: "education",
      school: "郑州大学",
      degree: "本科",
      major: "计算机科学与技术",
      startDate: "2024-09-01",
      endDate: "2028-06-01"
    });
  });

  it("preserves the source branch, derives a structurally complete Job branch, and renders PDF semantics", async () => {
    const profile = demoCareerProfile;
    const fixture = buildGoldenBranch(profile);
    db = new CareerAdaptDb(`P46aGolden-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const job = buildGoldenJob();
    await repository.saveProfile(profile);
    await repository.saveJobDescription(job);
    await repository.saveResumeBranch(fixture.branch);
    await db.resumeRevisions.put(fixture.revision);
    const defaultPresentation = await repository.getResumePresentationConfig(fixture.branch.id);
    await repository.saveResumePresentationConfig({
      branchId: fixture.branch.id,
      expectedBranchRevision: fixture.branch.revision,
      expectedRevisionId: fixture.branch.currentRevisionId!,
      expectedPresentationRevision: defaultPresentation.presentationRevision,
      operationId: "p46a-golden-presentation",
      nextConfig: {
        ...defaultPresentation,
        templateId: "modern-operations",
        theme: { ...defaultPresentation.theme, accentColor: "blue" },
        spacing: { ...defaultPresentation.spacing, itemGap: "tight" },
        presentationRevision: defaultPresentation.presentationRevision + 1
      }
    });

    const sourceBefore = await repository.getResumeBranch(fixture.branch.id);
    if (!sourceBefore) throw new Error("golden_source_missing");
    const degradedProject = sourceBefore.structuredContentItems?.find((item) => item.id === "golden-project-1");
    if (!degradedProject) throw new Error("golden_project_missing");
    expect(inspectResumeItemStructuralIntegrity(degradedProject.data, { origin: "structured", legacyTextProjection: degradedProject.legacyTextProjection }).status).toBe("degraded_structured_item");
    const recovered = syncStructuredContentItems(sourceBefore, sourceBefore.contentItems);
    expect(recovered.find((item) => item.id === "golden-project-1")?.data).toMatchObject({ title: "项目一", role: "核心开发" });
    expect(recovered.find((item) => item.id === "golden-skill-1")?.data).toMatchObject({ sectionType: "skills", name: "FastAPI" });

    const diff: ResumeTailoringDiff = {
      target: { sectionId: "project", itemId: "golden-project-1", fieldPath: "highlights" },
      operation: "replace",
      original: ["项目一亮点"],
      value: ["项目一亮点", "岗位验证结果"],
      reason: "保留原有项目身份，仅补充岗位相关结果。",
      requirementIds: ["golden-requirement"],
      targetKeywords: ["FastAPI"],
      evidenceRefs: [],
      supportLevel: "user_declared"
    };
    const derived = await repository.deriveAndApplyTailoringDiffsAtomic({
      sourceBranchId: fixture.branch.id,
      jobId: job.id,
      expectedSourceRevision: fixture.branch.revision,
      expectedSourceRevisionId: fixture.branch.currentRevisionId!,
      diffs: [diff],
      operationId: "p46a-golden-tailoring",
      name: "岗位定制简历"
    });
    expect(derived.revision).toBeDefined();

    const sourceAfter = await repository.getResumeBranch(fixture.branch.id);
    expect(sourceAfter?.structuredContentItems).toEqual(sourceBefore.structuredContentItems);
    const jobBranch = await repository.getResumeBranch(derived.branch.id);
    if (!jobBranch || !derived.revision) throw new Error("golden_job_missing");
    expect((await repository.getResumeRevision(derived.revision.id))?.snapshot.structuredContentItems).toEqual(jobBranch.structuredContentItems);

    const project = jobBranch.structuredContentItems?.find((item) => item.id === "golden-project-1");
    const education = jobBranch.structuredContentItems?.find((item) => item.id === "golden-education");
    const work = jobBranch.structuredContentItems?.find((item) => item.id === "golden-work");
    expect(project?.data).toMatchObject({
      sectionType: "project",
      title: "项目一",
      role: "核心开发",
      organization: "示例团队",
      startDate: "2024-09-01",
      endDate: "2025-06-01",
      url: "https://example.com/projects/1",
      tools: ["Python", "FastAPI"],
      highlights: ["项目一亮点", "岗位验证结果"]
    });
    expect(education?.data).toMatchObject({ school: "郑州大学", degree: "本科", major: "计算机科学与技术", startDate: "2024-09-01", endDate: "2028-06-01" });
    expect(work?.data).toMatchObject({ organization: "示例实验室", role: "数据实习生", department: "数据组" });
    expect(jobBranch.structuredContentItems?.filter((item) => item.data.sectionType === "skills").map((item) => item.data.sectionType === "skills" ? item.data.name : "")).toEqual([
      "FastAPI", "Python", "React", "PostgreSQL", "Redis", "Docker", "Git", "Playwright"
    ]);
    expect(jobBranch.contentItems.filter((item) => /(?:项目名称|组织|职位\/角色|学位\/学历|开始日期|结束日期|技术工具|项目链接|亮点)：/u.test(item.text))).toEqual([]);

    const sourcePresentation = await repository.getResumePresentationConfig(fixture.branch.id);
    const jobPresentation = await repository.getResumePresentationConfig(jobBranch.id);
    expect(presentationSnapshotFromConfig(jobPresentation)).toEqual(presentationSnapshotFromConfig(sourcePresentation));

    const model = mapBranchToResumeRenderModel({ branch: jobBranch, profile, job, presentationConfig: jobPresentation });
    expect(model.jobTitle).toBe("数据平台工程师");
    if (model.schemaVersion !== "resume-render-v2") throw new Error("render_v2_expected");
    const renderedProject = model.structuredSections.flatMap((section) => section.items).find((item) => item.itemId === "golden-project-1");
    expect(renderedProject?.presentation).toMatchObject({
      primaryTitle: "项目一",
      secondaryTitle: "核心开发",
      dateRange: "2024.09–2025.06",
      inlineMeta: ["示例团队", "Python", "FastAPI"]
    });
    expect(renderedProject?.presentation.highlights).toContain("岗位验证结果");

    const paginationPlan = createGoldenPaginationPlan(model, jobPresentation);
    const exportRequest = createResumePdfExportRequest({
      exportId: "p46a-golden-export",
      renderModel: model,
      persistedRevision: derived.revision,
      presentationConfig: jobPresentation,
      generatedAt: NOW,
      filename: "golden.pdf",
      overflowStatus: paginationPlan.status,
      paginationPlan
    });
    const html = await renderResumePdfHtml(exportRequest.snapshot);
    const visibleText = html.replace(/<style[\s\S]*?<\/style>/giu, "").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
    expect(visibleText).toContain("项目一");
    expect(visibleText).toContain("岗位验证结果");
    expect(visibleText).not.toMatch(/(?:项目名称|组织|职位\/角色|学位\/学历|开始日期|结束日期|技术工具|亮点)：/u);
    expect((visibleText.match(/项目一\s+核心开发/g) ?? []).length).toBe(1);
    expect(paginationPlan.actualPageCount).toBe(1);
  });

  it("uses the saved Job title before JD extraction and never exposes a command wrapper", () => {
    const base = buildGoldenBranch(demoCareerProfile).branch;
    const job = buildGoldenJob();
    expect(resolveResumeTargetRole({ branch: base, profile: demoCareerProfile })).toBeUndefined();
    const jobBranch = ResumeBranchSchema.parse({
      ...base,
      branchPurpose: "job_specific",
      jobId: job.id,
      sourceJobVersion: job.updatedAt,
      resumeBasics: { ...base.resumeBasics, targetRole: "我想应聘这个岗位" }
    });
    expect(resolveResumeTargetRole({ branch: jobBranch, profile: demoCareerProfile, job })).toBe("数据平台工程师");
    const wrapperJob = JobDescriptionSchema.parse({ ...job, title: "我想应聘这个岗位", rawText: "岗位名称：数据工程师\n要求：完成服务开发。" });
    expect(resolveResumeTargetRole({ branch: jobBranch, profile: demoCareerProfile, job: wrapperJob })).toBe("数据工程师");
  });
});

function buildGoldenBranch(profile: typeof demoCareerProfile) {
  const built = buildGeneralBranchFromProfile({
    profile,
    operationId: "p46a-golden-create",
    name: "通用简历",
    includeProfileFacts: false,
    includeProfileBasics: true,
    now: NOW
  });
  const definitions: Array<{ id: string; sectionType: ResumeItemV2["sectionType"]; itemType: "experience" | "skill"; sourceSectionId: string; text: string; data: Record<string, unknown> }> = [
    {
      id: "golden-education", sectionType: "education", itemType: "experience", sourceSectionId: "education",
      text: "学校：郑州大学\n学位/学历：本科\n专业：计算机科学与技术\n所在地：郑州\n开始日期：2024-09\n结束日期：2028-06\n说明：完成课程学习与项目实践。",
      data: { description: "学校：郑州大学\n学位/学历：本科\n专业：计算机科学与技术\n所在地：郑州\n开始日期：2024-09\n结束日期：2028-06\n说明：完成课程学习与项目实践。", courses: [], honors: [], highlights: [], current: false }
    },
    {
      id: "golden-work", sectionType: "work", itemType: "experience", sourceSectionId: "work",
      text: "组织：示例实验室\n职位/角色：数据实习生\n部门：数据组\n地点：郑州\n开始日期：2025-07\n结束日期：2025-09\n说明：参与数据处理流程。\n亮点：完成数据清洗。",
      data: { description: "组织：示例实验室\n职位/角色：数据实习生\n部门：数据组\n地点：郑州\n开始日期：2025-07\n结束日期：2025-09\n说明：参与数据处理流程。\n亮点：完成数据清洗。", highlights: [], current: false }
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `golden-project-${index + 1}`,
      sectionType: "project" as const,
      itemType: "experience" as const,
      sourceSectionId: "project",
      text: `项目名称：项目${["一", "二", "三", "四"][index]}\n角色：核心开发\n组织：示例团队\n开始日期：2024-09\n结束日期：2025-06\n项目链接：https://example.com/projects/${index + 1}\n技术工具：Python、FastAPI\n项目背景：用于验证结构化数据处理。\n说明：负责服务搭建。\n亮点：项目${["一", "二", "三", "四"][index]}亮点\n成果：形成可复用流程。`,
      data: { description: `项目名称：项目${["一", "二", "三", "四"][index]}\n角色：核心开发\n组织：示例团队\n开始日期：2024-09\n结束日期：2025-06\n技术工具：Python、FastAPI\n项目背景：用于验证结构化数据处理。\n说明：负责服务搭建。\n亮点：项目${["一", "二", "三", "四"][index]}亮点\n成果：形成可复用流程。`, tools: [], highlights: [], outcomes: [], current: false }
    })),
    ...["FastAPI", "Python", "React", "PostgreSQL", "Redis", "Docker", "Git", "Playwright"].map((term, index) => ({
      id: `golden-skill-${index + 1}`,
      sectionType: "skills" as const,
      itemType: "skill" as const,
      sourceSectionId: "skills",
      text: `${term}：基于 ${term} 完成真实任务验证。`,
      data: { name: `${term}：基于 ${term} 完成真实任务验证。` }
    }))
  ];
  const pairs = definitions.map((definition, order) => {
    const data = ResumeItemV2Schema.parse({ id: definition.id, sectionType: definition.sectionType, customFields: [], ...definition.data });
    const confirmation = { scope: "resume_only" as const, confirmedTextHash: stableHashText(definition.text), confirmedAt: NOW };
    const legacy = BranchContentItemSchema.parse({
      id: definition.id, itemType: definition.itemType, source: "user_manual", sourceSectionId: definition.sourceSectionId,
      text: definition.text, originalText: definition.text, order, visible: true, requirementIds: [], sourceSuggestionIds: [], factRefs: [],
      guardMode: "not_fact", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [], userConfirmation: confirmation
    });
    const structured = ResumeContentItemV2Schema.parse({
      id: definition.id, schemaVersion: "resume-content-item-v2", data, factRefs: [], source: "user_manual", order, visible: true,
      guardMode: "not_fact", guardStatus: "pass", guardFindings: [], userConfirmation: confirmation, legacyTextProjection: definition.text,
      sourceBlockIds: [], sourceRanges: [], mappingTrace: []
    });
    return { legacy, structured };
  });
  const branchBase = ResumeBranchSchema.parse({
    ...built.branch,
    id: "p46a-golden-general",
    contentItems: pairs.map((pair) => pair.legacy),
    structuredContentItems: pairs.map((pair) => pair.structured),
    revision: 0,
    currentRevisionId: undefined,
    updatedAt: NOW
  });
  const revision = createResumeRevision({ branch: branchBase, source: "created_from_profile", operationId: "p46a-golden-root", now: NOW });
  const branch = ResumeBranchSchema.parse({ ...branchBase, currentRevisionId: revision.id });
  return { branch, revision };
}

function buildGoldenJob() {
  return JobDescriptionSchema.parse({
    id: "p46a-golden-job",
    title: "数据平台工程师",
    company: "示例公司",
    rawText: "岗位名称：数据平台工程师\n要求：使用 FastAPI 完成服务开发与验证。",
    source: "manual",
    requirements: [{
      id: "golden-requirement",
      category: "required_skill",
      description: "使用 FastAPI 完成服务开发与验证。",
      priority: "high",
      hardConstraint: false,
      sourceSpan: { start: 25, end: 48, text: "使用 FastAPI 完成服务开发与验证。" },
      keywords: ["FastAPI"],
      confidence: 1,
      createdAt: NOW,
      updatedAt: NOW
    }],
    createdAt: NOW,
    updatedAt: NOW
  });
}

function createGoldenPaginationPlan(model: ReturnType<typeof mapBranchToResumeRenderModel>, presentationConfig: Awaited<ReturnType<WorkspaceRepository["getResumePresentationConfig"]>>) {
  let cursor = 40;
  const sections = model.sections.map((section) => {
    const top = cursor;
    const blockIds = section.blocks.map((block) => block.sourceItemId);
    cursor += section.blocks.length * 28 + 20;
    return { sectionType: section.type, top, bottom: cursor, height: cursor - top, blockIds };
  });
  const blocks = model.sections.flatMap((section) => section.blocks.map((block, index) => ({
    sourceItemId: block.sourceItemId,
    sectionType: section.type,
    top: index * 28,
    bottom: index * 28 + 24,
    height: 24
  })));
  return createResumePaginationPlan({
    measurement: { scrollHeight: Math.max(cursor, 600), clientHeight: 1123, sections, blocks },
    paginationConfig: presentationConfig.pagination
  });
}
