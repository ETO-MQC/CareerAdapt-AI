import { afterEach, describe, expect, it } from "vitest";
import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import type { AiLog, ExportRecord, ResumeBranch } from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

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
    expect(exported.schemaVersion).toBe("stage-a-v1");
    expect(exported.profiles).toHaveLength(1);
    expect(exported.jobDescriptions).toHaveLength(2);
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
});
