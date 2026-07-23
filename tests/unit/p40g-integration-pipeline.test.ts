import { describe, expect, it } from "vitest";
import {
  analyzeJobDescriptionV3,
  reconcileJobRequirementGraphV3,
  buildCanonicalJobRequirementGraphV3
} from "@/domain/jobOptimization/v3/analyze";
import { routeTailoringRequirements, createDeterministicTailoringSuggestions } from "@/domain/jobOptimization/tailoringEngine";
import { runResumeDiagnostics } from "@/domain/resumeDiagnostics";
import type { BranchContentItem, JobDescription, RequirementBlockMatch, ResumeBranch, ResumePaginationPlan, ResumePresentationConfig, ResumeRenderModel } from "@/domain/schemas";
import { JobDescriptionSchema } from "@/domain/schemas";

const NOW = "2026-07-21T00:00:00.000Z";

const JD_TEXT = `AI 软件工程师
岗位职责
大模型应用开发，搭建和调优 RAG 系统与 AI Agent 任务规划、工具调用
使用 Python / FastAPI 完成接口开发
使用 Playwright 进行端到端自动化测试
负责模型输出评估、Prompt Engineering 与结构化输出验证
任职要求
必须：3 年以上 Python 开发经验
必须：熟悉 FastAPI 或类似框架
满足以下任一条件即可
有 RAG 系统搭建经验
有 AI Agent 开发经验
加分项
熟悉 Playwright 或 Vitest
有 Coding Agent 使用经验
候选人画像
我们希望你对 AI 输出质量有天然的敏感度
能够独立定位问题并提出改进建议
验证材料
GitHub 仓库或个人项目链接
作品集或技术博客
公司介绍
我们是一家 AI 驱动的科技公司。`;

function fixtureJob(): JobDescription {
  return JobDescriptionSchema.parse({
    id: "job-integration-test",
    title: "AI 软件工程师",
    company: "测试公司",
    rawText: JD_TEXT,
    source: "manual",
    requirements: [],
    createdAt: NOW,
    updatedAt: NOW
  });
}

function fixtureBranchItems(): BranchContentItem[] {
  return [
    { id: "summary-1", itemType: "summary", source: "user_manual", sourceSectionId: "summary", text: "具备 ReactJS 搭建与 NextJS 部署的 AI 领域软件工程化经验。", originalText: "具备 ReactJS 搭建与 NextJS 部署的 AI 领域软件工程化经验。", order: 0, visible: true, requirementIds: [], sourceSuggestionIds: [], factRefs: [], guardMode: "not_fact", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [] },
    { id: "skill-python", itemType: "skill", source: "user_manual", sourceSectionId: "skills", text: "Python / FastAPI；Playwright 端到端测试", originalText: "Python / FastAPI；Playwright 端到端测试", order: 1, visible: true, requirementIds: [], sourceSuggestionIds: [], factRefs: [], guardMode: "not_fact", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [] },
    { id: "project-1", itemType: "experience", source: "user_manual", sourceSectionId: "experience", text: "示例任务系统：完成 RAG 系统搭建与调优。", originalText: "示例任务系统：完成 RAG 系统搭建与调优。", order: 2, visible: true, requirementIds: [], sourceSuggestionIds: [], factRefs: [], guardMode: "not_fact", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [] },
    { id: "project-2", itemType: "experience", source: "user_manual", sourceSectionId: "experience", text: "示例学习助手：实现 AI Agent 任务规划与工具调用。", originalText: "示例学习助手：实现 AI Agent 任务规划与工具调用。", order: 3, visible: true, requirementIds: [], sourceSuggestionIds: [], factRefs: [], guardMode: "not_fact", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [] }
  ];
}

describe("P4.0g Integration: full JD → Graph v3 → matching → tailoring → diagnostics pipeline", () => {
  it("completes the full pipeline end-to-end", () => {
    // Step 1: JD raw text → deterministic segmentation
    const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
    const statements = graph.requirements.map((r) => r.statement);
    expect(statements).not.toContain("岗位职责");
    expect(statements).not.toContain("满足以下任一条件即可");
    expect(graph.requirements.length).toBeGreaterThan(0);
    expect(graph.groups.some((g) => g.relation === "any_of")).toBe(true);
    expect(graph.verificationMaterials.length).toBeGreaterThanOrEqual(2);
    expect(graph.roleProfile.hiringSignals.length).toBeGreaterThanOrEqual(2);
    expect(graph.sourceCoverage.coverageRatio).toBeGreaterThanOrEqual(0.95);

    // Step 2: Deterministic → AI reconciliation
    const aiOutput = {
      requirements: graph.requirements.slice(0, 2).map((r) => ({
        id: r.id, category: "required_skill" as const, description: r.statement, priority: "high" as const,
        hardConstraint: false, sourceQuote: r.sourceSpan.text, sourceSpan: r.sourceSpan,
        keywords: [...r.exactKeywords, "AI测试关键词"], confidenceLevel: "high" as const, confidence: 0.95,
        confidenceReason: "test", needsConfirmation: false, confirmedByUser: false,
        createdAt: NOW, updatedAt: NOW, riskNotes: [] as string[]
      })),
      riskNotes: [] as string[]
    };
    const reconciled = reconcileJobRequirementGraphV3({ rawText: JD_TEXT, aiOutput });
    const reconciledFirst = reconciled.graph.requirements.find((r) => r.id === graph.requirements[0].id);
    expect(reconciledFirst?.exactKeywords).toContain("AI测试关键词");
    expect(reconciled.metrics.silentLoss).toBe(0);
    expect(reconciled.graph.graphHash).toBe(graph.graphHash);
    expect(reconciled.graph.semanticEnrichmentHash).not.toBe(graph.semanticEnrichmentHash);

    // Step 3: Graph v3 → JobDescription projection
    const job = fixtureJob();
    const projected = buildCanonicalJobRequirementGraphV3(job);
    expect(projected.schemaVersion).toBe("job-requirement-graph-v3");
    expect(projected.requirements.length).toBeGreaterThan(0);

    // Step 4: Graph v3 → matching
    const matchResults = routeTailoringRequirements({
      job, sectionType: "project",
      renderedText: "示例任务系统 RAG 系统搭建 Python FastAPI",
      itemId: "project-1"
    });
    expect(matchResults.length).toBeGreaterThan(0);
    expect(matchResults.some((r) => r.keywords.some((k) => k.includes("RAG") || k.includes("Python")))).toBe(true);
    for (let i = 1; i < matchResults.length; i++) {
      expect(matchResults[i - 1].relevanceScore).toBeGreaterThanOrEqual(matchResults[i].relevanceScore);
    }

    // Step 5: Matching → tailoring suggestions
    const branch = {
      id: "b", schemaVersion: "resume-branch-v2", branchPurpose: "job_specific", profileId: "p", jobId: "j",
      name: "测试", sourceProfileVersion: 1, sourceProfileSnapshotId: "s", sourceJobVersion: "v1", sourceDraftRevision: 0,
      matcherVersion: "m", sourceMatchSetHash: "h", requirementMatchIds: [], revision: 1, currentRevisionId: "r",
      tailoringAppliedCount: 0, lifecycleStatus: "active", migrationStatus: "verified",
      syncStatusCache: { status: "in_sync", sourceProfileVersion: 1, currentProfileVersion: 1, invalidFactRefs: [], checkedAt: NOW, message: "ok" },
      contentItems: fixtureBranchItems(),
      structuredContentItems: [
        { id: "summary-1", schemaVersion: "resume-content-item-v2" as const, data: { sectionType: "summary" as const, id: "summary-1", text: "具备 ReactJS 搭建与 NextJS 部署的 AI 领域软件工程化经验。", customFields: [] }, factRefs: [], source: "user_manual" as const, order: 0, visible: true, guardMode: "not_fact" as const, guardStatus: "pass" as const, guardFindings: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
        { id: "skill-python", schemaVersion: "resume-content-item-v2" as const, data: { sectionType: "skills" as const, id: "skill-python", name: "Python", description: "Python / FastAPI；Playwright 端到端测试", customFields: [] }, factRefs: [], source: "user_manual" as const, order: 1, visible: true, guardMode: "not_fact" as const, guardStatus: "pass" as const, guardFindings: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
        { id: "project-1", schemaVersion: "resume-content-item-v2" as const, data: { sectionType: "project" as const, id: "project-1", title: "示例任务系统", role: "全栈开发", highlights: ["示例任务系统：完成 RAG 系统搭建与调优。"], customFields: [] }, factRefs: [], source: "user_manual" as const, order: 2, visible: true, guardMode: "not_fact" as const, guardStatus: "pass" as const, guardFindings: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
        { id: "project-2", schemaVersion: "resume-content-item-v2" as const, data: { sectionType: "project" as const, id: "project-2", title: "示例学习助手", role: "后端开发", highlights: ["示例学习助手：实现 AI Agent 任务规划与工具调用。"], customFields: [] }, factRefs: [], source: "user_manual" as const, order: 3, visible: true, guardMode: "not_fact" as const, guardStatus: "pass" as const, guardFindings: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }
      ],
      createdAt: NOW, updatedAt: NOW
    } as ResumeBranch;

    const suggestions = createDeterministicTailoringSuggestions({
      branch, job, intensity: "balanced", operationId: "pipeline-test", resolveEvidenceRefs: () => []
    });
    expect(Array.isArray(suggestions)).toBe(true);

    // Step 6: Tailoring → diagnostics
    const uncoveredReqs = graph.requirements.filter((r) => !matchResults.some((m) => m.requirementId === r.id));
    const allMatches: RequirementBlockMatch[] = [
      ...matchResults.map((r) => ({
        id: `rbm-${r.requirementId}`, jobId: job.id, branchId: "b", branchRevision: 1, currentRevisionId: "r",
        requirementsHash: "h", requirementId: r.requirementId, contentItemId: "project-1",
        matchLevel: "strong" as const, evidenceRefs: [], evidenceFactIds: [], evidenceQuotes: [],
        reason: "test", source: "deterministic" as const, isStale: false, createdAt: NOW, updatedAt: NOW
      })),
      ...uncoveredReqs.map((r) => ({
        id: `rbm-none-${r.id}`, jobId: job.id, branchId: "b", branchRevision: 1, currentRevisionId: "r",
        requirementsHash: "h", requirementId: r.id, matchLevel: "none" as const, evidenceRefs: [],
        evidenceFactIds: [], evidenceQuotes: [], reason: "no match", source: "deterministic" as const,
        isStale: false, createdAt: NOW, updatedAt: NOW
      }))
    ];

    const renderModel: ResumeRenderModel = {
      schemaVersion: "resume-render-v1", branchId: "b", branchRevision: 1, branchCurrentRevisionId: "r",
      branchName: "测试", jobTitle: job.title, company: job.company,
      candidate: { name: "测试", contacts: [] }, sections: [],
      safety: { ruleOnlyItemIds: [], visibleItemCount: 4, excludedItemIds: [] },
      sourceTrace: { profileId: "p", jobId: job.id, currentRevisionId: "r", sourceProfileVersion: 1, sourceJobVersion: NOW }
    };

    const presentationConfig: ResumePresentationConfig = {
      schemaVersion: "resume-presentation-v1", branchId: "b", templateId: "ats-minimal",
      contentRevision: { branchRevision: 1, currentRevisionId: "r" },
      sectionOrder: ["summary", "skills", "experience"],
      itemOrderBySection: { summary: ["summary-1"], skills: ["skill-python"], experience: ["project-1", "project-2"] },
      hiddenItemIds: [],
      typography: { chineseFont: "system_sans", englishFont: "system_sans", bodyTextScale: "normal", titleTextScale: "normal", lineHeight: "normal" },
      spacing: { pageMargin: "normal", sectionGap: "normal", itemGap: "normal" },
      theme: { primaryColor: "emerald", accentColor: "emerald", dividerColor: "graphite", density: "balanced" },
      pagination: { pagePolicy: "one_page_strict", preferredPageCount: 1, maximumPageCount: 4, overflowBehavior: "warn", headerFooter: "none", showPhoto: false, pageBreakBeforeSections: [] },
      sectionStyleOverrides: {}, highlightListStyle: "bullet", itemHeaderMiddleAlignment: "balanced",
      presentationRevision: 1, updatedAt: NOW
    };

    const paginationPlan: ResumePaginationPlan = {
      schemaVersion: "resume-pagination-v1", pagePolicy: "one_page_strict", requestedMaxPages: 4,
      preferredPageCount: 1, maximumPageCount: 4, overflowBehavior: "warn", actualPageCount: 1,
      status: "near_one_page_limit",
      pages: [{ pageNumber: 1, sectionTypes: ["summary", "skills", "experience"], itemIdsBySection: { summary: ["summary-1"], skills: ["skill-python"], experience: ["project-1", "project-2"] }, blockIds: ["summary-1", "skill-python", "project-1", "project-2"] }],
      forcedBreakBeforeSections: [], overflowBlockIds: [], oversizedBlockIds: [],
      measurement: { scrollHeight: 900, clientHeight: 1000, remainingPx: 100 }, paginationHash: "pagination-hash-test"
    };

    const diagnostics = runResumeDiagnostics({
      branchId: "b", branchRevision: 1, currentRevisionId: "r",
      branchContentItems: fixtureBranchItems(), renderModel, presentationConfig,
      template: { id: "ats-minimal", version: 1, category: "ats", layout: "single-column", atsLevel: "high", suitableRoles: [], tags: [], capabilities: { supportsDensity: false, supportsBodyScale: false, supportsHeadingScale: false, supportsLineHeight: false, supportsSectionGap: false, supportsItemGap: false, supportsTwoPages: false, supportsSectionPageBreaks: false, supportsSectionTitleVisibility: false } },
      job, requirementMatches: [], requirementBlockMatches: allMatches, requirementsHash: "requirements-hash-test",
      paginationPlan, paginationMeasurement: { scrollHeight: 900, clientHeight: 1000, sections: [], blocks: [] }, now: NOW
    });

    const codes = diagnostics.issues.map((i) => i.code);
    // Job has no formal requirements (requirements: []), so diagnostics reports NO_REQUIREMENTS
    // In production, the job would have requirements from JD parsing
    expect(codes).toContain("NO_REQUIREMENTS");
    expect(diagnostics.summary.exportHardBlocked).toBe(false);
  });
});
