import { afterEach, describe, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { JobDescriptionSchema } from "@/domain/schemas";
import { buildCareerIntelligence, CareerIntelligenceCache } from "@/domain/jobOptimization/careerIntelligence";
import { CareerContextRetrieveInputSchema, retrieveCareerContext } from "@/domain/careerContext/retrieveCareerContext";
import { compileResumeComposition } from "@/domain/resumeComposition";
import { diagnoseResumeQuality } from "@/domain/resumeComposition/qualityDiagnostics";
import { analyzeJobFit } from "@/services/jobs/tailoringService";
import { generateTailoringDiffsCommand } from "@/services/jobs/tailoringCommands";
import { aiTaskRegistry } from "@/ai/tasks/registry";
import type { ResumeTailoringDiffTaskInput } from "@/domain/schemas";

let db: CareerAdaptDb;
afterEach(() => { db?.close(); vi.restoreAllMocks(); });
async function fixture() {
  db = new CareerAdaptDb(`core02-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const profile = migrateCareerProfileToV2(structuredClone(demoCareerProfile));
  await repository.saveProfile(profile);
  await repository.setActiveProfileId(profile.id);
  const branch = (await repository.ensureGeneralResumeFromProfile({ profileId: profile.id, operationId: "core02-source", mode: "create_new" })).branch;
  const rawText = "岗位职责\n1. 参与数据分析与报告。\n任职要求\n1. 必须掌握 Kubernetes。\n2. 熟悉 Python 或 SQL。\n优先考虑\n1. 具备数据分析经验。";
  const job = JobDescriptionSchema.parse({ id: "core02-job", title: "匿名岗位", company: "匿名组织", source: "manual",
    rawText, requirements: [], requirementGraph: analyzeJobDescriptionV4({ rawText }).graph, createdAt: profile.createdAt, updatedAt: profile.updatedAt });
  return { repository, profile, branch, job };
}

describe("Core-02 derived career intelligence", () => {
  it("preserves canonical requirement identity, relationships and raw sources without parsing the JD again", async () => {
    const f = await fixture();
    const result = buildCareerIntelligence(f);
    expect(result.candidateEvidenceMatrix.rows.map(row => row.requirementId)).toEqual(f.job.requirementGraph!.requirements.map(row => row.id));
    for (const row of result.candidateEvidenceMatrix.rows) {
      expect(f.job.rawText.slice(row.rawSourceRef.start, row.rawSourceRef.end)).toBe(row.rawSourceRef.text);
      expect(row.candidateFactIds.every(id => result.evidenceUnits.some(unit => unit.factRefs.some(ref => (ref.type === "evidence_file" ? ref.linkedFactId : ref.factId) === id)))).toBe(true);
    }
    expect(result.candidateEvidenceMatrix.binding).toMatchObject({ profileId: f.profile.id, resumeId: f.branch.id, jobId: f.job.id, jobVersion: f.job.updatedAt });
    expect(result.jobFit.mustHaveCoverage.total).toBeGreaterThan(0);
  });
  it("does not infer candidate Kubernetes capability from the JD or equate absence with mismatch", async () => {
    const result = buildCareerIntelligence(await fixture());
    const row = result.candidateEvidenceMatrix.rows.find(row => /kubernetes/iu.test(row.normalizedRequirement))!;
    expect(row).toBeTruthy();
    expect(row.evidenceStatus).not.toBe("direct");
    expect(row.evidenceStatus).not.toBe("mismatch");
    expect(row.evidenceStatus).not.toBe("conflicting");
    expect(result.evidenceUnits.every(unit => !unit.text.includes("Kubernetes"))).toBe(true);
  });
  it("reuses exact versioned snapshots and isolates returned objects", async () => {
    const f = await fixture();
    const cache = new CareerIntelligenceCache();
    const first = cache.get(f);
    const second = cache.get(structuredClone({ profile: f.profile, branch: f.branch, job: f.job }));
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.candidateEvidenceMatrix).toEqual(first.candidateEvidenceMatrix);
    second.candidateEvidenceMatrix.rows.length = 0;
    expect(cache.get(f).candidateEvidenceMatrix.rows.length).toBeGreaterThan(0);
  });
  it.each(["profile", "branch", "job"] as const)("invalidates %s revision and analysis identity", async kind => {
    const f = await fixture();
    const cache = new CareerIntelligenceCache();
    const first = cache.get(f);
    if (kind === "profile") f.profile.version++;
    else if (kind === "branch") f.branch.revision++;
    else f.job.updatedAt = "2026-10-29T00:00:00.000Z";
    const second = cache.get(f);
    expect(second.reused).toBe(false);
    expect(second.candidateEvidenceMatrix.analysisId).not.toBe(first.candidateEvidenceMatrix.analysisId);
  });
  it("shares the same analysis ID across Fit, Writer composition and Reviewer", async () => {
    const f = await fixture();
    const analysis = buildCareerIntelligence(f);
    const fit = analyzeJobFit(f, analysis);
    const composition = compileResumeComposition({ ...f, mode: "job_specific", sourceResumeId: f.branch.id, candidateEvidenceMatrix: analysis.candidateEvidenceMatrix });
    expect(composition.candidateEvidenceMatrix).toEqual(fit.candidateEvidenceMatrix);
    expect(composition.reviewResult.analysisId).toBe(fit.candidateEvidenceMatrix!.analysisId);
    expect(composition.reviewResult.diagnostics?.atsStructure.textExtractability.status).toBe("unknown");
    expect(fit.summary).toContain("不是面试概率");
  });
  it("does not let attractive prose offset an emitted unsupported claim", async () => {
    const f = await fixture();
    const composition = compileResumeComposition({ profile: f.profile, mode: "general" });
    const claim = composition.claims.find(claim => composition.items.some(item => item.claimIds.includes(claim.id)))!;
    expect(claim).toBeTruthy();
    claim.classification = "UNSUPPORTED";
    expect(diagnoseResumeQuality(composition).hardGate).toMatchObject({ status: "blocked", violations: [`unverified_claim:${claim.id}`] });
  });
  it("keeps Job Fit read-only and returns the new canonical contract through the service", async () => {
    const f = await fixture();
    await f.repository.saveJobDescription(f.job);
    const service = new BrowserAgentToolService(f.repository);
    const before = await f.repository.getProfile(f.profile.id);
    const result = await service.analyzeJobFit({ profileId: f.profile.id, resumeId: f.branch.id, jobId: f.job.id }, "core02-fit");
    expect(result.analysis.candidateEvidenceMatrix?.rows.length).toBeGreaterThan(0);
    expect(await f.repository.getProfile(f.profile.id)).toEqual(before);
    expect(await f.repository.listResumeBranches()).toHaveLength(1);
  });
  it("carries the same Fit matrix through the real tailoring session and structured model prompt", async () => {
    const f = await fixture();
    await f.repository.saveJobDescription(f.job);
    const service = new BrowserAgentToolService(f.repository);
    const selection = { profileId: f.profile.id, resumeId: f.branch.id, jobId: f.job.id, mode: "steady" };
    const fit = await service.analyzeJobFit(selection, "core02-compare");
    const created = await service.createTailoringSession(selection, "core02-tailoring");
    expect(created.session.candidateEvidenceMatrix).toEqual(fit.analysis.candidateEvidenceMatrix);
    const requests: ResumeTailoringDiffTaskInput[] = [];
    await generateTailoringDiffsCommand({ operationId: "core02-generate", session: created.session,
      generate: async request => {
        requests.push(request);
        return { diffs: [], clarifications: [] };
      } });
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.requirementEvidence?.analysisId).toBe(fit.analysis.candidateEvidenceMatrix!.analysisId);
      const prompt = aiTaskRegistry["resume-tailor-diff"].buildUserPrompt(request);
      expect(JSON.parse(prompt).REQUIREMENT.requirementEvidence.analysisId).toBe(fit.analysis.candidateEvidenceMatrix!.analysisId);
    }
  });
  it("returns bounded versioned facts, maturity, and provenance without full entities", async () => {
    const f = await fixture();
    const request = CareerContextRetrieveInputSchema.parse({ profileId: f.profile.id, query: "Python", intent: "job_fit_explanation", maxFacts: 2 });
    const result = retrieveCareerContext({ ...f, request, resume: f.branch });
    expect(result.facts.length).toBeLessThanOrEqual(2);
    expect(result.binding).toMatchObject({ profileId: f.profile.id, profileRevision: f.profile.version, branchId: f.branch.id, jobVersion: f.job.updatedAt });
    expect(result.facts.every(fact => fact.maturity && fact.evidenceRefs.length > 0)).toBe(true);
    expect(result).not.toHaveProperty("profile");
    expect(result).not.toHaveProperty("resume");
    expect(result).not.toHaveProperty("job.rawText");
  });
  it("does not expose unrelated confirmed facts for a focused enrichment request", async () => {
    const f = await fixture();
    const request = CareerContextRetrieveInputSchema.parse({ profileId: f.profile.id, query: "Kubernetes", intent: "profile_enrichment" });
    expect(retrieveCareerContext({ profile: f.profile, request }).facts).toEqual([]);
  });
  it.each(["profile", "job"] as const)("rejects a stale %s in the atomic general-to-targeted write without creating any branch", async kind => {
    const f = await fixture();
    await f.repository.saveJobDescription(f.job);
    if (kind === "profile") await f.repository.saveProfile({ ...f.profile, version: f.profile.version + 1 });
    else await f.repository.saveJobDescription({ ...f.job, updatedAt: "2026-10-29T12:00:00.000Z" });
    const before = await f.repository.listResumeRevisions(f.branch.id);
    await expect(f.repository.deriveAndApplyTailoringDiffsAtomic({ sourceBranchId: f.branch.id, jobId: f.job.id,
      expectedSourceRevision: f.branch.revision, expectedSourceRevisionId: f.branch.currentRevisionId!,
      expectedProfileRevision: f.profile.version, expectedJobRevision: f.job.updatedAt,
      diffs: [], operationId: `core02-stale-${kind}`, name: "Must not be created" })).rejects.toThrow("revision_conflict");
    expect(await f.repository.listResumeBranches()).toHaveLength(1);
    expect(await f.repository.listResumeRevisions(f.branch.id)).toEqual(before);
  });
  it("keeps unconfirmed and high-risk provenance out of retrieved candidate facts", async () => {
    const f = await fixture();
    for (const experience of f.profile.experiences) for (const fact of experience.facts) fact.confirmedByUser = false;
    for (const skill of f.profile.skills) if (skill.fact) skill.fact.provenance.forEach(source => { source.riskLevel = "high"; });
    const request = CareerContextRetrieveInputSchema.parse({ profileId: f.profile.id, query: "职业经历" });
    const result = retrieveCareerContext({ profile: f.profile, request });
    const unsafe = new Set([...f.profile.experiences.flatMap(entry => entry.facts.map(fact => fact.id)), ...f.profile.skills.flatMap(entry => entry.fact ? [entry.fact.id] : [])]);
    expect(result.facts.every(fact => !unsafe.has(fact.factId))).toBe(true);
    expect(result.pendingFacts.length).toBeGreaterThan(0);
  });
});
