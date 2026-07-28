import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { BranchContentItemSchema, CareerProfileSchema } from "@/domain/schemas";
import { adaptConversationMessageToIntakeDraft } from "@/domain/profileIntake/ConversationIntakeAdapter";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

describe("P4.2a.3f profile commit and General Resume bootstrap", () => {
  it("commits CareerProfile first, then creates a usable General Resume without a blank dependency", async () => {
    const repository = createRepository();
    const profile = emptyProfile("profile-no-resume", "示例用户");
    await repository.saveProfile(profile);
    const prepared = adaptConversationMessageToIntakeDraft({
      sessionId: "session-no-resume",
      messageId: "message-no-resume",
      turnId: "turn-no-resume",
      text: "示例大学计算机相关专业。开发 ESP32 心跳与摔倒检测课程项目。开发 CareerAdapt AI 简历制作平台。",
      capturedAt: "2026-07-27T10:09:56.725Z"
    });
    const saved = await repository.saveImportedResumeDraft(prepared.draft, 0);
    const plan = await repository.reconcileImportedResume({
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      profileId: profile.id
    });
    expect(plan.status).toBe("ready");

    const committed = await repository.confirmProfileIntake({
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      expectedReconciliationRevision: plan.revision,
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version,
      operationId: "profile-intake-commit-no-resume"
    });
    expect(committed.profileVersion).toBe(2);
    expect(committed.committedItemCount).toBeGreaterThanOrEqual(3);
    expect(await repository.listResumeBranches(profile.id)).toHaveLength(0);
    const storedProfile = await repository.getProfile(profile.id);
    expect(storedProfile?.experiences.length).toBeGreaterThanOrEqual(3);

    const resume = await repository.ensureGeneralResumeFromProfile({
      profileId: profile.id,
      operationId: "profile-intake-bootstrap-no-resume"
    });
    expect(resume.mode).toBe("created");
    expect(resume.branch.profileId).toBe(profile.id);
    expect(resume.branch.contentItems.some((item) => item.visible && item.factRefs.length > 0)).toBe(true);
    expect(resume.revision?.id).toBe(resume.branch.currentRevisionId);

    const repeated = await repository.ensureGeneralResumeFromProfile({
      profileId: profile.id,
      operationId: "profile-intake-bootstrap-no-resume"
    });
    expect(repeated.idempotent).toBe(true);
    expect(repeated.branch.id).toBe(resume.branch.id);
    expect(await repository.listResumeBranches(profile.id)).toHaveLength(1);
  });

  it("syncs an existing blank General Resume through a new Revision without creating a duplicate", async () => {
    const repository = createRepository();
    const profile = emptyProfile("profile-blank-resume", "小明");
    await repository.saveProfile(profile);
    const blank = await repository.createGeneralResumeBranch({
      profileId: profile.id,
      operationId: "profile-intake-create-blank",
      name: "小明的通用简历",
      includeProfileFacts: false,
      includeProfileBasics: false
    });
    const prepared = adaptConversationMessageToIntakeDraft({
      sessionId: "session-blank",
      messageId: "message-blank",
      turnId: "turn-blank",
      text: "开发示例内容分析系统，支持多格式报告导出。开发 CareerAdapt AI 简历制作平台。",
      capturedAt: "2026-07-27T10:09:56.725Z"
    });
    const saved = await repository.saveImportedResumeDraft(prepared.draft, 0);
    const plan = await repository.reconcileImportedResume({
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      profileId: profile.id
    });
    await repository.confirmProfileIntake({
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      expectedReconciliationRevision: plan.revision,
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version,
      operationId: "profile-intake-commit-blank"
    });

    const synced = await repository.ensureGeneralResumeFromProfile({
      profileId: profile.id,
      operationId: "profile-intake-sync-blank"
    });
    expect(synced.mode).toBe("synced");
    expect(synced.branch.id).toBe(blank.branch.id);
    expect(synced.branch.revision).toBe(blank.branch.revision + 1);
    expect(synced.revision?.previousRevisionId).toBe(blank.branch.currentRevisionId);
    expect(synced.branch.contentItems.some((item) => item.visible && item.factRefs.length > 0)).toBe(true);
    expect(await repository.listResumeBranches(profile.id)).toHaveLength(1);
  });

  it("preserves non-profile manual content when syncing an existing non-empty General Resume", async () => {
    const repository = createRepository();
    const profile = emptyProfile("profile-manual-resume", "小明");
    await repository.saveProfile(profile);
    const existing = await repository.createGeneralResumeBranch({
      profileId: profile.id,
      operationId: "profile-intake-create-manual",
      name: "已有通用简历",
      includeProfileFacts: false,
      includeProfileBasics: false
    });
    const manualItem = BranchContentItemSchema.parse({
      id: "manual-resume-only-item",
      itemType: "experience",
      source: "user_manual",
      sourceSectionId: "custom",
      text: "这段内容仅属于简历，不反向写入资料库。",
      originalText: "这段内容仅属于简历，不反向写入资料库。",
      order: 1,
      visible: true,
      requirementIds: [],
      sourceSuggestionIds: [],
      factRefs: [],
      guardMode: "not_fact",
      guardStatus: "pass",
      guardRiskLevel: "low",
      guardFindings: [],
      guardedAt: "2026-07-27T10:09:56.725Z",
      guardVersion: "profile-snapshot-v2",
      userConfirmation: {
        scope: "resume_only",
        confirmedTextHash: "manual-text-confirmed",
        confirmedAt: "2026-07-27T10:09:56.725Z"
      }
    });
    await repository.saveResumeBranch({
      ...existing.branch,
      contentItems: [...existing.branch.contentItems, manualItem]
    });

    const synced = await repository.ensureGeneralResumeFromProfile({
      profileId: profile.id,
      operationId: "profile-intake-sync-manual"
    });
    expect(synced.branch.contentItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: manualItem.id,
        text: manualItem.text,
        source: "user_manual"
      })
    ]));
    expect(await repository.listResumeBranches(profile.id)).toHaveLength(1);
  });

  it("blocks a stale target after the active Profile changes until that mismatch is acknowledged", async () => {
    const repository = createRepository();
    const profileA = emptyProfile("profile-switch-a", "示例用户");
    const profileB = emptyProfile("profile-switch-b", "小明");
    await repository.saveProfile(profileA);
    await repository.saveProfile(profileB);
    await repository.setActiveProfileId(profileA.id);
    const service = new BrowserAgentToolService(repository);
    await repository.setActiveProfileId(profileB.id);
    const input = {
      sessionId: "session-switch",
      messageId: "message-switch",
      turnId: "turn-switch",
      text: "开发 CareerAdapt AI 简历制作平台。",
      capturedAt: "2026-07-27T10:09:56.725Z",
      targetProfileId: profileA.id,
      expectedProfileVersion: profileA.version,
      acknowledgedActiveProfileId: profileA.id
    };

    await expect(service.captureProfileIntake(input)).rejects.toMatchObject({
      code: "profile_intake_active_profile_changed"
    });
    await expect(service.captureProfileIntake({
      ...input,
      acknowledgedActiveProfileId: profileB.id
    })).resolves.toMatchObject({
      targetProfileId: profileA.id
    });
  });
});

function createRepository() {
  db = new CareerAdaptDb(`GuidedProfileIntake-${crypto.randomUUID()}`);
  return new WorkspaceRepository(db);
}

function emptyProfile(id: string, name: string) {
  const now = "2026-07-27T09:00:00.000Z";
  return CareerProfileSchema.parse({
    ...structuredClone(demoCareerProfile),
    id,
    name,
    basics: {
      name,
      links: []
    },
    version: 1,
    experiences: [],
    skills: [],
    certificates: [],
    evidences: [],
    unclassifiedBlocks: [],
    structuredFacts: [],
    createdAt: now,
    updatedAt: now
  });
}
