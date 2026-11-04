import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { JobRequirementGraphV2Schema, type CandidateEvidenceUnit } from "@/domain/schemas";
import { evaluateRequirementEvidence } from "@/domain/jobOptimization/v2/evidence";
import { buildJobCoverageReport } from "@/domain/jobOptimization/v2/coverage";
function analyze(terms: string[], relation: "any_of" | "all_of", texts: string[], statement = terms.join(" "), maturity: CandidateEvidenceUnit["maturity"] = "demonstrated") {
  const graph = JobRequirementGraphV2Schema.parse({ schemaVersion: "job-requirement-graph-v2", nodes: [{ id: "req", kind: "tool_or_technology", statement, normalizedIntent: statement, priority: "must", hardConstraint: true, exactKeywords: terms, keywordLogic: { relation, terms }, semanticAliases: [], sourceSpan: { start: 0, end: statement.length, text: statement }, sourceSpans: [{ start: 0, end: statement.length, text: statement }], confidence: 1, needsConfirmation: false }], analyzedAt: demoCareerProfile.updatedAt, analyzerVersion: "test" });
  const evidenceUnits: CandidateEvidenceUnit[] = texts.map((text, i) => ({ id: `u${i}`, itemId: `i${i}`, fieldPath: "name", text, normalizedText: text.toLowerCase(), sourceType: "skill", sectionType: "skills", factRefs: [], sourceBlockIds: [], supportLevel: "user_declared", maturity, confirmed: true }));
  // Use real formal references so reference resolution remains part of the test.
  const profile = structuredClone(demoCareerProfile);
  const exp = profile.experiences.find(item => item.facts.length)!;
  exp.facts = texts.map((text, index) => ({ ...exp.facts[0], id: `condition-fact-${index}`, statement: text, maturity, provenance: exp.facts[0].provenance.map(source => ({ ...source, sourceText: text, confirmedByUser: true })) }));
  evidenceUnits.forEach((unit, index) => { unit.factRefs = [{ type: "experience_fact", experienceId: exp.id, factId: exp.facts[index].id }]; unit.supportLevel = "verified"; });
  const matrix = evaluateRequirementEvidence({ profile, graph, evidenceUnits, recalls: [{ requirementId: "req", candidates: evidenceUnits.map(unit => ({ evidenceUnitId: unit.id, score: 0.9, reasons: ["精确术语"] })) }] });
  return { graph, matrix, profile, evidenceUnits, result: matrix.evaluations[0] };
}
describe("JD02 condition sufficiency", () => {
  it("satisfies Python OR SQL with Python only", () => { const { result } = analyze(["Python", "SQL"], "any_of", ["Python"]); expect(result.matchLevel).toBe("direct"); expect(result.missingAspects).toEqual([]); });
  it("requires Spring Boot as well as Java", () => { const { result } = analyze(["Java", "Spring Boot"], "all_of", ["Java"]); expect(result.matchLevel).toBe("partial"); expect(result.missingAspects).toEqual(["Spring Boot"]); });
  it("combines two distinct experiences for all_of", () => { expect(analyze(["Java", "Spring Boot"], "all_of", ["Java", "Spring Boot"]).result.matchLevel).toBe("direct"); });
  it("does not confuse JavaScript with Java", () => { expect(analyze(["Java", "SQL"], "any_of", ["JavaScript"]).result.matchLevel).not.toBe("direct"); });
  it("does not promote adjacent TypeScript to JavaScript", () => { expect(analyze(["JavaScript", "SQL"], "any_of", ["TypeScript"]).result.matchLevel).not.toBe("direct"); });
  it.each(["至少3年 Python 或 SQL", "独立负责 Python 或 SQL", "有效证书 Python 或 SQL"])("keeps %s pending", statement => { expect(analyze(["Python", "SQL"], "any_of", ["Python"], statement).result.matchLevel).toBe("needs_confirmation"); });
  it.each(["正在学习 Python", "暂未独立使用 Python"])("does not treat %s as demonstrated", text => { expect(analyze(["Python", "SQL"], "any_of", [text]).result.matchLevel).toBe("needs_confirmation"); });
  it("keeps confirmed capability distinct from demonstrated experience", () => { expect(analyze(["Python", "SQL"], "any_of", ["Python"], undefined, "confirmed_capability").result.matchLevel).toBe("partial"); });
  it("preferred evidence gaps are not hard blockers", () => { const { graph, matrix } = analyze(["Python", "SQL"], "all_of", ["Python"]); graph.nodes[0].priority = "nice_to_have"; expect(buildJobCoverageReport({ graph, matrix }).blockingGaps).toEqual([]); });
  it.each([1, 2])("counts any_of minimumSatisfied=%i without turning unused alternatives into gaps", minimum => {
    const a = analyze(["Python", "SQL"], "any_of", ["Python"]);
    a.graph.nodes = [a.graph.nodes[0], { ...a.graph.nodes[0], id: "other" }];
    a.graph.groups = [{ id: "group", label: "alternatives", relation: "any_of", minimumSatisfied: minimum, requirementIds: ["req", "other"], sourceSpan: a.graph.nodes[0].sourceSpan }];
    a.matrix.evaluations.push({ ...a.result, requirementId: "other", matchLevel: "none", evidenceUnitIds: [], evidenceRefs: [] });
    const report = buildJobCoverageReport(a);
    expect(report.uncoveredRequirementIds.includes("other")).toBe(minimum === 2);
  });
  it("does not let a demonstrated fact upgrade a second learning fact in the same item", () => {
    const a = analyze(["Python", "SQL"], "all_of", ["Python", "SQL"]);
    a.profile.experiences[0].facts[1].maturity = "learning";
    const result = evaluateRequirementEvidence({ ...a, recalls: [{ requirementId: "req", candidates: a.evidenceUnits.map(unit => ({ evidenceUnitId: unit.id, score: 0.9, reasons: ["精确术语"] })) }] });
    expect(result.evaluations[0].matchLevel).not.toBe("direct");
  });

});
