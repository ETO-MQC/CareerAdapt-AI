import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import {
  ApplicationRecordSchema,
  type ApplicationRecord,
  type ResumeBranch
} from "@/domain/schemas";
import { createRuleRequirementMatches } from "@/domain/match/matcher";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

const TEST_TIME = "2026-07-06T08:00:00.000Z";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) {
    return;
  }
  db.close();
  await db.delete();
  db = undefined;
});

describe("Application schema", () => {
  it("parses a complete application record and rejects invalid enum values", () => {
    const record = createApplicationFixture();
    expect(ApplicationRecordSchema.parse(record).schemaVersion).toBe("application-v1");

    expect(() => ApplicationRecordSchema.parse({
      ...record,
      status: "sent"
    })).toThrow();
    expect(() => ApplicationRecordSchema.parse({
      ...record,
      priority: "urgent"
    })).toThrow();
  });

  it("allows URL as plain stored text but enforces note and timeline limits", () => {
    const record = createApplicationFixture({
      sourceUrl: "https://jobs.example.com/apply?id=1",
      note: "<script>alert(1)</script>",
      timeline: []
    });
    const parsed = ApplicationRecordSchema.parse(record);
    expect(parsed.sourceUrl).toContain("https://");
    expect(parsed.note).toContain("<script>");
    expect(() => ApplicationRecordSchema.parse({
      ...record,
      note: "x".repeat(4001)
    })).toThrow();
  });
});

describe("Application repository", () => {
  it("creates an application from a job-specific branch with latest export and duplicate detection", async () => {
    const fixture = await setupApplicationFixture();
    const beforeBranch = JSON.stringify(fixture.branch);
    const beforeRevisionCount = (await fixture.repository.listResumeRevisions(fixture.branch.id)).length;

    const created = await fixture.repository.createApplicationFromBranch({
      branchId: fixture.branch.id,
      expectedBranchRevision: fixture.branch.revision,
      expectedRevisionId: fixture.branch.currentRevisionId!,
      operationId: "g6a-create-app",
      initialStatus: "preparing"
    });
    const duplicate = await fixture.repository.createApplicationFromBranch({
      branchId: fixture.branch.id,
      expectedBranchRevision: fixture.branch.revision,
      expectedRevisionId: fixture.branch.currentRevisionId!,
      operationId: "g6a-create-app-duplicate"
    });
    const idempotent = await fixture.repository.createApplicationFromBranch({
      branchId: fixture.branch.id,
      expectedBranchRevision: fixture.branch.revision,
      expectedRevisionId: fixture.branch.currentRevisionId!,
      operationId: "g6a-create-app",
      initialStatus: "preparing"
    });

    expect(created.idempotent).toBe(false);
    expect(created.application.profileId).toBe(demoCareerProfile.id);
    expect(created.application.jobId).toBe(demoJobDescriptions[0].id);
    expect(created.application.selectedExportRecordId).toBe(fixture.exportRecord.id);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.application.id).toBe(created.application.id);
    expect(idempotent.idempotent).toBe(true);
    expect(JSON.stringify(await fixture.repository.getResumeBranch(fixture.branch.id))).toBe(beforeBranch);
    expect(await fixture.repository.listResumeRevisions(fixture.branch.id)).toHaveLength(beforeRevisionCount);
  });

  it("rejects general branches and cross-branch export records", async () => {
    const fixture = await setupApplicationFixture();
    const generalBranch = {
      ...fixture.branch,
      id: "general-branch-for-application-test",
      branchPurpose: "general" as const,
      jobId: undefined,
      sourceJobVersion: undefined,
      sourceAdaptationDraftId: undefined,
      sourceImportId: "import-test",
      requirementMatchIds: []
    };
    await fixture.repository.saveResumeBranch(generalBranch);
    await expect(fixture.repository.createApplicationFromBranch({
      branchId: generalBranch.id,
      expectedBranchRevision: generalBranch.revision,
      expectedRevisionId: generalBranch.currentRevisionId!,
      operationId: "g6a-create-general"
    })).rejects.toThrow("invalid_branch_purpose");

    const created = await fixture.repository.createApplicationFromBranch({
      branchId: fixture.branch.id,
      expectedBranchRevision: fixture.branch.revision,
      expectedRevisionId: fixture.branch.currentRevisionId!,
      operationId: "g6a-create-cross-export"
    });
    const otherBranch = await createSecondBranch(fixture.repository);
    const otherExport = await fixture.repository.createResumeExportRecord({
      operationId: "g6a-cross-export",
      branchId: otherBranch.id,
      expectedBranchRevision: otherBranch.revision,
      expectedRevisionId: otherBranch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "fits_one_page",
      exportStatus: "direct_pdf_success",
      fileName: "other.pdf"
    });

    await expect(fixture.repository.attachApplicationExport({
      applicationId: created.application.id,
      expectedVersion: created.application.version,
      operationId: "g6a-attach-cross-export",
      exportRecordId: otherExport.record.id
    })).rejects.toThrow("export_branch_mismatch");
  });

  it("updates status with timeline, rejects illegal jumps, and locks applied snapshot", async () => {
    const fixture = await setupApplicationFixture();
    const created = await fixture.repository.createApplicationFromBranch({
      branchId: fixture.branch.id,
      expectedBranchRevision: fixture.branch.revision,
      expectedRevisionId: fixture.branch.currentRevisionId!,
      operationId: "g6a-create-status"
    });

    await expect(fixture.repository.updateApplicationStatus({
      applicationId: created.application.id,
      expectedVersion: created.application.version,
      operationId: "g6a-invalid-status",
      nextStatus: "applied"
    })).rejects.toThrow("invalid_status_transition");

    const ready = await fixture.repository.updateApplicationStatus({
      applicationId: created.application.id,
      expectedVersion: created.application.version,
      operationId: "g6a-ready-status",
      nextStatus: "ready"
    });
    const applied = await fixture.repository.updateApplicationStatus({
      applicationId: ready.application.id,
      expectedVersion: ready.application.version,
      operationId: "g6a-applied-status",
      nextStatus: "applied",
      appliedAt: TEST_TIME
    });

    expect(applied.application.status).toBe("applied");
    expect(applied.application.appliedSnapshot).toMatchObject({
      revisionId: created.application.selectedRevisionId,
      branchRevision: created.application.selectedBranchRevision,
      exportRecordId: fixture.exportRecord.id
    });

    const editedBranch = await fixture.repository.editResumeBranch({
      branchId: fixture.branch.id,
      expectedRevision: fixture.branch.revision,
      operationId: "g6a-edit-after-applied",
      edits: [{ itemId: fixture.branch.contentItems[0].id, text: fixture.branch.contentItems[0].text }]
    });
    const afterEdit = await fixture.repository.getApplication(applied.application.id);
    expect(editedBranch.branch.revision).toBe(fixture.branch.revision + 1);
    expect(afterEdit?.appliedSnapshot?.branchRevision).toBe(fixture.branch.revision);
    await expect(fixture.repository.linkApplicationRevision({
      applicationId: applied.application.id,
      expectedVersion: applied.application.version,
      operationId: "g6a-link-after-applied",
      revisionId: editedBranch.branch.currentRevisionId!
    })).rejects.toThrow("application_revision_locked");
  });

  it("updates details with version checks, URL validation, note redaction, archive and restore", async () => {
    const fixture = await setupApplicationFixture();
    const created = await fixture.repository.createApplicationFromBranch({
      branchId: fixture.branch.id,
      expectedBranchRevision: fixture.branch.revision,
      expectedRevisionId: fixture.branch.currentRevisionId!,
      operationId: "g6a-create-details"
    });

    await expect(fixture.repository.updateApplicationDetails({
      applicationId: created.application.id,
      expectedVersion: created.application.version + 1,
      operationId: "g6a-details-conflict",
      note: "conflict"
    })).rejects.toThrow("version_conflict");

    await expect(fixture.repository.updateApplicationDetails({
      applicationId: created.application.id,
      expectedVersion: created.application.version,
      operationId: "g6a-details-url",
      sourceUrl: "javascript:alert(1)"
    })).rejects.toThrow("invalid_url");

    const updated = await fixture.repository.updateApplicationDetails({
      applicationId: created.application.id,
      expectedVersion: created.application.version,
      operationId: "g6a-details-save",
      priority: "high",
      sourceChannel: "referral",
      sourceUrl: "https://jobs.example.com/1",
      deadlineAt: "2026-07-20",
      nextFollowUpAt: "2026-07-10",
      note: "联系 HR，api-key: demo-placeholder",
      tags: ["内推", "重点", "内推"]
    });
    expect(updated.application.note).not.toContain("demo-placeholder");
    expect(updated.application.tags).toEqual(["内推", "重点"]);
    expect(updated.application.timeline.length).toBeGreaterThan(created.application.timeline.length);

    const archived = await fixture.repository.archiveApplication({
      applicationId: updated.application.id,
      expectedVersion: updated.application.version,
      operationId: "g6a-archive-app"
    });
    expect(archived.application.status).toBe("archived");
    const restored = await fixture.repository.restoreApplication({
      applicationId: archived.application.id,
      expectedVersion: archived.application.version,
      operationId: "g6a-restore-app"
    });
    expect(restored.application.status).toBe("preparing");
    expect(restored.application.archivedAt).toBeUndefined();
  });
});

async function setupApplicationFixture() {
  db = new CareerAdaptDb(`CareerAdaptApplicationDb-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const job = demoJobDescriptions[0];
  const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
  await repository.saveProfile(demoCareerProfile);
  await repository.saveJobDescription(job);
  await repository.saveRuleRequirementMatches({ profile: demoCareerProfile, job, matches });
  const draft = await repository.createJobAdaptationDraft({
    profile: demoCareerProfile,
    job,
    matches,
    operationId: "g6a-draft"
  });
  const createdBranch = await repository.createResumeBranchFromDraft({
    draftId: draft.draft.id,
    expectedDraftRevision: draft.draft.revision,
    operationId: "g6a-branch",
    name: "G6a Application Branch"
  });
  const exportRecord = await repository.createResumeExportRecord({
    operationId: "g6a-export",
    branchId: createdBranch.branch.id,
    expectedBranchRevision: createdBranch.branch.revision,
    expectedRevisionId: createdBranch.branch.currentRevisionId!,
    templateId: "classic-technical",
    overflowStatus: "fits_one_page",
    exportStatus: "direct_pdf_success",
    fileName: "g6a.pdf",
    actualPageCount: 1,
    requestedMaxPages: 1,
    pagePolicy: "one_page_strict",
    diagnosticsEngineVersion: "resume-diagnostics.v1",
    diagnosticsSnapshotHash: "diagnostic-hash-123",
    criticalIssueCount: 0,
    warningIssueCount: 0
  });

  return {
    repository,
    branch: createdBranch.branch,
    exportRecord: exportRecord.record
  };
}

async function createSecondBranch(repository: WorkspaceRepository): Promise<ResumeBranch> {
  const job = demoJobDescriptions[1];
  const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
  await repository.saveJobDescription(job);
  await repository.saveRuleRequirementMatches({ profile: demoCareerProfile, job, matches });
  const draft = await repository.createJobAdaptationDraft({
    profile: demoCareerProfile,
    job,
    matches,
    operationId: "g6a-second-draft"
  });
  const created = await repository.createResumeBranchFromDraft({
    draftId: draft.draft.id,
    expectedDraftRevision: draft.draft.revision,
    operationId: "g6a-second-branch",
    name: "G6a Second Branch"
  });
  return created.branch;
}

function createApplicationFixture(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    schemaVersion: "application-v1",
    id: "application-fixture",
    profileId: demoCareerProfile.id,
    jobId: demoJobDescriptions[0].id,
    jobTitleSnapshot: demoJobDescriptions[0].title,
    companySnapshot: demoJobDescriptions[0].company,
    jobSpecificBranchId: "branch-fixture",
    selectedRevisionId: "revision-fixture",
    selectedBranchRevision: 0,
    selectedPresentationRevision: 0,
    selectedTemplateId: "classic-technical",
    selectedPagePolicy: "one_page_strict",
    status: "preparing",
    priority: "normal",
    tags: [],
    timeline: [
      {
        id: "application-event-fixture",
        type: "created",
        occurredAt: TEST_TIME,
        createdAt: TEST_TIME,
        summary: "created",
        operationId: "application-fixture-create"
      }
    ],
    version: 1,
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME,
    ...overrides
  };
}
