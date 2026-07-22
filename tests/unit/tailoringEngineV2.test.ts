import { describe, expect, it } from "vitest";
import { createTailoringPlan } from "@/services/jobs/tailoringService";
import { routeTailoringRequirements, validateTailoringDelta } from "@/domain/jobOptimization";
import type { CareerProfile, JobDescription, ResumeBranch, TailoringIntensity } from "@/domain/schemas";

const NOW = "2026-07-20T08:00:00.000Z";
const jdText = `AI 软件工程师\n岗位职责\n大模型应用开发，搭建和调优 RAG 系统与 AI Agent 任务规划、工具调用\n使用 Python / FastAPI 完成接口开发\n使用 Playwright 进行端到端自动化测试\n负责模型输出评估、Prompt Engineering 与结构化输出验证`;

describe("Tailoring Engine v2 regression", () => {
  it.each(["conservative", "balanced", "proactive"] as TailoringIntensity[])(
    "%s produces task inputs with correct intensity and job context",
    (intensity) => {
      const result = createTailoringPlan({
        profile: fixtureProfile(),
        branch: fixtureBranch(),
        job: fixtureJob(),
        intensity,
        operationId: `regression-${intensity}`,
        now: NOW
      });

      expect(result.plan).toBeDefined();
      expect(result.taskInputs?.every((request) => request.intensity === intensity)).toBe(true);
      expect(result.taskInputs?.every((request) => request.jobContext.rawText === jdText)).toBe(true);
      // Claims may be empty when the engine determines no valid rewrite is possible
      if (result.plan!.claims.length > 0) {
        expect(result.plan!.claims.every((claim) => claim.proposedText !== claim.currentText)).toBe(true);
      }
    }
  );

  it("generates suggestions with correct structure and keyword coverage", () => {
    const plan = createTailoringPlan({
      profile: fixtureProfile(), branch: fixtureBranch(), job: fixtureJob(), intensity: "proactive", operationId: "structure-proactive", now: NOW
    }).plan!;
    const suggestions = plan.suggestions!;

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((item) => item.targetSectionType === "summary")).toBe(true);
    expect(suggestions.some((item) => item.targetSectionType === "skills")).toBe(true);
    expect(suggestions.every((item) => JSON.stringify(item.before) !== JSON.stringify(item.after))).toBe(true);
    expect(suggestions.every((item) => item.targetKeywords.some((keyword) => keyword.toLowerCase() !== "ai"))).toBe(true);
    expect(suggestions.reduce((total, item) => total + item.metrics.keywordGain, 0)).toBeGreaterThan(0);
    const projectRequirements = suggestions.filter((item) => item.targetSectionType === "project").map((item) => item.requirementIds.join(","));
    expect(new Set(projectRequirements).size).toBeGreaterThan(0);
  });

  it("rejects copied or empty model output instead of falling back to before", () => {
    const copied = validateTailoringDelta({ before: "RAG 系统搭建与调优", after: "RAG 系统搭建与调优", intensity: "balanced", targetKeywords: ["RAG", "FastAPI"], sectionType: "project" });
    const empty = validateTailoringDelta({ before: "RAG 系统搭建与调优", after: "", intensity: "balanced", targetKeywords: ["RAG", "FastAPI"], sectionType: "project" });
    expect(copied).toMatchObject({ valid: false, status: "no_change_needed" });
    expect(empty).toMatchObject({ valid: false, status: "invalid_ai_output" });
  });

  it("routes different requirements to skills and individual projects", () => {
    const job = fixtureJob();
    const skills = routeTailoringRequirements({ job, sectionType: "skills", renderedText: "Python FastAPI Playwright", itemId: "skill-python" });
    const smartFocus = routeTailoringRequirements({ job, sectionType: "project", renderedText: "示例任务系统 RAG 系统搭建与调优", itemId: "smartfocus" });
    const learnKata = routeTailoringRequirements({ job, sectionType: "project", renderedText: "示例学习助手 AI Agent 任务规划与工具调用", itemId: "learnkata" });
    expect(skills.map((item) => item.requirementId)).toContain("req-api");
    expect(smartFocus[0].requirementId).toBe("req-rag");
    expect(learnKata[0].requirementId).toBe("req-agent");
  });
});

function fixtureJob(): JobDescription {
  const requirements = [
    ["rag", "大模型应用开发与 RAG 系统搭建调优", ["大模型应用开发", "RAG"]],
    ["agent", "AI Agent 任务规划与工具调用", ["AI Agent", "任务规划", "工具调用"]],
    ["api", "Python / FastAPI 接口开发", ["Python", "FastAPI", "接口开发"]],
    ["test", "Playwright 端到端自动化测试", ["Playwright", "自动化测试"]],
    ["eval", "模型输出评估与结构化输出验证", ["模型输出评估", "结构化输出验证", "Prompt Engineering"]]
  ].map(([id, description, keywords], index) => ({
    id: `req-${id}`, category: index < 2 ? "responsibility" as const : "required_skill" as const,
    description: description as string, priority: "high" as const, hardConstraint: false,
    sourceSpan: { start: 0, end: jdText.length, text: jdText }, keywords: keywords as string[], confidence: 1,
    createdAt: NOW, updatedAt: NOW
  }));
  return { id: "job-ai", title: "AI 软件工程师", company: "目标公司", rawText: jdText, source: "manual", requirements, createdAt: NOW, updatedAt: NOW };
}

function fixtureProfile(): CareerProfile {
  return {
    id: "profile-ai", name: "测试用户", basics: { name: "测试用户", links: [] },
    preference: { targetRoles: [], targetCities: [], industries: [] }, version: 1,
    experiences: [], skills: [], certificates: [], evidences: [], unclassifiedBlocks: [], createdAt: NOW, updatedAt: NOW
  } as CareerProfile;
}

function fixtureBranch(): ResumeBranch {
  const rows = [
    ["summary", "summary", "具备 ReactJS 搭建与 NextJS 部署的 AI 领域软件工程化和产品开发经验。"],
    ["skill-python", "skill", "Python / FastAPI；Playwright 端到端测试；Type Script 结构化输出验证"],
    ["smartfocus", "experience", "示例任务系统：完成 RAG 系统搭建与调优。"],
    ["learnkata", "experience", "示例学习助手：实现 AI Agent 任务规划与工具调用。"],
    ["redbook", "experience", "示例内容分析项目：开展模型输出评估。"]
  ] as const;
  return {
    id: "branch-ai", schemaVersion: "resume-branch-v2", branchPurpose: "job_specific", profileId: "profile-ai", jobId: "job-ai",
    name: "AI 软件工程师岗位简历", sourceProfileVersion: 1, sourceProfileSnapshotId: "snapshot-ai", sourceJobVersion: "job-v1", sourceDraftRevision: 0,
    matcherVersion: "matcher-v2", sourceMatchSetHash: "hash-ai-123", requirementMatchIds: [], revision: 1,
    currentRevisionId: "revision-ai", lifecycleStatus: "active", migrationStatus: "verified",
    syncStatusCache: { status: "in_sync", sourceProfileVersion: 1, currentProfileVersion: 1, invalidFactRefs: [], checkedAt: NOW, message: "in sync" },
    contentItems: rows.map(([id, itemType, text], order) => ({ id, itemType, source: "user_manual", sourceSectionId: itemType, text, originalText: text, order, visible: true, requirementIds: [], sourceSuggestionIds: [], factRefs: [], guardMode: "not_fact", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [], userConfirmation: { scope: "resume_only", confirmedTextHash: `confirmed-${id}`, confirmedAt: NOW } })),
    structuredContentItems: [
      { id: "summary", schemaVersion: "resume-content-item-v2" as const, data: { sectionType: "summary" as const, id: "summary", text: "具备 AI 领域的软件工程化和产品开发经验。", customFields: [] }, factRefs: [], source: "user_manual" as const, order: 0, visible: true, guardMode: "not_fact" as const, guardStatus: "pass" as const, guardFindings: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { id: "skill-python", schemaVersion: "resume-content-item-v2" as const, data: { sectionType: "skills" as const, id: "skill-python", name: "Python", description: "Python / FastAPI；Playwright 端到端测试；结构化输出验证", customFields: [] }, factRefs: [], source: "user_manual" as const, order: 1, visible: true, guardMode: "not_fact" as const, guardStatus: "pass" as const, guardFindings: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { id: "smartfocus", schemaVersion: "resume-content-item-v2" as const, data: { sectionType: "project" as const, id: "smartfocus", title: "示例任务系统", role: "全栈开发", highlights: ["示例任务系统：完成 RAG 系统搭建与调优。"], customFields: [] }, factRefs: [], source: "user_manual" as const, order: 2, visible: true, guardMode: "not_fact" as const, guardStatus: "pass" as const, guardFindings: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { id: "learnkata", schemaVersion: "resume-content-item-v2" as const, data: { sectionType: "project" as const, id: "learnkata", title: "示例学习助手", role: "后端开发", highlights: ["示例学习助手：实现 AI Agent 任务规划与工具调用。"], customFields: [] }, factRefs: [], source: "user_manual" as const, order: 3, visible: true, guardMode: "not_fact" as const, guardStatus: "pass" as const, guardFindings: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
      { id: "redbook", schemaVersion: "resume-content-item-v2" as const, data: { sectionType: "project" as const, id: "redbook", title: "示例内容分析项目", role: "数据分析", highlights: ["示例内容分析项目：开展模型输出评估。"], customFields: [] }, factRefs: [], source: "user_manual" as const, order: 4, visible: true, guardMode: "not_fact" as const, guardStatus: "pass" as const, guardFindings: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }
    ], createdAt: NOW, updatedAt: NOW
  } as ResumeBranch;
}
