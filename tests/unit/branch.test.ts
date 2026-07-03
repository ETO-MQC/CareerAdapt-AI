import Dexie, { type Table } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { mapAdaptationDraftToResumeBranch } from "@/domain/branch/mapper";
import { createJobAdaptationDraft } from "@/domain/adaptation/draft";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { createRuleRequirementMatches, resolveEffectiveMatch } from "@/domain/match/matcher";
import { CareerAdaptDb } from "@/services/storage/db";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";
import type { AiSuggestion } from "@/domain/schemas";

const TEST_TIME = "2026-07-02T12:00:00.000Z";

let db: CareerAdaptDb | undefined;

class LegacyV4BranchDb extends Dexie {
  resumeBranches!: Table<Record<string, unknown>, string>;
  exportRecords!: Table<Record<string, unknown>, string>;

  constructor(name: string) {
    super(name);
    this.version(4).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      rawInputs: "id, kind, inputHash, updatedAt",
      profileImportDrafts: "id, rawInputId, status, updatedAt",
      jobAnalysisDrafts: "id, rawInputId, status, updatedAt",
      draftCommits: "commitId, draftId, kind, entityId",
      requirementMatches: "id, [profileId+jobId], requirementId, isStale, updatedAt",
      matchOperations: "id, operationId, requirementMatchId, [profileId+jobId], type, occurredAt",
      jobAdaptationDrafts: "id, [profileId+jobId], status, updatedAt",
      aiSuggestions: "id, draftId, status, type, updatedAt",
      adaptationSnapshots: "id, draftId, revision, operationId, updatedAt",
      suggestionOperations: "id, operationId, draftId, suggestionId, type, occurredAt",
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

describe("D1 resume branch domain", () => {
  it("maps a non-stale adaptation draft into a verified branch and first revision", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const draft = createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d1-map-create",
      now: TEST_TIME
    });

    const result = mapAdaptationDraftToResumeBranch({
      draft,
      suggestions: [],
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d1-map-branch",
      name: "D1 mapped branch",
      now: TEST_TIME
    });

    expect(result.branch.migrationStatus).toBe("verified");
    expect(result.branch.contentItems.length).toBeGreaterThan(0);
    expect(result.branch.contentItems[0].factRefs.length).toBeGreaterThan(0);
    expect(result.firstRevision.revisionNumber).toBe(0);
    expect(result.firstRevision.previousRevisionId).toBeUndefined();
    expect(result.firstRevision.snapshot).not.toHaveProperty("syncStatusCache");
    expect(result.firstRevision.snapshot).not.toHaveProperty("revision");
    expect(result.firstRevision.snapshot).not.toHaveProperty("currentRevisionId");
  });

  it("allows ai_failed_rule_kept only as rule_only_verified when rule findings have no high block", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const draft = createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d1-rule-only-create",
      now: TEST_TIME
    });
    const section = draft.sectionTexts[0];
    const match = matches.find((item) => resolveEffectiveMatch(item).evidenceRefs.length > 0)!;
    const evidenceRef = resolveEffectiveMatch(match).evidenceRefs[0];
    const guard = runRuleFactGuard({
      originalText: section.originalText,
      checkedText: section.originalText,
      usedEvidenceRefs: [evidenceRef],
      now: TEST_TIME
    });
    const suggestion: AiSuggestion = {
      id: "suggestion-rule-only",
      draftId: draft.id,
      targetSectionId: section.sectionId,
      type: "rewrite",
      originalText: section.originalText,
      suggestedText: section.originalText,
      reason: "Rule-only verification test.",
      requirementIds: [match.requirementId],
      usedEvidenceRefs: [evidenceRef],
      guardResult: { ...guard, status: "ai_failed_rule_kept" },
      riskLevel: "low",
      status: "accepted",
      promptVersion: "resume-tailor.v1",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    const result = mapAdaptationDraftToResumeBranch({
      draft,
      suggestions: [suggestion],
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d1-rule-only-branch",
      name: "Rule only branch",
      now: TEST_TIME
    });

    expect(result.branch.contentItems[0].guardMode).toBe("rule_only_verified");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("blocks stale source versions before branch creation", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const draft = createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d1-stale-create",
      now: TEST_TIME
    });

    expect(() => mapAdaptationDraftToResumeBranch({
      draft,
      suggestions: [],
      profile: { ...demoCareerProfile, version: demoCareerProfile.version + 1 },
      job,
      matches,
      operationId: "d1-stale-branch",
      name: "Stale branch",
      now: TEST_TIME
    })).toThrow("draft_profile_version_stale");
  });
});

describe("D1 resume branch repository", () => {
  it("creates branch and first revision atomically, edits with rule guard, and undoes through previousRevisionId", async () => {
    db = new CareerAdaptDb(`CareerAdaptD1Db-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    await repository.saveProfile(demoCareerProfile);
    await repository.saveJobDescription(job);
    await repository.saveRuleRequirementMatches({ profile: demoCareerProfile, job, matches });
    const createdDraft = await repository.createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d1-repo-draft"
    });

    const created = await repository.createResumeBranchFromDraft({
      draftId: createdDraft.draft.id,
      expectedDraftRevision: createdDraft.draft.revision,
      operationId: "d1-repo-create",
      name: "Repository D1 branch"
    });
    const duplicate = await repository.createResumeBranchFromDraft({
      draftId: createdDraft.draft.id,
      expectedDraftRevision: createdDraft.draft.revision,
      operationId: "d1-repo-create",
      name: "Repository D1 branch"
    });

    expect(created.idempotent).toBe(false);
    expect(duplicate.idempotent).toBe(true);
    expect(await repository.listResumeRevisions(created.branch.id)).toHaveLength(1);

    await expect(repository.editResumeBranch({
      branchId: created.branch.id,
      expectedRevision: created.branch.revision,
      operationId: "d1-repo-edit-blocked",
      edits: [{ itemId: created.branch.contentItems[0].id, text: `${created.branch.contentItems[0].text} 30%` }]
    })).rejects.toThrow("branch_edit_fact_guard_blocked");

    const edited = await repository.editResumeBranch({
      branchId: created.branch.id,
      expectedRevision: created.branch.revision,
      operationId: "d1-repo-edit-safe",
      edits: [{ itemId: created.branch.contentItems[0].id, text: created.branch.contentItems[0].text }]
    });
    expect(edited.branch.revision).toBe(1);
    expect(edited.revision?.previousRevisionId).toBe(created.branch.currentRevisionId);
    expect(edited.revision?.snapshot).not.toHaveProperty("syncStatusCache");

    await expect(repository.editResumeBranch({
      branchId: edited.branch.id,
      expectedRevision: created.branch.revision,
      operationId: "d1-repo-edit-conflict",
      edits: [{ itemId: edited.branch.contentItems[0].id, text: edited.branch.contentItems[0].text }]
    })).rejects.toBeInstanceOf(RevisionConflictError);

    const undone = await repository.undoResumeBranch({
      branchId: edited.branch.id,
      expectedRevision: edited.branch.revision,
      operationId: "d1-repo-undo"
    });
    expect(undone.branch.revision).toBe(2);
    expect(undone.revision?.previousRevisionId).toBe(edited.branch.currentRevisionId);

    const exportRecord = await repository.createResumeExportRecord({
      operationId: "d2-repo-export",
      branchId: undone.branch.id,
      expectedBranchRevision: undone.branch.revision,
      expectedRevisionId: undone.branch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "fits",
      exportStatus: "print_invoked",
      fileName: "d2-export.pdf"
    });
    const duplicateExport = await repository.createResumeExportRecord({
      operationId: "d2-repo-export",
      branchId: undone.branch.id,
      expectedBranchRevision: undone.branch.revision,
      expectedRevisionId: undone.branch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "fits",
      exportStatus: "print_invoked",
      fileName: "d2-export.pdf"
    });

    expect(exportRecord.idempotent).toBe(false);
    expect(duplicateExport.idempotent).toBe(true);
    expect(exportRecord.record.branchRevision).toBe(undone.branch.revision);
    expect(exportRecord.record.exportStatus).toBe("print_invoked");

    await expect(repository.createResumeExportRecord({
      operationId: "d2-repo-export-overflow",
      branchId: undone.branch.id,
      expectedBranchRevision: undone.branch.revision,
      expectedRevisionId: undone.branch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "overflow",
      exportStatus: "print_invoked",
      fileName: "d2-overflow.pdf"
    })).rejects.toThrow("export_overflow_blocked");

    await expect(repository.createResumeExportRecord({
      operationId: "d2-repo-export-stale",
      branchId: edited.branch.id,
      expectedBranchRevision: created.branch.revision,
      expectedRevisionId: created.branch.currentRevisionId!,
      templateId: "classic-technical",
      overflowStatus: "fits",
      exportStatus: "print_invoked",
      fileName: "d2-stale.pdf"
    })).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("migrates legacy v4 placeholder branches as read-only legacy_unverified", async () => {
    const dbName = `CareerAdaptD1MigrationDb-${crypto.randomUUID()}`;
    const legacy = new LegacyV4BranchDb(dbName);
    await legacy.open();
    await legacy.resumeBranches.put({
      id: "legacy-branch",
      profileId: demoCareerProfile.id,
      jobId: demoJobDescriptions[0].id,
      name: "Legacy placeholder",
      selectedItems: [{ experienceId: "exp", order: 0, visible: true }],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });
    await legacy.exportRecords.put({
      id: "legacy-export",
      branchId: "legacy-branch",
      revisionId: "legacy-revision",
      templateId: "a4-probe",
      format: "pdf",
      fileName: "legacy.pdf",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });
    legacy.close();

    db = new CareerAdaptDb(dbName);
    const repository = new WorkspaceRepository(db);
    const branches = await repository.listResumeBranches();

    expect(branches).toHaveLength(1);
    expect(branches[0].migrationStatus).toBe("legacy_unverified");
    expect(branches[0].legacyPayload).toBeDefined();
    await expect(repository.editResumeBranch({
      branchId: branches[0].id,
      expectedRevision: branches[0].revision,
      operationId: "d1-edit-legacy",
      edits: []
    })).rejects.toThrow("legacy_resume_branch_read_only");

    await expect(repository.createResumeExportRecord({
      operationId: "d2-export-legacy",
      branchId: branches[0].id,
      expectedBranchRevision: branches[0].revision,
      expectedRevisionId: branches[0].currentRevisionId ?? "legacy-revision",
      templateId: "classic-technical",
      overflowStatus: "fits",
      exportStatus: "print_invoked",
      fileName: "legacy.pdf"
    })).rejects.toThrow("legacy_branch_cannot_export");

    const exported = await repository.exportWorkspaceJson();
    expect(exported.exportRecords[0]).toMatchObject({
      operationId: "legacy-export",
      branchRevision: 0,
      exportStatus: "print_invoked",
      overflowStatus: "fits"
    });
  });

  it("keeps edit operationId idempotent and blocks archived or invalid-reference edits", async () => {
    db = new CareerAdaptDb(`CareerAdaptV2G0aBranchDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    await repository.saveProfile(demoCareerProfile);
    await repository.saveJobDescription(job);
    await repository.saveRuleRequirementMatches({ profile: demoCareerProfile, job, matches });
    const createdDraft = await repository.createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "v2-g0a-repo-draft"
    });
    const created = await repository.createResumeBranchFromDraft({
      draftId: createdDraft.draft.id,
      expectedDraftRevision: createdDraft.draft.revision,
      operationId: "v2-g0a-repo-create",
      name: "V2 G0a branch"
    });
    const item = created.branch.contentItems[0];
    const editInput = {
      branchId: created.branch.id,
      expectedRevision: created.branch.revision,
      operationId: "v2-g0a-idempotent-edit",
      edits: [{ itemId: item.id, text: `${item.text}.` }]
    };

    const edited = await repository.editResumeBranch(editInput);
    const duplicate = await repository.editResumeBranch(editInput);
    expect(edited.idempotent).toBe(false);
    expect(duplicate.idempotent).toBe(true);
    expect(await repository.listResumeRevisions(created.branch.id)).toHaveLength(2);

    const isolated = await repository.createResumeBranchFromDraft({
      draftId: createdDraft.draft.id,
      expectedDraftRevision: createdDraft.draft.revision,
      operationId: "v2-g0a-repo-create-isolated",
      name: "V2 G0a isolated branch"
    });
    const isolatedBefore = JSON.stringify(isolated.branch.contentItems);
    const branchAfterIsolationEdit = await repository.editResumeBranch({
      branchId: edited.branch.id,
      expectedRevision: edited.branch.revision,
      operationId: "v2-g0a-branch-isolation-edit",
      edits: [{ itemId: item.id, text: `${item.text}..` }]
    });
    const isolatedAfter = (await repository.listResumeBranches(demoCareerProfile.id))
      .find((branch) => branch.id === isolated.branch.id);
    expect(isolatedAfter?.revision).toBe(isolated.branch.revision);
    expect(JSON.stringify(isolatedAfter?.contentItems)).toBe(isolatedBefore);

    await expect(repository.editResumeBranch({
      branchId: edited.branch.id,
      expectedRevision: created.branch.revision,
      operationId: "v2-g0a-conflict-edit",
      edits: [{ itemId: item.id, text: `${item.text}.` }]
    })).rejects.toBeInstanceOf(RevisionConflictError);

    const archived = await repository.archiveResumeBranch({
      branchId: branchAfterIsolationEdit.branch.id,
      expectedRevision: branchAfterIsolationEdit.branch.revision,
      operationId: "v2-g0a-archive",
      confirmedImpact: true
    });
    await expect(repository.editResumeBranch({
      branchId: archived.branch.id,
      expectedRevision: archived.branch.revision,
      operationId: "v2-g0a-edit-archived",
      edits: [{ itemId: item.id, text: `${item.text}..` }]
    })).rejects.toThrow("archived_resume_branch_read_only");

    const invalid = {
      ...created.branch,
      id: "v2-g0a-invalid-reference-branch",
      currentRevisionId: created.branch.currentRevisionId,
      syncStatusCache: {
        ...created.branch.syncStatusCache,
        status: "invalid_reference" as const,
        invalidFactRefs: ["missing-fact"],
        message: "invalid"
      }
    };
    await repository.saveResumeBranch(invalid);
    await expect(repository.editResumeBranch({
      branchId: invalid.id,
      expectedRevision: invalid.revision,
      operationId: "v2-g0a-edit-invalid-reference",
      edits: [{ itemId: invalid.contentItems[0].id, text: `${invalid.contentItems[0].text}.` }]
    })).rejects.toThrow("invalid_reference_resume_branch_read_only");
  });
});
