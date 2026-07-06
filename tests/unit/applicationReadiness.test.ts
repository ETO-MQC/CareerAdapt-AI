import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { computeApplicationReadiness } from "@/domain/application";
import type {
  ApplicationRecord,
  ApplicationPreparationChecklist,
  ExportRecord,
  ResumeBranch,
  ResumeRevision
} from "@/domain/schemas";

const TEST_TIME = "2026-07-06T10:00:00.000Z";

describe("Application readiness", () => {
  it("reports needs_attention when a valid branch has no export record", () => {
    const readiness = computeApplicationReadiness({
      application: createApplication(),
      job: demoJobDescriptions[0],
      branch: createBranch(),
      revision: createRevision(),
      now: TEST_TIME
    });

    expect(readiness.level).toBe("needs_attention");
    expect(readiness.items.find((item) => item.id === "export")?.level).toBe("needs_attention");
    expect(JSON.stringify(readiness)).not.toMatch(/录用|概率|ATS通过率/);
  });

  it("reports ready when job, branch, revision, export, guard, pagination, and diagnostics are ready", () => {
    const readiness = computeApplicationReadiness({
      application: createApplication({
        selectedExportRecordId: "export-ready",
        diagnosticSummary: {
          diagnosticsEngineVersion: "resume-diagnostics.v1",
          diagnosticsSnapshotHash: "diagnostic-ready",
          criticalIssueCount: 0,
          warningIssueCount: 0
        }
      }),
      job: demoJobDescriptions[0],
      branch: createBranch(),
      revision: createRevision(),
      exportRecord: createExportRecord(),
      preparationChecklist: createReadyPreparationChecklist(),
      now: TEST_TIME
    });

    expect(readiness.level).toBe("ready");
    expect(readiness.items.every((item) => item.level === "ready")).toBe(true);
  });

  it("blocks missing branches, missing revisions, invalid references, and page overflow", () => {
    const missingBranch = computeApplicationReadiness({
      application: createApplication(),
      job: demoJobDescriptions[0],
      now: TEST_TIME
    });
    expect(missingBranch.level).toBe("blocked");

    const invalidBranch = computeApplicationReadiness({
      application: createApplication(),
      job: demoJobDescriptions[0],
      branch: {
        ...createBranch(),
        syncStatusCache: {
          ...createBranch().syncStatusCache,
          status: "invalid_reference",
          invalidFactRefs: ["fact-missing"],
          message: "invalid"
        }
      },
      revision: createRevision(),
      now: TEST_TIME
    });
    expect(invalidBranch.level).toBe("blocked");

    const overflow = computeApplicationReadiness({
      application: createApplication({ selectedExportRecordId: "export-overflow" }),
      job: demoJobDescriptions[0],
      branch: createBranch(),
      revision: createRevision(),
      exportRecord: createExportRecord({
        id: "export-overflow",
        exportStatus: "blocked_overflow",
        overflowStatus: "exceeds_two_pages",
        exceededPageLimit: true
      }),
      now: TEST_TIME
    });
    expect(overflow.level).toBe("blocked");
    expect(overflow.items.find((item) => item.id === "page_policy")?.level).toBe("blocked");
  });

  it("does not hard-block normal diagnostic warnings", () => {
    const readiness = computeApplicationReadiness({
      application: createApplication({
        selectedExportRecordId: "export-warning",
        diagnosticSummary: {
          diagnosticsEngineVersion: "resume-diagnostics.v1",
          diagnosticsSnapshotHash: "diagnostic-warning",
          criticalIssueCount: 0,
          warningIssueCount: 2
        }
      }),
      job: demoJobDescriptions[0],
      branch: createBranch(),
      revision: createRevision(),
      exportRecord: createExportRecord({ id: "export-warning" }),
      now: TEST_TIME
    });

    expect(readiness.level).toBe("needs_attention");
    expect(readiness.items.find((item) => item.id === "diagnostics")?.level).toBe("needs_attention");
    expect(readiness.items.find((item) => item.id === "diagnostics")?.message).toContain("用户可自行决定");
  });
});

function createApplication(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    schemaVersion: "application-v1",
    id: "application-readiness",
    profileId: demoCareerProfile.id,
    jobId: demoJobDescriptions[0].id,
    jobTitleSnapshot: demoJobDescriptions[0].title,
    companySnapshot: demoJobDescriptions[0].company,
    jobSpecificBranchId: "branch-readiness",
    selectedRevisionId: "revision-readiness",
    selectedBranchRevision: 0,
    selectedPresentationRevision: 0,
    selectedTemplateId: "classic-technical",
    selectedPagePolicy: "one_page_strict",
    status: "preparing",
    priority: "normal",
    tags: [],
    timeline: [
      {
        id: "event-readiness",
        type: "created",
        occurredAt: TEST_TIME,
        createdAt: TEST_TIME,
        summary: "created",
        operationId: "create-readiness"
      }
    ],
    version: 1,
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME,
    ...overrides
  };
}

function createReadyPreparationChecklist(): ApplicationPreparationChecklist {
  return {
    level: "ready",
    items: [
      {
        id: "cover_letter",
        label: "求职信",
        status: "completed",
        level: "ready",
        materialType: "cover_letter",
        message: "ready"
      },
      {
        id: "application_email",
        label: "投递邮件草稿",
        status: "not_needed",
        level: "ready",
        materialType: "application_email",
        message: "ready"
      }
    ],
    updatedAt: TEST_TIME
  };
}

function createBranch(): ResumeBranch {
  const statement = demoCareerProfile.experiences[0].facts[0].statement;
  return {
    id: "branch-readiness",
    branchPurpose: "job_specific",
    profileId: demoCareerProfile.id,
    jobId: demoJobDescriptions[0].id,
    name: "Readiness Branch",
    sourceProfileVersion: demoCareerProfile.version,
    sourceJobVersion: demoJobDescriptions[0].updatedAt,
    sourceAdaptationDraftId: "draft-readiness",
    sourceDraftRevision: 0,
    matcherVersion: "evidence-matcher.v1",
    sourceMatchSetHash: "readinesshash",
    requirementMatchIds: ["match-readiness"],
    revision: 0,
    currentRevisionId: "revision-readiness",
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
        id: "item-readiness",
        itemType: "experience",
        source: "adaptation_draft",
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

function createRevision(): ResumeRevision {
  const branch = createBranch();
  return {
    id: "revision-readiness",
    branchId: branch.id,
    revisionNumber: 0,
    source: "created",
    operationId: "revision-readiness-op",
    snapshot: {
      name: branch.name,
      lifecycleStatus: branch.lifecycleStatus,
      contentItems: branch.contentItems
    },
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME
  };
}

function createExportRecord(overrides: Partial<ExportRecord> = {}): ExportRecord {
  return {
    id: "export-ready",
    operationId: "export-ready-op",
    branchId: "branch-readiness",
    revisionId: "revision-readiness",
    branchRevision: 0,
    templateId: "classic-technical",
    format: "pdf",
    fileName: "ready.pdf",
    displayName: "ready.pdf",
    exportStatus: "direct_pdf_success",
    overflowStatus: "fits_one_page",
    exportedAt: TEST_TIME,
    actualPageCount: 1,
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME,
    ...overrides
  };
}
