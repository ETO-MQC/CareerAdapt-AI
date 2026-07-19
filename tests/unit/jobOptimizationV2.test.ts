import { describe, expect, it } from "vitest";
import { analyzeJobDescriptionV2, buildCandidateEvidenceUnits, buildJobCoverageReport, createResumeOptimizationPlan, evaluateRequirementEvidence, evaluateRequirementEvidenceWithAi, recallEvidenceCandidates } from "@/domain/jobOptimization";
import type { CareerProfile, ResumeBranch, ResumeContentItemV2 } from "@/domain/schemas";
import { jobOptimizationV2GoldenCases } from "../fixtures/jobOptimizationV2";

const NOW = "2026-07-19T08:00:00.000Z";

describe("JD Optimization Engine V2", () => {
  it("parses headings, lists, independent constraints and preserves every source span", () => {
    const rawText = `岗位职责\n- 负责 React 前端应用开发；维护组件库\n任职要求\n1. 至少 3 年前端工作经验\n2. 本科及以上学历\n3. 英语 CET-6\n加分项\n- 熟悉 Next.js 者优先\n工作地点\n上海\n福利待遇\n五险一金，下午茶`;
    const graph = analyzeJobDescriptionV2({ rawText, now: NOW });
    expect(graph.nodes.length).toBeGreaterThanOrEqual(7);
    expect(graph.nodes.every((node) => rawText.slice(node.sourceSpan.start, node.sourceSpan.end) === node.sourceSpan.text)).toBe(true);
    expect(graph.nodes.find((node) => node.minimumYears === 3)?.hardConstraint).toBe(true);
    expect(graph.nodes.find((node) => node.kind === "preferred")?.hardConstraint).toBe(false);
    expect(graph.nodes.some((node) => node.kind === "education")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "language")).toBe(true);
    expect(graph.nodes.some((node) => node.statement.includes("五险一金"))).toBe(false);
  });

  it.each([
    { caseName: "AI 工程师", jd: "任职要求\n设计模型输出质量评测体系\n熟悉 Python\n至少 3 年工作经验", expectedGap: "3 年" },
    { caseName: "前端开发", jd: "岗位职责\n负责 React 与 TypeScript 前端开发\n任职要求\n熟悉 Next.js", expectedGap: "" },
    { caseName: "外贸供应链", jd: "任职要求\n负责海外供应链与英语客户沟通\n具备报关证书", expectedGap: "报关" },
    { caseName: "明显不匹配", jd: "任职要求\n持有注册护士证\n至少 5 年 ICU 临床经验", expectedGap: "注册护士" }
  ])("creates grounded matrix and honest coverage for $caseName", ({ caseName, jd, expectedGap }) => {
    const { profile, branch } = fixture();
    const graph = analyzeJobDescriptionV2({ rawText: jd, now: NOW });
    const evidenceUnits = buildCandidateEvidenceUnits({ profile, branch });
    const recalls = recallEvidenceCandidates({ graph, evidenceUnits });
    const matrix = evaluateRequirementEvidence({ profile, graph, evidenceUnits, recalls, now: NOW });
    const coverage = buildJobCoverageReport({ graph, matrix });
    const plan = createResumeOptimizationPlan({ profile, branch, jobId: "job-v2", graph, evidenceUnits, matrix, coverage, now: NOW });

    expect(evidenceUnits.some((unit) => unit.fieldPath === "highlights.0")).toBe(true);
    expect(evidenceUnits.some((unit) => unit.fieldPath === "highlights.1")).toBe(true);
    expect(matrix.evaluations.every((evaluation) => evaluation.evidenceUnitIds.every((id) => evidenceUnits.some((unit) => unit.id === id)))).toBe(true);
    expect(coverage.scoreExplanation).toContain("不是 ATS");
    expect(plan.actions.every((action) => action.status === "proposed")).toBe(true);
    expect(plan.actions.every((action) => action.currentText?.includes("999%") !== true)).toBe(true);
    if (expectedGap) expect([...coverage.blockingGaps, ...plan.factGaps.map((gap) => gap.question)].join(" ")).toContain(expectedGap);
    if (caseName === "明显不匹配") expect(coverage.overallCoverage).toBeLessThan(30);
  });

  it("rejects unknown, duplicate and out-of-recall AI evidence ids", () => {
    const { profile, branch } = fixture();
    const graph = analyzeJobDescriptionV2({ rawText: "任职要求\n熟悉 React", now: NOW });
    const evidenceUnits = buildCandidateEvidenceUnits({ profile, branch });
    const recalls = recallEvidenceCandidates({ graph, evidenceUnits });
    expect(() => evaluateRequirementEvidence({ profile, graph, evidenceUnits, recalls, aiOutput: [{ requirementId: graph.nodes[0].id, matchLevel: "direct", evidenceUnitIds: ["invented"], evidenceRefs: [], coveredAspects: [], missingAspects: [], risks: [], explanation: "虚假引用", confidence: 1 }] })).toThrow("evidence_matcher_v2_evidence_outside_recall");
  });

  it("semantic rerank accepts recalled IDs and preserves deterministic results on AI failure", async () => {
    const { profile, branch } = fixture();
    const graph = analyzeJobDescriptionV2({ rawText: "任职要求\n设计模型输出质量评测体系", now: NOW });
    const evidenceUnits = buildCandidateEvidenceUnits({ profile, branch });
    const recalls = recallEvidenceCandidates({ graph, evidenceUnits });
    const candidateId = recalls[0].candidates[0]?.evidenceUnitId;
    expect(candidateId).toBeTruthy();
    const ai = await evaluateRequirementEvidenceWithAi({ profile, graph, evidenceUnits, recalls, now: NOW, rerank: async () => ({ evaluations: [{ requirementId: graph.nodes[0].id, matchLevel: "strong_transferable", evidenceUnitIds: [candidateId!], evidenceRefs: [], coveredAspects: ["输出审核与事实核对"], missingAspects: ["完整评测体系设计"], risks: [], explanation: "任务机制可迁移，但不能宣称已负责完整平台。", confidence: 0.74 }] }) });
    expect(ai.source).toBe("ai");
    expect(ai.matrix.evaluations[0].matchLevel).toBe("strong_transferable");
    const fallback = await evaluateRequirementEvidenceWithAi({ profile, graph, evidenceUnits, recalls, now: NOW, rerank: async () => { throw new Error("provider_failed"); } });
    expect(fallback.source).toBe("deterministic_fallback");
    expect(fallback.error).toBe("provider_failed");
    expect(fallback.matrix.evaluations).toHaveLength(graph.nodes.length);
  });

  it("does not hide hard gaps or create claims for missing years and certificates", () => {
    const { profile, branch } = fixture();
    const graph = analyzeJobDescriptionV2({ rawText: "必备条件\n至少 3 年工作经验\n持有 PMP 证书", now: NOW });
    const evidenceUnits = buildCandidateEvidenceUnits({ profile, branch });
    const recalls = recallEvidenceCandidates({ graph, evidenceUnits });
    const matrix = evaluateRequirementEvidence({ profile, graph, evidenceUnits, recalls, now: NOW });
    const coverage = buildJobCoverageReport({ graph, matrix });
    const plan = createResumeOptimizationPlan({ profile, branch, jobId: "job-gap", graph, evidenceUnits, matrix, coverage, now: NOW });
    expect(coverage.blockingGaps.length).toBe(2);
    expect(plan.factGaps.length).toBe(2);
    expect(plan.actions.filter((action) => action.type === "add_follow_up_question")).toHaveLength(2);
    expect(JSON.stringify(plan)).not.toContain("拥有三年经验");
  });

  it("meets the four-case grounding benchmark and records a V1/V2 comparison", () => {
    const { profile, branch } = fixture();
    const comparison = jobOptimizationV2GoldenCases.map((golden) => {
      const graph = analyzeJobDescriptionV2({ rawText: golden.rawJd, now: NOW });
      const evidenceUnits = buildCandidateEvidenceUnits({ profile, branch });
      const recalls = recallEvidenceCandidates({ graph, evidenceUnits });
      const matrix = evaluateRequirementEvidence({ profile, graph, evidenceUnits, recalls, now: NOW });
      const coverage = buildJobCoverageReport({ graph, matrix });
      const plan = createResumeOptimizationPlan({ profile, branch, jobId: golden.id, graph, evidenceUnits, matrix, coverage, now: NOW });
      const serialized = JSON.stringify(plan.actions.filter((action) => action.type !== "add_follow_up_question").map((action) => action.proposedIntent));
      expect(graph.nodes.every((node) => node.sourceSpans.length > 0)).toBe(true); // requirementSourceSpanCoverage = 1
      expect(golden.expectedRequirements.every((text) => graph.nodes.some((node) => node.statement.includes(text)))).toBe(true);
      expect(golden.expectedHardGaps.every((text) => coverage.blockingGaps.some((gap) => gap.includes(text)))).toBe(true); // hardConstraintRecall = 1
      expect(matrix.evaluations.flatMap((item) => item.evidenceUnitIds).every((id) => evidenceUnits.some((unit) => unit.id === id))).toBe(true); // invalidEvidenceRefCount = 0
      expect(golden.forbiddenSuggestions.every((text) => !serialized.includes(text))).toBe(true); // hallucinatedFactCount = 0
      expect(coverage.uncoveredRequirementIds.every((id) => plan.factGaps.some((gap) => gap.requirementId === id))).toBe(true); // factGapHiddenCount = 0
      return {
        caseId: golden.id,
        v1RequirementCount: golden.rawJd.split(/[。；;\n]/).map((part) => part.trim()).filter(Boolean).slice(0, 8).length,
        v2RequirementCount: graph.nodes.length,
        v1KeywordMatches: 0,
        v2EvidenceMatches: matrix.evaluations.filter((item) => item.evidenceUnitIds.length > 0).length,
        uncoveredRequirements: coverage.uncoveredRequirementIds.length,
        unsupportedStrongMatches: matrix.evaluations.filter((item) => item.matchLevel === "direct" && item.evidenceUnitIds.length === 0).length,
        generatedPlanActions: plan.actions.length
      };
    });
    expect(comparison).toHaveLength(4);
    expect(comparison.every((item) => item.unsupportedStrongMatches === 0)).toBe(true);
  });
});

function fixture(): { profile: CareerProfile; branch: ResumeBranch } {
  const fact = (id: string, statement: string, category: "experience" | "skill") => ({ id, statement, category, confirmedByUser: true, riskLevel: "low" as const, provenance: [{ sourceType: "user_input" as const, sourceId: `source-${id}`, sourceText: statement, confidence: 1, confirmedByUser: true, riskLevel: "low" as const, createdAt: NOW }], createdAt: NOW, updatedAt: NOW });
  const reactFact = fact("fact-react", "使用 React、Next.js 和 TypeScript 开发前端项目。", "experience");
  const qualityFact = fact("fact-quality", "审核 AI 输出、核对事实并分析结果可信度。", "experience");
  const pythonFact = fact("fact-python", "在项目中使用 Python 处理数据。", "skill");
  const profile = {
    id: "profile-v2", name: "测试用户", basics: { name: "测试用户", links: [] }, preference: { targetRoles: [], targetCities: [], industries: [] }, version: 1,
    experiences: [{ id: "exp-react", type: "project", organization: "CareerAdapt", role: "前端开发", facts: [reactFact, qualityFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: NOW, updatedAt: NOW }],
    skills: [{ id: "skill-python", name: "Python", fact: pythonFact, evidenceIds: [], createdAt: NOW, updatedAt: NOW }], certificates: [], evidences: [], unclassifiedBlocks: [], createdAt: NOW, updatedAt: NOW
  } as CareerProfile;
  const structured: ResumeContentItemV2[] = [
    { id: "item-project", schemaVersion: "resume-content-item-v2", data: { id: "item-project", sectionType: "project", title: "CareerAdapt AI", role: "前端开发", current: false, tools: ["React", "Next.js", "TypeScript"], highlights: ["使用 React、Next.js 和 TypeScript 开发可追溯简历工作台。", "审核 AI 输出、核对事实并分析结果可信度。"], outcomes: [], customFields: [] }, factRefs: [{ type: "experience_fact", experienceId: "exp-react", factId: "fact-react" }, { type: "experience_fact", experienceId: "exp-react", factId: "fact-quality" }], source: "user_manual", order: 0, visible: true, guardMode: "rule_verified", guardStatus: "pass", guardFindings: [], sourceBlockIds: ["block-project"], sourceRanges: [], mappingTrace: [], legacyTextProjection: "React project", userConfirmation: { scope: "resume_only", confirmedTextHash: "confirmed-project", confirmedAt: NOW } },
    { id: "item-python", schemaVersion: "resume-content-item-v2", data: { id: "item-python", sectionType: "skills", name: "Python", customFields: [] }, factRefs: [{ type: "skill_fact", skillId: "skill-python", factId: "fact-python" }], source: "user_manual", order: 1, visible: true, guardMode: "rule_verified", guardStatus: "pass", guardFindings: [], sourceBlockIds: ["block-python"], sourceRanges: [], mappingTrace: [], legacyTextProjection: "Python", userConfirmation: { scope: "resume_only", confirmedTextHash: "confirmed-python", confirmedAt: NOW } }
  ];
  const contentItems = structured.map((item) => ({ id: item.id, itemType: item.data.sectionType === "skills" ? "skill" as const : "experience" as const, source: item.source, sourceSectionId: item.data.sectionType, text: item.legacyTextProjection!, originalText: item.legacyTextProjection!, order: item.order, visible: item.visible, requirementIds: [], sourceSuggestionIds: [], factRefs: item.factRefs, guardMode: item.guardMode, guardStatus: item.guardStatus, guardRiskLevel: "low" as const, guardFindings: [], userConfirmation: item.userConfirmation }));
  const branch = { id: "branch-v2", schemaVersion: "resume-branch-v2", branchPurpose: "general", profileId: profile.id, name: "通用简历", sourceProfileVersion: 1, sourceProfileSnapshotId: "snapshot-v2", sourceDraftRevision: 0, matcherVersion: "matcher-v2", sourceMatchSetHash: "hash-v2-123", requirementMatchIds: [], revision: 2, currentRevisionId: "revision-v2", lifecycleStatus: "active", migrationStatus: "verified", syncStatusCache: { status: "in_sync", sourceProfileVersion: 1, currentProfileVersion: 1, invalidFactRefs: [], checkedAt: NOW, message: "in sync" }, contentItems, structuredContentItems: structured, createdAt: NOW, updatedAt: NOW } as ResumeBranch;
  return { profile, branch };
}
