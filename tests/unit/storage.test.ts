import { afterEach, describe, expect, it } from "vitest";
import Dexie, { type Table } from "dexie";
import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import type {
  AiLog,
  DraftCommit,
  ExportRecord,
  JobAnalysisDraft,
  ProfileImportDraft,
  RawInputDocument,
  ResumeBranch
} from "@/domain/schemas";
import { mapProfileDraftToCareerProfile } from "@/domain/mappers/profileDraftMapper";
import { mapJobDraftToJobDescription } from "@/domain/mappers/jobDraftMapper";
import { CareerAdaptDb } from "@/services/storage/db";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";

const TEST_TIME = "2026-07-01T10:00:00.000Z";

let db: CareerAdaptDb | undefined;

class LegacyStageBDb extends Dexie {
  profiles!: Table<typeof demoCareerProfile, string>;
  jobDescriptions!: Table<(typeof demoJobDescriptions)[number], string>;
  rawInputs!: Table<RawInputDocument, string>;
  profileImportDrafts!: Table<ProfileImportDraft, string>;
  jobAnalysisDrafts!: Table<JobAnalysisDraft, string>;
  draftCommits!: Table<DraftCommit, string>;

  constructor(name: string) {
    super(name);
    this.version(2).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      rawInputs: "id, kind, inputHash, updatedAt",
      profileImportDrafts: "id, rawInputId, status, updatedAt",
      jobAnalysisDrafts: "id, rawInputId, status, updatedAt",
      draftCommits: "commitId, draftId, kind, entityId",
      resumeBranches: "id, profileId, jobId, updatedAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, branchId, revisionId, createdAt",
      appMeta: "key"
    });
  }
}

afterEach(async () => {
  if (!db) {
    return;
  }

  db.close();
  await db.delete();
  db = undefined;
});

describe("WorkspaceRepository", () => {
  it("writes, reads, updates, and exports the demo workspace", async () => {
    db = new CareerAdaptDb(`CareerAdaptTestDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);

    await repository.seedDemoWorkspace();

    const profile = await repository.getProfile(demoCareerProfile.id);
    const jobs = await repository.listJobDescriptions();

    expect(profile?.name).toBe("陈同学");
    expect(jobs).toHaveLength(demoJobDescriptions.length);

    await repository.saveProfile({
      ...demoCareerProfile,
      version: 2,
      updatedAt: "2026-07-01T10:30:00.000Z"
    });

    const updated = await repository.getProfile(demoCareerProfile.id);
    expect(updated?.version).toBe(2);

    const exported = await repository.exportWorkspaceJson();
    expect(exported.schemaVersion).toBe("stage-c-c1-v1");
    expect(exported.profiles).toHaveLength(1);
    expect(exported.jobDescriptions).toHaveLength(2);
    expect(exported.rawInputs).toHaveLength(0);
    expect(exported.appMeta.some((meta) => meta.key === "demoSeededAt")).toBe(true);
  });

  it("migrates stage B Dexie v2 data to v3 without losing profile, job, raw inputs, or drafts", async () => {
    const dbName = `CareerAdaptMigrationDb-${crypto.randomUUID()}`;
    const legacy = new LegacyStageBDb(dbName);
    const rawProfile: RawInputDocument = {
      id: "raw-migration-profile",
      kind: "resume_text",
      rawText: "迁移测试简历文本",
      inputHash: "hash-migration-profile",
      title: "migration profile",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };
    const rawJob: RawInputDocument = {
      id: "raw-migration-job",
      kind: "job_jd",
      rawText: "迁移测试JD文本",
      inputHash: "hash-migration-job",
      title: "migration job",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };
    const profileDraft: ProfileImportDraft = {
      id: "profile-draft-migration",
      rawInputId: rawProfile.id,
      revision: 0,
      status: "manual_mode",
      promptVersion: "profile-builder.v1",
      attemptCount: 0,
      pendingFacts: [],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };
    const jobDraft: JobAnalysisDraft = {
      id: "job-draft-migration",
      rawInputId: rawJob.id,
      revision: 0,
      title: "迁移测试岗位",
      company: "迁移测试公司",
      status: "manual_mode",
      promptVersion: "jd-analyzer.v1",
      attemptCount: 0,
      manualRequirements: [],
      riskNotes: [],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };
    const commit: DraftCommit = {
      id: "commit-migration",
      commitId: "commit-migration",
      draftId: profileDraft.id,
      kind: "profile",
      entityId: demoCareerProfile.id,
      expectedRevision: 0,
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    await legacy.open();
    await legacy.table("profiles").put(demoCareerProfile);
    await legacy.table("jobDescriptions").put(demoJobDescriptions[0]);
    await legacy.table("rawInputs").bulkPut([rawProfile, rawJob]);
    await legacy.table("profileImportDrafts").put(profileDraft);
    await legacy.table("jobAnalysisDrafts").put(jobDraft);
    await legacy.table("draftCommits").put(commit);
    legacy.close();

    db = new CareerAdaptDb(dbName);
    const repository = new WorkspaceRepository(db);
    const exported = await repository.exportWorkspaceJson();

    expect(exported.profiles.map((profile) => profile.id)).toContain(demoCareerProfile.id);
    expect(exported.jobDescriptions.map((job) => job.id)).toContain(demoJobDescriptions[0].id);
    expect(exported.rawInputs.map((raw) => raw.id)).toEqual(expect.arrayContaining([rawProfile.id, rawJob.id]));
    expect(exported.profileImportDrafts.map((draft) => draft.id)).toContain(profileDraft.id);
    expect(exported.jobAnalysisDrafts.map((draft) => draft.id)).toContain(jobDraft.id);
    expect(exported.draftCommits.map((item) => item.id)).toContain(commit.id);
    expect(exported.requirementMatches).toHaveLength(0);
    expect(exported.matchOperations).toHaveLength(0);
  });

  it("saves resume branches, AI logs, export records, and app meta", async () => {
    db = new CareerAdaptDb(`CareerAdaptTestDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);

    const branch: ResumeBranch = {
      id: "branch-storage-test",
      profileId: demoCareerProfile.id,
      jobId: demoJobDescriptions[0].id,
      name: "阶段A Repository 分支写入测试",
      selectedItems: [
        {
          experienceId: demoCareerProfile.experiences[0].id,
          draftId: demoCareerProfile.experiences[0].resumeDrafts[0].id,
          order: 0,
          visible: true
        }
      ],
      customTexts: [],
      templateId: "a4-probe",
      templateConfig: {
        templateId: "a4-probe",
        fontScale: 1,
        density: "comfortable"
      },
      currentRevisionId: "revision-storage-test",
      profileVersion: demoCareerProfile.version,
      requirementMatches: [],
      aiSuggestions: [],
      revisions: [
        {
          id: "revision-storage-test",
          branchId: "branch-storage-test",
          snapshot: { source: "repository-test" },
          source: "template_probe",
          createdAt: TEST_TIME,
          updatedAt: TEST_TIME
        }
      ],
      exportRecords: [],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    const aiLog: AiLog = {
      id: "ai-log-storage-test",
      task: "health-check",
      provider: "mock",
      promptVersion: "health-check.v1",
      inputSummary: "storage test",
      outputSummary: "ok",
      status: "success",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    const exportRecord: ExportRecord = {
      id: "export-storage-test",
      branchId: branch.id,
      revisionId: "revision-storage-test",
      templateId: "a4-probe",
      format: "pdf",
      fileName: "stage-a-probe.pdf",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    await repository.saveResumeBranch(branch);
    await repository.saveAiLogs([aiLog]);
    await repository.saveExportRecord(exportRecord);
    await repository.setMeta("stageAReview", { status: "covered" });

    expect(await repository.listResumeBranches()).toHaveLength(1);
    expect(await repository.getMeta("stageAReview")).toMatchObject({
      key: "stageAReview",
      value: { status: "covered" }
    });

    const exported = await repository.exportWorkspaceJson();
    expect(exported.resumeBranches).toHaveLength(1);
    expect(exported.aiLogs).toHaveLength(1);
    expect(exported.exportRecords).toHaveLength(1);
    expect(exported.aiLogs[0].id).toBe(aiLog.id);
  });

  it("saves stage B profile drafts with revision checks and idempotent commits", async () => {
    db = new CareerAdaptDb(`CareerAdaptStageBDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const rawInput = {
      id: "raw-profile-test",
      kind: "resume_text" as const,
      rawText: "项目经历：使用 Excel 整理销售数据，完成周报。",
      inputHash: "hash-profile-test-123",
      title: "profile test",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    await repository.saveRawInput(rawInput);

    const draft = await repository.createProfileImportDraft({
      id: "profile-draft-test",
      rawInputId: rawInput.id,
      revision: 0,
      status: "ai_validated",
      promptVersion: "profile-builder.v1",
      attemptCount: 1,
      builderOutput: {
        basics: {
          name: {
            value: "测试用户",
            sourceQuote: "项目经历",
            sourceSpan: { start: 0, end: 4, text: "项目经历" },
            confidenceLevel: "low",
            confidenceReason: "测试样本未提供姓名。",
            needsConfirmation: true
          },
          links: []
        },
        experiences: [
          {
            id: "exp-draft-test",
            type: "project",
            organization: {
              value: "项目经历",
              sourceQuote: "项目经历",
              sourceSpan: { start: 0, end: 4, text: "项目经历" },
              confidenceLevel: "medium",
              confidenceReason: "原文包含项目经历。",
              needsConfirmation: false
            },
            role: {
              value: "数据整理",
              sourceQuote: "使用 Excel 整理销售数据",
              sourceSpan: { start: 5, end: 18, text: "使用 Excel 整理销售数据" },
              confidenceLevel: "medium",
              confidenceReason: "原文直接说明任务。",
              needsConfirmation: false
            },
            facts: [
              {
                id: "fact-draft-test",
                statement: "使用 Excel 整理销售数据，完成周报。",
                category: "experience",
                sourceQuote: "使用 Excel 整理销售数据，完成周报",
                sourceSpan: { start: 5, end: 24, text: "使用 Excel 整理销售数据，完成周报" },
                confidenceLevel: "high",
                confidenceReason: "原文直接陈述。",
                needsConfirmation: false,
                confirmedByUser: true,
                createdAt: TEST_TIME,
                updatedAt: TEST_TIME
              }
            ],
            tags: ["Excel"],
            confirmedByUser: true,
            createdAt: TEST_TIME,
            updatedAt: TEST_TIME
          }
        ],
        skills: [],
        certificates: [],
        unclassifiedBlocks: []
      },
      pendingFacts: [],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });

    const saved = await repository.saveProfileImportDraftRevision(
      {
        ...draft,
        status: "editing"
      },
      0
    );
    expect(saved.revision).toBe(1);

    await expect(repository.saveProfileImportDraftRevision(saved, 0)).rejects.toBeInstanceOf(RevisionConflictError);

    const profile = mapProfileDraftToCareerProfile({ draft: saved, rawInput, now: TEST_TIME });
    const firstCommit = await repository.commitProfileDraft({
      draftId: saved.id,
      expectedRevision: saved.revision,
      commitId: "commit-profile-test",
      profile
    });
    const secondCommit = await repository.commitProfileDraft({
      draftId: saved.id,
      expectedRevision: saved.revision,
      commitId: "commit-profile-test",
      profile
    });

    expect(firstCommit.idempotent).toBe(false);
    expect(secondCommit.idempotent).toBe(true);
    expect((await repository.listProfiles()).filter((item) => item.id === profile.id)).toHaveLength(1);

    const exported = await repository.exportWorkspaceJson();
    expect(exported.rawInputs).toHaveLength(1);
    expect(exported.profileImportDrafts).toHaveLength(1);
    expect(exported.draftCommits).toHaveLength(1);
  });

  it("saves stage B JD drafts with revision checks and idempotent commits", async () => {
    db = new CareerAdaptDb(`CareerAdaptStageBJdDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);

    const rawInput = {
      id: "raw-jd-test",
      kind: "job_jd" as const,
      rawText: "岗位职责：负责用户增长数据分析。任职要求：熟练使用SQL。",
      inputHash: "hash-jd-test-456",
      title: "某公司 / 数据分析实习生",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    await repository.saveRawInput(rawInput);

    const draft = await repository.createJobAnalysisDraft({
      id: "job-draft-test",
      rawInputId: rawInput.id,
      revision: 0,
      title: "数据分析实习生",
      company: "某公司",
      status: "ai_validated",
      promptVersion: "jd-analyzer.v1",
      attemptCount: 1,
      analyzerOutput: {
        requirements: [
          {
            id: "req-jd-test",
            category: "responsibility",
            description: "负责用户增长数据分析",
            priority: "important",
            hardConstraint: false,
            sourceQuote: "负责用户增长数据分析",
            sourceSpan: { start: 5, end: 15, text: "负责用户增长数据分析" },
            keywords: ["数据分析", "用户增长"],
            confidenceLevel: "high",
            confidenceReason: "原文直接说明。",
            needsConfirmation: false,
            confirmedByUser: true,
            createdAt: TEST_TIME,
            updatedAt: TEST_TIME
          }
        ],
        riskNotes: []
      },
      manualRequirements: [],
      riskNotes: [],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });

    // Revision check
    const saved = await repository.saveJobAnalysisDraftRevision(
      { ...draft, status: "editing" },
      0
    );
    expect(saved.revision).toBe(1);

    // Stale revision should fail
    await expect(repository.saveJobAnalysisDraftRevision(saved, 0)).rejects.toBeInstanceOf(
      RevisionConflictError
    );

    // Commit
    const jobDescription = mapJobDraftToJobDescription({ draft: saved, rawInput, now: TEST_TIME });
    const firstCommit = await repository.commitJobDraft({
      draftId: saved.id,
      expectedRevision: saved.revision,
      commitId: "commit-job-test",
      jobDescription
    });

    expect(firstCommit.idempotent).toBe(false);
    expect(firstCommit.jobDescription.title).toBe("数据分析实习生");

    // Idempotent re-commit
    const secondCommit = await repository.commitJobDraft({
      draftId: saved.id,
      expectedRevision: saved.revision,
      commitId: "commit-job-test",
      jobDescription
    });
    expect(secondCommit.idempotent).toBe(true);
    expect(secondCommit.jobDescription.id).toBe(firstCommit.jobDescription.id);

    // Only one job stored
    const allJobs = await repository.listJobDescriptions();
    const matchingJobs = allJobs.filter((job) => job.id === jobDescription.id);
    expect(matchingJobs).toHaveLength(1);

    const exported = await repository.exportWorkspaceJson();
    expect(exported.rawInputs).toHaveLength(1);
    expect(exported.jobAnalysisDrafts).toHaveLength(1);
    expect(exported.draftCommits).toHaveLength(1);
  });

  it("revision conflict prevents concurrent profile draft overwrites", async () => {
    db = new CareerAdaptDb(`CareerAdaptRevConflictDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);

    const rawInput = {
      id: "raw-conflict-test",
      kind: "resume_text" as const,
      rawText: "测试冲突场景的简历文本内容。",
      inputHash: "hash-conflict-test-789",
      title: "conflict test",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    await repository.saveRawInput(rawInput);

    const draft = await repository.createProfileImportDraft({
      id: "profile-draft-conflict",
      rawInputId: rawInput.id,
      revision: 0,
      status: "ai_validated",
      promptVersion: "profile-builder.v1",
      attemptCount: 1,
      builderOutput: {
        basics: {
          name: {
            value: "冲突测试",
            sourceQuote: "测试冲突场景",
            sourceSpan: { start: 0, end: 6, text: "测试冲突场景" },
            confidenceLevel: "low",
            confidenceReason: "测试样本。",
            needsConfirmation: true
          },
          links: []
        },
        experiences: [],
        skills: [],
        certificates: [],
        unclassifiedBlocks: []
      },
      pendingFacts: [],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });

    // Two concurrent saves with the same expected revision
    const concurrentUpdate = { ...draft, status: "editing" as const };

    const first = repository.saveProfileImportDraftRevision(concurrentUpdate, 0);
    await expect(first).resolves.toBeDefined();

    const second = repository.saveProfileImportDraftRevision(concurrentUpdate, 0);
    await expect(second).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("draft persists through simulated refresh for recovery", async () => {
    db = new CareerAdaptDb(`CareerAdaptRefreshDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);

    const rawInput = {
      id: "raw-refresh-test",
      kind: "resume_text" as const,
      rawText: "刷新恢复测试文本，包含某大学教育经历。",
      inputHash: "hash-refresh-test-abc",
      title: "refresh test",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    await repository.saveRawInput(rawInput);

    const draft = await repository.createProfileImportDraft({
      id: "profile-draft-refresh",
      rawInputId: rawInput.id,
      revision: 0,
      status: "ai_validated",
      promptVersion: "profile-builder.v1",
      attemptCount: 1,
      builderOutput: {
        basics: {
          name: {
            value: "刷新测试",
            sourceQuote: "刷新恢复测试文本",
            sourceSpan: { start: 0, end: 7, text: "刷新恢复测试文本" },
            confidenceLevel: "low",
            confidenceReason: "测试样本。",
            needsConfirmation: true
          },
          links: []
        },
        experiences: [],
        skills: [],
        certificates: [],
        unclassifiedBlocks: []
      },
      pendingFacts: [],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });

    // Simulate refresh: create new repository instance
    const repositoryAfterRefresh = new WorkspaceRepository(db);

    const recovered = await repositoryAfterRefresh.getProfileImportDraft(draft.id);
    expect(recovered).toBeDefined();
    expect(recovered!.status).toBe("ai_validated");
    expect(recovered!.rawInputId).toBe(rawInput.id);

    const recoveredRaw = await repositoryAfterRefresh.getRawInput(rawInput.id);
    expect(recoveredRaw).toBeDefined();
    expect(recoveredRaw!.rawText).toBe(rawInput.rawText);

    // Also test latest draft retrieval
    const latestDraft = await repositoryAfterRefresh.getLatestProfileImportDraft();
    expect(latestDraft).toBeDefined();
    expect(latestDraft!.id).toBe(draft.id);
  });

  it("JD draft also persists through simulated refresh", async () => {
    db = new CareerAdaptDb(`CareerAdaptJdRefreshDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);

    const rawInput = {
      id: "raw-jd-refresh-test",
      kind: "job_jd" as const,
      rawText: "某互联网公司数据分析实习岗位。",
      inputHash: "hash-jd-refresh-xyz",
      title: "某互联网公司 / 数据分析",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    await repository.saveRawInput(rawInput);

    const draft = await repository.createJobAnalysisDraft({
      id: "job-draft-refresh",
      rawInputId: rawInput.id,
      revision: 0,
      title: "数据分析",
      company: "某互联网公司",
      status: "ai_validated",
      promptVersion: "jd-analyzer.v1",
      attemptCount: 1,
      analyzerOutput: {
        requirements: [
          {
            id: "req-jd-refresh",
            category: "responsibility",
            description: "数据分析",
            priority: "important",
            hardConstraint: false,
            sourceQuote: "数据分析",
            sourceSpan: { start: 6, end: 10, text: "数据分析" },
            keywords: [],
            confidenceLevel: "medium",
            confidenceReason: "测试。",
            needsConfirmation: true,
            confirmedByUser: false,
            createdAt: TEST_TIME,
            updatedAt: TEST_TIME
          }
        ],
        riskNotes: []
      },
      manualRequirements: [],
      riskNotes: [],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });

    const repositoryAfterRefresh = new WorkspaceRepository(db);
    const recovered = await repositoryAfterRefresh.getJobAnalysisDraft(draft.id);
    expect(recovered).toBeDefined();
    expect(recovered!.status).toBe("ai_validated");
    expect(recovered!.title).toBe("数据分析");

    const latestJobDraft = await repositoryAfterRefresh.getLatestJobAnalysisDraft();
    expect(latestJobDraft).toBeDefined();
    expect(latestJobDraft!.id).toBe(draft.id);
  });

  it("provider failure fallback: raw text preserved, manual mode draft created", async () => {
    db = new CareerAdaptDb(`CareerAdaptFallbackDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);

    // Step 1: Save raw input
    const rawInput = {
      id: "raw-fallback-test",
      kind: "resume_text" as const,
      rawText: "降级测试：某公司实习经历。",
      inputHash: "hash-fallback-test-def",
      title: "fallback test",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    await repository.saveRawInput(rawInput);

    // Step 2: Simulate provider failure -> create manual mode draft
    const manualDraft = await repository.createProfileImportDraft({
      id: "profile-draft-fallback",
      rawInputId: rawInput.id,
      revision: 0,
      status: "manual_mode",
      promptVersion: "profile-builder.v1",
      attemptCount: 2,
      manualSections: {
        basics: {
          name: {
            value: "待确认用户",
            sourceQuote: "降级测试",
            sourceSpan: { start: 0, end: 4, text: "降级测试" },
            confidenceLevel: "low",
            confidenceReason: "AI不可用，手动模式占位。",
            needsConfirmation: true
          },
          links: []
        },
        experiences: [
          {
            id: "exp-fallback",
            type: "internship",
            organization: {
              value: "某公司",
              sourceQuote: "某公司实习经历",
              sourceSpan: { start: 5, end: 12, text: "某公司实习经历" },
              confidenceLevel: "low",
              confidenceReason: "手动模式占位。",
              needsConfirmation: true
            },
            role: {
              value: "实习",
              sourceQuote: "某公司实习经历",
              sourceSpan: { start: 5, end: 12, text: "某公司实习经历" },
              confidenceLevel: "low",
              confidenceReason: "手动模式占位。",
              needsConfirmation: true
            },
            facts: [
              {
                id: "fact-fallback",
                statement: "某公司实习经历",
                category: "experience",
                sourceQuote: "某公司实习经历",
                sourceSpan: { start: 5, end: 12, text: "某公司实习经历" },
                confidenceLevel: "low",
                confidenceReason: "用户拒绝外部处理或AI不可用。",
                needsConfirmation: true,
                confirmedByUser: false,
                createdAt: TEST_TIME,
                updatedAt: TEST_TIME
              }
            ],
            tags: [],
            confirmedByUser: false,
            createdAt: TEST_TIME,
            updatedAt: TEST_TIME
          }
        ],
        skills: [],
        certificates: [],
        unclassifiedBlocks: []
      },
      pendingFacts: [],
      saveError: "provider_failed",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });

    expect(manualDraft.status).toBe("manual_mode");
    expect(manualDraft.saveError).toBe("provider_failed");
    expect(manualDraft.attemptCount).toBe(2);

    // Raw input is preserved
    const preserved = await repository.getRawInput(rawInput.id);
    expect(preserved).toBeDefined();
    expect(preserved!.rawText).toBe(rawInput.rawText);

    // Commit from manual mode still works if user confirms facts
    const updatedManual = await repository.saveProfileImportDraftRevision(
      {
        ...manualDraft,
        manualSections: {
          ...manualDraft.manualSections!,
          experiences: manualDraft.manualSections!.experiences.map((exp) => ({
            ...exp,
            facts: exp.facts.map((fact) => ({ ...fact, confirmedByUser: true }))
          }))
        }
      },
      0
    );

    const profile = mapProfileDraftToCareerProfile({
      draft: updatedManual,
      rawInput,
      now: TEST_TIME
    });

    const commit = await repository.commitProfileDraft({
      draftId: updatedManual.id,
      expectedRevision: updatedManual.revision,
      commitId: "commit-fallback-test",
      profile
    });

    expect(commit.profile).toBeDefined();
    expect(commit.profile.experiences).toHaveLength(1);
  });
});
