import { afterEach, describe, expect, it } from "vitest";
import { buildGeneralBranchFromProfile, buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import type { CareerProfile, ResumeTailoringPlan } from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { presentationSnapshotFromConfig } from "@/services/export/snapshot";
import { analyzeJobFit } from "@/services/jobs/tailoringService";
import { JobDescriptionSchema } from "@/domain/schemas";
import { tailoringValueHash } from "@/domain/jobOptimization";

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
    await repository.saveProfile(profile);
    await repository.saveJobDescription({ id: "job-ai", title: "AI 软件工程师", company: "测试公司", rawText: "负责 AI 软件工程与质量验证", source: "manual", requirements: [], createdAt: NOW, updatedAt: NOW });
    await repository.saveResumeBranch(general.branch);
    await repository.saveResumeBranch(job.branch);
    await db.resumeRevisions.bulkPut([general.firstRevision, job.firstRevision]);
    const presentationBefore = await repository.getResumePresentationConfig(job.branch.id);
    const structured = job.branch.structuredContentItems![0];
    if (structured.data.sectionType !== "project") throw new Error("project_fixture_expected");
    const before = structured.data.highlights;
    const after = ["围绕 RAG 与 FastAPI 完成 示例任务系统 系统搭建、接口开发和结构化输出验证。"];
    const suggestionId = "tailoring-smartfocus-highlights";
    const plan: ResumeTailoringPlan = {
      id: "plan-ai", branchId: job.branch.id, jobId: "job-ai", intensity: "balanced", promptVersion: "resume-tailor.v2",
      basedOnBranchRevision: job.branch.revision, estimatedFitScore: 80, createdAt: NOW,
      claims: [{ id: suggestionId, label: "强化 示例任务系统 的 RAG 与 FastAPI 经验", claimText: after[0], sourceItemIds: [structured.id], targetPatches: [{ sectionId: "project", itemId: structured.id, fieldPath: "highlights", operation: "replace", before, after }], claimType: "experience_reframe", section: "project", targetContentItemId: structured.id, targetFieldPath: `sections.project.items.${structured.id}.highlights`, currentText: before.join("\n"), proposedText: "项目名称：示例任务系统 开始日期：2025-01 亮点：错误的整条目文本", reason: "示例任务系统 对 RAG 与 FastAPI 要求最相关，重写项目要点。", keywords: ["RAG", "FastAPI"], requirementIds: ["req-rag"], supportLevel: "verified", decision: "auto_applicable", evidenceRefs: [], syncScope: "resume_only", confirmed: true }],
      suggestions: [{ id: suggestionId, intensity: "balanced", operation: "rewrite", targetSectionType: "project", targetSectionId: "project", targetItemId: structured.id, targetFieldPath: `sections.project.items.${structured.id}.highlights`, before, after, changedFields: ["highlights"], requirementIds: ["req-rag"], targetKeywords: ["RAG", "FastAPI"], coveredKeywordsBefore: ["RAG"], coveredKeywordsAfter: ["RAG", "FastAPI"], claimSupportLevel: "verified", evidenceRefs: [], rationale: "示例任务系统 对 RAG 与 FastAPI 要求最相关，重写项目要点。", riskLevel: "low", metrics: { textChangeRatio: 0.55, keywordGain: 1 }, status: "ready" }]
    };

    const staleSnapshotPlan: ResumeTailoringPlan = {
      ...plan,
      basedOnRevisionId: job.branch.currentRevisionId!,
      claims: plan.claims.map((claim) => ({
        ...claim,
        baseRevisionId: "older-revision",
        originalValue: before,
        originalValueHash: tailoringValueHash(before),
        suggestedValue: after,
        resolvedValue: after
      }))
    };
    await expect(repository.applyTailoringPlan({
      plan: staleSnapshotPlan,
      operationId: "apply-stale-snapshot",
      expectedBranchRevision: job.branch.revision,
      expectedRevisionId: job.branch.currentRevisionId!
    })).rejects.toThrow("original_snapshot_mismatch");

    const applied = await repository.applyTailoringPlan({ plan, operationId: "apply-plan-ai", expectedBranchRevision: job.branch.revision, expectedRevisionId: job.branch.currentRevisionId! });
    const updated = applied.branch.structuredContentItems![0].data;
    if (updated.sectionType !== "project") throw new Error("project_result_expected");
    expect(updated.highlights).toEqual(after);
    expect({ title: updated.title, role: updated.role, startDate: updated.startDate, endDate: updated.endDate }).toEqual({ title: structured.data.title, role: structured.data.role, startDate: structured.data.startDate, endDate: structured.data.endDate });
    const legacy = applied.branch.contentItems.find((item) => item.id === structured.id)?.text ?? "";
    expect(legacy).toContain(after[0]);
    expect(legacy).not.toMatch(/组织：|职位\/角色：|项目名称：|开始日期：|结束日期：|进行中：|亮点：/);
    expect(applied.branch.structuredContentItems?.find((item) => item.id === structured.id)?.legacyTextProjection).toBe(legacy);
    expect(applied.revision?.source).toBe("suggestion_accept");
    expect((await repository.getResumeBranch(general.branch.id))?.structuredContentItems).toEqual(general.branch.structuredContentItems);
    expect(presentationSnapshotFromConfig(await repository.getResumePresentationConfig(job.branch.id))).toEqual(presentationSnapshotFromConfig(presentationBefore));
    expect(updated.highlights.join("\n")).not.toMatch(/组织：|职位\/角色：|项目名称：|开始日期：|结束日期：|进行中：|亮点：/);

    const duplicate = await repository.applyTailoringPlan({ plan, operationId: "apply-plan-ai", expectedBranchRevision: job.branch.revision, expectedRevisionId: job.branch.currentRevisionId! });
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.revision?.id).toBe(applied.revision?.id);

    const undone = await repository.undoResumeBranch({ branchId: applied.branch.id, expectedRevision: applied.branch.revision, operationId: "undo-plan-ai" });
    expect(undone.branch.structuredContentItems).toEqual(job.branch.structuredContentItems);
  });

  it("creates a legal resume-only SkillItemV2 only from a confirmed append patch", async () => {
    const profile = fixtureProfile();
    const general = buildGeneralBranchFromProfile({ profile, operationId: "general-skill", name: "通用简历", includeProfileFacts: true, includeProfileBasics: true, now: NOW });
    const job = buildJobBranchFromProfile({ profile, jobId: "job-ai", jobTitle: "AI Coding 任务设计专家", jobVersion: "job-v1", operationId: "job-skill", name: "岗位简历", selectedCanonicalItemIds: ["smartfocus"], requirementMatchIds: [], sourceMatchSetHash: "match-hash-skill", now: NOW });
    db = new CareerAdaptDb(`TailoringSkill-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(profile);
    await repository.saveJobDescription({ id: "job-ai", title: "AI Coding 任务设计专家", company: "测试公司", rawText: "熟悉 Cursor", source: "manual", requirements: [], createdAt: NOW, updatedAt: NOW });
    await repository.saveResumeBranch(general.branch);
    await repository.saveResumeBranch(job.branch);
    await db.resumeRevisions.bulkPut([general.firstRevision, job.firstRevision]);
    const plan: ResumeTailoringPlan = {
      id: "plan-cursor", branchId: job.branch.id, jobId: "job-ai", intensity: "balanced", basedOnBranchRevision: job.branch.revision, estimatedFitScore: 0, createdAt: NOW,
      claims: [{ id: "claim-cursor", label: "确认 Cursor 的使用程度", claimText: "了解 Cursor 等 AI Coding 工具的基本工作方式。", finalTextByProficiency: { proficient: "熟练使用 Cursor 完成多文件开发、代码修改与问题定位。", familiar: "熟悉 Cursor 的项目开发、代码修改与调试流程。", aware: "了解 Cursor 等 AI Coding 工具的基本工作方式。", learning: "正在学习 Cursor 等 AI Coding 工具在真实开发任务中的应用。" }, sourceItemIds: [job.branch.contentItems[0].id], requirementIds: ["req-cursor"], targetPatches: [{ sectionId: "skills", itemId: "skill-cursor", fieldPath: "name", operation: "append", before: "", after: "Cursor" }, { sectionId: "skills", itemId: "skill-cursor", fieldPath: "description", operation: "replace", before: "", after: "了解 Cursor 等 AI Coding 工具的基本工作方式。" }], claimType: "tool", section: "skills", targetContentItemId: "skill-cursor", targetFieldPath: "sections.skills.items.skill-cursor.description", currentText: "", proposedText: "了解 Cursor 等 AI Coding 工具的基本工作方式。", resolvedText: "了解 Cursor 等 AI Coding 工具的基本工作方式。", reason: "岗位工具要求", keywords: ["Cursor"], supportLevel: "user_declared", decision: "requires_confirmation", evidenceRefs: [], syncScope: "resume_only", proficiency: "aware", confirmed: true }]
    };
    const applied = await repository.applyTailoringPlan({ plan, operationId: "apply-cursor", expectedBranchRevision: job.branch.revision, expectedRevisionId: job.branch.currentRevisionId! });
    const skill = applied.branch.structuredContentItems?.find((item) => item.id === "skill-cursor");
    expect(skill?.data).toMatchObject({ id: "skill-cursor", sectionType: "skills", name: "Cursor", description: "了解 Cursor 等 AI Coding 工具的基本工作方式。" });
    expect(skill).toMatchObject({ source: "user_manual", factRefs: [], userConfirmation: { scope: "resume_only" } });
    expect((await repository.getResumeBranch(general.branch.id))?.structuredContentItems).toEqual(general.branch.structuredContentItems);
  });

  it("applies valid diffs independently, preserves presentation, and supports undo", async () => {
    const profile = fixtureProfile();
    const job = buildJobBranchFromProfile({
      profile,
      jobId: "job-diff",
      jobTitle: "AI 评测工程师",
      jobVersion: "job-v1",
      operationId: "job-diff-create",
      name: "岗位简历",
      selectedCanonicalItemIds: ["smartfocus"],
      requirementMatchIds: [],
      sourceMatchSetHash: "match-hash-diff",
      now: NOW
    });
    db = new CareerAdaptDb(`TailoringDiff-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(profile);
    const fitJob = JobDescriptionSchema.parse({
      id: "job-diff",
      title: "AI 评测工程师",
      company: "测试公司",
      rawText: "负责 RAG 输出验证。",
      source: "manual",
      requirements: [{
        id: "req-rag",
        category: "core_skill",
        description: "具备 RAG 输出验证经验。",
        priority: "high",
        hardConstraint: false,
        sourceSpan: { start: 3, end: 11, text: "RAG 输出验证" },
        keywords: ["RAG", "输出验证"],
        confidence: 1,
        createdAt: NOW,
        updatedAt: NOW
      }],
      createdAt: NOW,
      updatedAt: NOW
    });
    await repository.saveJobDescription(fitJob);
    await repository.saveResumeBranch(job.branch);
    await db.resumeRevisions.put(job.firstRevision);
    const presentationBefore = presentationSnapshotFromConfig(await repository.getResumePresentationConfig(job.branch.id));
    const structured = job.branch.structuredContentItems![0];
    if (structured.data.sectionType !== "project") throw new Error("project_fixture_expected");
    const before = structured.data.highlights;
    const after = [...before, "验证 RAG 输出并定位逻辑缺陷"];
    const valid = {
      target: { sectionId: "project", itemId: structured.id, fieldPath: "highlights" as const },
      operation: "replace" as const,
      original: before,
      value: after,
      reason: "突出已验证的模型输出评估经验",
      requirementIds: ["req-eval"],
      targetKeywords: ["输出质量评估", "逻辑缺陷识别"],
      evidenceRefs: [{ type: "experience_fact" as const, experienceId: "smartfocus", factId: "fact-rag", factQuote: profile.experiences[0].facts[0].statement, factText: profile.experiences[0].facts[0].statement }],
      supportLevel: "verified" as const
    };
    const stale = { ...valid, original: ["旧 Revision 文本"], value: ["不会写入"] };

    const applied = await repository.applyTailoringDiffs({
      branchId: job.branch.id,
      jobId: "job-diff",
      diffs: [valid, stale],
      operationId: "apply-diffs-partial",
      expectedBranchRevision: job.branch.revision,
      expectedRevisionId: job.branch.currentRevisionId!
    });
    expect(applied.appliedDiffs).toHaveLength(1);
    expect(applied.rejectedDiffs).toEqual([expect.objectContaining({ reasonCode: "original_mismatch" })]);
    expect(applied.revision).toBeDefined();
    expect(presentationSnapshotFromConfig(await repository.getResumePresentationConfig(job.branch.id))).toEqual(presentationBefore);
    const updated = applied.branch.structuredContentItems?.find((item) => item.id === structured.id);
    expect(updated?.data.sectionType === "project" ? updated.data.highlights : []).toEqual(after);
    const beforeFit = analyzeJobFit({ profile, branch: job.branch, job: fitJob }).report!.overallCoverage;
    const afterFit = analyzeJobFit({ profile, branch: applied.branch, job: fitJob }).report!.overallCoverage;
    expect([beforeFit, afterFit]).toEqual([0, 50]);

    const undone = await repository.undoResumeBranch({ branchId: job.branch.id, expectedRevision: applied.branch.revision, operationId: "undo-diffs-partial" });
    expect(undone.branch.structuredContentItems).toEqual(job.branch.structuredContentItems);
  });

  it("does not create an empty revision when every diff is rejected", async () => {
    const profile = fixtureProfile();
    const job = buildJobBranchFromProfile({
      profile,
      jobId: "job-empty-diff",
      jobTitle: "AI 评测工程师",
      jobVersion: "job-v1",
      operationId: "job-empty-create",
      name: "岗位简历",
      selectedCanonicalItemIds: ["smartfocus"],
      requirementMatchIds: [],
      sourceMatchSetHash: "match-hash-empty",
      now: NOW
    });
    db = new CareerAdaptDb(`TailoringEmptyDiff-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(profile);
    await repository.saveJobDescription({ id: "job-empty-diff", title: "AI 评测工程师", company: "测试公司", rawText: "负责模型输出质量评估与逻辑缺陷识别。", source: "manual", requirements: [], createdAt: NOW, updatedAt: NOW });
    await repository.saveResumeBranch(job.branch);
    await db.resumeRevisions.put(job.firstRevision);
    const structured = job.branch.structuredContentItems![0];
    const beforeRevisionCount = await db.resumeRevisions.count();
    const result = await repository.applyTailoringDiffs({
      branchId: job.branch.id,
      jobId: "job-empty-diff",
      diffs: [{
        target: { sectionId: "project", itemId: structured.id, fieldPath: "description" },
        operation: "replace",
        original: "stale",
        value: "new",
        reason: "stale test",
        requirementIds: ["req-eval"],
        targetKeywords: [],
        evidenceRefs: [],
        supportLevel: "reasonable_inference"
      }],
      operationId: "apply-empty-diffs",
      expectedBranchRevision: job.branch.revision,
      expectedRevisionId: job.branch.currentRevisionId!
    });
    expect(result.revision).toBeUndefined();
    expect(result.branch.revision).toBe(job.branch.revision);
    expect(await db.resumeRevisions.count()).toBe(beforeRevisionCount);
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
