import { afterEach, describe, expect, it, vi } from "vitest";
import { buildResumeEvidenceGraph } from "@/domain/resumeComposition/ResumeEvidenceGraph";
import { planResumeBlueprint } from "@/domain/resumeComposition/ResumeBlueprint";
import { compileResumeComposition, writeResumeComposition } from "@/domain/resumeComposition/ResumeWriter";
import { reviewResumeComposition } from "@/domain/resumeComposition/ResumeReviewer";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";
import { corpusBullets, corpusProfile } from "../fixtures/p48cCorpus";

afterEach(() => vi.unstubAllGlobals());

function reviewCandidates(source: string, candidates: string[]) {
  const draft = compileResumeComposition({ profile: corpusProfile([source]), mode: "general" });
  const item = draft.items.find(({ data }) => data.sectionType === "project")!;
  if (item.data.sectionType === "project") item.data.highlights = candidates;
  const originalClaims = structuredClone(draft.claims);
  const originalGraph = structuredClone(draft.evidenceGraph);
  const result = reviewResumeComposition(draft);
  expect(result.claims).toEqual(originalClaims);
  expect(result.evidenceGraph).toEqual(originalGraph);
  return result;
}

describe("SQ13-B2 source contract v2: internal review is not a user question", () => {
  it("A complete support: no proposals, no rewrite, original references and maturity retained", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = reviewCandidates(corpusBullets.infra, [corpusBullets.infra]);
    expect(result.reviewResult.diffs).toEqual([]);
    expect(result.claims.some((claim) => claim.factIds.includes("fact-0") && claim.sourceAssetIds.includes("asset-0"))).toBe(true);
    expect(result.evidenceGraph.nodes.find((node) => node.id === "asset:asset-0")?.maturity).toBe("demonstrated");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("B partial support: verifies only the unsupported metric bullet and keeps the supported one", () => {
    const missing = "参与订单服务开发，使用 Redis 缓存将接口延迟降低 35%。";
    const result = reviewCandidates(corpusBullets.backend, [corpusBullets.backend, missing]);
    const verify = result.reviewResult.diffs.filter((diff) => diff.kind === "verify");
    expect(verify.length).toBeGreaterThan(0);
    expect(verify.every((diff) => diff.before === missing)).toBe(true);
    expect(result.reviewResult.diffs.some((diff) => diff.before === corpusBullets.backend)).toBe(false);
    expect(result.items.flatMap(({ data }) => data.sectionType === "project" ? data.highlights : [])).toContain(corpusBullets.backend);
    expect(result.claims.some((claim) => claim.text === missing)).toBe(false);
  });

  it("C conflicting responsibility: reviewer flags it; actual Writer never adopts the conflicting claim", () => {
    const source = "协助部署流程开发，配置双机热备与健康检查，通过故障切换演练验证恢复。";
    const candidate = source.replace("协助", "主导");
    const reviewed = reviewCandidates(source, [candidate]);
    expect(reviewed.reviewResult.status).toBe("NEEDS_REVIEW");
    expect(reviewed.reviewResult.diffs.some((diff) => diff.kind === "verify" && diff.before === candidate)).toBe(true);
    const profile = corpusProfile([source]);
    const graph = buildResumeEvidenceGraph({ profile });
    const blueprint = planResumeBlueprint({ profile, graph, mode: "general" });
    const written = writeResumeComposition({ profile, graph, blueprint, mode: "general", writingOutput: {
      assets: [{ sourceAssetId: "asset-0", title: "验证项目0", techStack: [], highlights: [candidate] }], skillGroups: []
    } });
    expect(written.claims.some((claim) => claim.text === candidate)).toBe(false);
    expect(written.items.flatMap(({ data }) => data.sectionType === "project" ? data.highlights : [])).not.toContain(candidate);
    expect(profile.experiences[0].facts[0].provenance[0].sourceText).toBe(source);
  });

  it("D insufficient/unconfirmed source: never promotes it or invents supported content", () => {
    const profile = corpusProfile([corpusBullets.infra]);
    profile.experiences[0].facts[0].confirmedByUser = false;
    profile.experiences[0].facts[0].provenance[0].confirmedByUser = false;
    const graph = buildResumeEvidenceGraph({ profile });
    expect(graph.nodes.filter((node) => node.confirmationStatus === "confirmed").flatMap((node) => node.sourceExcerpts)).not.toContain(corpusBullets.infra);
    const result = compileResumeComposition({ profile, mode: "general" });
    expect(result.claims.some((claim) => claim.text === corpusBullets.infra)).toBe(false);
    expect(result.items.flatMap(({ data }) => data.sectionType === "project" ? data.highlights : [])).not.toContain(corpusBullets.infra);
    expect(profile.experiences[0].facts[0].confirmedByUser).toBe(false);
    expect(profile.experiences[0].facts[0].maturity).toBe("demonstrated");
  });

  it("old p48c mismatch: two verify ledger entries cause zero verify tools or automatic factual questions", async () => {
    const composition = reviewCandidates(corpusBullets.backend, [corpusBullets.infra]);
    expect(composition.reviewResult.diffs.filter((diff) => diff.kind === "verify")).toHaveLength(2);
    expect(composition.reviewResult.diffs.filter((diff) => diff.kind === "rewrite")).toHaveLength(0);
    const atomic = vi.fn(async () => ({ ok: true as const, data: { composition, checkpointId: "sq13b2-checkpoint", reviewResult: composition.reviewResult }, artifacts: [],
      receipt: { operationId: "sq13b2-plan", toolName: "career.resume.plan_composition", status: "completed" as const, completedAt: "2026-11-03T00:00:00.000Z" } }));
    const result = await executeCareerWorkflowFacade("career.workflow.compose_resume", { profileId: composition.profileId, expectedProfileRevision: 1, mode: "general" },
      { confirmed: false, confirmationCount: 0 }, "sq13b2", atomic);
    expect(atomic).toHaveBeenCalledTimes(1);
    expect(atomic.mock.calls[0]).toEqual(expect.arrayContaining(["career.resume.plan_composition"]));
    expect(result.data).toMatchObject({ status: "waiting_for_confirmation", workflowStage: "review_composition" });
    // One existing explicit write confirmation, not two new factual questions.
    expect(result.data.userPrompt).toBe("这一步需要你的明确确认。");
  });
});
