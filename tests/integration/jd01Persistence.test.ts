import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { JobAnalysisDraftSchema, type RawInputDocument } from "@/domain/schemas";
import { projectJobGraphV4ToAnalyzerOutput, analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { mapJobDraftToJobDescription } from "@/domain/mappers/jobDraftMapper";
import { createRuleRequirementMatches, recallCandidatesForRequirement, resolveEffectiveMatch } from "@/domain/match/matcher";
import { demoCareerProfile } from "@/data/demoProfile";
import { JobRequirements } from "@/app/jobs/JobsWorkspace";
import { semanticAnalysis, semanticRaw } from "../fixtures/jd01";

const now = "2026-11-04T00:00:00.000Z";
const databases: CareerAdaptDb[] = [];
afterEach(async () => { cleanup(); for (const db of databases.splice(0)) await db.delete(); });

describe("JD-01 formal persistence and presentation", () => {
  it("persists validated AI splits after explicit confirmation, reopens and renders identical nodes", async () => {
    const db = new CareerAdaptDb(`jd01-${crypto.randomUUID()}`); databases.push(db);
    let repository = new WorkspaceRepository(db);
    const raw: RawInputDocument = { id: "raw-jd01", kind: "job_jd", rawText: semanticRaw, inputHash: "synthetic-jd01-hash", createdAt: now, updatedAt: now };
    await repository.saveRawInput(raw);
    const graph = semanticAnalysis().graph;
    const output = projectJobGraphV4ToAnalyzerOutput({ graph, title: "合成岗位", company: "合成公司", now });
    const draft = JobAnalysisDraftSchema.parse({ id: "draft-jd01", rawInputId: raw.id, revision: 0, title: "合成岗位", company: "合成公司", status: "needs_review", promptVersion: "jd01", attemptCount: 1, analyzerOutput: output, requirementGraph: graph, manualRequirements: [], riskNotes: [], createdAt: now, updatedAt: now });
    await repository.createJobAnalysisDraft(draft);
    expect(mapJobDraftToJobDescription({ draft, rawInput: raw, now }).requirements).toHaveLength(0);
    const confirmed = await repository.saveJobAnalysisDraftRevision({ ...draft, analyzerOutput: { ...output, requirements: output.requirements.map((item) => ({ ...item, confirmedByUser: true, needsConfirmation: false })) } }, 0);
    const job = mapJobDraftToJobDescription({ draft: confirmed, rawInput: raw, jobId: "job-jd01", now });
    const first = await repository.commitJobDraft({ draftId: draft.id, expectedRevision: confirmed.revision, commitId: "commit-jd01", jobDescription: job });
    expect(first.jobDescription.requirements.map((node) => node.id)).toEqual(graph.requirements.map((node) => node.id));
    db.close(); await db.open(); repository = new WorkspaceRepository(db);
    const restored = (await repository.getJobDescription(job.id))!;
    expect(restored.rawText).toBe(semanticRaw);
    expect(restored.requirementGraph).toEqual(first.jobDescription.requirementGraph);
    expect(restored.requirements).toEqual(first.jobDescription.requirements);
    expect((await repository.commitJobDraft({ draftId: draft.id, expectedRevision: confirmed.revision, commitId: "commit-jd01", jobDescription: job })).idempotent).toBe(true);
    const view = render(createElement(JobRequirements, { job: restored }));
    expect(view.container.querySelectorAll("[data-requirement-id]")).toHaveLength(restored.requirementGraph!.requirements.length);
    expect(screen.getByText("2 条已确认要求 · 来源覆盖 100%")).toBeTruthy();
    expect(view.container.textContent).toContain("来源段落：能完成接口设计，能定位生产故障");
  });

  it("reuses many-to-many confirmed evidence references with reasons and support levels", () => {
    const profile = structuredClone(demoCareerProfile); profile.skills = []; profile.certificates = []; profile.evidences = [];
    const base = profile.experiences[0];
    profile.experiences = [0, 1].map((index) => ({ ...base, id: `experience-${index}`, organization: "合成项目", facts: [{ ...base.facts[0], id: `fact-${index}`, statement: "使用 Java 和 SQL 开发", provenance: [{ ...base.facts[0].provenance[0], sourceText: "使用 Java 和 SQL 开发", confirmedByUser: true }], confirmedByUser: true }] }));
    const graph = analyzeJobDescriptionV4({ rawText: "任职要求\n熟悉 Java\n熟悉 SQL" }).graph;
    const output = projectJobGraphV4ToAnalyzerOutput({ graph, title: "合成岗位", company: "合成公司", now });
    const draft = JobAnalysisDraftSchema.parse({ id: "mapping", rawInputId: "raw", revision: 0, title: "合成岗位", company: "合成公司", status: "manual_mode", promptVersion: "jd01", attemptCount: 0, analyzerOutput: output, requirementGraph: graph, createdAt: now, updatedAt: now });
    const job = mapJobDraftToJobDescription({ draft, rawInput: { id: "raw", kind: "job_jd", rawText: "任职要求\n熟悉 Java\n熟悉 SQL", inputHash: "synthetic-hash", createdAt: now, updatedAt: now }, now });
    const matches = createRuleRequirementMatches({ profile, job }, now);
    expect(matches).toHaveLength(2);
    for (const match of matches) {
      const evaluation = resolveEffectiveMatch(match);
      expect(evaluation.evidenceRefs.map((ref) => ref.type === "experience_fact" ? ref.experienceId : "invalid").sort()).toEqual(["experience-0", "experience-1"]);
      expect(evaluation.explanation).toContain("[支持]");
      expect(evaluation.source).toBe("rule");
      expect(evaluation.evidenceRefs.every((ref) => ref.factQuote === "使用 Java 和 SQL 开发")).toBe(true);
    }
    render(createElement(JobRequirements, { job, matches }));
    expect(screen.getAllByText("使用 Java 和 SQL 开发")).toHaveLength(4);
    const unmatched = { ...job.requirements[0], keywords: ["Python"], description: "熟悉 Python", sourceSpan: { start: 0, end: 9, text: "熟悉 Python" } };
    expect(recallCandidatesForRequirement(profile, unmatched)).toHaveLength(0);
  });
});
