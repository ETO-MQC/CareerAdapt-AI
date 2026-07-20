import { afterEach, describe, expect, it } from "vitest";
import { buildGeneralBranchFromProfile, buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import type { CareerProfile, ResumeTailoringPlan } from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

const NOW = "2026-07-20T08:00:00.000Z";
let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  await db?.delete();
  db = undefined;
});

describe("Tailoring Engine v2 repository application", () => {
  it("patches only the canonical highlights field, creates a revision, and leaves the general resume unchanged", async () => {
    const profile = fixtureProfile();
    const general = buildGeneralBranchFromProfile({ profile, operationId: "general-create", name: "通用简历", includeProfileFacts: true, includeProfileBasics: true, now: NOW });
    const job = buildJobBranchFromProfile({
      profile, jobId: "job-ai", jobTitle: "AI 软件工程师", jobVersion: "job-v1", operationId: "job-create", name: "岗位简历",
      selectedCanonicalItemIds: ["smartfocus"], requirementMatchIds: [], sourceMatchSetHash: "match-hash-ai", now: NOW
    });
    db = new CareerAdaptDb(`TailoringV2-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveResumeBranch(general.branch);
    await repository.saveResumeBranch(job.branch);
    const structured = job.branch.structuredContentItems![0];
    if (structured.data.sectionType !== "project") throw new Error("project_fixture_expected");
    const before = structured.data.highlights;
    const after = ["围绕 RAG 与 FastAPI 完成 示例任务系统 系统搭建、接口开发和结构化输出验证。"];
    const suggestionId = "tailoring-smartfocus-highlights";
    const plan: ResumeTailoringPlan = {
      id: "plan-ai", branchId: job.branch.id, jobId: "job-ai", intensity: "balanced", promptVersion: "resume-tailor.v2",
      basedOnBranchRevision: job.branch.revision, estimatedFitScore: 80, createdAt: NOW,
      claims: [{ id: suggestionId, section: "project", targetContentItemId: structured.id, targetFieldPath: `sections.project.items.${structured.id}.highlights`, currentText: before.join("\n"), proposedText: after.join("\n"), reason: "示例任务系统 对 RAG 与 FastAPI 要求最相关，重写项目要点。", keywords: ["RAG", "FastAPI"], requirementIds: ["req-rag"], supportLevel: "verified", decision: "auto_applicable", evidenceRefs: [], syncScope: "resume_only", confirmed: true }],
      suggestions: [{ id: suggestionId, intensity: "balanced", operation: "rewrite", targetSectionType: "project", targetSectionId: "project", targetItemId: structured.id, targetFieldPath: `sections.project.items.${structured.id}.highlights`, before, after, changedFields: ["highlights"], requirementIds: ["req-rag"], targetKeywords: ["RAG", "FastAPI"], coveredKeywordsBefore: ["RAG"], coveredKeywordsAfter: ["RAG", "FastAPI"], claimSupportLevel: "verified", evidenceRefs: [], rationale: "示例任务系统 对 RAG 与 FastAPI 要求最相关，重写项目要点。", riskLevel: "low", metrics: { textChangeRatio: 0.55, keywordGain: 1 }, status: "ready" }]
    };

    const applied = await repository.applyTailoringPlan({ plan, operationId: "apply-plan-ai", expectedBranchRevision: job.branch.revision, expectedRevisionId: job.branch.currentRevisionId! });
    const updated = applied.branch.structuredContentItems![0].data;
    if (updated.sectionType !== "project") throw new Error("project_result_expected");
    expect(updated.highlights).toEqual(after);
    expect({ title: updated.title, role: updated.role, startDate: updated.startDate, endDate: updated.endDate }).toEqual({ title: structured.data.title, role: structured.data.role, startDate: structured.data.startDate, endDate: structured.data.endDate });
    expect(applied.revision?.source).toBe("suggestion_accept");
    expect((await repository.getResumeBranch(general.branch.id))?.structuredContentItems).toEqual(general.branch.structuredContentItems);

    const duplicate = await repository.applyTailoringPlan({ plan, operationId: "apply-plan-ai", expectedBranchRevision: job.branch.revision, expectedRevisionId: job.branch.currentRevisionId! });
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.revision?.id).toBe(applied.revision?.id);
  });
});

function fixtureProfile(): CareerProfile {
  const statement = "在 示例任务系统 项目中搭建并调优 RAG 系统。";
  return {
    id: "profile-ai", name: "测试用户", basics: { name: "测试用户", links: [] }, structuredBasics: { name: "测试用户", portfolioLinks: [], otherLinks: [], customFields: [] },
    preference: { targetRoles: [], targetCities: [], industries: [] }, version: 1,
    experiences: [{ id: "smartfocus", type: "project", organization: "示例任务系统", role: "开发", startDate: "2025-01", endDate: "2025-06", facts: [{ id: "fact-rag", statement, category: "experience", confirmedByUser: true, riskLevel: "low", provenance: [{ sourceType: "user_input", sourceId: "source-rag", sourceText: statement, confidence: 1, confirmedByUser: true, riskLevel: "low", createdAt: NOW }], createdAt: NOW, updatedAt: NOW }], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: NOW, updatedAt: NOW }],
    skills: [], certificates: [], evidences: [], unclassifiedBlocks: [], createdAt: NOW, updatedAt: NOW
  } as unknown as CareerProfile;
}
