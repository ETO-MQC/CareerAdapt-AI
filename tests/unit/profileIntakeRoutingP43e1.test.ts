import { afterEach, describe, expect, it, vi } from "vitest";
import regressionFixture from "../fixtures/p43e1-profile-state-regression.json";
import { AgentKernel } from "@/agent/kernel/AgentKernel";
import { AgentObservationCache } from "@/agent/kernel/AgentObservationCache";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { classifyProfileIntakeTurn, classifyTurnIntent } from "@/agent/runtime/AgentTurnIntent";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";
import { CareerProfileSchema } from "@/domain/schemas";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { extractEducationFacts } from "@/domain/profileIntake/ProfileIntakeNormalizer";
import { adaptConversationMessageToIntakeDraft } from "@/domain/profileIntake/ConversationIntakeAdapter";
import { aiTaskRegistry } from "@/ai/tasks/registry";
import { ProfileIntakeSemanticService } from "@/domain/profileIntake/ProfileIntakeSemanticService";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

const NOW = "2026-08-03T12:00:00.000Z";
let db: CareerAdaptDb | undefined;

function baseServices(overrides: Partial<AgentToolServices> = {}): AgentToolServices {
  const empty = async () => ({ value: "ok" });
  return {
    listResumes: empty,
    listProfiles: empty,
    listJobs: empty,
    getActiveProfile: async () => ({ selected: true, profileId: "profile-p43e1-disposable", version: 7 }),
    getProfile: async () => ({ profile: { id: "profile-p43e1-disposable", items: [], sectionCounts: {} } }),
    searchProfileFacts: empty,
    getResume: empty,
    getResumeRevision: empty,
    getJob: empty,
    getAgentTaskContext: empty,
    searchAgentSessions: empty,
    skillsList: empty,
    skillView: empty,
    parseResumeFile: empty,
    createResumeImportDraft: empty,
    commitResumeImport: empty,
    parseJobDescription: empty,
    commitJob: empty,
    analyzeJobFit: empty,
    createTailoringSession: empty,
    answerTailoringQuestion: empty,
    previewTailoringChanges: empty,
    applyTailoringChanges: empty,
    exportResume: empty,
    ...overrides
  };
}

function educationData() {
  return {
    id: regressionFixture.profile.education.id,
    sectionType: "education" as const,
    school: regressionFixture.profile.education.school,
    degree: regressionFixture.profile.education.degree,
    major: regressionFixture.profile.education.major,
    startDate: regressionFixture.profile.education.startDate,
    endDate: regressionFixture.profile.education.endDate,
    current: false,
    courses: [],
    honors: [],
    highlights: [],
    customFields: []
  };
}

function v2Profile() {
  const fact = {
    id: "fact-p43e1-education",
    createdAt: NOW,
    updatedAt: NOW,
    statement: "示例大学本科示例专业",
    category: "education" as const,
    provenance: [{
      sourceType: "user_input" as const,
      sourceId: "fixture-p43e1",
      sourceText: "示例大学本科示例专业",
      confidence: 1,
      confirmedByUser: true,
      riskLevel: "low" as const,
      createdAt: NOW
    }],
    confirmedByUser: true,
    riskLevel: "low" as const
  };
  return CareerProfileSchema.parse({
    id: regressionFixture.profile.id,
    createdAt: NOW,
    updatedAt: NOW,
    name: "匿名测试档案",
    basics: { name: "匿名测试档案", links: [] },
    preference: { targetRoles: [], targetCities: [], industries: [] },
    version: regressionFixture.profile.versionBeforeRecycle,
    schemaVersion: "career-profile-v2",
    // This legacy mirror is intentionally retained to prove it cannot
    // resurrect a deliberately removed canonical fact.
    experiences: [{
      id: regressionFixture.profile.education.id,
      createdAt: NOW,
      updatedAt: NOW,
      type: "education" as const,
      organization: regressionFixture.profile.education.school,
      role: regressionFixture.profile.education.degree,
      major: regressionFixture.profile.education.major,
      startDate: regressionFixture.profile.education.startDate,
      endDate: regressionFixture.profile.education.endDate,
      facts: [fact],
      tags: [],
      evidenceIds: [],
      resumeDrafts: []
    }],
    skills: [],
    certificates: [],
    evidences: [],
    unclassifiedBlocks: [],
    structuredBasics: { name: "匿名测试档案", customFields: [], portfolioLinks: [], otherLinks: [] },
    structuredFacts: [{ data: educationData(), factIds: [fact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }]
  });
}

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

describe("P4.3e.1 Profile Intake routing and recycle isolation", () => {
  it("classifies the real complaint as a profile-state side turn, not evidence", () => {
    const text = regressionFixture.sequence[2];
    expect(classifyProfileIntakeTurn({ text, stage: "collect_experience" })).toBe("profile_state_question");
    const session = AgentRuntime.create("guided_profile_intake", "collect_experience");
    const reducer = new AgentTaskStateReducer();
    const taskState = {
      ...reducer.create(session, "profile_intake"),
      stage: "collect_experience",
      completionStatus: "waiting_for_user" as const,
      knownSlots: {
        targetProfileId: regressionFixture.profile.id,
        expectedProfileVersion: regressionFixture.profile.versionBeforeRecycle,
        intakeInterviewPlan: { questions: [{ id: "q-first", expectedAnswerDimension: "education" }] },
        draft: { preserved: true }
      }
    };
    const decision = classifyTurnIntent({ text, taskState });
    expect(decision).toMatchObject({
      intent: "casual_side_turn",
      taskMutation: "preserve",
      toolScope: "profile_read",
      profileIntakeTurnKind: "profile_state_question"
    });
    const next = reducer.reduce(taskState, {
      type: "user_message",
      message: text,
      sessionId: session.id,
      messageId: "message-meta-question",
      turnId: "turn-meta-question",
      capturedAt: NOW,
      turnIntent: decision.intent,
      profileIntakeTurnKind: decision.profileIntakeTurnKind
    });
    expect(next.rootGoal).toBe("profile_intake");
    expect(next.stage).toBe("collect_experience");
    expect(next.knownSlots.draft).toEqual({ preserved: true });
    expect(next.knownSlots).not.toHaveProperty("latestIntakeSource");
  });

  it("performs a fresh profile read and never calls capture for the side turn", async () => {
    const getProfile = vi.fn(async () => ({ profile: { id: regressionFixture.profile.id, items: [], sectionCounts: {} } }));
    const captureProfileIntake = vi.fn(async () => ({}));
    const registry = createAgentToolRegistry(baseServices({ getProfile, captureProfileIntake }));
    const model = {
      completeWithTools: vi.fn(async () => ({
        stopReason: "tool_calls" as const,
        toolCalls: [{ id: "profile-state-read", name: "get_profile", arguments: { profileId: regressionFixture.profile.id } }]
      }))
    };
    const session = AgentRuntime.create("guided_profile_intake", "collect_experience");
    const reducer = new AgentTaskStateReducer();
    session.taskState = {
      ...reducer.create(session, "profile_intake"),
      stage: "collect_experience",
      completionStatus: "waiting_for_user",
      knownSlots: {
        targetProfileId: regressionFixture.profile.id,
        expectedProfileVersion: regressionFixture.profile.versionBeforeRecycle,
        draft: { preserved: true }
      }
    };
    const result = await new AgentKernel({
      model,
      executor: new AgentExecutor(registry),
      toolResolver: new AgentToolResolver(registry)
    }).runTurn({
      session,
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: regressionFixture.sequence[2],
      turnId: "turn-meta-question",
      turnIntent: "casual_side_turn",
      profileIntakeTurnKind: "profile_state_question",
      toolScope: "profile_read",
      taskEventAlreadyReduced: true
    });
    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(captureProfileIntake).not.toHaveBeenCalled();
    expect(result.text).toContain("没有这条教育经历");
    expect(result.taskState?.rootGoal).toBe("profile_intake");
    expect(result.taskState?.stage).toBe("collect_experience");
    expect(result.taskState?.knownSlots.draft).toEqual({ preserved: true });
  });

  it("does not reconstruct a recycled canonical education item and restores exactly once", async () => {
    db = new CareerAdaptDb(`P43e1-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const original = v2Profile();
    await repository.saveProfile(original);
    const before = await repository.getProfile(original.id);
    expect(before && canonicalProfileLibraryItems(before).map((item) => item.id)).toContain(regressionFixture.profile.education.id);

    const recycled = CareerProfileSchema.parse({
      ...before,
      structuredFacts: [],
      version: (before?.version ?? 0) + 1,
      updatedAt: NOW
    });
    await repository.saveProfile(recycled);
    const afterReload = await repository.getProfile(original.id);
    expect(afterReload && canonicalProfileLibraryItems(afterReload).map((item) => item.id)).not.toContain(regressionFixture.profile.education.id);
    expect(afterReload?.structuredFacts).toEqual([]);

    const recycleItem = original.structuredFacts?.[0];
    if (!recycleItem) throw new Error("fixture canonical item missing");
    await repository.addProfileRecycleItem({
      id: regressionFixture.profile.education.id,
      profileId: original.id,
      kind: "canonical",
      category: "education",
      title: "示例大学",
      deletedAt: NOW,
      value: recycleItem
    });
    const restored = await repository.restoreProfileRecycleItem("canonical", regressionFixture.profile.education.id);
    expect(restored.idempotent).toBe(false);
    expect(restored.profile.structuredFacts?.filter((entry) => entry.data.id === regressionFixture.profile.education.id)).toHaveLength(1);
    const repeated = await repository.restoreProfileRecycleItem("canonical", regressionFixture.profile.education.id);
    expect(repeated.idempotent).toBe(true);
    expect(repeated.profile.structuredFacts?.filter((entry) => entry.data.id === regressionFixture.profile.education.id)).toHaveLength(1);
  });

  it("does not cache profile reads and reports safe typed tool input diagnostics", async () => {
    const cache = new AgentObservationCache();
    cache.set("get_profile", { profileId: regressionFixture.profile.id }, {
      ok: true,
      operationId: "profile-read-old",
      toolName: "get_profile",
      data: { profile: { id: regressionFixture.profile.id, version: 7 } },
      artifactIds: [],
      completedAt: NOW
    });
    expect(cache.get("get_profile", { profileId: regressionFixture.profile.id })).toBeUndefined();

    const registry = createAgentToolRegistry(baseServices());
    const invalid = await registry.execute("capture_profile_intake", {}, "invalid-input-operation");
    expect(invalid).toMatchObject({
      ok: false,
      toolName: "capture_profile_intake",
      error: {
        code: "tool_input_invalid",
        message: "当前访谈状态不完整，未执行资料整理。现有输入已保留。"
      }
    });
    const fields = (invalid.error?.details as { fields?: string[] } | undefined)?.fields ?? [];
    expect(fields).toEqual(expect.arrayContaining(["targetProfileId", "expectedProfileVersion"]));
    expect(JSON.stringify(invalid)).not.toContain("profile-p43e1-disposable");
  });

  it("requires typed education and keeps legacy migration explicit", async () => {
    const narrative = "我现在是郑州大学本科学生，计算机科学与技术专业，2024年9月入学，预计2028年6月毕业。";
    expect(extractEducationFacts(narrative)).toMatchObject({
      school: "郑州大学",
      degree: "本科",
      major: "计算机科学与技术",
      datePatch: { startDate: "2024-09", endDate: "2028-06" }
    });
    const item = {
      id: "education-typed",
      sectionType: "education" as const,
      school: "郑州大学",
      degree: "本科",
      major: "计算机科学与技术",
      startDate: "2024-09",
      endDate: "2028-06",
      current: false,
      courses: [],
      honors: [],
      highlights: [],
      customFields: []
    };
    const candidate = {
      candidateKey: "education-typed",
      sectionType: "education" as const,
      structuredItem: item,
      sourceQuote: narrative,
      confidence: 0.99,
      needsConfirmation: false,
      current: false,
      highlights: [],
      tools: [],
      methods: [],
      outcomes: [],
      fieldEvidence: ["school", "degree", "major", "startDate", "endDate"].map((field) => ({
        field,
        sourceQuote: field === "school" ? "郑州大学" : field === "degree" ? "本科" : field === "major" ? "计算机科学与技术" : field === "startDate" ? "2024年9月" : "2028年6月",
        support: "explicit" as const,
        confidence: 0.99,
        needsConfirmation: false
      }))
    };
    const input = { rawNarrative: narrative, existingDraftContext: [], canonicalSections: ["education" as const] };
    expect(() => aiTaskRegistry["profile-intake-semantic"].validateOutput({ candidates: [candidate] }, input)).not.toThrow();
    const service = new ProfileIntakeSemanticService(async () => ({ ok: true as const, data: { candidates: [candidate], followUpQuestion: undefined } }));
    const normalized = await service.normalize({ rawNarrative: narrative });
    expect(normalized.candidates[0]?.normalization.structuredItem).toMatchObject({ ...item, id: expect.any(String) });

    const staleLabelResult = {
      ...normalized,
      candidates: normalized.candidates.map((candidate) => ({
        ...candidate,
        label: "我现在是郑州大学 / 本科 / 计算机科学与技术"
      }))
    };
    const adapted = adaptConversationMessageToIntakeDraft({
      sessionId: "session-p43e1-label",
      messageId: "message-p43e1-label",
      turnId: "turn-p43e1-label",
      text: narrative,
      capturedAt: NOW,
      semanticResult: staleLabelResult
    });
    expect(adapted.candidates[0]?.label).toBe("郑州大学 / 本科 / 计算机科学与技术");
    expect(adapted.artifact.candidates[0]?.label).toBe("郑州大学 / 本科 / 计算机科学与技术");
    expect(adapted.artifact.candidates[0]?.professionalDescription).not.toContain("我现在是");
    expect(migrateCareerProfileToV2({ ...v2Profile(), schemaVersion: undefined, structuredFacts: undefined, structuredBasics: undefined }).structuredFacts).toHaveLength(1);
  });
});
