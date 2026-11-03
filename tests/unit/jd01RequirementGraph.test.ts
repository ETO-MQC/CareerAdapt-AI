import { describe, expect, it } from "vitest";
import { analyzeJobDescriptionV4, buildProvisionalJdSemanticLedger, projectJobGraphV4ToAnalyzerOutput } from "@/domain/jobOptimization";
import { semanticAnalysis, semanticRaw } from "../fixtures/jd01";
import { recallCandidatesForRequirement } from "@/domain/match/matcher";
import { demoCareerProfile } from "@/data/demoProfile";

describe("JD-01 normalized requirements", () => {
  it("splits independent long-paragraph predicates with exact paragraph provenance", () => {
    const rawText = "任职要求\n必须具备本科及以上学历；熟悉 Java 或 Python。负责接口开发。";
    const { graph } = analyzeJobDescriptionV4({ rawText });
    expect(graph.requirements).toHaveLength(3);
    for (const node of graph.requirements) expect(rawText.slice(node.sourceSpan.start, node.sourceSpan.end)).toBe(node.statement);
    expect(new Set(graph.semanticUnits.filter((unit) => unit.originUnitId).map((unit) => unit.originUnitId)).size).toBe(1);
  });
  it("does not mechanically split explanations, alternatives or shared conditions", () => {
    const { graph } = analyzeJobDescriptionV4({ rawText: "任职要求\n如果没有学历，必须具备经验；否则提供作品。\n熟悉 Java 和 Spring Boot" });
    expect(graph.requirements).toHaveLength(2);
    expect(graph.requirements[1].keywordLogic).toEqual({ relation: "all_of", terms: ["Spring Boot", "Java"] });
  });
  it("retains mixed columns and unknown headings while excluding benefits and company", () => {
    const rawText = "你将承担的职责：\n负责接口开发\n我们期待的条件：\n必须具备本科及以上学历\n特别关注：\n熟悉 JavaScript\n额外加分：\n熟悉 Python\n我们的福利：\n必须享受带薪年假\n公司介绍\n必须介绍公司历史";
    const { graph } = analyzeJobDescriptionV4({ rawText });
    expect(graph.requirements).toHaveLength(4);
    expect(graph.requirements.find((node) => node.statement.includes("本科"))?.priority).toBe("must");
    expect(graph.requirements.find((node) => node.statement.includes("Python"))?.priority).toBe("nice_to_have");
    expect(graph.semanticUnits.find((unit) => unit.text === "特别关注：")?.final?.disposition).toBe("heading");
    expect(graph.requirements.some((node) => /年假|公司历史/.test(node.statement))).toBe(false);
  });
  it("recognizes unheaded preferred and mandatory requirements independently", () => {
    const { graph } = analyzeJobDescriptionV4({ rawText: "必须具备本科及以上学历。\n熟悉 Python 优先。\n负责接口开发。" });
    expect(graph.requirements.map((node) => node.priority)).toEqual(["must", "nice_to_have", "high"]);
  });
  it("preserves OR and AND without splitting them into mandatory sibling requirements", () => {
    const { graph } = analyzeJobDescriptionV4({ rawText: "任职要求\n熟悉 Java 或 Python\n掌握 Java 和 Spring Boot\n熟悉 JavaScript" });
    expect(graph.requirements[0].keywordLogic).toEqual({ relation: "any_of", terms: ["Python", "Java"] });
    expect(graph.requirements[1].keywordLogic?.relation).toBe("all_of");
    expect(graph.requirements[2].exactKeywords).toEqual(["JavaScript"]);
  });
  it("preserves existing any_of groups and mandatory/preferred distinction", () => {
    const { graph } = analyzeJobDescriptionV4({ rawText: "任职要求\n满足以下任一条件即可：\n熟悉 Java\n熟悉 Python\n加分项\n熟悉 SQL" });
    expect(graph.groups[0].relation).toBe("any_of");
    expect(graph.groups[0].requirementIds).toHaveLength(2);
    expect(graph.requirements.at(-1)?.hardConstraint).toBe(false);
  });
  it("preserves explicit all_of and does not split a compound any_of alternative", () => {
    const all = analyzeJobDescriptionV4({ rawText: "任职要求\n同时满足以下条件：\n熟悉 Java\n熟悉 Python" }).graph;
    expect(all.groups[0].relation).toBe("all_of");
    expect(all.groups[0].requirementIds).toHaveLength(2);
    const any = analyzeJobDescriptionV4({ rawText: "任职要求\n满足以下任一条件即可：\n熟悉 Java。具备本科及以上学历。\n熟悉 Python" }).graph;
    expect(any.groups[0].requirementIds).toHaveLength(2);
    expect(any.requirements[0].statement).toBe("熟悉 Java。具备本科及以上学历。");
  });
  it("carries schema-validated AI segments through compilation and canonical projection", () => {
    const { graph } = semanticAnalysis();
    const output = projectJobGraphV4ToAnalyzerOutput({ graph, title: "合成岗位", company: "合成公司" });
    expect(graph.requirements).toHaveLength(2);
    expect(output.requirements.map((node) => node.id)).toEqual(graph.requirements.map((node) => node.id));
    expect(output.requirements.every((node) => node.needsConfirmation && !node.confirmedByUser)).toBe(true);
    expect(graph.requirements[0].exactKeywords).toEqual(["接口"]);
    expect(graph.requirements[0].semanticAliases).toEqual(["API design"]);
    expect(graph.semanticUnits.filter((unit) => unit.originSpan?.text.includes("故障"))).toHaveLength(2);
  });
  it.each([
    [{ start: 0, end: 2 }, { start: 8, end: 12 }],
    [{ start: 0, end: 9 }, { start: 8, end: 14 }],
    [{ start: 0, end: 8 }, { start: 8, end: 999 }]
  ])("rejects missing, overlapping and out-of-range source segments", (...segments) => {
    const units = buildProvisionalJdSemanticLedger(semanticRaw);
    const { graph } = analyzeJobDescriptionV4({ rawText: semanticRaw, aiAssignments: units.map((unit) => unit.text.includes("，") ? { sourceUnitId: unit.id, verdict: "override", segments } : { sourceUnitId: unit.id, verdict: "accept" }) });
    expect(graph.requirements).toHaveLength(1);
    expect(graph.issues.some((item) => item.code === "source_inconsistency")).toBe(true);
  });
  it("rejects AI splitting an alternative into mandatory sibling requirements", () => {
    const rawText = "任职要求\n熟悉 Java 或 Python";
    const units = buildProvisionalJdSemanticLedger(rawText);
    const { graph } = analyzeJobDescriptionV4({ rawText, aiAssignments: units.map((unit) => unit.text.includes("Java") ? { sourceUnitId: unit.id, verdict: "override", segments: [{ start: 0, end: 8 }, { start: 8, end: unit.text.length }] } : { sourceUnitId: unit.id, verdict: "accept" }) });
    expect(graph.requirements).toHaveLength(1);
    expect(graph.requirements[0].keywordLogic?.relation).toBe("any_of");
    expect(graph.issues.some((item) => item.code === "source_inconsistency")).toBe(true);
  });
  it("permits semantic column classification while retaining unknown heading source", () => {
    const rawText = "理想伙伴：\n熟悉 Python\n我们是一家软件公司\n提供五险一金";
    const units = buildProvisionalJdSemanticLedger(rawText);
    const { graph } = analyzeJobDescriptionV4({ rawText, aiAssignments: units.map((unit) => unit.text === "理想伙伴：" ? { sourceUnitId: unit.id, verdict: "override", disposition: "heading", section: "required" } : { sourceUnitId: unit.id, verdict: "accept" }) });
    expect(graph.requirements).toHaveLength(1);
    expect(graph.semanticUnits[0].text).toBe("理想伙伴：");
    expect(graph.semanticUnits[0].final?.section).toBe("required");
    expect(graph.requirements[0].statement).toBe("熟悉 Python");
  });
  it("keeps stable identities and hashes across repeated AI analysis", () => {
    const first = semanticAnalysis().graph;
    const second = semanticAnalysis().graph;
    expect(second).toEqual(first);
    expect(new Set(first.requirements.map((node) => node.id)).size).toBe(2);
  });
  it("does not recall JavaScript evidence for Java", () => {
    const profile = structuredClone(demoCareerProfile);
    profile.skills = []; profile.certificates = []; profile.evidences = [];
    profile.experiences = [{ ...profile.experiences[0], role: "前端", organization: "合成团队", facts: [{ ...profile.experiences[0].facts[0], statement: "使用 JavaScript 开发", provenance: [{ ...profile.experiences[0].facts[0].provenance[0], sourceText: "使用 JavaScript 开发", confirmedByUser: true }], confirmedByUser: true }] }];
    const requirement = projectJobGraphV4ToAnalyzerOutput({ graph: analyzeJobDescriptionV4({ rawText: "任职要求\n熟悉 Java" }).graph, title: "合成", company: "合成" }).requirements[0];
    expect(recallCandidatesForRequirement(profile, { ...requirement, sourceSpan: requirement.sourceSpan!, confidence: 0.9 })).toHaveLength(0);
  });
});
