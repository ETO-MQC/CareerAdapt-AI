import Dexie, { type Table } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { mapAdaptationDraftToResumeBranch } from "@/domain/branch/mapper";
import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import { createJobAdaptationDraft } from "@/domain/adaptation/draft";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { createRuleRequirementMatches, resolveEffectiveMatch } from "@/domain/match/matcher";
import { migrateCareerProfileToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { CareerProfileSchema, ResumeItemV2Schema, ResumeRevisionSchema, ResumeBranchSchema } from "@/domain/schemas";
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
  it("builds profile-backed and blank general branches with independent basic information", () => {
    const fromProfile = buildGeneralBranchFromProfile({
      profile: demoCareerProfile,
      operationId: "g7b5-from-profile",
      name: "资料库简历",
      includeProfileFacts: true,
      includeProfileBasics: true,
      now: TEST_TIME
    });
    const blank = buildGeneralBranchFromProfile({
      profile: demoCareerProfile,
      operationId: "g7b5-blank",
      name: "空白简历",
      includeProfileFacts: false,
      includeProfileBasics: false,
      now: TEST_TIME
    });

    expect(fromProfile.branch.branchPurpose).toBe("general");
    expect(fromProfile.branch.resumeBasics?.name).toBe(demoCareerProfile.basics.name);
    expect(fromProfile.branch.contentItems.some((item) => item.factRefs.length > 0)).toBe(true);
    expect(blank.branch.resumeBasics?.name).toBe("");
    expect(blank.branch.contentItems).toHaveLength(1);
    expect(blank.branch.contentItems[0]).toMatchObject({ itemType: "structural", visible: false, factRefs: [] });
    expect(blank.firstRevision.snapshot.resumeBasics?.name).toBe("");
  });

  it("persists blank resume basics and keeps newly confirmed content resume-only by default", async () => {
    db = new CareerAdaptDb(`CareerAdaptG7b5Db-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(demoCareerProfile);
    const created = await repository.createGeneralResumeBranch({
      profileId: demoCareerProfile.id,
      operationId: "g7b5-create-blank-repository",
      name: "空白简历",
      includeProfileFacts: false,
      includeProfileBasics: false
    });
    const basics = await repository.editResumeBranchBasics({
      branchId: created.branch.id,
      expectedRevision: created.branch.revision,
      operationId: "g7b5-edit-basics-repository",
      basics: { name: "独立简历姓名", targetRole: "测试工程师", email: "resume@example.com" }
    });
    await expect(repository.renameResumeBranch({
      branchId: basics.branch.id,
      expectedRevision: basics.branch.revision,
      operationId: "g7b5-reject-empty-branch-name",
      name: "   "
    })).rejects.toThrow("resume_branch_name_required");
    const added = await repository.addResumeContentItem({
      branchId: basics.branch.id,
      expectedRevision: basics.branch.revision,
      operationId: "g7b5-add-confirmed-experience",
      section: "experience",
      itemType: "experience",
      text: "示例公司 / 工程师  上海  2024 - 至今\n负责产品开发",
      organization: "示例公司",
      role: "工程师",
      startDate: "2024-01-01"
    });
    const savedProfile = await repository.getProfile(demoCareerProfile.id);
    const addedItem = added.branch.contentItems.find((item) => item.id === added.newItemId);

    expect(basics.branch.resumeBasics).toMatchObject({ name: "独立简历姓名", targetRole: "测试工程师", email: "resume@example.com" });
    expect((await repository.listResumeRevisions(basics.branch.id)).some((revision) => revision.snapshot.resumeBasics?.targetRole === "测试工程师")).toBe(true);
    expect(added.branch.revision).toBe(2);
    expect(addedItem?.factRefs).toHaveLength(0);
    expect(addedItem?.userConfirmation?.scope).toBe("resume_only");
    expect(savedProfile?.version).toBe(demoCareerProfile.version);
    expect(savedProfile?.experiences.some((item) => item.organization === "示例公司")).toBe(false);

    const edited = await repository.editResumeBranch({
      branchId: added.branch.id,
      expectedRevision: added.branch.revision,
      operationId: "g7b5-edit-resume-only-experience",
      confirmAsResumeOnly: true,
      edits: [{ itemId: added.newItemId, text: "新公司 / 高级工程师\n负责新的产品交付" }]
    });
    expect(edited.branch.contentItems.find((item) => item.id === added.newItemId)).toMatchObject({
      text: "新公司 / 高级工程师\n负责新的产品交付",
      factRefs: [],
      userConfirmation: { scope: "resume_only" }
    });

    const synced = await repository.syncResumeContentItemToProfile({
      branchId: edited.branch.id,
      expectedRevision: edited.branch.revision,
      operationId: "g7b5-sync-resume-only-experience",
      itemId: added.newItemId,
      organization: "新公司",
      role: "高级工程师"
    });
    const syncedProfile = await repository.getProfile(demoCareerProfile.id);
    expect(synced.branch.contentItems.find((item) => item.id === added.newItemId)?.userConfirmation).toBeUndefined();
    expect(synced.branch.contentItems.find((item) => item.id === added.newItemId)?.factRefs).toHaveLength(1);
    expect(syncedProfile?.version).toBe(demoCareerProfile.version + 1);
    expect(syncedProfile?.experiences.some((item) => item.organization === "新公司" && item.role === "高级工程师")).toBe(true);
  });

  it("normalizes award dates and syncs profile changes back to an existing resume item", async () => {
    db = new CareerAdaptDb(`CareerAdaptAwardSyncDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const baseProfile = migrateCareerProfileToV2(demoCareerProfile);
    const awardFactId = demoCareerProfile.experiences[0]!.facts[0]!.id;
    const award = ResumeItemV2Schema.parse({
      id: "award-sync",
      sectionType: "awards",
      name: "测试奖项",
      issuer: "测试机构",
      awardedAt: "2025-05",
      customFields: []
    });
    const profile = CareerProfileSchema.parse({
      ...baseProfile,
      structuredFacts: [
        ...baseProfile.structuredFacts,
        { data: award, factIds: [awardFactId], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }
      ]
    });
    await repository.saveProfile(profile);
    const blank = await repository.createGeneralResumeBranch({
      profileId: profile.id,
      operationId: "award-sync-create",
      name: "奖项同步简历",
      includeProfileFacts: false,
      includeProfileBasics: false
    });
    const created = await repository.addResumeContentItemFromProfileReference({
      branchId: blank.branch.id,
      expectedRevision: blank.branch.revision,
      operationId: "award-sync-add-from-profile",
      section: "awards",
      reference: { type: "canonical", itemId: award.id, sectionType: "awards" }
    });
    const createdAward = created.branch.structuredContentItems?.find((item) => item.data.id === award.id);
    expect(createdAward?.data.sectionType === "awards" ? createdAward.data.awardedAt : undefined).toBe("2025-05");

    const storedProfile = CareerProfileSchema.parse(await db.profiles.get(profile.id));
    const staleDayProfile = CareerProfileSchema.parse({
      ...storedProfile,
      version: storedProfile.version + 1,
      updatedAt: "2026-07-02T12:00:00.000Z",
      structuredFacts: storedProfile.structuredFacts?.map((entry) => entry.data.id === award.id
        ? { ...entry, data: { ...entry.data, awardedAt: "2025-05-20" } }
        : entry)
    });
    await db.profiles.put(staleDayProfile);
    const latestProfile = await repository.getProfile(profile.id);
    const latestAward = latestProfile?.structuredFacts?.find((entry) => entry.data.id === award.id);
    expect(latestAward?.data.sectionType).toBe("awards");
    expect(latestAward?.data.sectionType === "awards" ? latestAward.data.awardedAt : undefined).toBe("2025-05");

    const syncedFromProfile = await repository.syncResumeBranchFromProfile({
      branchId: created.branch.id,
      expectedRevision: created.branch.revision,
      operationId: "award-sync-from-profile",
      basics: {},
      structuredItems: latestAward && latestAward.data.sectionType === "awards" && createdAward
        ? [{ itemId: createdAward.id, data: latestAward.data }]
        : []
    });
    const syncedAward = syncedFromProfile.branch.structuredContentItems?.find((item) => item.id === createdAward?.id);
    expect(syncedAward?.data.sectionType).toBe("awards");
    expect(syncedAward?.data.sectionType === "awards" ? syncedAward.data.awardedAt : undefined).toBe("2025-05");
    expect(syncedAward?.legacyTextProjection).toContain("2025-05");

    const editedAward = ResumeItemV2Schema.parse({ ...syncedAward?.data, awardedAt: "2025-06-20" });
    const edited = await repository.editResumeBranch({
      branchId: syncedFromProfile.branch.id,
      expectedRevision: syncedFromProfile.branch.revision,
      operationId: "award-sync-manual-edit",
      confirmAsResumeOnly: true,
      edits: [{ itemId: syncedAward!.id, text: projectResumeItemV2(editedAward), structuredItem: editedAward }]
    });
    await repository.syncResumeContentItemToProfile({
      branchId: edited.branch.id,
      expectedRevision: edited.branch.revision,
      operationId: "award-sync-to-profile",
      itemId: syncedAward!.id,
      structuredItem: editedAward
    });
    const profileAfterManualSync = await repository.getProfile(profile.id);
    const awardAfterManualSync = profileAfterManualSync?.structuredFacts?.find((entry) => entry.data.id === award.id);
    expect(awardAfterManualSync?.data.sectionType === "awards" ? awardAfterManualSync.data.awardedAt : undefined).toBe("2025-06");
  });

  it("adds confirmed profile experience to a resume without duplicating profile data", async () => {
    db = new CareerAdaptDb(`CareerAdaptG7b5LibraryDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(demoCareerProfile);
    const created = await repository.createGeneralResumeBranch({
      profileId: demoCareerProfile.id,
      operationId: "g7b5-library-blank",
      name: "资料库选择测试",
      includeProfileFacts: false,
      includeProfileBasics: false
    });
    const experience = demoCareerProfile.experiences[0];
    const fact = experience.facts[0];
    const added = await repository.addResumeContentItemFromProfile({
      branchId: created.branch.id,
      expectedRevision: created.branch.revision,
      operationId: "g7b5-use-profile-experience",
      section: "experience",
      experienceId: experience.id,
      factId: fact.id
    });
    const savedProfile = await repository.getProfile(demoCareerProfile.id);
    expect(added.branch.contentItems.find((item) => item.id === added.newItemId)?.factRefs).toEqual([{
      type: "experience_fact",
      experienceId: experience.id,
      factId: fact.id
    }]);
    expect(savedProfile?.version).toBe(demoCareerProfile.version);
  });

  it("reuses skills and certificates by fact reference and rejects duplicates", async () => {
    db = new CareerAdaptDb(`CareerAdaptP32LibraryDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(demoCareerProfile);
    const created = await repository.createGeneralResumeBranch({
      profileId: demoCareerProfile.id,
      operationId: "p32-library-blank",
      name: "P3.2 资料库复用",
      includeProfileFacts: false,
      includeProfileBasics: false
    });
    const skill = demoCareerProfile.skills[0];
    const skillFact = skill.fact!;
    const skillAdded = await repository.addResumeContentItemFromProfileReference({
      branchId: created.branch.id,
      expectedRevision: created.branch.revision,
      operationId: "p32-use-skill",
      section: "skills",
      reference: { type: "skill", skillId: skill.id, factId: skillFact.id }
    });
    expect(skillAdded.branch.contentItems.find((item) => item.id === skillAdded.newItemId)?.factRefs).toEqual([{
      type: "skill_fact",
      skillId: skill.id,
      factId: skillFact.id
    }]);

    await expect(repository.addResumeContentItemFromProfileReference({
      branchId: skillAdded.branch.id,
      expectedRevision: skillAdded.branch.revision,
      operationId: "p32-use-skill-duplicate",
      section: "skills",
      reference: { type: "skill", skillId: skill.id, factId: skillFact.id }
    })).rejects.toThrow("profile_item_already_used");

    const certificate = demoCareerProfile.certificates[0];
    const certificateAdded = await repository.addResumeContentItemFromProfileReference({
      branchId: skillAdded.branch.id,
      expectedRevision: skillAdded.branch.revision,
      operationId: "p32-use-certificate",
      section: "certificates",
      reference: { type: "certificate", certificateId: certificate.id, factId: certificate.fact!.id }
    });
    expect(certificateAdded.branch.contentItems.find((item) => item.id === certificateAdded.newItemId)?.itemType).toBe("certificate");
  });

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

    const restored = await repository.restoreArchivedResumeBranch({
      branchId: archived.branch.id,
      expectedRevision: archived.branch.revision,
      operationId: "p33-restore-archived"
    });
    expect(restored.branch.lifecycleStatus).toBe("active");
    const reArchived = await repository.archiveResumeBranch({
      branchId: restored.branch.id,
      expectedRevision: restored.branch.revision,
      operationId: "p33-rearchive",
      confirmedImpact: true
    });
    const trashed = await repository.moveResumeBranchToTrash({
      branchId: reArchived.branch.id,
      expectedRevision: reArchived.branch.revision,
      operationId: "p33-trash"
    });
    expect(trashed.branch.lifecycleStatus).toBe("trashed");
    const restoredToArchive = await repository.restoreResumeBranchFromTrash({
      branchId: trashed.branch.id,
      expectedRevision: trashed.branch.revision,
      operationId: "p33-restore-trash"
    });
    expect(restoredToArchive.branch.lifecycleStatus).toBe("archived");
    const trashedAgain = await repository.moveResumeBranchToTrash({
      branchId: restoredToArchive.branch.id,
      expectedRevision: restoredToArchive.branch.revision,
      operationId: "p33-trash-again"
    });
    const permanentlyDeleted = await repository.deleteResumeBranchPermanently({
      branchId: trashedAgain.branch.id,
      expectedRevision: trashedAgain.branch.revision
    });
    expect(permanentlyDeleted.deleted).toBe(true);
    expect(await repository.getResumeBranch(trashedAgain.branch.id)).toBeUndefined();
    expect(await repository.listResumeRevisions(trashedAgain.branch.id)).toHaveLength(0);

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
    const archivedInvalid = await repository.archiveResumeBranch({
      branchId: invalid.id,
      expectedRevision: invalid.revision,
      operationId: "v2-g0a-archive-invalid-reference",
      confirmedImpact: true
    });
    expect(archivedInvalid.branch.lifecycleStatus).toBe("archived");
  });

  it("parses ResumeRevision with null previousRevisionId and restoredFromRevisionId from IndexedDB", () => {
    // IndexedDB serializes undefined as null, which must be accepted by the schema.
    // Regression test for the ZodError seen during listResumeRevisions.
    const parsed = ResumeRevisionSchema.parse({
      id: "rev-null-test",
      branchId: "branch-1",
      revisionNumber: 0,
      source: "created",
      operationId: "op-null-test",
      previousRevisionId: null,
      restoredFromRevisionId: null,
      snapshot: {
        name: "test",
        lifecycleStatus: "active",
        contentItems: []
      },
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });
    expect(parsed.previousRevisionId == null).toBe(true);
    expect(parsed.restoredFromRevisionId == null).toBe(true);
  });

  it("parses ResumeBranch with null currentRevisionId from IndexedDB", () => {
    // Regression test for the same IndexedDB null serialization issue.
    const parsed = ResumeBranchSchema.parse({
      id: "branch-null-test",
      profileId: demoCareerProfile.id,
      jobId: demoJobDescriptions[0].id,
      name: "null revision test",
      sourceProfileVersion: 1,
      sourceJobVersion: "v1",
      sourceAdaptationDraftId: "draft-1",
      sourceDraftRevision: 0,
      matcherVersion: "rule-matcher.v1",
      sourceMatchSetHash: "hash12345678",
      requirementMatchIds: ["match-1"],
      revision: 0,
      currentRevisionId: null,
      lifecycleStatus: "active",
      migrationStatus: "legacy_unverified",
      syncStatusCache: {
        status: "in_sync",
        sourceProfileVersion: 1,
        currentProfileVersion: 1,
        sourceJobVersion: "v1",
        currentJobVersion: "v1",
        invalidFactRefs: [],
        checkedAt: TEST_TIME,
        message: "ok"
      },
      contentItems: [],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });
    expect(parsed.currentRevisionId == null).toBe(true);
  });
});
