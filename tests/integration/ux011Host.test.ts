import { afterEach, expect, it } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { ProfileIntakeSemanticService } from "@/domain/profileIntake/ProfileIntakeSemanticService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerToolGateway, CareerToolGatewayExecutor } from "@/agent/tools/CareerToolGateway";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { CareerProfileSchema } from "@/domain/schemas";
import { ProfileIntakeReviewProjectionSchema } from "@/domain/profileIntake/ProfileIntakeReviewProjection";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
let db: CareerAdaptDb;
afterEach(async () => { db?.close(); if (db) await db.delete(); });
it("projects a Hermes intake into a bound editable Host task and keeps Profile untouched until confirmation", async () => {
  db = new CareerAdaptDb(`ux011-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const now = "2026-11-05T00:00:00.000Z";
  const profileInput = CareerProfileSchema.parse({ id: "ux-profile", createdAt: now, updatedAt: now, version: 1,
    schemaVersion: "career-profile-v2", name: "匿名", basics: { name: "匿名", links: [] },
    preference: { targetRoles: [], targetCities: [], industries: [] }, experiences: [], skills: [], evidence: [] });
  const profile = await repository.saveProfile(profileInput);
  await repository.setActiveProfileId(profile.id);
  const service = new BrowserAgentToolService(repository, new ProfileIntakeSemanticService(async input => ({ ok: true, data: {
    candidates: [{ candidateKey: "education", sectionType: "education", school: "匿名大学", major: "计算机专业",
      sourceQuote: input.rawNarrative, confidence: 0.9, needsConfirmation: true, current: false, highlights: [],
      tools: [], methods: [], outcomes: [], fieldEvidence: [] },
      { candidateKey: "award", sectionType: "awards", name: "匿名竞赛三等奖", sourceQuote: "获得匿名竞赛三等奖。", confidence: 0.9, needsConfirmation: true, current: false, highlights: [], tools: [], methods: [], outcomes: [], fieldEvidence: [{ field: "name", sourceQuote: "获得匿名竞赛三等奖。", support: "explicit", confidence: 0.9, needsConfirmation: false }] }]
  } })));
  const registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
  const persistence = new AgentSessionStore(repository);
  const initial = await persistence.save(AgentRuntime.createConversationSession());
  const host = new AgentHostStore({ repository, persistence, executor: new CareerToolGatewayExecutor(registry, gateway) });
  host.adopt(initial);
  const text = "帮我整理资料库：就读匿名大学计算机专业。获得匿名竞赛三等奖。";
  const shell = await host.beginRuntimeShell({ session: initial, userMessage: text, runtimeId: "hermes" });
  const result = await gateway.execute("career.workflow.profile_intake_turn", { userTurn: text }, {
    agentSessionId: initial.id, userMessageId: shell.userMessageId, logicalTurnId: shell.turnId, operationId: "ux-capture",
    careerSessionBinding: { agentSessionId: initial.id, personId: profile.personId!, profileId: profile.id,
      profileVersionNumber: profile.profileVersionNumber ?? 1, profileRevision: profile.version }
  });
  expect(result.ok).toBe(true);
  await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: initial.id, turnId: shell.turnId,
    timestamp: now, toolName: "career.workflow.profile_intake_turn", operationId: "ux-capture", data: { result } }, shell.assistantMessageId);
  let session = await host.applyRuntimeEvent({ type: "turn_completed", sessionId: initial.id, turnId: shell.turnId,
    timestamp: now, message: "候选已准备，请核对。" }, shell.assistantMessageId);
  expect(session?.taskState).toMatchObject({ workflowId: "guided_profile_intake", completionStatus: "waiting_for_user",
    knownSlots: { targetProfileId: profile.id, expectedProfileVersion: 1 } });
  const projection = ProfileIntakeReviewProjectionSchema.parse(session!.taskState!.knownSlots.profileIntakeReviewProjection);
  expect(projection.candidates).toHaveLength(2);
  expect(await repository.getProfile(profile.id)).toEqual(profile);
  session = await host.dispatch({ type: "artifact_action", action: { type: "profile_intake_candidate_edit",
    importId: projection.importId, expectedDraftRevision: projection.draftRevision, candidateId: projection.candidates[0].id,
    fieldPatch: { major: "计算机" }, decision: "accept" } }, { session: session!, pageContext: { pathname: "/ai-workspace", query: {} } });
  const edited = ProfileIntakeReviewProjectionSchema.parse(session!.taskState!.knownSlots.profileIntakeReviewProjection);
  expect(edited.candidates[0].status).toBe("accepted");
  expect(edited.candidates[0].structuredItem).toMatchObject({ major: "计算机" });
  expect(await repository.getProfile(profile.id)).toEqual(profile);
  const restored = await persistence.get(initial.id);
  expect(restored?.taskState?.knownSlots.profileIntakeReviewProjection).toEqual(edited);
  expect(canonicalProfileLibraryItems((await repository.getProfile(profile.id))!)).toHaveLength(0);
  session = await host.dispatch({ type: "artifact_action", action: { type: "profile_intake_candidate_decision",
    candidateId: edited.candidates.find(row => row.sectionType === "awards")!.id, decision: "reject" } },
    { session: session!, pageContext: { pathname: "/ai-workspace", query: {} } });
  const reviewed = ProfileIntakeReviewProjectionSchema.parse(session!.taskState!.knownSlots.profileIntakeReviewProjection);
  expect(reviewed.candidates.find(row => row.sectionType === "awards")?.status).toBe("ignored");
  expect(await repository.getProfile(profile.id)).toEqual(profile);
  const plan = await repository.reconcileImportedResume({ importId: reviewed.importId, expectedDraftRevision: reviewed.draftRevision, profileId: profile.id });
  expect(plan.status).toBe("ready");
  const confirmation = { importId: reviewed.importId, expectedDraftRevision: reviewed.draftRevision,
    expectedReconciliationRevision: plan.revision, targetProfileId: profile.id, expectedProfileVersion: profile.version,
    operationId: "ux011-explicit-confirmation" };
  const committed = await repository.confirmProfileIntake(confirmation);
  const repeated = await repository.confirmProfileIntake(confirmation);
  expect(repeated.profileVersion).toBe(committed.profileVersion);
  const saved = (await repository.getProfile(profile.id))!;
  expect(saved.version).toBe(profile.version + 1);
  expect(canonicalProfileLibraryItems(saved).some(row => row.sectionType === "awards")).toBe(false);
  expect(JSON.stringify(saved)).toContain("匿名大学");
  const sourceDraft = await repository.getImportedResumeDraft(reviewed.importId);
  expect(JSON.stringify(sourceDraft)).toContain(text);
  expect(JSON.stringify(sourceDraft)).toContain(shell.turnId);
  expect(JSON.stringify(sourceDraft)).toContain(shell.userMessageId);
  expect(await repository.listResumeBranches(profile.id)).toHaveLength(0);

});

it("persists an analyze-only target and clears old job/fit ownership when another JD is analyzed", async () => {
  db = new CareerAdaptDb(`ux011-job-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const service = new BrowserAgentToolService(repository);
  const registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
  const persistence = new AgentSessionStore(repository);
  const initial = await persistence.save(AgentRuntime.createConversationSession());
  const host = new AgentHostStore({ repository, persistence, executor: new CareerToolGatewayExecutor(registry, gateway) });
  host.adopt(initial);
  let current = initial;
  const analyze = async (rawText: string, operationId: string) => {
    const shell = await host.beginRuntimeShell({ session: current, userMessage: rawText, runtimeId: "hermes" });
    const result = await gateway.execute("career.workflow.job_intake", { rawText, persistence: "analyze_only" }, {
      agentSessionId: initial.id, userMessageId: shell.userMessageId, operationId
    });
    expect(result.ok).toBe(true);
    await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), toolName: "career.workflow.job_intake", operationId, data: { result } }, shell.assistantMessageId);
    current = (await host.applyRuntimeEvent({ type: "turn_completed", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), message: "解析完成，请核对原文。" }, shell.assistantMessageId))!;
    return current.taskState!.knownSlots.targetSnapshot;
  };
  const first = await analyze("公司：匿名甲公司\n岗位：数据分析师\n任职要求\n必须掌握 Python 或 R。", "ux011-jd-A");
  expect((await persistence.get(initial.id))?.taskState?.knownSlots.targetSnapshot).toEqual(first);
  current = await persistence.save({ ...current, taskState: { ...current.taskState!,
    selectedEntities: { ...current.taskState!.selectedEntities, jobId: "old-demo-job" },
    knownSlots: { ...current.taskState!.knownSlots, fitAnalysis: { stale: true } } } });
  host.adopt(current);
  const second = await analyze("公司：匿名乙公司\n岗位：后端工程师\n任职要求\n必须掌握 Java，完成接口开发。", "ux011-jd-B");
  expect(second).not.toEqual(first);
  expect(current.taskState?.knownSlots.fitAnalysis).toBeUndefined();
  expect(current.taskState?.selectedEntities.jobId).toBeUndefined();
  expect((await persistence.get(initial.id))?.taskState?.knownSlots.targetSnapshot).toEqual(second);
  expect(await repository.listJobDescriptions()).toHaveLength(0);
  expect(await repository.listJobListings()).toHaveLength(0);
});
