import Dexie, { type Table } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import type { ExportRecord, ResumeBranch, ResumeRevision } from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

const TEST_TIME = "2026-07-06T09:00:00.000Z";

let db: CareerAdaptDb | undefined;

class LegacyV7ApplicationDb extends Dexie {
  profiles!: Table<Record<string, unknown>, string>;
  jobDescriptions!: Table<Record<string, unknown>, string>;
  resumeBranches!: Table<Record<string, unknown>, string>;
  resumeRevisions!: Table<Record<string, unknown>, string>;
  exportRecords!: Table<Record<string, unknown>, string>;

  constructor(name: string) {
    super(name);
    this.version(7).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      rawInputs: "id, kind, inputHash, sourceSessionId, updatedAt",
      pdfImportSessions: "id, status, fileHash, normalizedTextHash, rawInputId, draftId, updatedAt",
      pdfPageTexts: "id, sessionId, [sessionId+pageNumber], pageNumber, updatedAt",
      profileImportDrafts: "id, rawInputId, status, updatedAt",
      jobAnalysisDrafts: "id, rawInputId, status, updatedAt",
      draftCommits: "commitId, draftId, kind, entityId",
      requirementMatches: "id, [profileId+jobId], requirementId, isStale, updatedAt",
      matchOperations: "id, operationId, requirementMatchId, [profileId+jobId], type, occurredAt",
      jobAdaptationDrafts: "id, [profileId+jobId], status, updatedAt",
      aiSuggestions: "id, draftId, status, type, updatedAt",
      adaptationSnapshots: "id, draftId, revision, operationId, updatedAt",
      suggestionOperations: "id, operationId, draftId, suggestionId, type, occurredAt",
      resumeBranches: "id, profileId, jobId, sourceAdaptationDraftId, lifecycleStatus, migrationStatus, updatedAt",
      resumeRevisions: "id, branchId, revisionNumber, operationId, source, createdAt",
      resumeBranchOperations: "id, &operationId, branchId, sourceAdaptationDraftId, type, occurredAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, &operationId, branchId, branchRevision, templateId, exportStatus, exportedAt",
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

describe("Application Dexie v8 migration", () => {
  it("creates an empty v8 database with a readable applications table", async () => {
    db = new CareerAdaptDb(`CareerAdaptEmptyV8Db-${crypto.randomUUID()}`);
    await db.open();
    expect(db.verno).toBe(8);
    await db.applications.put(createApplicationRecord("empty-v8"));
    expect(await db.applications.count()).toBe(1);
  });

  it("migrates v7 data to v8 while preserving profile, job, branch, revision, and export records", async () => {
    const dbName = `CareerAdaptV7ToV8Db-${crypto.randomUUID()}`;
    const legacy = new LegacyV7ApplicationDb(dbName);
    const branch = createBranch();
    const revision = createRevision(branch);
    const exportRecord = createExportRecord(branch, revision);

    await legacy.open();
    await legacy.profiles.put(demoCareerProfile);
    await legacy.jobDescriptions.put(demoJobDescriptions[0]);
    await legacy.resumeBranches.put(branch);
    await legacy.resumeRevisions.put(revision);
    await legacy.exportRecords.put(exportRecord);
    legacy.close();

    db = new CareerAdaptDb(dbName);
    const repository = new WorkspaceRepository(db);
    const exported = await repository.exportWorkspaceJson();

    expect(db.verno).toBe(8);
    expect(exported.profiles.map((profile) => profile.id)).toContain(demoCareerProfile.id);
    expect(exported.jobDescriptions.map((job) => job.id)).toContain(demoJobDescriptions[0].id);
    expect(exported.resumeBranches.map((item) => item.id)).toContain(branch.id);
    expect(exported.resumeRevisions.map((item) => item.id)).toContain(revision.id);
    expect(exported.exportRecords.map((item) => item.id)).toContain(exportRecord.id);
    expect(exported.applications).toHaveLength(0);

    const created = await repository.createApplicationFromBranch({
      branchId: branch.id,
      expectedBranchRevision: branch.revision,
      expectedRevisionId: revision.id,
      operationId: "g6a-v7-to-v8-create"
    });
    expect(created.application.jobSpecificBranchId).toBe(branch.id);
    expect(await db.applications.count()).toBe(1);
  });
});

function createBranch(): ResumeBranch {
  const statement = demoCareerProfile.experiences[0].facts[0].statement;
  return {
    id: "v7-branch-application",
    branchPurpose: "job_specific",
    profileId: demoCareerProfile.id,
    jobId: demoJobDescriptions[0].id,
    name: "V7 branch",
    sourceProfileVersion: demoCareerProfile.version,
    sourceJobVersion: demoJobDescriptions[0].updatedAt,
    sourceAdaptationDraftId: "v7-draft",
    sourceDraftRevision: 0,
    matcherVersion: "evidence-matcher.v1",
    sourceMatchSetHash: "v7matchhash",
    requirementMatchIds: ["v7-match"],
    revision: 0,
    currentRevisionId: "v7-revision-application",
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
      message: "ok"
    },
    contentItems: [
      {
        id: "v7-branch-item",
        itemType: "experience",
        source: "adaptation_draft",
        sourceSectionId: "v7-section",
        text: statement,
        originalText: statement,
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
}

function createRevision(branch: ResumeBranch): ResumeRevision {
  return {
    id: branch.currentRevisionId!,
    branchId: branch.id,
    revisionNumber: 0,
    source: "created",
    operationId: "v7-revision-operation",
    snapshot: {
      name: branch.name,
      lifecycleStatus: branch.lifecycleStatus,
      contentItems: branch.contentItems
    },
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME
  };
}

function createExportRecord(branch: ResumeBranch, revision: ResumeRevision): ExportRecord {
  return {
    id: "v7-export-application",
    operationId: "v7-export-operation",
    branchId: branch.id,
    revisionId: revision.id,
    branchRevision: branch.revision,
    templateId: "classic-technical",
    format: "pdf",
    fileName: "v7.pdf",
    displayName: "v7.pdf",
    exportStatus: "direct_pdf_success",
    overflowStatus: "fits_one_page",
    exportedAt: TEST_TIME,
    actualPageCount: 1,
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME
  };
}

function createApplicationRecord(id: string) {
  return {
    schemaVersion: "application-v1" as const,
    id,
    profileId: demoCareerProfile.id,
    jobId: demoJobDescriptions[0].id,
    jobTitleSnapshot: demoJobDescriptions[0].title,
    companySnapshot: demoJobDescriptions[0].company,
    jobSpecificBranchId: "branch",
    selectedRevisionId: "revision",
    selectedBranchRevision: 0,
    selectedPresentationRevision: 0,
    selectedTemplateId: "classic-technical" as const,
    status: "preparing" as const,
    priority: "normal" as const,
    tags: [],
    timeline: [
      {
        id: "event",
        type: "created" as const,
        occurredAt: TEST_TIME,
        createdAt: TEST_TIME,
        summary: "created",
        operationId: "create"
      }
    ],
    version: 1,
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME
  };
}
