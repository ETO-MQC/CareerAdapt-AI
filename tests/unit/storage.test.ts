import { afterEach, describe, expect, it } from "vitest";
import Dexie, { type Table } from "dexie";
import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import type {
  AiLog,
  AiSuggestion,
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
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { createRuleRequirementMatches, resolveEffectiveMatch } from "@/domain/match/matcher";

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

class LegacyStageC1Db extends Dexie {
  profiles!: Table<typeof demoCareerProfile, string>;
  jobDescriptions!: Table<(typeof demoJobDescriptions)[number], string>;

  constructor(name: string) {
    super(name);
    this.version(3).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      rawInputs: "id, kind, inputHash, updatedAt",
      profileImportDrafts: "id, rawInputId, status, updatedAt",
      jobAnalysisDrafts: "id, rawInputId, status, updatedAt",
      draftCommits: "commitId, draftId, kind, entityId",
      requirementMatches: "id, [profileId+jobId], requirementId, isStale, updatedAt",
      matchOperations: "id, operationId, requirementMatchId, [profileId+jobId], type, occurredAt",
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
  it("persists only an existing profile as the active profile context", async () => {
    db = new CareerAdaptDb(`CareerAdaptActiveProfileDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(demoCareerProfile);
    expect(await repository.getActiveProfileId()).toBeUndefined();

    await repository.setActiveProfileId(demoCareerProfile.id);
    expect(await repository.getActiveProfileId()).toBe(demoCareerProfile.id);
    await expect(repository.setActiveProfileId("missing-profile")).rejects.toThrow("Profile not found.");
  });

  it("copies a user-entered profile summary into a new general resume", async () => {
    db = new CareerAdaptDb(`CareerAdaptProfileSummaryDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const profile = {
      ...demoCareerProfile,
      basics: { ...demoCareerProfile.basics, summary: "专注工程质量与跨团队协作。" }
    };
    await repository.saveProfile(profile);
    const created = await repository.createGeneralResumeBranch({
      profileId: profile.id,
      operationId: "profile-summary-general-resume",
      name: "带自我评价的简历",
      includeProfileFacts: true,
      includeProfileBasics: true
    });
    const summary = created.branch.contentItems.find((item) => item.itemType === "summary");
    expect(summary?.text).toBe("专注工程质量与跨团队协作。");
    expect(summary?.userConfirmation?.scope).toBe("resume_only");
  });

  it("deletes an unreferenced profile and blocks deletion after a resume references it", async () => {
    db = new CareerAdaptDb(`CareerAdaptProfileDeleteDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(demoCareerProfile);

    const deleted = await repository.deleteProfileIfUnreferenced(demoCareerProfile.id);
    expect(deleted.deleted).toBe(true);
    expect(await repository.getProfile(demoCareerProfile.id)).toBeUndefined();

    await repository.saveProfile(demoCareerProfile);
    await repository.createGeneralResumeBranch({
      profileId: demoCareerProfile.id,
      operationId: "profile-delete-reference",
      name: "引用资料的简历",
      includeProfileFacts: false,
      includeProfileBasics: true
    });
    const blocked = await repository.deleteProfileIfUnreferenced(demoCareerProfile.id);
    expect(blocked.deleted).toBe(false);
    expect(blocked.blockers.branches).toBe(1);
    expect(await repository.getProfile(demoCareerProfile.id)).toBeDefined();
  });

  it("restores profile items and jobs from the unified recycle bin", async () => {
    db = new CareerAdaptDb(`CareerAdaptRecycleDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.seedDemoWorkspace();
    const skill = demoCareerProfile.skills[0];
    await repository.saveProfile({
      ...demoCareerProfile,
      skills: demoCareerProfile.skills.filter((item) => item.id !== skill.id),
      version: demoCareerProfile.version + 1,
      updatedAt: TEST_TIME
    });
    await repository.addProfileRecycleItem({
      id: skill.id,
      profileId: demoCareerProfile.id,
      kind: "skill",
      category: "skill",
      title: skill.name,
      deletedAt: TEST_TIME,
      value: skill
    });
    expect((await repository.getRecycleBinState()).profileItems).toHaveLength(1);
    const restored = await repository.restoreProfileRecycleItem("skill", skill.id);
    expect(restored.profile.skills.some((item) => item.id === skill.id)).toBe(true);

    const job = demoJobDescriptions[0];
    await repository.moveJobToRecycleBin(job.id);
    expect((await repository.getRecycleBinState()).jobIds).toContain(job.id);
    await repository.restoreJobFromRecycleBin(job.id);
    expect((await repository.getRecycleBinState()).jobIds).not.toContain(job.id);
    await repository.moveJobToRecycleBin(job.id);
    const deleted = await repository.deleteJobPermanently(job.id);
    expect(deleted.deleted).toBe(true);
    expect(await repository.getJobDescription(job.id)).toBeUndefined();
  });

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
    expect(exported.schemaVersion).toBe("stage-e-e1-v1");
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
    expect(exported.jobAdaptationDrafts).toHaveLength(0);
    expect(exported.aiSuggestions).toHaveLength(0);
  });

  it("migrates stage C1 Dexie v3 data to v4 with empty C2 tables", async () => {
    const dbName = `CareerAdaptMigrationC2Db-${crypto.randomUUID()}`;
    const legacy = new LegacyStageC1Db(dbName);
    await legacy.open();
    await legacy.table("profiles").put(demoCareerProfile);
    await legacy.table("jobDescriptions").put(demoJobDescriptions[0]);
    legacy.close();

    db = new CareerAdaptDb(dbName);
    const repository = new WorkspaceRepository(db);
    const exported = await repository.exportWorkspaceJson();

    expect(exported.profiles.map((profile) => profile.id)).toContain(demoCareerProfile.id);
    expect(exported.jobDescriptions.map((job) => job.id)).toContain(demoJobDescriptions[0].id);
    expect(exported.jobAdaptationDrafts).toHaveLength(0);
    expect(exported.aiSuggestions).toHaveLength(0);
    expect(exported.adaptationSnapshots).toHaveLength(0);
    expect(exported.suggestionOperations).toHaveLength(0);
  });

  it("saves resume branches, AI logs, export records, and app meta", async () => {
    db = new CareerAdaptDb(`CareerAdaptTestDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);

    const branch: ResumeBranch = {
      id: "branch-storage-test",
      branchPurpose: "job_specific",
      profileId: demoCareerProfile.id,
      jobId: demoJobDescriptions[0].id,
      name: "阶段A Repository 分支写入测试",
      sourceProfileVersion: demoCareerProfile.version,
      sourceJobVersion: demoJobDescriptions[0].updatedAt,
      sourceAdaptationDraftId: "adapt-storage-test",
      sourceDraftRevision: 0,
      matcherVersion: "evidence-matcher.v1",
      sourceMatchSetHash: "storage-test-hash",
      requirementMatchIds: ["match-storage-test"],
      revision: 0,
      currentRevisionId: "revision-storage-test",
      lifecycleStatus: "active",
      migrationStatus: "verified",
      syncStatusCache: {
        status: "in_sync",
        sourceProfileVersion: demoCareerProfile.version,
        currentProfileVersion: demoCareerProfile.version,
        sourceJobVersion: demoJobDescriptions[0].updatedAt,
        currentJobVersion: demoJobDescriptions[0].updatedAt,
        invalidFactRefs: [],
        checkedAt: TEST_TIME,
        message: "Branch is in sync with its source profile and job versions."
      },
      contentItems: [
        {
          id: "branch-item-storage-test",
          itemType: "experience",
          source: "adaptation_draft",
          sourceSectionId: "section-storage-test",
          text: demoCareerProfile.experiences[0].facts[0].statement,
          originalText: demoCareerProfile.experiences[0].facts[0].statement,
          order: 0,
          visible: true,
          requirementIds: [demoJobDescriptions[0].requirements[0].id],
          sourceSuggestionIds: [],
          factRefs: [
            {
              type: "experience_fact",
              experienceId: demoCareerProfile.experiences[0].id,
              factId: demoCareerProfile.experiences[0].facts[0].id
            }
          ],
          guardMode: "rule_verified",
          guardStatus: "pass",
          guardRiskLevel: "low",
          guardFindings: [],
          guardedAt: TEST_TIME,
          guardVersion: "fact-guard-rule.v1"
        }
      ],
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
      operationId: "export-storage-test",
      branchId: branch.id,
      revisionId: "revision-storage-test",
      branchRevision: 0,
      templateId: "a4-probe",
      format: "pdf",
      fileName: "stage-a-probe.pdf",
      displayName: "stage-a-probe.pdf",
      exportStatus: "print_invoked",
      overflowStatus: "fits",
      exportedAt: TEST_TIME,
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

  it("persists C2 draft, suggestions, idempotent accept, rejection, edit guard, and undo", async () => {
    db = new CareerAdaptDb(`CareerAdaptC2Db-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const created = await repository.createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "c2-create-storage"
    });
    const duplicateCreate = await repository.createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "c2-create-storage"
    });
    expect(created.idempotent).toBe(false);
    expect(duplicateCreate.idempotent).toBe(true);

    const firstMatch = matches.find((match) => resolveEffectiveMatch(match).evidenceRefs.length > 0)!;
    const firstEvidence = resolveEffectiveMatch(firstMatch).evidenceRefs[0];
    const firstSection = created.draft.sectionTexts[0];
    const passGuard = runRuleFactGuard({
      originalText: firstSection.originalText,
      checkedText: firstSection.originalText,
      usedEvidenceRefs: [firstEvidence],
      now: TEST_TIME
    });
    const suggestion: AiSuggestion = {
      id: "suggestion-storage-c2",
      draftId: created.draft.id,
      targetSectionId: firstSection.sectionId,
      type: "rewrite",
      originalText: firstSection.originalText,
      suggestedText: firstSection.originalText,
      reason: "Grounded rewrite test.",
      requirementIds: [firstMatch.requirementId],
      usedEvidenceRefs: [firstEvidence],
      guardResult: passGuard,
      riskLevel: "low",
      status: "pending_review",
      promptVersion: "resume-tailor.v1",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    const saved = await repository.saveGeneratedSuggestions({
      profile: demoCareerProfile,
      job,
      draftId: created.draft.id,
      matches,
      suggestions: [suggestion],
      expectedRevision: created.draft.revision,
      operationId: "c2-generate-storage"
    });
    expect(saved.draft.revision).toBe(1);

    const accepted = await repository.acceptSuggestion({
      profile: demoCareerProfile,
      job,
      matches,
      draftId: saved.draft.id,
      suggestionId: suggestion.id,
      expectedRevision: saved.draft.revision,
      operationId: "c2-accept-storage"
    });
    const acceptedAgain = await repository.acceptSuggestion({
      profile: demoCareerProfile,
      job,
      matches,
      draftId: saved.draft.id,
      suggestionId: suggestion.id,
      expectedRevision: saved.draft.revision,
      operationId: "c2-accept-storage"
    });
    expect(accepted.suggestion.status).toBe("accepted");
    expect(acceptedAgain.idempotent).toBe(true);

    const editedGuard = runRuleFactGuard({
      originalText: suggestion.originalText,
      checkedText: "主导项目并提升 30%",
      usedEvidenceRefs: [firstEvidence],
      now: TEST_TIME
    });
    const edited = await repository.editSuggestionGuarded({
      draftId: accepted.draft.id,
      suggestionId: suggestion.id,
      expectedRevision: accepted.draft.revision,
      operationId: "c2-edit-storage",
      editedText: "主导项目并提升 30%",
      guardResult: editedGuard
    });
    expect(edited.suggestion.status).toBe("blocked_high_risk");

    await expect(repository.rejectSuggestion({
      draftId: edited.draft.id,
      suggestionId: suggestion.id,
      expectedRevision: accepted.draft.revision,
      operationId: "c2-reject-stale-revision"
    })).rejects.toBeInstanceOf(RevisionConflictError);

    const undone = await repository.undoSuggestion({
      draftId: edited.draft.id,
      suggestionId: suggestion.id,
      expectedRevision: edited.draft.revision,
      operationId: "c2-undo-storage"
    });
    expect(undone.suggestion.status).toBe("undone");

    const exported = await repository.exportWorkspaceJson();
    expect(exported.jobAdaptationDrafts).toHaveLength(1);
    expect(exported.aiSuggestions).toHaveLength(1);
    expect(exported.adaptationSnapshots.length).toBeGreaterThan(1);
    expect(exported.suggestionOperations.length).toBeGreaterThan(1);
  });

  it("prevents accepting blocked high-risk suggestions", async () => {
    db = new CareerAdaptDb(`CareerAdaptC2BlockedDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const created = await repository.createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "c2-create-blocked"
    });
    const firstMatch = matches.find((match) => resolveEffectiveMatch(match).evidenceRefs.length > 0)!;
    const firstEvidence = resolveEffectiveMatch(firstMatch).evidenceRefs[0];
    const firstSection = created.draft.sectionTexts[0];
    const blockedGuard = runRuleFactGuard({
      originalText: firstSection.originalText,
      checkedText: "主导项目并提升 30%",
      usedEvidenceRefs: [firstEvidence],
      now: TEST_TIME
    });
    const suggestion: AiSuggestion = {
      id: "suggestion-blocked-c2",
      draftId: created.draft.id,
      targetSectionId: firstSection.sectionId,
      type: "rewrite",
      originalText: firstSection.originalText,
      suggestedText: "主导项目并提升 30%",
      reason: "Unsafe test.",
      requirementIds: [firstMatch.requirementId],
      usedEvidenceRefs: [firstEvidence],
      guardResult: blockedGuard,
      riskLevel: blockedGuard.riskLevel,
      status: "blocked_high_risk",
      promptVersion: "resume-tailor.v1",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };
    const saved = await repository.saveGeneratedSuggestions({
      profile: demoCareerProfile,
      job,
      draftId: created.draft.id,
      matches,
      suggestions: [suggestion],
      expectedRevision: created.draft.revision,
      operationId: "c2-generate-blocked"
    });

    await expect(repository.acceptSuggestion({
      profile: demoCareerProfile,
      job,
      matches,
      draftId: saved.draft.id,
      suggestionId: suggestion.id,
      expectedRevision: saved.draft.revision,
      operationId: "c2-accept-blocked"
    })).rejects.toThrow("blocked_high_risk_suggestion_cannot_accept");
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
