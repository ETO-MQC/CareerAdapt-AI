import { describe, expect, it, vi } from "vitest";
import { invokeStructuredAi } from "@/ai/client";
import { CareerProfileSchema, JobDescriptionSchema, type FactCategory, type ResumeItemV2 } from "@/domain/schemas";
import {
  CareerResumeWritingService,
  createResumeCompositionCheckpoint,
  compileResumeComposition,
  buildResumeEvidenceGraph,
  planResumeBlueprint,
  resolveCareerAssetDisplayIdentity,
  findTechnicalTerms
} from "@/domain/resumeComposition";
import { projectResumePresentationItem } from "@/domain/resumePresentation/projector";
import { canonicalToStructuredProjectFields, patchCanonicalProjectFields } from "@/domain/resumeFields/catalog";
import { ResumeCareerWritingTaskInputSchema, aiTaskRegistry } from "@/ai/tasks/registry";

vi.mock("@/ai/client", () => ({ invokeStructuredAi: vi.fn() }));

const TIME = "2026-08-01T00:00:00.000Z";

function fact(id: string, sourceId: string, statement: string, category: FactCategory = "experience") {
  return {
    id,
    statement,
    category,
    provenance: [{
      sourceType: "user_input" as const,
      sourceId,
      sourceText: statement,
      sourceQuote: statement,
      sourceTurnId: `turn-${id}`,
      confidence: 1,
      confirmedByUser: true,
      riskLevel: "low" as const,
      createdAt: TIME
    }],
    confirmedByUser: true,
    riskLevel: "low" as const,
    createdAt: TIME,
    updatedAt: TIME
  };
}

function profileFixture() {
  const educationFact = fact("fact-education", "exp-education", "郑州大学计算机科学与技术专业本科生，预计 2028 年 6 月毕业。", "education");
  const wearableFact = fact("fact-wearable", "exp-wearable", "协助完成 ESP32 可穿戴设备项目的传感器采集与联调。使用 PlatformIO、Arduino 和 C++。", "experience");
  const foxFact = fact("fact-fox", "exp-fox", "参与 Smart Fox 项目，使用 TypeScript、React 和 Rust 完成前后端功能开发。", "experience");
  const learnFact = fact("fact-learn", "exp-learn", "参与 Learn AI 项目，使用 TypeScript 与 React 完成交互页面和模型调用流程。", "experience");
  const socialFact = fact("fact-social", "exp-social", "使用 RPA、FastAPI、SQLite 和 SQLx 完成社会数据处理与自动化流程，未涉及 PostgreSQL。", "experience");
  const careerFact = fact("fact-career", "exp-career", "参与 CareerAdapt AI 项目，使用 TypeScript、Next.js 和 AI 工具完成简历工作流。", "experience");
  const researchFact = fact("fact-research", "exp-research", "在研究实验室参与数据处理和样本清洗，协助完成分析准备。", "experience");
  const campusFact = fact("fact-campus", "exp-campus", "担任班级团支书，组织校园活动并协助完成通知协调。", "experience");
  const awardFact = fact("fact-award", "exp-award", "获得蓝桥杯省赛奖项。", "achievement");
  const experiences = [
    { id: "exp-education", type: "education", organization: "郑州大学", role: "本科", major: "计算机科学与技术", startDate: "2024-09", facts: [educationFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: TIME, updatedAt: TIME },
    { id: "exp-wearable", type: "project", organization: "可穿戴设备", role: "协助开发", facts: [wearableFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: TIME, updatedAt: TIME },
    { id: "exp-fox", type: "project", organization: "Smart Fox", role: "项目成员", facts: [foxFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: TIME, updatedAt: TIME },
    { id: "exp-learn", type: "project", organization: "Learn AI", role: "项目成员", facts: [learnFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: TIME, updatedAt: TIME },
    { id: "exp-social", type: "project", organization: "社会数据处理", role: "项目成员", facts: [socialFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: TIME, updatedAt: TIME },
    { id: "exp-career", type: "project", organization: "CareerAdapt AI", role: "项目成员", facts: [careerFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: TIME, updatedAt: TIME },
    { id: "exp-research", type: "other", organization: "研究实验室", role: "研究助理", facts: [researchFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: TIME, updatedAt: TIME },
    { id: "exp-campus", type: "campus", organization: "班级", role: "团支书", facts: [campusFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: TIME, updatedAt: TIME },
    { id: "exp-award", type: "competition", organization: "蓝桥杯", role: "省赛奖项", facts: [awardFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: TIME, updatedAt: TIME }
  ];
  return CareerProfileSchema.parse({
    id: "profile-p45b",
    schemaVersion: "career-profile-v2",
    createdAt: TIME,
    updatedAt: TIME,
    name: "P4.5b 候选人",
    basics: { name: "P4.5b 候选人", email: "candidate@example.com", links: [] },
    preference: { targetRoles: ["前端开发"], targetCities: [], industries: [] },
    version: 7,
    experiences,
    skills: [],
    certificates: [],
    evidences: [],
    unclassifiedBlocks: [],
    structuredFacts: [
      { data: { id: "exp-education", sectionType: "education", school: "郑州大学", major: "计算机科学与技术", degree: "本科", startDate: "2024-09", current: true, expectedEndDate: "2028-06", courses: [], honors: [], highlights: [], customFields: [] }, factIds: [educationFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { data: { id: "exp-wearable", sectionType: "project", title: "可穿戴设备", role: "协助开发", tools: ["ESP32", "PlatformIO", "Arduino", "C++"], highlights: ["协助完成传感器采集与联调。"], outcomes: [], current: false, customFields: [] }, factIds: [wearableFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { data: { id: "exp-fox", sectionType: "project", title: "Smart Fox", role: "项目成员", tools: ["TypeScript", "React", "Rust"], highlights: ["参与前后端功能开发。"], outcomes: [], current: false, customFields: [] }, factIds: [foxFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { data: { id: "exp-learn", sectionType: "project", title: "Learn AI", role: "项目成员", tools: ["TypeScript", "React"], highlights: ["参与交互页面和模型调用流程开发。"], outcomes: [], current: false, customFields: [] }, factIds: [learnFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { data: { id: "exp-social", sectionType: "project", title: "社会数据处理", role: "项目成员", tools: ["RPA", "FastAPI", "SQLite", "SQLx"], highlights: ["完成社会数据处理与自动化流程。"], outcomes: [], current: false, customFields: [] }, factIds: [socialFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { data: { id: "exp-career", sectionType: "project", title: "CareerAdapt AI", role: "项目成员", tools: ["TypeScript", "Next.js"], highlights: ["参与简历工作流开发。"], outcomes: [], current: false, customFields: [] }, factIds: [careerFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { data: { id: "exp-research", sectionType: "research", title: "研究实验室数据处理", institution: "研究实验室", methods: ["数据处理"], description: "参与数据处理和样本清洗。", highlights: ["协助完成分析准备。"], current: false, customFields: [] }, factIds: [researchFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { data: { id: "exp-campus", sectionType: "campus", organization: "班级", role: "团支书", highlights: ["组织校园活动并协助完成通知协调。"], current: false, customFields: [] }, factIds: [campusFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { data: { id: "exp-award", sectionType: "awards", name: "蓝桥杯省赛奖项", issuer: "蓝桥杯", awardedAt: "2026-05", description: "获得蓝桥杯省赛奖项。", customFields: [] }, factIds: [awardFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }
    ]
  });
}

function jobFixture() {
  return JobDescriptionSchema.parse({
    id: "job-p45b",
    createdAt: TIME,
    updatedAt: TIME,
    title: "前端工程实习生",
    company: "示例公司",
    rawText: "岗位要求：熟悉 PostgreSQL 与 REST API，参与前端和后端协作。",
    source: "manual",
    requirements: [
      { id: "req-postgres", createdAt: TIME, updatedAt: TIME, category: "required_skill", description: "熟悉 PostgreSQL 数据库", priority: "high", hardConstraint: false, sourceSpan: { start: 0, end: 18, text: "PostgreSQL" }, keywords: ["PostgreSQL"], confidence: 1 },
      { id: "req-rest", createdAt: TIME, updatedAt: TIME, category: "required_skill", description: "了解 REST API 设计", priority: "high", hardConstraint: false, sourceSpan: { start: 19, end: 30, text: "REST API" }, keywords: ["REST API"], confidence: 1 }
    ]
  });
}

describe("P4.5b resume compilation intelligence", () => {
  it("builds a grounded evidence graph and general resume without mutating Profile", () => {
    const profile = profileFixture();
    const before = JSON.stringify(profile);
    const graph = buildResumeEvidenceGraph({ profile });
    const result = compileResumeComposition({ profile, mode: "general" });
    const projectItems = result.items.filter((item): item is typeof item & { data: Extract<ResumeItemV2, { sectionType: "project" }> } => item.data.sectionType === "project");
    const education = result.items.find((item) => item.data.sectionType === "education")?.data;

    expect(JSON.stringify(profile)).toBe(before);
    expect(graph.skillMatrix.length).toBeGreaterThan(0);
    expect(graph.skillMatrix.find((skill) => skill.name === "TypeScript")?.sourceAssetIds.length).toBeGreaterThanOrEqual(2);
    expect(graph.skillMatrix.some((skill) => skill.name === "PostgreSQL")).toBe(false);
    expect(graph.recoveryCandidates).toContainEqual(expect.objectContaining({ field: "authorRole", status: "needs_confirmation", proposedValue: "研究助理" }));
    expect(graph.excludedAssetIds).not.toContain("empty-resume-placeholder");
    expect(result.items.some((item) => item.data.sectionType === "summary")).toBe(true);
    expect(result.items.some((item) => item.data.sectionType === "skills")).toBe(true);
    expect(projectItems.length).toBeGreaterThanOrEqual(4);
    expect(projectItems.every((item) => item.data.sectionType === "project" && !item.data.description && item.data.highlights.length >= 1 && item.data.highlights.length <= 4)).toBe(true);
    expect(projectItems.find((item) => item.data.sectionType === "project" && item.data.title === "可穿戴设备")?.data.highlights.join(" ")).toContain("协助");
    expect(education && education.sectionType === "education" ? projectResumePresentationItem(education).dateRange : undefined).toBe("2024.09–2028.06（预计）");
    expect(result.metrics.unsupportedClaims).toBe(0);
    expect(result.metrics.duplicateBullets).toBe(0);
    expect(result.metrics.fillerBullets).toBe(0);
    expect(result.metrics.paragraphHeavyItems).toBe(0);
    expect(result.metrics.atsRepairPassCount).toBeGreaterThanOrEqual(1);
    expect(result.informationNeeds.length).toBeLessThanOrEqual(2);
  });

  it("classifies job keywords conservatively and keeps the job branch proposal-only until composition", () => {
    const profile = profileFixture();
    const job = jobFixture();
    const graph = buildResumeEvidenceGraph({ profile });
    const blueprint = planResumeBlueprint({ profile, graph, mode: "job_specific", job });
    const postgres = blueprint.keywordCoverage.find((item) => item.keyword === "PostgreSQL");
    const rest = blueprint.keywordCoverage.find((item) => item.keyword === "REST API");
    const result = compileResumeComposition({ profile, mode: "job_specific", job });

    expect(postgres?.status).toBe("POTENTIALLY_SUPPORTED");
    expect(rest?.status).toBe("POTENTIALLY_SUPPORTED");
    expect(blueprint.informationNeeds.length).toBeLessThanOrEqual(2);
    expect(result.mode).toBe("job_specific");
    expect(result.jobId).toBe(job.id);
    expect(result.metrics.unsupportedClaims).toBe(0);
    expect(result.items.every((item) => item.data.sectionType !== "skills" || item.factIds.length > 0)).toBe(true);
  });

  it("round-trips all canonical project fields through the structured editor model", () => {
    const original = {
      id: "project-editable",
      sectionType: "project" as const,
      title: "可编辑项目",
      role: "协助开发",
      organization: "CareerAdapt AI",
      location: "郑州",
      startDate: "2025-01",
      endDate: "2025-06",
      current: false,
      url: "https://example.com/project",
      tools: ["TypeScript", "SQLite"],
      background: "为求职者整理可核验经历。",
      description: "实现项目证据图与结构化编辑。",
      highlights: ["保留来源事实。"],
      outcomes: ["支持继续编辑。"],
      customFields: []
    } satisfies ResumeItemV2;
    const fields = canonicalToStructuredProjectFields(original);
    const edited = patchCanonicalProjectFields(original, {
      ...fields,
      role: "项目成员",
      tools: [...fields.tools, "React"],
      outcomes: [...fields.outcomes, "隔离资料库写入边界。"]
    });

    expect(edited).toMatchObject({
      sectionType: "project",
      role: "项目成员",
      tools: ["TypeScript", "SQLite", "React"],
      background: original.background,
      description: original.description,
      highlights: original.highlights,
      outcomes: ["支持继续编辑。", "隔离资料库写入边界。"],
      url: original.url
    });
  });

  it("recovers explicit project technologies into the proposal without mutating Profile", () => {
    const profile = profileFixture();
    const recoveredProfile = CareerProfileSchema.parse({
      ...profile,
      structuredFacts: profile.structuredFacts?.map((entry) => entry.data.id === "exp-career"
        ? { ...entry, data: { ...entry.data, tools: [] } }
        : entry)
    });
    const result = compileResumeComposition({ profile: recoveredProfile, mode: "general" });
    const career = result.items.find((item) => item.data.sectionType === "project" && item.data.id === "exp-career");
    const recoveredEntry = recoveredProfile.structuredFacts?.find((entry) => entry.data.id === "exp-career");

    expect(career?.data.sectionType === "project" ? career.data.tools : []).toEqual(expect.arrayContaining(["TypeScript", "Next.js"]));
    expect(recoveredEntry?.data.sectionType === "project" ? recoveredEntry.data.tools : []).toEqual([]);
  });

  it("lets the model improve phrasing while deterministic boundaries keep identity, tools, and skills grounded", async () => {
    const profile = profileFixture();
    const graph = buildResumeEvidenceGraph({ profile });
    const blueprint = planResumeBlueprint({ profile, graph, mode: "general" });
    const selectedProject = blueprint.assets.find((asset) => asset.sourceAssetId === "exp-career")
      ?? blueprint.assets.find((asset) => asset.sectionType === "project");
    expect(selectedProject).toBeDefined();
    vi.mocked(invokeStructuredAi).mockResolvedValueOnce({
      ok: true,
      data: {
        summary: "根据已确认资料，为候选人生成一段看起来完整但不应直接展示的说明。",
        assets: [
          {
            sourceAssetId: selectedProject!.sourceAssetId,
            title: "内部 asset-exp-fox 标识",
            role: "项目成员",
            techStack: ["TypeScript", "API", "未确认工具"],
            highlights: [
              "参与简历工作流开发。",
              "根据已确认资料整理项目。",
              "负责并不存在的量化结果。"
            ]
          },
          {
            sourceAssetId: "not-selected",
            title: "不应进入简历的项目",
            techStack: [],
            highlights: ["这条资产不在蓝图中。"]
          }
        ],
        skillGroups: [
          { category: "后端", skills: ["API", "TypeScript", "未确认技能"] },
          { category: "编程语言", skills: ["TypeScript"] }
        ]
      }
    } as never);

    const output = await new CareerResumeWritingService().write({
      profile,
      graph,
      blueprint,
      mode: "general"
    });
    const groundedAsset = output?.assets.find((asset) => asset.sourceAssetId === selectedProject!.sourceAssetId);
    const selectedEntry = profile.structuredFacts?.find((entry) => entry.data.id === selectedProject!.sourceAssetId);
    const expectedTitle = selectedEntry ? resolveCareerAssetDisplayIdentity(selectedEntry.data).label : "";

    expect(invokeStructuredAi).toHaveBeenCalledWith(expect.objectContaining({ task: "resume-career-writer" }));
    expect(groundedAsset).toMatchObject({ title: expectedTitle, role: "项目成员" });
    expect(groundedAsset?.techStack).toEqual(expect.arrayContaining(["TypeScript"]));
    expect(groundedAsset?.techStack).not.toContain("API");
    expect(groundedAsset?.highlights).toEqual(["参与简历工作流开发。"]);
    expect(output?.assets.some((asset) => asset.sourceAssetId === "not-selected")).toBe(false);
    expect(output?.summary).toBeUndefined();
    expect(output?.skillGroups.flatMap((group) => group.skills)).toContain("TypeScript");
    expect(output?.skillGroups.flatMap((group) => group.skills)).not.toContain("API");
  });

  it("uses section labels instead of internal IDs and filters generic technical noise", () => {
    const profile = profileFixture();
    const unnamed = profile.structuredFacts?.find((entry) => entry.data.id === "exp-career")?.data;
    expect(unnamed?.sectionType === "project" ? resolveCareerAssetDisplayIdentity({ ...unnamed, title: "", role: undefined }).label : "").toBe("项目经历");
    expect(findTechnicalTerms("使用 API、测试和 React 完成页面；部署在 ESP32 上。")).toEqual(["React", "ESP32"]);
  });

  it("records writer execution, preserves target context, and creates an immutable checkpoint", () => {
    const profile = profileFixture();
    const composition = compileResumeComposition({
      profile,
      mode: "general",
      targetDirection: "后端工程",
      targetAudience: "校招",
      companyType: "技术团队"
    });
    expect(composition.writingExecution).toMatchObject({ mode: "deterministic_fallback", attemptCount: 1 });
    expect(composition.telemetry).toMatchObject({ writerMode: "deterministic_fallback", pageCountSource: "blueprint_estimate", targetContext: { targetDirection: "后端工程", targetAudience: "校招", companyType: "技术团队" } });
    const checkpoint = createResumeCompositionCheckpoint({ composition, createdAt: TIME });
    expect(checkpoint.compositionResult).toEqual(composition);
    expect(checkpoint.contentHash.length).toBeGreaterThanOrEqual(8);
    expect(checkpoint.writingExecution.inputContextHash.length).toBeGreaterThanOrEqual(8);
  });

  it("records a deterministic fallback when the writer provider is unavailable", async () => {
    const profile = profileFixture();
    const graph = buildResumeEvidenceGraph({ profile });
    const blueprint = planResumeBlueprint({ profile, graph, mode: "general" });
    vi.mocked(invokeStructuredAi).mockResolvedValueOnce({
      ok: false,
      errorCode: "provider_unavailable",
      diagnostics: { provider: "server", model: "test-model", attempt: 2, latencyMs: 17 }
    } as never);
    const result = await new CareerResumeWritingService().writeWithExecution({ profile, graph, blueprint, mode: "general" });
    expect(result.output).toBeUndefined();
    expect(result.execution).toMatchObject({ mode: "deterministic_fallback", fallbackReason: "provider_unavailable", attemptCount: 2, provider: "server", model: "test-model", latencyMs: 17 });
    expect(result.execution.inputContextHash.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps writer target context in the strict task schema and prompt payload", () => {
    const input = ResumeCareerWritingTaskInputSchema.parse({
      mode: "job_specific",
      targetRole: "后端工程师",
      targetDirection: "服务端研发",
      targetAudience: "应届校招面试官",
      companyType: "B2B SaaS 技术团队",
      assets: [{
        sourceAssetId: "asset-1",
        displayIdentity: "数据处理项目",
        sectionType: "project",
        canonicalItem: { id: "asset-1", sectionType: "project", title: "数据处理项目" },
        factStatements: ["已确认完成数据处理"],
        evidenceExcerpts: ["来源摘录"],
        ownershipStrength: 3,
        explicitTools: ["Python"]
      }],
      skillGroups: { 编程语言: ["Python"] },
      instructions: []
    });
    const prompt = JSON.parse(aiTaskRegistry["resume-career-writer"].buildUserPrompt(input)) as Record<string, unknown>;
    expect(prompt).toMatchObject({
      mode: "job_specific",
      targetRole: "后端工程师",
      targetDirection: "服务端研发",
      targetAudience: "应届校招面试官",
      companyType: "B2B SaaS 技术团队"
    });
    expect(() => aiTaskRegistry["resume-career-writer"].validateOutput?.({
      assets: [],
      skillGroups: []
    }, input)).toThrow("resume_career_writer_asset_coverage_incomplete");
    expect(() => aiTaskRegistry["resume-career-writer"].validateOutput?.({
      assets: [{ sourceAssetId: "asset-1", title: "数据处理项目", techStack: [], highlights: [] }],
      skillGroups: []
    }, input)).not.toThrow();
  });
});
