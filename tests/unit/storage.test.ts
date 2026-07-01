import { afterEach, describe, expect, it } from "vitest";
import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import type { AiLog, ExportRecord, ResumeBranch } from "@/domain/schemas";
import { mapProfileDraftToCareerProfile } from "@/domain/mappers/profileDraftMapper";
import { CareerAdaptDb } from "@/services/storage/db";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";

const TEST_TIME = "2026-07-01T10:00:00.000Z";

let db: CareerAdaptDb | undefined;

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
    expect(exported.schemaVersion).toBe("stage-b-v1");
    expect(exported.profiles).toHaveLength(1);
    expect(exported.jobDescriptions).toHaveLength(2);
    expect(exported.rawInputs).toHaveLength(0);
    expect(exported.appMeta.some((meta) => meta.key === "demoSeededAt")).toBe(true);
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
});
