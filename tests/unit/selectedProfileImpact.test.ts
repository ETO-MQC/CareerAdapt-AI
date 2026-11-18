import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { buildResumeEvidenceGraph } from "@/domain/resumeComposition/ResumeEvidenceGraph";
import { buildProfileReceiptEvidence } from "@/domain/resumeComposition/profileReceiptEvidence";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization/v4/analyze";
import { analyzeSelectedProfileImpact } from "@/domain/jobOptimization/selectedProfileImpact";
import { CareerProfileSchema, JobDescriptionSchema } from "@/domain/schemas";
import { stableStringify } from "@/services/export/snapshot";

function fixture() {
  const profile = migrateCareerProfileToV2({ ...structuredClone(demoCareerProfile), personId: "person-test" });
  const graph = buildResumeEvidenceGraph({ profile });
  const fact = profile.experiences.flatMap(experience => experience.facts)
    .find(candidate => graph.nodes.some(node => node.factIds.includes(candidate.id)))!;
  const receipt = { operationId: "operation-test", personId: "person-test", profileId: profile.id,
    profileVersion: profile.version, committedItems: [], committedFacts: [{ id: fact.id, content: stableStringify(fact) }] };
  const evidence = buildProfileReceiptEvidence({ personId: "person-test", operationId: receipt.operationId, profile, receipt });
  const rawText = "岗位职责\n参与数据分析与报告。\n任职要求\n必须掌握 Kubernetes。";
  const job = JobDescriptionSchema.parse({ id: "job-selected", title: "数据分析", company: null, source: "manual", rawText,
    requirements: [], requirementGraph: analyzeJobDescriptionV4({ rawText }).graph, createdAt: profile.createdAt, updatedAt: profile.updatedAt });
  return { personId: "person-test", operationId: receipt.operationId, profile, evidence,
    selectedJobs: [job], analyzedAt: "2026-11-16T12:00:00.000Z" };
}

describe("selected profile impact", () => {
  it("binds the result to selected jobs and does not infer capabilities from the JD", () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = analyzeSelectedProfileImpact(input);
    expect(result.binding).toMatchObject({ personId: input.personId, profileId: input.profile.id,
      profileRevision: input.profile.version, operationId: input.operationId });
    expect(result.jobs.map(job => job.jobId)).toEqual(["job-selected"]);
    expect(result.jobs[0].status).toBe("ANALYZED");
    const row = result.jobs[0].rows.find(item => /kubernetes/iu.test(item.requirement))!;
    expect(row.flags).toContain("REMAINING_GAP");
    expect(row.flags).not.toContain("NEW_EVIDENCE_RELEVANT");
    expect(row.evidence.every(item => !/kubernetes/iu.test(item.text))).toBe(true);
    expect(input).toEqual(before);
  });

  it("rejects empty selection or a stale profile and marks missing graphs not analyzed", () => {
    const input = fixture();
    expect(() => analyzeSelectedProfileImpact({ ...input, selectedJobs: [] })).toThrow("impact_job_selection_invalid");
    expect(() => analyzeSelectedProfileImpact({ ...input, profile: { ...input.profile, version: input.profile.version + 1 } })).toThrow("impact_profile_binding_stale");
    const result = analyzeSelectedProfileImpact({ ...input, selectedJobs: [{ ...input.selectedJobs[0], requirementGraph: undefined }] });
    expect(result.jobs[0]).toMatchObject({ status: "NOT_ANALYZED", rows: [] });
  });

  it("never reports an unrelated receipt fact as the changed source of an existing match", () => {
    const input = fixture();
    const changedFacts = input.evidence.changedFactIds;
    input.evidence.changedFactIds = [];
    const result = analyzeSelectedProfileImpact(input);
    expect(changedFacts.length).toBeGreaterThan(0);
    expect(result.jobs.flatMap(job => job.rows).every(row => !row.flags.includes("NEW_EVIDENCE_RELEVANT"))).toBe(true);
  });

  it("recalls confirmed internship responsibilities for a related saved job", () => {
    const now = "2026-11-16T12:00:00.000Z";
    const statement = "负责用户反馈整理、竞品分析和产品功能优化";
    const fact = { id: "internship-fact", createdAt: now, updatedAt: now, statement, category: "experience",
      provenance: [{ sourceType: "user_input", sourceId: "source", sourceText: statement, confidence: 0.9,
        confirmedByUser: true, riskLevel: "medium", createdAt: now }], confirmedByUser: true, riskLevel: "medium", maturity: "demonstrated" };
    const profile = CareerProfileSchema.parse({ id: "person-profile", personId: "person", version: 2, createdAt: now, updatedAt: now,
      schemaVersion: "career-profile-v2", name: "示例", basics: { name: "示例", links: [] },
      preference: { targetRoles: [], targetCities: [], industries: [] }, skills: [], evidence: [],
      experiences: [{ id: "experience", createdAt: now, updatedAt: now, type: "work", organization: "示例科技", role: "产品运营实习",
        facts: [fact], resumeDrafts: [], tags: [], evidenceIds: [] }],
      structuredFacts: [{ data: { id: "internship", sectionType: "internship", organization: "示例科技", role: "产品运营实习",
        current: false, description: statement, highlights: [], customFields: [] }, factIds: [fact.id], sourceBlockIds: ["source"], sourceRanges: [], mappingTrace: [] }] });
    const receipt = { operationId: "op", personId: "person", profileId: profile.id, profileVersion: profile.version,
      committedItems: [], committedFacts: [{ id: fact.id, content: stableStringify(fact) }] };
    const evidence = buildProfileReceiptEvidence({ personId: "person", operationId: "op", profile, receipt });
    const rawText = "岗位职责\n参与用户反馈整理和产品功能优化。\n任职要求\n具备相关实践经验。";
    const job = JobDescriptionSchema.parse({ id: "product-job", title: "产品运营", company: null, source: "manual", rawText,
      requirements: [], requirementGraph: analyzeJobDescriptionV4({ rawText }).graph, createdAt: now, updatedAt: now });
    const result = analyzeSelectedProfileImpact({ personId: "person", operationId: "op", profile, evidence, selectedJobs: [job], analyzedAt: now });
    expect(result.jobs[0].rows.some(row => row.evidence.some(item => item.text.includes("用户反馈"))), JSON.stringify(result.jobs)).toBe(true);
    expect(result.jobs[0].rows.some(row => row.flags.includes("NEW_EVIDENCE_RELEVANT")), JSON.stringify(result.jobs)).toBe(true);
  });
});
