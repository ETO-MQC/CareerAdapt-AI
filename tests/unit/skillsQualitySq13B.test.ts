import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CandidateEvidenceUnitSchema, CareerProfileSchema, JobDescriptionSchema } from "@/domain/schemas";
import { analyzeJobDescriptionV2, evaluateRequirementEvidence } from "@/domain/jobOptimization";
import { classifyKeywordRelation, containsKeywordTerm } from "@/domain/jobOptimization/keywordTaxonomy";
import { preservesOwnership, ownershipStrength, dedupeCareerWriting } from "@/domain/profileIntake/CareerWritingQuality";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { compileResumeComposition, buildResumeEvidenceGraph, planResumeBlueprint } from "@/domain/resumeComposition";
import { classifyJobKeywords } from "@/domain/resumeComposition/ResumeBlueprint";
import { reviewResumeComposition } from "@/domain/resumeComposition/ResumeReviewer";
import { createLexicalJdUnits } from "@/domain/jobOptimization/v4/analyze";

const TIME = "2026-11-03T00:00:00.000Z";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const guard = (originalText: string, checkedText: string) => runRuleFactGuard({ originalText, checkedText, usedEvidenceRefs: [], now: TIME });
function profile(lines: string[], tools: string[][] = []) {
  return CareerProfileSchema.parse({ id: "sq13b-profile", name: "合成候选人", basics: { name: "合成候选人" }, preference: {}, version: 1, createdAt: TIME, updatedAt: TIME,
    experiences: lines.map((statement, index) => ({ id: `asset-${index}`, type: "project", organization: `课程项目${index}`, role: "成员", facts: [{
      id: `fact-${index}`, statement, category: "experience", confirmedByUser: true, riskLevel: "low", createdAt: TIME, updatedAt: TIME,
      provenance: [{ sourceType: "user_input", sourceId: `asset-${index}`, sourceTurnId: `turn-${index}`, sourceText: statement, sourceQuote: statement, confirmedByUser: true, confidence: 1, riskLevel: "low", createdAt: TIME }]
    }], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: TIME, updatedAt: TIME })),
    skills: [], certificates: [], evidences: [], unclassifiedBlocks: [],
    structuredFacts: lines.map((line, index) => ({ data: { id: `asset-${index}`, sectionType: "project", title: `课程项目${index}`, role: "成员", tools: tools[index] ?? [], highlights: [line], outcomes: [], current: false, customFields: [] }, factIds: [`fact-${index}`], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }))
  });
}
function job(keywords: string[]) {
  return JobDescriptionSchema.parse({ id: "sq13b-job", title: "实习生", company: "合成公司", rawText: keywords.join("；"), source: "manual", createdAt: TIME, updatedAt: TIME,
    requirements: keywords.map((keyword, index) => ({ id: `req-${index}`, description: keyword, sourceSpan: { start: 0, end: keyword.length, text: keyword }, keywords: [keyword], category: "required_skill", priority: "high", hardConstraint: false, confidence: 1, createdAt: TIME, updatedAt: TIME })) });
}

describe("SQ1.3-B v1 deterministic contracts (real model UNVERIFIED_REAL_MODEL_REQUIRED)", () => {
  it("A1 exact confirmed Python mapping", () => {
    const p = profile(["负责使用Python清洗课程CSV数据，逐项核对空值并交付清洗脚本。"], [["Python"]]);
    const graph = buildResumeEvidenceGraph({ profile: p });
    expect(classifyJobKeywords(job(["Python"]), graph, new Map((p.structuredFacts ?? []).map((entry) => [entry.data.id, entry.data])))[0].status).toBe("SUPPORTED");
  });
  it("A2 taxonomy bilingual synonym without promoting unrelated aliases", () => {
    expect(classifyKeywordRelation("Prompt Engineering", "参与提示词工程，调整客服问答提示模板")).toBe("synonym");
    expect(classifyKeywordRelation("TypeScript", "使用JavaScript")).toBe("unknown");
    const p = profile(["参与提示词工程，调整客服问答提示模板，并逐条核对资料引用。"]);
    expect(classifyJobKeywords(job(["Prompt Engineering"]), buildResumeEvidenceGraph({ profile: p }), new Map((p.structuredFacts ?? []).map((entry) => [entry.data.id, entry.data])))[0].status).toBe("SUPPORTED");
  });
  it("A3 false equivalence, adjacency, uncertainty, denial and ambiguity", () => {
    expect(containsKeywordTerm("JavaScript React MySQL", "Java")).toBe(false);
    expect(containsKeywordTerm("React", "R")).toBe(false);
    expect(containsKeywordTerm("MySQL", "SQL")).toBe(false);
    expect(classifyKeywordRelation("PostgreSQL", "使用SQLite保存本地记录")).toBe("adjacent");
    expect(classifyKeywordRelation("MySQL", "使用SQL")).toBe("adjacent");
    expect(classifyKeywordRelation("frontend", "参与React组件开发")).toBe("transferable");
    expect(classifyKeywordRelation("Java", "尚未确认Java经验")).toBe("unknown");
    expect(classifyKeywordRelation("Java", "没有Java经验")).toBe("negative");
    expect(classifyKeywordRelation("Java", "使用Python")).toBe("unknown");
    expect(classifyKeywordRelation("平台开发", "课程页面")).toBe("ambiguous");
  });
  it("B1 separates team leader from personal assistance", () => {
    const source = "团队负责人主导发布；我协助接口测试，复核缺陷修复结果。";
    expect(preservesOwnership(source, "协助接口测试")).toBe(true);
    expect(preservesOwnership(source, "主导发布")).toBe(false);
    expect(guard(source, "主导发布").status).toBe("blocked_high_risk");
  });
  it("A3/D3 V2 cannot promote recalled aliases or familiar skills to direct", () => {
    const p = profile(["使用JavaScript开发课程页面"]);
    const graph = analyzeJobDescriptionV2({ rawText: "任职要求\n熟悉Java", now: TIME });
    const requirement = graph.nodes[0];
    requirement.exactKeywords = ["Java"];
    requirement.kind = "tool_or_technology";
    const unit = CandidateEvidenceUnitSchema.parse({ id: "evu-sq13b", itemId: "asset-0", sourceType: "skill", sectionType: "project", fieldPath: "tools.0", text: "JavaScript", normalizedText: "javascript", factRefs: [{ type: "experience_fact", experienceId: "asset-0", factId: "fact-0" }], sourceBlockIds: [], supportLevel: "verified", confirmed: true, maturity: "demonstrated" });
    const recalls = [{ requirementId: requirement.id, candidates: [{ evidenceUnitId: unit.id, score: 0.99, reasons: ["语义别名：JavaScript"] }] }];
    const input = { profile: p, graph, evidenceUnits: [unit], recalls, now: TIME };
    expect(evaluateRequirementEvidence(input).evaluations[0].matchLevel).not.toBe("direct");
    const aiOutput = [{ requirementId: requirement.id, matchLevel: "direct", evidenceUnitIds: [unit.id], evidenceRefs: [], coveredAspects: ["Java"], missingAspects: [], risks: [], explanation: "claim", confidence: 1 }];
    expect(() => evaluateRequirementEvidence({ ...input, aiOutput })).toThrow("evidence_matcher_v2_unsupported_direct_claim");
    unit.text = "Java";
    unit.normalizedText = "java";
    unit.maturity = "familiar";
    expect(evaluateRequirementEvidence(input).evaluations[0].matchLevel).not.toBe("direct");
    expect(() => evaluateRequirementEvidence({ ...input, aiOutput })).toThrow("evidence_matcher_v2_unsupported_direct_claim");
  });
  it("B2 binds ownership to the task instead of the paragraph maximum", () => {
    expect(preservesOwnership("负责海报排版；参与缓存方案讨论", "负责缓存方案讨论")).toBe(false);
    expect(preservesOwnership("项目采用缓存方案；我参加方案讨论，并整理讨论记录。", "主导缓存架构设计")).toBe(false);
  });
  it("B3 longest phrases retain shared, primary, independent and leading responsibility", () => {
    const phrases = ["协助", "参与", "共同完成", "共同负责", "主要负责", "负责", "独立完成", "主导"];
    for (const phrase of phrases) expect(preservesOwnership(`${phrase}接口测试`, `${phrase}接口测试`)).toBe(true);
    expect(ownershipStrength("共同负责接口测试")).toBe(2);
    expect(ownershipStrength("主要负责接口测试")).toBeGreaterThan(ownershipStrength("负责接口测试"));
    for (const [source, candidate] of [["共同负责", "负责"], ["负责", "主导"], ["协助", "独立完成"]]) expect(guard(`${source}接口测试`, `${candidate}接口测试`).status).toBe("blocked_high_risk");
  });
  it("C1 qualitative outcomes need no numeric decoration", () => {
    const text = "负责整理实验操作说明，按老师反馈修正文档，最终被课程小组用作交接材料。";
    expect(guard(text, text).status).toBe("pass");
  });
  it.each(["80ms", "2s", "2 seconds", "QPS1000", "TPS200", "99%", "￥300", "收入200元", "10个用户", "3个月", "效率提升30%"])("C2 rejects unsupported metric %s", (metric) => {
    expect(guard("负责接口测试", `负责接口测试，${metric}`).status).toBe("blocked_high_risk");
    const text = `负责接口测试，${metric}`;
    expect(guard(text, text).status).toBe("pass");
  });
  it("C2 rejects a metric borrowed from a different task", () => {
    expect(guard("负责接口测试；负责渲染测试，延迟80ms", "负责接口测试，延迟80ms").status).toBe("blocked_high_risk");
  });
  it("C2 metric token equality and comma-separated task objects", () => {
    expect(guard("负责接口测试，延迟180ms", "负责接口测试，延迟80ms").status).toBe("blocked_high_risk");
    expect(guard("负责接口测试，延迟80ms", "负责接口测试，延迟80s").status).toBe("blocked_high_risk");
    expect(guard("负责渲染测试，延迟80ms，负责接口测试，延迟100ms", "负责接口测试，延迟80ms").status).toBe("blocked_high_risk");
  });
  it("C2 reviewer compares generated claims against original confirmed evidence", () => {
    const p = profile(["负责接口回归测试，记录失败请求并复核修复。"]);
    const result = compileResumeComposition({ profile: p, mode: "general" });
    const item = result.items.find((entry) => entry.sourceAssetId === "asset-0")!;
    if (item.data.sectionType !== "project") throw new Error("fixture");
    item.data.highlights = ["负责接口回归测试，延迟80ms"];
    for (const claim of result.claims.filter((entry) => item.claimIds.includes(entry.id))) claim.text = item.data.highlights[0];
    const reviewed = reviewResumeComposition(result);
    expect(reviewed.reviewResult.diffs.some((diff) => diff.itemId === "asset-0" && diff.kind === "verify")).toBe(true);
    expect(reviewed.reviewResult.status).toBe("NEEDS_REVIEW");
  });
  it("C3 preserves non-target strong asset hash and input profiles/revisions", () => {
    const p = profile(["参与使用React封装表单组件，通过Vitest检查必填字段校验。", "负责使用Python清洗课程CSV数据，核对空值并交付脚本。"], [["React", "Vitest"], ["Python"]]);
    const result = compileResumeComposition({ profile: p, mode: "general" });
    const other = result.items.find((entry) => entry.sourceAssetId === "asset-1")!;
    const sentinels = { profile: p, general: structuredClone(result), otherJobRevision: structuredClone(result), unselectedField: other.data };
    const before = hash(sentinels);
    const target = result.items.find((entry) => entry.sourceAssetId === "asset-0")!;
    if (target.data.sectionType !== "project") throw new Error("fixture");
    target.data.highlights = ["来源事实：内部草稿", "参与React表单组件封装，使用Vitest验证必填字段校验。"];
    const reviewed = reviewResumeComposition(result, { targetAssetIds: ["asset-0"] });
    expect(reviewed.items.find((entry) => entry.sourceAssetId === "asset-0")!.data).not.toEqual(target.data);
    expect(hash(reviewed.items.find((entry) => entry.sourceAssetId === "asset-1")!.data)).toBe(hash(other.data));
    expect(hash(sentinels)).toBe(before);
    expect(JSON.stringify(reviewed.items.find((entry) => entry.sourceAssetId === "asset-0")!.data)).not.toContain("Python");
  });
  it("D1 does not turn transferable R evidence into Python experience", () => {
    const p = profile(["参与使用R清洗课程数据，向老师汇报异常记录。", "负责校园海报排版并交付活动组。"], [["R"], []]);
    const graph = buildResumeEvidenceGraph({ profile: p });
    const bp = planResumeBlueprint({ profile: p, graph, mode: "job_specific", job: job(["Python"]) });
    expect(bp.keywordCoverage.find((entry) => entry.keyword === "Python")?.status).toBe("UNSUPPORTED");
  });
  it("D2 removes repeated cache wording but keeps invalidation verification", () => {
    const input = ["参与使用Redis缓存课程查询结果。", "参与使用Redis缓存课程查询结果。", "协助复核缓存失效后的接口返回。"];
    expect(dedupeCareerWriting(input)).toEqual([input[0], input[2]]);
  });
  it("D3 preserves unique recovery evidence and labels page count as estimate", () => {
    const p = profile(["参与制定课程服务恢复步骤，在演练中记录恢复过程并复核检查清单。", "参与旧活动签到表整理。"]);
    const result = compileResumeComposition({ profile: p, mode: "general" });
    expect(result.blueprint.assets.some((entry) => entry.sourceAssetId === "asset-0")).toBe(true);
    p.experiences[0].facts[0].maturity = "familiar";
    const familiar = buildResumeEvidenceGraph({ profile: p });
    expect(familiar.nodes.some((node) => node.sourceAssetIds.includes("asset-0") && node.maturity === "demonstrated")).toBe(false);
    expect(result.telemetry?.pageCountSource).toBe("blueprint_estimate");
  });
  it("next-round JD finding: paragraph remains a single lexical unit", () => {
    expect(createLexicalJdUnits("熟悉Java。能够编写SQL；具备接口测试经验。")).toHaveLength(1);
  });
});
