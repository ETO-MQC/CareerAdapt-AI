import { describe, expect, it } from "vitest";
import {
  analyzeJobDescriptionV3,
  reconcileJobRequirementGraphV3,
  validateJobRequirementGraphV3,
  buildCanonicalJobRequirementGraphV3,
  JOB_REQUIREMENT_ANALYZER_V3
} from "@/domain/jobOptimization/v3/analyze";
import { routeTailoringRequirements } from "@/domain/jobOptimization/tailoringEngine";
import { JobDescriptionSchema, type JobDescription } from "@/domain/schemas";

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

function fixtureJob(overrides?: Partial<JobDescription>): JobDescription {
  return JobDescriptionSchema.parse({
    id: "job-v3-test",
    title: "AI 软件工程师",
    company: "测试公司",
    rawText: JD_TEXT,
    source: "manual",
    requirements: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  });
}

describe("P4.0g JobRequirementGraphV3", () => {
  describe("heading and wrapper suppression", () => {
    it("suppresses heading lines from requirements", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const statements = graph.requirements.map((r) => r.statement);
      expect(statements).not.toContain("岗位职责");
      expect(statements).not.toContain("任职要求");
      expect(statements).not.toContain("加分项");
      expect(statements).not.toContain("候选人画像");
      expect(statements).not.toContain("验证材料");
      expect(statements).not.toContain("公司介绍");
    });

    it("suppresses wrapper lines from requirements", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const statements = graph.requirements.map((r) => r.statement);
      expect(statements).not.toContain("满足以下任一条件即可");
      expect(statements).not.toContain("具备以下任一条件者优先");
      expect(statements).not.toContain("根据自身情况提供以下材料");
    });

    it("excludes removed sections entirely", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      // Company info section is excluded - its content should not appear as requirements
      const requirementTexts = graph.requirements.map((r) => r.statement);
      expect(requirementTexts).not.toContain("我们是一家 AI 驱动的科技公司");
      // Verification materials and hiring signals should also not contain it
      expect(graph.verificationMaterials.every((m) => !m.label.includes("AI 驱动"))).toBe(true);
      expect(graph.roleProfile.hiringSignals.every((s) => !s.statement.includes("AI 驱动"))).toBe(true);
    });
  });

  describe("any_of group", () => {
    it("creates an any_of group with minimumSatisfied=1", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const anyOfGroups = graph.groups.filter((g) => g.relation === "any_of");
      expect(anyOfGroups.length).toBeGreaterThanOrEqual(1);
      expect(anyOfGroups[0].minimumSatisfied).toBe(1);
    });

    it("groups requirements under the any_of wrapper", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const anyOfGroup = graph.groups.find((g) => g.relation === "any_of");
      expect(anyOfGroup).toBeDefined();
      expect(anyOfGroup!.requirementIds.length).toBeGreaterThanOrEqual(2);
      // Each child should be a real requirement
      for (const childId of anyOfGroup!.requirementIds) {
        const child = graph.requirements.find((r) => r.id === childId);
        expect(child).toBeDefined();
      }
    });
  });

  describe("preferred_any_of group", () => {
    it("creates a preferred_any_of group when wrapper is present", () => {
      const jdWithPreferred = JD_TEXT.replace("加分项", "具备以下任一条件者优先");
      const graph = analyzeJobDescriptionV3({ rawText: jdWithPreferred });
      const preferredGroups = graph.groups.filter((g) => g.relation === "preferred_any_of");
      expect(preferredGroups.length).toBeGreaterThanOrEqual(1);
    });

    it("preferred group children are in preferred section", () => {
      const jdWithPreferred = JD_TEXT.replace("加分项", "具备以下任一条件者优先");
      const graph = analyzeJobDescriptionV3({ rawText: jdWithPreferred });
      const preferredGroup = graph.groups.find((g) => g.relation === "preferred_any_of");
      if (preferredGroup) {
        for (const childId of preferredGroup.requirementIds) {
          const child = graph.requirements.find((r) => r.id === childId);
          expect(child?.section).toBe("preferred");
        }
      }
    });
  });

  describe("verification bundle", () => {
    it("creates evidence_bundle group for verification materials", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const evidenceGroups = graph.groups.filter((g) => g.relation === "evidence_bundle");
      expect(evidenceGroups.length).toBeGreaterThanOrEqual(1);
    });

    it("captures verification materials separately from requirements", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      expect(graph.verificationMaterials.length).toBeGreaterThanOrEqual(2);
      const labels = graph.verificationMaterials.map((m) => m.label);
      expect(labels.some((l) => l.includes("GitHub"))).toBe(true);
      expect(labels.some((l) => l.includes("作品"))).toBe(true);
    });

    it("verification materials have valid kind", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      for (const material of graph.verificationMaterials) {
        expect(["usage_dashboard", "billing_history", "github", "badcase", "other"]).toContain(material.kind);
      }
    });
  });

  describe("role profile signals", () => {
    it("captures role profile lines as hiringSignals", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      expect(graph.roleProfile.hiringSignals.length).toBeGreaterThanOrEqual(2);
    });

    it("hiringSignals have correct structure", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      for (const signal of graph.roleProfile.hiringSignals) {
        expect(signal.id).toBeTruthy();
        expect(signal.statement).toBeTruthy();
        expect(signal.normalizedIntent).toBeTruthy();
        expect(signal.sourceSpan).toBeDefined();
        expect(signal.confidence).toBeGreaterThan(0);
      }
    });
  });

  describe("source coverage", () => {
    it("covers heading, wrapper, and requirement lines", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      expect(graph.sourceCoverage.coveredSpans.length).toBeGreaterThan(0);
      expect(graph.sourceCoverage.coverageRatio).toBeGreaterThan(0);
    });

    it("coverage ratio is at least 0.95 for well-structured JD", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      expect(graph.sourceCoverage.coverageRatio).toBeGreaterThanOrEqual(0.95);
    });

    it("excluded section lines are not in coveredSpans", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      // "公司介绍" section is excluded, its content should not be covered
      const coveredTexts = graph.sourceCoverage.coveredSpans.map((s) => s.text);
      expect(coveredTexts).not.toContain("我们是一家 AI 驱动的科技公司");
    });
  });

  describe("graph hash stability", () => {
    it("same rawText produces same graphHash", () => {
      const g1 = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const g2 = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      expect(g1.graphHash).toBe(g2.graphHash);
    });

    it("different rawText produces different graphHash", () => {
      const g1 = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const g2 = analyzeJobDescriptionV3({ rawText: "完全不同\n的 JD 文本\n任职要求\n会写代码" });
      expect(g1.graphHash).not.toBe(g2.graphHash);
    });

    it("graphHash is at least 8 characters", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      expect(graph.graphHash.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe("AI/deterministic reconciliation", () => {
    it("without AI output returns deterministic graph", () => {
      const result = reconcileJobRequirementGraphV3({ rawText: JD_TEXT });
      expect(result.graph.analyzerVersion).toBe(JOB_REQUIREMENT_ANALYZER_V3);
      expect(result.graph.requirements.length).toBeGreaterThan(0);
    });

    it("with AI output merges keywords and increases confidence", () => {
      const deterministic = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const firstReq = deterministic.requirements[0];
      const aiOutput = {
        requirements: [{
          id: firstReq.id,
          category: "required_skill" as const,
          description: firstReq.statement,
          priority: "high" as const,
          hardConstraint: false,
          sourceQuote: firstReq.sourceSpan.text,
          sourceSpan: firstReq.sourceSpan,
          keywords: [...firstReq.exactKeywords, "新增关键词"],
          confidenceLevel: "high" as const,
          confidence: 0.95,
          confidenceReason: "test",
          needsConfirmation: false,
          confirmedByUser: false,
          createdAt: NOW,
          updatedAt: NOW,
          riskNotes: [] as string[]
        }],
        riskNotes: [] as string[]
      };
      const result = reconcileJobRequirementGraphV3({ rawText: JD_TEXT, aiOutput });
      const reconciled = result.graph.requirements.find((r) => r.id === firstReq.id);
      expect(reconciled).toBeDefined();
      expect(reconciled!.exactKeywords).toContain("新增关键词");
      expect(reconciled!.confidence).toBeGreaterThanOrEqual(firstReq.confidence);
    });

    it("AI classification conflict sets needsConfirmation", () => {
      const deterministic = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const firstReq = deterministic.requirements[0];
      const aiOutput = {
        requirements: [{
          id: firstReq.id,
          category: "soft_skill" as const, // different kind from deterministic
          description: firstReq.statement,
          priority: "high" as const,
          hardConstraint: false,
          sourceQuote: firstReq.sourceSpan.text,
          sourceSpan: firstReq.sourceSpan,
          keywords: firstReq.exactKeywords,
          confidenceLevel: "high" as const,
          confidence: 0.95,
          confidenceReason: "test",
          needsConfirmation: false,
          confirmedByUser: false,
          createdAt: NOW,
          updatedAt: NOW,
          riskNotes: [] as string[]
        }],
        riskNotes: [] as string[]
      };
      const result = reconcileJobRequirementGraphV3({ rawText: JD_TEXT, aiOutput });
      const reconciled = result.graph.requirements.find((r) => r.id === firstReq.id);
      expect(reconciled?.needsConfirmation).toBe(true);
    });

    it("does not silently drop deterministic requirements", () => {
      const deterministic = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const result = reconcileJobRequirementGraphV3({ rawText: JD_TEXT });
      expect(result.metrics.silentLoss).toBe(0);
      expect(result.graph.requirements.length).toBeGreaterThanOrEqual(deterministic.requirements.length);
    });
  });

  describe("duplicate merge", () => {
    it("merges requirements with the same normalizedIntent", () => {
      const jdWithDuplicates = `岗位职责
使用 Python 开发
使用 python 开发
任职要求
3 年经验`;
      const graph = analyzeJobDescriptionV3({ rawText: jdWithDuplicates });
      // "使用 Python 开发" and "使用 python 开发" should merge (case-insensitive)
      const pythonReqs = graph.requirements.filter((r) => r.normalizedIntent.includes("python"));
      expect(pythonReqs.length).toBeLessThanOrEqual(1);
    });

    it("merged requirements combine keywords", () => {
      const jdWithDuplicates = `岗位职责
使用 Python 和 FastAPI 开发
使用 Python 进行 FastAPI 开发
任职要求
3 年经验`;
      const graph = analyzeJobDescriptionV3({ rawText: jdWithDuplicates });
      const pythonReqs = graph.requirements.filter((r) => r.normalizedIntent.includes("python"));
      if (pythonReqs.length === 1) {
        expect(pythonReqs[0].exactKeywords.length).toBeGreaterThan(0);
      }
    });
  });

  describe("dynamic clarification questions", () => {
    it("routeTailoringRequirements returns requirements sorted by relevance", () => {
      const job = fixtureJob();
      const results = routeTailoringRequirements({
        job,
        sectionType: "project",
        renderedText: "示例任务系统 RAG 系统搭建与调优 Python FastAPI",
        itemId: "project-1"
      });
      expect(results.length).toBeGreaterThan(0);
      // Results should be sorted by relevanceScore descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].relevanceScore).toBeGreaterThanOrEqual(results[i].relevanceScore);
      }
    });

    it("requirements with more keyword matches rank higher", () => {
      const job = fixtureJob();
      const ragResults = routeTailoringRequirements({
        job,
        sectionType: "project",
        renderedText: "RAG 系统搭建 Python FastAPI Playwright",
        itemId: "project-1"
      });
      const genericResults = routeTailoringRequirements({
        job,
        sectionType: "project",
        renderedText: "一般性项目经验",
        itemId: "project-2"
      });
      // RAG-specific content should have higher scores
      if (ragResults.length > 0 && genericResults.length > 0) {
        expect(ragResults[0].relevanceScore).toBeGreaterThanOrEqual(genericResults[0].relevanceScore);
      }
    });

    it("summary section gets up to 4 requirements", () => {
      const job = fixtureJob();
      const results = routeTailoringRequirements({
        job,
        sectionType: "summary",
        renderedText: "AI 工程师 Python FastAPI RAG Playwright Agent",
        itemId: "summary-1"
      });
      expect(results.length).toBeLessThanOrEqual(4);
    });

    it("other sections get up to 3 requirements", () => {
      const job = fixtureJob();
      const results = routeTailoringRequirements({
        job,
        sectionType: "project",
        renderedText: "AI 工程师 Python FastAPI RAG Playwright Agent",
        itemId: "project-1"
      });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe("verification materials excluded from skills", () => {
    it("verification materials not in skills routing", () => {
      const job = fixtureJob();
      const results = routeTailoringRequirements({
        job,
        sectionType: "skills",
        renderedText: "Python FastAPI Playwright",
        itemId: "skill-1"
      });
      // Verification material descriptions should not appear in results
      const descriptions = results.map((r) => r.description.toLowerCase());
      expect(descriptions).not.toContain(expect.stringContaining("github 仓库"));
      expect(descriptions).not.toContain(expect.stringContaining("作品集"));
    });

    it("verification materials not in project routing", () => {
      const job = fixtureJob();
      const results = routeTailoringRequirements({
        job,
        sectionType: "project",
        renderedText: "完成 RAG 系统搭建",
        itemId: "project-1"
      });
      const descriptions = results.map((r) => r.description.toLowerCase());
      expect(descriptions).not.toContain(expect.stringContaining("github 仓库"));
    });
  });

  describe("hidden signals excluded from hard filters", () => {
    it("hiringSignals not in routeTailoringRequirements", () => {
      const job = fixtureJob();
      const results = routeTailoringRequirements({
        job,
        sectionType: "project",
        renderedText: "AI 输出质量敏感度 问题定位能力",
        itemId: "project-1"
      });
      // Hiring signal descriptions should not appear
      const descriptions = results.map((r) => r.description);
      expect(descriptions).not.toContain("我们希望你对 AI 输出质量有天然的敏感度");
      expect(descriptions).not.toContain("能够独立定位问题并提出改进建议");
    });
  });

  describe("buildCanonicalJobRequirementGraphV3", () => {
    it("returns existing requirementGraph if present", () => {
      const existingGraph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const job = fixtureJob({ requirementGraph: existingGraph });
      const result = buildCanonicalJobRequirementGraphV3(job);
      expect(result).toStrictEqual(existingGraph);
    });

    it("builds graph from flat requirements when no existing graph", () => {
      const job = fixtureJob({
        requirements: [
          { id: "req-1", category: "responsibility", description: "RAG 系统开发", priority: "high", hardConstraint: false, sourceSpan: { start: 0, end: 10, text: "RAG" }, keywords: ["RAG"], confidence: 0.9, createdAt: NOW, updatedAt: NOW },
          { id: "req-2", category: "required_skill", description: "Python 开发", priority: "must", hardConstraint: true, sourceSpan: { start: 10, end: 20, text: "Python" }, keywords: ["Python"], confidence: 0.95, createdAt: NOW, updatedAt: NOW }
        ]
      });
      const graph = buildCanonicalJobRequirementGraphV3(job);
      expect(graph.requirements.length).toBe(2);
      expect(graph.requirements.some((r) => r.id === "req-1")).toBe(true);
      expect(graph.requirements.some((r) => r.id === "req-2")).toBe(true);
    });
  });

  describe("validateJobRequirementGraphV3", () => {
    it("returns valid for well-formed graph", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const validation = validateJobRequirementGraphV3(graph);
      expect(validation.valid).toBe(true);
      expect(validation.status).toBe("validated");
    });

    it("detects wrapper text as hardWrapperNodes", () => {
      const graph = analyzeJobDescriptionV3({ rawText: JD_TEXT });
      const validation = validateJobRequirementGraphV3(graph);
      // Wrapper lines should be suppressed, so hardWrapperNodes should be 0
      expect(validation.metrics.hardWrapperNodes).toBe(0);
    });
  });
});
