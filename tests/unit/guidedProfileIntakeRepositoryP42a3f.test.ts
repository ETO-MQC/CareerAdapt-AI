import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { BranchContentItemSchema, CareerProfileSchema } from "@/domain/schemas";
import { adaptConversationMessageToIntakeDraft } from "@/domain/profileIntake/ConversationIntakeAdapter";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import {
  ProfileIntakeSemanticService,
  type ProfileIntakeSemanticResult
} from "@/domain/profileIntake/ProfileIntakeSemanticService";

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
    const raw = "示例大学计算机相关专业。开发 ESP32 心跳与摔倒检测课程项目。开发 CareerAdapt AI 简历制作平台。";
    const prepared = adaptConversationMessageToIntakeDraft({
      sessionId: "session-no-resume",
      messageId: "message-no-resume",
      turnId: "turn-no-resume",
      text: raw,
      semanticResult: semanticProjects(raw, ["教育背景", "穿戴设备课程项目", "简历制作平台"]),
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
    const raw = "开发示例内容分析系统，支持多格式报告导出。开发 CareerAdapt AI 简历制作平台。";
    const prepared = adaptConversationMessageToIntakeDraft({
      sessionId: "session-blank",
      messageId: "message-blank",
      turnId: "turn-blank",
      text: raw,
      semanticResult: semanticProjects(raw, ["内容分析系统", "职业资料工具"]),
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

  it("patches the same draft candidate with follow-up dates, survives reload, and commits source-separated wording", async () => {
    const repository = createRepository();
    const profile = emptyProfile("profile-follow-up-patch", "小明");
    await repository.saveProfile(profile);
    const service = new BrowserAgentToolService(repository, new ProfileIntakeSemanticService(async (input) => ({
      ok: true,
      data: {
        candidates: [{
          candidateKey: "smart-focus-fixture",
          sectionType: "project",
          title: "Smart Focus - Task AI",
          current: false,
          description: "全栈开发桌面任务学习规划系统。",
          highlights: [],
          tools: [],
          methods: [],
          outcomes: [],
          sourceQuote: input.rawNarrative,
          confidence: 0.9,
          needsConfirmation: false,
          fieldEvidence: ["title", "description"].map((field) => ({
            field,
            sourceQuote: input.rawNarrative,
            support: field === "description" ? "derived" as const : "explicit" as const,
            confidence: 0.9,
            needsConfirmation: false
          }))
        }]
      }
    })));
    const raw = "Smart Focus - Task AI 是我全栈开发的，反正就是个桌面任务学习规划系统。";
    const captured = await service.captureProfileIntake({
      sessionId: "session-follow-up",
      messageId: "message-initial",
      turnId: "turn-initial",
      text: raw,
      capturedAt: "2026-07-28T10:00:00.000Z",
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version
    });
    const candidateId = captured.candidates[0]?.id;
    expect(candidateId).toBeTruthy();

    const reviewed = await service.reviewProfileIntake({
      importId: captured.importId,
      expectedDraftRevision: captured.expectedDraftRevision,
      candidateId,
      decision: "accept",
      structuredPatch: {
        startDate: "2026.02",
        endDate: "2026.04",
        current: false
      },
      evidence: {
        sessionId: "session-follow-up",
        messageId: "message-date-answer",
        turnId: "turn-date-answer",
        capturedAt: "2026-07-28T10:02:00.000Z",
        sourceQuote: "2026年2月开始，4月完成 MVP；确认 startDate=2026.02、endDate=2026.04。"
      }
    });

    const reloaded = await repository.getImportedResumeDraft(captured.importId);
    const item = reloaded?.sections.flatMap((section) => section.items)
      .find((value) => value.id === candidateId);
    expect(reloaded?.revision).toBe(reviewed.expectedDraftRevision);
    expect(item?.structuredItem).toMatchObject({
      sectionType: "project",
      startDate: "2026-02",
      endDate: "2026-04",
      current: false
    });
    expect(item?.sourceQuote).toContain("反正");
    expect(item?.normalizedText).not.toContain("反正");
    expect(item?.conversationEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: "message-initial" }),
      expect.objectContaining({
        messageId: "message-date-answer",
        supportedFields: ["startDate", "endDate", "current"]
      })
    ]));

    const plan = await repository.reconcileImportedResume({
      importId: captured.importId,
      expectedDraftRevision: reviewed.expectedDraftRevision,
      profileId: profile.id
    });
    await repository.confirmProfileIntake({
      importId: captured.importId,
      expectedDraftRevision: reviewed.expectedDraftRevision,
      expectedReconciliationRevision: plan.revision,
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version,
      operationId: "profile-intake-follow-up-commit"
    });

    const committed = await repository.getProfile(profile.id);
    const structured = committed?.structuredFacts.find((entry) =>
      entry.data.sectionType === "project" && entry.data.title?.startsWith("Smart Focus")
    );
    expect(structured?.data).toMatchObject({
      startDate: "2026-02",
      endDate: "2026-04",
      current: false,
      description: "全栈开发桌面任务学习规划系统。"
    });
    const facts = committed?.experiences.flatMap((experience) => experience.facts) ?? [];
    const committedFact = facts.find((fact) => structured?.factIds.includes(fact.id));
    expect(committedFact?.statement).not.toContain("反正");
    expect(committedFact?.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceMessageId: "message-initial",
        sourceText: expect.stringContaining("反正"),
        sourceQuote: expect.stringContaining("反正")
      }),
      expect.objectContaining({
        sourceMessageId: "message-date-answer",
        sourceQuote: expect.stringContaining("startDate=2026.02")
      })
    ]));
  });

  it("adds a completely new follow-up experience to the same Intake Draft", async () => {
    const repository = createRepository();
    const profile = emptyProfile("profile-additive-follow-up", "林澄");
    await repository.saveProfile(profile);
    const semantic = new ProfileIntakeSemanticService(async (input) => {
      const isSecond = input.rawNarrative.includes("青禾社区");
      const title = isSecond ? "青禾社区志愿服务" : "TideNote";
      const sectionType = isSecond ? "volunteer" as const : "project" as const;
      return {
        ok: true as const,
        data: {
          candidates: [{
            candidateKey: isSecond ? "volunteer-follow-up" : "project-initial",
            sectionType,
            title,
            organization: isSecond ? "青禾社区" : undefined,
            role: isSecond ? "志愿者" : undefined,
            current: false,
            description: isSecond ? "讲解手机挂号操作。" : "开发离线笔记工具。",
            highlights: [],
            tools: [],
            methods: [],
            outcomes: [],
            sourceQuote: input.rawNarrative,
            confidence: 0.9,
            needsConfirmation: false,
            fieldEvidence: [
              "title",
              ...(isSecond ? ["organization", "role"] : []),
              "description"
            ].map((field) => ({
              field,
              sourceQuote: input.rawNarrative,
              support: field === "description" ? "derived" as const : "explicit" as const,
              confidence: 0.9,
              needsConfirmation: false
            }))
          }]
        }
      };
    });
    const service = new BrowserAgentToolService(repository, semantic);
    const first = await service.captureProfileIntake({
      sessionId: "session-additive",
      messageId: "message-project",
      turnId: "turn-project",
      text: "我开发了 TideNote 离线笔记工具。",
      capturedAt: "2026-07-29T08:00:00.000Z",
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version
    });
    const second = await service.captureProfileIntake({
      sessionId: "session-additive",
      messageId: "message-volunteer",
      turnId: "turn-volunteer",
      text: "另外，我在青禾社区做志愿者，给老人讲手机挂号操作。",
      capturedAt: "2026-07-29T08:02:00.000Z",
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version,
      importId: first.importId,
      expectedDraftRevision: first.expectedDraftRevision
    });
    const reloaded = await repository.getImportedResumeDraft(first.importId);

    expect(second.importId).toBe(first.importId);
    expect(second.expectedDraftRevision).toBe(first.expectedDraftRevision + 1);
    expect(reloaded?.sections.flatMap((section) => section.items).map((item) => item.structuredItem?.sectionType))
      .toEqual(["project", "volunteer"]);
    expect(reloaded?.sections.flatMap((section) => section.items).flatMap((item) => item.conversationEvidence ?? [])
      .map((evidence) => evidence.messageId)).toEqual(["message-project", "message-volunteer"]);
  });

  it("keeps canonical Rich Review totals and cards aligned across 3 → 4 → 5 incremental candidates", async () => {
    const repository = createRepository();
    const profile = emptyProfile("profile-rich-incremental", "林澄");
    await repository.saveProfile(profile);
    const semantic = new ProfileIntakeSemanticService(async (input) => ({
      ok: true as const,
      data: {
        candidates: input.rawNarrative.split("|").map((sourceQuote, index) => ({
          candidateKey: `${input.rawNarrative}-${index}`,
          sectionType: "project" as const,
          title: sourceQuote,
          titleKind: "explicit" as const,
          current: false,
          description: `完成${sourceQuote}。`,
          highlights: [],
          tools: [],
          methods: [],
          outcomes: [],
          sourceQuote,
          confidence: 0.9,
          needsConfirmation: false,
          fieldEvidence: [
            { field: "title", sourceQuote, support: "explicit" as const, confidence: 1, needsConfirmation: false },
            { field: "description", sourceQuote, support: "derived" as const, confidence: 0.9, needsConfirmation: false }
          ]
        }))
      }
    }));
    const service = new BrowserAgentToolService(repository, semantic);
    const first = await service.captureProfileIntake({
      sessionId: "session-rich",
      messageId: "message-rich-1",
      turnId: "turn-rich-1",
      text: "项目A|项目B|项目C",
      capturedAt: "2026-07-29T09:00:00.000Z",
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version
    });
    const second = await service.captureProfileIntake({
      sessionId: "session-rich",
      messageId: "message-rich-2",
      turnId: "turn-rich-2",
      text: "项目D",
      capturedAt: "2026-07-29T09:01:00.000Z",
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version,
      importId: first.importId,
      expectedDraftRevision: first.expectedDraftRevision
    });
    const third = await service.captureProfileIntake({
      sessionId: "session-rich",
      messageId: "message-rich-3",
      turnId: "turn-rich-3",
      text: "项目E",
      capturedAt: "2026-07-29T09:02:00.000Z",
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version,
      importId: second.importId,
      expectedDraftRevision: second.expectedDraftRevision
    });
    const draft = await repository.getImportedResumeDraft(first.importId);
    const artifact = third.artifactPayload;

    expect([first.candidateCount, second.candidateCount, third.candidateCount]).toEqual([3, 4, 5]);
    expect(draft?.sections.flatMap((section) => section.items)).toHaveLength(5);
    expect(artifact.candidates).toHaveLength(5);
    expect(artifact.recognized).toHaveLength(5);
    expect(artifact.needsConfirmation).toHaveLength(0);
    expect(artifact.additions).toHaveLength(5);
    expect(artifact.duplicates).toHaveLength(0);
    expect(artifact.sources).toHaveLength(3);
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

function semanticProjects(raw: string, titles: string[]): ProfileIntakeSemanticResult {
  return {
    mode: "ai",
    providerStatus: "available",
    candidates: titles.map((title, index) => ({
      id: `semantic-project-${index}`,
      label: title,
      sourceQuote: raw,
      normalization: {
        sectionType: "project",
        normalizedText: `开发${title}。`,
        structuredItem: {
          id: `semantic-project-${index}`,
          sectionType: "project",
          title,
          current: false,
          description: `开发${title}。`,
          highlights: [],
          tools: [],
          outcomes: [],
          customFields: []
        },
        confidence: 0.9,
        needsConfirmation: false,
        needsNormalization: false,
        fieldEvidence: [{
          field: "description",
          sourceQuote: raw,
          support: "derived",
          confidence: 0.9,
          needsConfirmation: false
        }]
      }
    }))
  };
}
