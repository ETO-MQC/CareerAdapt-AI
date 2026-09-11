import { describe, expect, it } from "vitest";
import { compileResumeComposition } from "@/domain/resumeComposition/ResumeWriter";
import { reviewResumeComposition } from "@/domain/resumeComposition/ResumeReviewer";
import { careerResumeQualityWarnings } from "@/domain/resumeComposition/CareerResumeQualityPolicyV1";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { validateEachTailoringDiffLocally } from "@/domain/jobOptimization";
import type { ResumeBranch, ResumeTailoringDiff } from "@/domain/schemas";
import { corpusBullets, corpusProfile } from "../fixtures/p48cCorpus";

const compose = (bullets: string[], targetDirection?: string) => compileResumeComposition({ profile: corpusProfile(bullets), mode: "general", targetDirection });
const highlights = (result: ReturnType<typeof compose>) => result.items.flatMap(({ data }) => data.sectionType === "project" ? data.highlights : []);
const normalized = (value: string) => value.replace(/[。；;]+$/u, "");
const hasBullet = (result: ReturnType<typeof compose>, text: string) => highlights(result).some((value) => normalized(value) === normalized(text));

function reviewBullet(text: string) {
  const draft = compose([corpusBullets.backend]);
  const item = draft.items.find(({ data }) => data.sectionType === "project")!;
  if (item.data.sectionType === "project") item.data.highlights = [text];
  return reviewResumeComposition(draft);
}

describe("P4.8c frozen 20 production scenarios", () => {
  it("01 action + method without metric KEEP", () => {
    const result = compose([corpusBullets.backend]);
    expect(hasBullet(result, corpusBullets.backend)).toBe(true);
    expect(result.reviewResult.diffs).toEqual([]);
  });
  it("02 verified metric preserved", () => {
    const text = "参与查询接口开发，使用 Redis 缓存将实测延迟从 200ms 降至 120ms。";
    expect(hasBullet(compose([text]), text)).toBe(true);
  });
  it("03 generic claim requests rewrite without invented number", () => {
    const result = reviewBullet("优化系统，显著提升稳定性");
    expect(result.reviewResult.diffs.some((diff) => diff.kind === "rewrite" && diff.before.includes("优化系统"))).toBe(true);
    expect(highlights(result).join(" ")).not.toMatch(/\d+%/u);
  });
  it("04 participation never becomes ownership", () => {
    expect(runRuleFactGuard({ originalText: "参与检索链路开发", checkedText: "主导检索链路开发", usedEvidenceRefs: [] }).status).not.toBe("pass");
  });
  it("05 familiar and learning never become mastery", () => {
    for (const proficiency of ["familiar", "learning"] as const) {
      const branch = { id: "b", contentItems: [{ id: "p", text: "参与模型输出评估", factRefs: [] }], structuredContentItems: [{ id: "p", order: 0, visible: true, data: { id: "p", sectionType: "project", title: "评估", description: "参与模型输出评估", highlights: [] } }] } as unknown as ResumeBranch;
      const diff: ResumeTailoringDiff = { target: { sectionId: "project", itemId: "p", fieldPath: "description" }, operation: "replace", original: "参与模型输出评估", value: "熟练运用 Claude Code 完成模型输出评估", reason: "校准", requirementIds: ["req"], targetKeywords: [], evidenceRefs: [], supportLevel: "user_declared" };
      const result = validateEachTailoringDiffLocally({ branch, diffs: [diff], allowUnconfirmed: true, confirmedUserDeclarations: [{ questionId: "q", value: "Claude Code", requirementIds: ["req"], proficiency }] });
      expect(result.rejectedDiffs[0]?.reasonCode).toBe("proficiency_upgrade");
    }
  });
  it("06 absent Summary has no penalty or automatic filler", () => {
    expect(careerResumeQualityWarnings({ bullets: [corpusBullets.backend] })).toEqual([]);
    expect(compose([corpusBullets.backend]).items.some(({ data }) => data.sectionType === "summary")).toBe(false);
  });
  it("07 generic Summary under pressure is removal candidate", () => {
    const draft = compose([corpusBullets.backend]);
    draft.items.push({ sourceAssetId: "summary", data: { id: "summary", sectionType: "summary", text: "积极主动，责任心强，热爱技术。", customFields: [] }, claimIds: [], factIds: [], sourceBlockIds: [] });
    draft.blueprint.pageBudget.estimatedPageCount = 2;
    const result = reviewResumeComposition(draft);
    expect(result.reviewResult.diffs.some((diff) => diff.kind === "remove" && diff.fieldPath === "text")).toBe(true);
    expect(result.items.some(({ sourceAssetId }) => sourceAssetId === "summary")).toBe(true);
  });
  it("08 twenty-tool catalog gets redundancy warning", () => {
    const tools = "Java、Python、Redis、MySQL、React、Vue、Docker、Kubernetes、RAG、Agent、LangGraph、MCP、FastAPI、Spring、Kafka、SQL、Git、Linux、Nginx、TypeScript";
    expect(careerResumeQualityWarnings({ bullets: [tools] })).toContain("resume_quality.tech_stack_redundancy");
  });
  it("09 Skills Redis plus Project Redis proof allowed", () => {
    expect(careerResumeQualityWarnings({ bullets: ["Redis", corpusBullets.backend] })).toEqual([]);
  });
  it("10 strong original requires zero rewrite", () => {
    const result = reviewBullet(corpusBullets.infra);
    expect(result.reviewResult.diffs).toEqual([]);
    expect(hasBullet(result, corpusBullets.infra)).toBe(true);
  });
  it("11 long single causal chain is not split", () => {
    const text = "参与文档查询链路开发，针对扫描文档的段落边界与引用定位问题，使用分段解析保留标题和页码；通过混合检索与重排序定位候选段落，并将引用回传到会话页面，在离线评测集上核对原文与回答以验证召回及引用一致性。";
    expect(hasBullet(compose([text]), text)).toBe(true);
  });
  it("12 independent achievements receive split suggestion", () => {
    const result = reviewBullet("参与订单接口开发，使用 Redis 缓存查询；另外组织校园招聘活动，完成志愿者排班交付。");
    expect(result.reviewResult.diffs.some((diff) => /拆分/u.test(diff.recommendation))).toBe(true);
  });
  it("13 user precise metric without supporting source VERIFY", () => {
    const text = "参与订单接口开发，使用 Redis 将延迟降低 35%。";
    const result = reviewBullet(text);
    expect(result.reviewResult.diffs.some((diff) => diff.kind === "verify" && diff.before === text)).toBe(true);
    expect(hasBullet(result, text)).toBe(true);
  });
  it("14 generated unsupported metric BLOCK", () => {
    expect(runRuleFactGuard({ originalText: corpusBullets.backend, checkedText: `${corpusBullets.backend}性能提升 35%。`, usedEvidenceRefs: [] }).status).not.toBe("pass");
  });
  it.each([
    ["15", "AI / Agent 应用工程师", "ai"],
    ["16", "后端工程师", "backend"],
    ["17", "前端工程师", "frontend"],
    ["18", "DevOps 基础设施工程师", "infra"]
  ] as const)("%s %s evidence emphasis", (_id, target, key) => {
    const result = compose(Object.values(corpusBullets), target);
    const id = `asset-${Object.keys(corpusBullets).indexOf(key)}`;
    expect(result.blueprint.assets[0].sourceAssetId).toBe(id);
    expect(result.items.find(({ data }) => data.sectionType === "project")?.sourceAssetId).toBe(id);
  });
  it("19 JD keyword without source cannot be parroted", () => {
    const result = compose([corpusBullets.backend], "RAG Kubernetes 工程师");
    expect(highlights(result).join(" ")).not.toMatch(/Kubernetes|RAG/u);
  });
  it("20 constrained selection preserves strongest relevant evidence", () => {
    const weak = Array.from({ length: 5 }, (_, i) => `参与系统${i}开发，优化系统效果。`);
    const result = compose([...weak, corpusBullets.backend], "后端工程师");
    expect(hasBullet(result, corpusBullets.backend)).toBe(true);
    expect(result.blueprint.assets[0].sourceAssetId).toBe("asset-5");
  });
});
