import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeStructuredAi } from "@/ai/client";
import { JobDescriptionSchema } from "@/domain/schemas";
import { compileResumeComposition, compileResumeCompositionWithAi } from "@/domain/resumeComposition/ResumeWriter";
import { careerResumeQualityWarnings, resumeRolePreference } from "@/domain/resumeComposition/CareerResumeQualityPolicyV1";
import { reviewResumeComposition } from "@/domain/resumeComposition/ResumeReviewer";
import { ResumeCareerWritingTaskInputSchema } from "@/ai/tasks/registry";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { corpusBullets, corpusProfile } from "../fixtures/p48cCorpus";

vi.mock("@/ai/client", () => ({ invokeStructuredAi: vi.fn() }));
let db: CareerAdaptDb | undefined;
afterEach(async () => { db?.close(); if (db) await db.delete(); db = undefined; vi.resetAllMocks(); });

describe("P4.8c same-profile product acceptance and false-positive guards", () => {
  it("persists general, AI and backend artifacts with identical facts and factRefs", async () => {
    db = new CareerAdaptDb(`p48c-acceptance-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const profile = corpusProfile();
    await repository.saveProfile(profile);
    const before = JSON.stringify(await repository.getProfile(profile.id));
    const generalComposition = compileResumeComposition({ profile, mode: "general" });
    const general = await repository.createGeneralResumeBranch({ profileId: profile.id, operationId: "p48c-general", name: "General", includeProfileFacts: true, includeProfileBasics: true, composition: generalComposition });
    const artifacts = [{ variant: "General", composition: generalComposition, branch: general.branch }];
    for (const [id, title] of [["ai", "AI / Agent 应用工程师"], ["backend", "后端工程师"]]) {
      const job = JobDescriptionSchema.parse({ id: `p48c-${id}`, title, company: "测试机构", rawText: title, source: "manual", requirements: [{ id: `req-${id}`, category: "responsibility", description: "交付可验证的功能", priority: "high", hardConstraint: false, keywords: [], confidence: 1, sourceSpan: { start: 0, end: title.length, text: title }, createdAt: profile.createdAt, updatedAt: profile.updatedAt }], createdAt: profile.createdAt, updatedAt: profile.updatedAt });
      await repository.saveJobDescription(job);
      const composition = compileResumeComposition({ profile, mode: "job_specific", job });
      const result = await repository.createJobSpecificBranchFromProfile({ profileId: profile.id, jobId: job.id, name: title, operationId: `p48c-${id}`, selectedCanonicalItemIds: composition.blueprint.assets.map((asset) => asset.sourceAssetId), requirementMatchIds: [], composition });
      artifacts.push({ variant: id, composition, branch: result.branch });
      expect(result.branch.branchPurpose).toBe("job_specific");
    }
    const refs = (branch: typeof general.branch) => branch.contentItems.flatMap((item) => item.factRefs.map((ref) => JSON.stringify(ref))).sort();
    const sourceBullets = Object.values(corpusBullets).sort();
    if (process.env.P48C_ACCEPTANCE_REPORT === "1") writeFileSync("docs/testing/p48c-same-profile.json", JSON.stringify({ mode: "deterministic production compiler + Repository; no live model", artifacts }, null, 2));
    for (const { composition, branch } of artifacts) {
      const bullets = composition.items.flatMap(({ data }) => data.sectionType === "project" ? data.highlights : []);
      expect([...bullets].sort()).toEqual(sourceBullets);
      expect(refs(branch)).toEqual(refs(general.branch));
      expect(branch.contentItems.flatMap((item) => item.factRefs).length).toBeGreaterThanOrEqual(4);
      expect(bullets.join(" ")).not.toMatch(/\d+%|主导|独立负责/u);
    }
    expect(artifacts[1].composition.items.find(({ data }) => data.sectionType === "project")?.sourceAssetId).toBe("asset-0");
    expect(artifacts[2].composition.items.find(({ data }) => data.sectionType === "project")?.sourceAssetId).toBe("asset-1");
    expect(JSON.stringify(await repository.getProfile(profile.id))).toBe(before);
    expect((await repository.listResumeBranches()).length).toBe(3);
    if (process.env.P48C_ACCEPTANCE_REPORT === "1") writeFileSync("docs/testing/p48c-same-profile.json", JSON.stringify({ mode: "deterministic production compiler + Repository; no live model", factsUnchanged: true, factRefsUnchanged: true, artifacts }, null, 2));
  });

  it("uses the actual strict Writer input boundary and compresses catalogs without changing source", async () => {
    const profile = corpusProfile([corpusBullets.backend]);
    const tools = ["Java", "Python", "Redis", "MySQL", "React", "Vue", "Docker", "Kubernetes", "RAG", "Agent", "LangGraph", "MCP", "FastAPI", "Spring", "Kafka", "SQL", "Git", "Linux", "Nginx", "TypeScript"];
    const item = profile.structuredFacts![0].data;
    if (item.sectionType === "project") item.tools = tools;
    const fact = profile.experiences[0].facts[0];
    fact.statement += ` 工具：${tools.join("、")}`;
    fact.provenance[0].sourceText = fact.statement;
    fact.provenance[0].sourceQuote = fact.statement;
    const before = JSON.stringify(profile);
    vi.mocked(invokeStructuredAi).mockImplementationOnce(async (request) => {
      const input = ResumeCareerWritingTaskInputSchema.parse(request.businessInput);
      expect(input.instructions.join(" ")).toContain("medium");
      expect(input.instructions.join(" ")).toContain("maturity");
      return { ok: true, data: { assets: input.assets.map((asset) => ({ sourceAssetId: asset.sourceAssetId, title: asset.displayIdentity, techStack: tools, highlights: [corpusBullets.backend] })), skillGroups: [] } } as never;
    });
    const result = await compileResumeCompositionWithAi({ profile, mode: "general", targetDirection: "后端工程师" });
    const project = result.items.find(({ data }) => data.sectionType === "project")!.data;
    expect(project.sectionType === "project" ? project.tools.length : 0).toBe(8);
    expect(project.sectionType === "project" ? project.highlights : []).toEqual([corpusBullets.backend]);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it("does not penalize evidence-backed positive wording, repeated proof or a multi-page budget", () => {
    const bullets = ["通过 Redis 缓存订单查询减少数据库请求，参与接口优化并验证稳定性。", "基于双机热备实现故障恢复，参与切换演练并验证稳定性。"];
    expect(careerResumeQualityWarnings({ bullets })).toEqual([]);
    const draft = compileResumeComposition({ profile: corpusProfile(bullets), mode: "general" });
    draft.blueprint.pageBudget.targetPages = 3;
    draft.blueprint.pageBudget.estimatedPageCount = 2;
    expect(reviewResumeComposition(draft).reviewResult.diffs).toEqual([]);
  });

  it("keeps unsupported roles generic and provisional roles weak", () => {
    for (const role of ["政府行政", "finance", "legal", "medical", "academic CV", "设计师", "sales", "HR", "机械工程师", "AI 产品设计师"]) expect(resumeRolePreference(role)).toBeUndefined();
    for (const role of ["产品经理", "data analyst", "增长运营"]) expect(resumeRolePreference(role)?.confidence).toBe("provisional");
    const text = "负责月度财务结算与审计，编制资产负债表。";
    const result = compileResumeComposition({ profile: corpusProfile([text]), mode: "general", targetDirection: "财务" });
    expect(result.items.flatMap(({ data }) => data.sectionType === "project" ? data.highlights : [])).toEqual([text]);
  });

  it("asks for AI evaluation evidence only where the effectiveness claim lacks it", () => {
    const profile = corpusProfile(["参与 RAG 检索开发，使用混合检索提升准确率。"]);
    const result = compileResumeComposition({ profile, mode: "general", targetDirection: "AI 应用工程师" });
    expect(result.reviewResult.diffs.some((diff) => diff.kind === "verify" && diff.recommendation.includes("评测"))).toBe(true);
  });
});
