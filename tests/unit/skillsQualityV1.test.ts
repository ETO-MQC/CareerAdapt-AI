import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import cases from "../fixtures/skills-quality-eval-v1.json";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { FactStatementSchema, type FactMaturity } from "@/domain/schemas";
import { buildResumeEvidenceGraph, compileResumeComposition, normalizeSkillGroups } from "@/domain/resumeComposition";
import { diagnoseResumeQuality } from "@/domain/resumeComposition/qualityDiagnostics";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { resolveTailoringClaimPolicy } from "@/domain/jobOptimization/tailoringClaimPolicy";

const now = "2026-10-30T00:00:00.000Z";
function skillProfile(maturity: FactMaturity, confirmed = true) {
  const profile = migrateCareerProfileToV2(structuredClone(demoCareerProfile));
  const statement = maturity === "learning" ? "正在学习 Python" : maturity === "familiar" ? "基础接触 Python" : "Python 基础查询任务可以独立完成";
  const fact = FactStatementSchema.parse({ id: "sq1-python-fact", statement, category: "skill", maturity,
    provenance: [{ sourceType: "user_input", sourceId: "sq1-turn", sourceTurnId: "sq1-turn", sourceText: statement,
      sourceQuote: statement, confidence: 1, confirmedByUser: confirmed, riskLevel: "low", createdAt: now }],
    confirmedByUser: confirmed, riskLevel: "low", createdAt: now, updatedAt: now });
  profile.skills = [{ id: "sq1-python", name: "Python", fact, evidenceIds: [], createdAt: now, updatedAt: now }];
  profile.structuredFacts = profile.structuredFacts.filter(entry => entry.data.sectionType !== "skills");
  return profile;
}

describe("SQ1 executable contracts (not model-quality grades)", () => {
  it("retains 30 anonymous cases in six balanced groups, including fixed multi-turn answers", () => {
    expect(cases.anonymous).toBe(true);
    expect(cases.cases).toHaveLength(30);
    expect(new Set(cases.cases.map(row => row.id)).size).toBe(30);
    for (const category of new Set(cases.cases.map(row => row.category))) expect(cases.cases.filter(row => row.category === category)).toHaveLength(5);
    expect(cases.cases.find(row => row.id === "guided_clarification-01")?.followUpTurns).toHaveLength(1);
    expect(cases.cases.find(row => row.id === "guided_clarification-02")?.followUpTurns).toEqual(["没有用过。"]);
  });

  it("runs identical cases against pinned before/after skills without turning mock output into quality scores", () => {
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { loadEvaluation, runRealEvaluation } from './scripts/skills-quality-eval.mjs';
      const evaluation = loadEvaluation();
      const requests = [];
      const results = await runRealEvaluation(evaluation, {baseUrl:'https://synthetic.invalid/v1',apiKey:'synthetic-key',model:'simulated'}, async (url, request) => {
        requests.push(JSON.parse(request.body));
        return {ok:true,json:async()=>({choices:[{message:{content:'模拟回复，不作质量证明'}}]})};
      });
      console.log(JSON.stringify({count:results.length, requests:requests.length,
        pending:results.every(row=>row.reviewStatus==='PENDING_HUMAN_REVIEW' && Object.values(row.metrics).every(value=>value===null)),
        arms:results.map(row=>[row.caseId,row.arm,row.skillSHA256]),
        prompts:requests.filter(row=>row.messages.length===2).map(row=>row.messages[1].content)}));
    `], { cwd: process.cwd(), encoding: "utf8" });
    const report = JSON.parse(result) as { count: number; requests: number; pending: boolean; arms: string[][]; prompts: string[] };
    expect(report.count).toBe(60);
    expect(report.requests).toBe(64);
    expect(report.pending).toBe(true);
    for (let index = 0; index < report.arms.length; index += 2) {
      expect(report.arms[index][0]).toBe(report.arms[index + 1][0]);
      expect(report.arms[index][1]).toBe("before");
      expect(report.arms[index + 1][1]).toBe("after");
      expect(report.arms[index][2]).not.toBe(report.arms[index + 1][2]);
      expect(report.prompts[index]).toBe(report.prompts[index + 1]);
    }
  });

  it.each(["confirmed_capability", "familiar", "learning"] as const)("keeps confirmed %s capability without a project or uploaded proof", maturity => {
    const profile = skillProfile(maturity);
    const before = structuredClone(profile);
    const graph = buildResumeEvidenceGraph({ profile });
    const skill = graph.skillMatrix.find(row => row.name === "Python")!;
    expect(skill).toMatchObject({ maturity, factIds: ["sq1-python-fact"] });
    const groups = Object.values(normalizeSkillGroups([skill])).flat().join(" ");
    if (maturity === "familiar") expect(groups).toContain("Python（基础接触）");
    if (maturity === "learning") expect(groups).toContain("Python（正在学习）");
    const composition = compileResumeComposition({ profile, mode: "general" });
    const claim = composition.claims.find(row => row.id === "claim:skill:Python")!;
    expect(claim).toMatchObject({ classification: "SUPPORTED", guardStatus: "pass", sourceTurnIds: ["sq1-turn"] });
    expect(composition.items.some(item => item.claimIds.includes(claim.id))).toBe(true);
    expect(profile).toEqual(before);
  });

  it("withholds unconfirmed exploratory skills from both evidence and emitted resume claims", () => {
    const profile = skillProfile("familiar", false);
    expect(buildResumeEvidenceGraph({ profile }).skillMatrix.some(row => row.factIds.includes("sq1-python-fact"))).toBe(false);
    expect(compileResumeComposition({ profile, mode: "general" }).claims.some(row => row.factIds.includes("sq1-python-fact"))).toBe(false);
  });

  it("keeps bounded maturity on canonical skill items as well as derived groups", () => {
    const profile = skillProfile("learning");
    profile.structuredFacts.push({ data: {
      id: "sq1-python", sectionType: "skills", name: "Python", customFields: []
    }, factIds: ["sq1-python-fact"], sourceBlockIds: [], sourceRanges: [], mappingTrace: [], sourceExcerpt: "正在学习 Python" });
    const result = compileResumeComposition({ profile, mode: "job_specific" });
    expect(result.items.find(item => item.sourceAssetId === "sq1-python")?.data).toMatchObject({ name: "Python（正在学习）" });
  });

  it.each([
    ["参与数据清洗", "主导数据清洗并提升45%"],
    ["协助完成报告", "独立完成报告"],
    ["基础接触 Python", "精通 Python"]
  ])("retains confirmation/ownership guard for %s → %s", (originalText, checkedText) => {
    const guardResult = runRuleFactGuard({ originalText, checkedText, usedEvidenceRefs: [] });
    const result = resolveTailoringClaimPolicy({ suggestion: { claimSupportLevel: "user_declared" }, guardResult, sectionType: "project", mode: "max_fit" });
    expect(result.decision).not.toBe("auto_applicable");
    if (checkedText.includes("45%") || checkedText.includes("独立")) expect(result.decision).toBe("blocked");
  });

  it.each(["SUPPORTED", "NEEDS_USER_CONFIRMATION", "UNSUPPORTED"] as const)("separates %s claim risk from content/HR/ATS observations", classification => {
    const result = compileResumeComposition({ profile: skillProfile("confirmed_capability"), mode: "general" });
    const claim = result.claims.find(row => row.id === "claim:skill:Python")!;
    const before = diagnoseResumeQuality(result);
    claim.classification = classification;
    const after = diagnoseResumeQuality(result);
    expect(after.claimRisk?.level).toBe(classification === "SUPPORTED" ? "low" : classification === "UNSUPPORTED" ? "high_risk" : "needs_confirmation");
    expect(after.recruiterScan).toEqual(before.recruiterScan);
    expect(after.atsStructure).toEqual(before.atsStructure);
    expect(after.atsStructure.textExtractability.status).toBe("unknown");
    expect(after.atsStructure.readingOrder.status).toBe("unknown");
  });
});
