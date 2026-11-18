import { afterEach, expect, it, vi } from "vitest";
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
import { CareerProfileSchema, JobDescriptionSchema, type ResumeTailoringDiff } from "@/domain/schemas";
import { ProfileIntakeReviewProjectionSchema } from "@/domain/profileIntake/ProfileIntakeReviewProjection";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { recoverProfileIntakeCommit } from "@/agent/runtime/profileIntakeCommitRecovery";
import { adaptConversationMessageToIntakeDraft, buildConversationIntakeReviewProjectionFromDraft } from "@/domain/profileIntake/ConversationIntakeAdapter";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { resolveCareerSessionBinding } from "@/agent/runtime/careerSessionBinding";
import { buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization/v4/analyze";
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
  // A review card must never precede its durable business checkpoint, even
  // while Hermes is still generating its final narration.
  const duringRun = await persistence.get(initial.id);
  expect(duringRun?.activeTurn?.status).toBe("running");
  expect(duringRun?.taskState?.knownSlots.profileIntakeReviewProjection).toEqual(
    host.getSnapshot().activeSession?.taskState?.knownSlots.profileIntakeReviewProjection
  );
  expect(duringRun?.taskState?.workflowId).toBe("guided_profile_intake");
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
  const confirmationBase = { importId: reviewed.importId, expectedDraftRevision: reviewed.draftRevision,
    expectedReconciliationRevision: plan.revision, targetProfileId: profile.id, expectedProfileVersion: profile.version,
    operationId: "ux011-explicit-confirmation" };
  const frozen = await repository.freezeProfileIntakeRequest({ ...confirmationBase, personId: profile.personId!,
    confirmation: { sessionId: initial.id, turnId: shell.turnId, messageId: shell.userMessageId, text } });
  const confirmation = { ...confirmationBase, frozen };
  await expect(service.commitProfileIntake(confirmationBase, "missing-frozen-operation")).rejects.toMatchObject({
    code: "profile_intake_frozen_request_required"
  });
  expect(await repository.getProfile(profile.id)).toEqual(profile);
  const committed = await repository.confirmProfileIntake(confirmation);
  const repeated = await repository.confirmProfileIntake(confirmation);
  expect(repeated.profileVersion).toBe(committed.profileVersion);
  const saved = (await repository.getProfile(profile.id))!;
  expect(saved.version).toBe(profile.version + 1);
  expect((await recoverProfileIntakeCommit(repository, { ...confirmation, personId: saved.personId! })).status).toBe("COMMITTED_VERIFIED");
  const interrupted: AgentSession = { ...session!, taskState: { ...session!.taskState!, knownSlots: {
    ...session!.taskState!.knownSlots, intakeImportId: confirmation.importId,
    expectedIntakeDraftRevision: confirmation.expectedDraftRevision, targetProfileId: profile.id,
    expectedProfileVersion: profile.version, profileIntakeCommitOutcome: { status: "UNKNOWN",
      operationId: confirmation.operationId, importId: confirmation.importId, targetProfileId: profile.id,
      request: { personId: saved.personId, expectedDraftRevision: confirmation.expectedDraftRevision,
        expectedReconciliationRevision: confirmation.expectedReconciliationRevision, expectedProfileVersion: profile.version, frozen } }
  } } };
  expect(interrupted.personId).toBe(saved.personId);
  const reloaded = await persistence.save(interrupted);
  const recoveryHost = new AgentHostStore({ repository, persistence, executor: new CareerToolGatewayExecutor(registry, gateway) });
  const adopted = (await recoveryHost.adoptDurably(reloaded))!;
  const lookup = vi.spyOn(repository, "getProfileIntakeOperationReceipt");
  const saveSession = vi.spyOn(persistence, "save");
  const recovered = await (recoveryHost as unknown as { finalizeProfileIntakeAtHostBoundary: (input: unknown, decision: unknown) => Promise<AgentSession> })
    .finalizeProfileIntakeAtHostBoundary({ current: adopted, taskState: adopted.taskState, turnId: "recovery-turn",
      userMessageId: "recovery-user", thinkingMessageId: "recovery-thinking", now, controller: new AbortController() }, {});
  expect(lookup).toHaveBeenCalledWith({ ...confirmation, personId: saved.personId });
  expect(saveSession.mock.lastCall?.[0].taskState?.knownSlots.profileIntakeCommitOutcome).toMatchObject({ status: "COMMITTED_VERIFIED" });
  expect(recovered.taskState?.knownSlots.profileIntakeCommitOutcome).toMatchObject({ status: "COMMITTED_VERIFIED", operationId: confirmation.operationId });
  expect((await repository.getProfile(profile.id))?.version).toBe(profile.version + 1);
  expect(canonicalProfileLibraryItems((await repository.getProfile(profile.id))!)).toHaveLength(1);
  expect(canonicalProfileLibraryItems(saved).some(row => row.sectionType === "awards")).toBe(false);
  expect(JSON.stringify(saved)).toContain("匿名大学");
  const sourceDraft = await repository.getImportedResumeDraft(reviewed.importId);
  expect(JSON.stringify(sourceDraft)).toContain(text);
  expect(JSON.stringify(sourceDraft)).toContain(shell.turnId);
  expect(JSON.stringify(sourceDraft)).toContain(shell.userMessageId);
  expect(await repository.listResumeBranches(profile.id)).toHaveLength(0);

});

it("only queries the receipt when an unknown frozen confirmation has no receipt", async () => {
  db = new CareerAdaptDb(`intake-replay-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const now = new Date().toISOString();
  const profile = await repository.saveProfile(CareerProfileSchema.parse({ id: "replay-profile", createdAt: now, updatedAt: now,
    version: 1, schemaVersion: "career-profile-v2", name: "匿名", basics: { name: "匿名", links: [] },
    preference: { targetRoles: [], targetCities: [], industries: [] }, experiences: [], skills: [], evidence: [] }));
  await repository.setActiveProfileId(profile.id);
  const text = "确认保存";
  const raw = "我参与了示例数据分析项目。";
  const prepared = adaptConversationMessageToIntakeDraft({ sessionId: "replay-session", messageId: "source-message",
    turnId: "source-turn", text: raw, capturedAt: now, semanticResult: { mode: "ai", providerStatus: "available",
      candidates: [{ id: "replay-item", label: "示例数据分析", sourceQuote: raw, normalization: {
        sectionType: "project", normalizedText: "参与示例数据分析项目。", structuredItem: { id: "replay-item",
          sectionType: "project", title: "示例数据分析", description: "参与示例数据分析项目。", current: false,
          highlights: [], tools: [], outcomes: [], customFields: [] }, confidence: 0.9, needsConfirmation: false,
        needsNormalization: false, fieldEvidence: [] } }] } });
  const draft = await repository.saveImportedResumeDraft(prepared.draft, 0);
  const service = new BrowserAgentToolService(repository, new ProfileIntakeSemanticService(async () => ({ ok: false, errorCode: "provider_unavailable" })));
  await service.reviewProfileIntake({ importId: draft.importId, expectedDraftRevision: draft.revision,
    candidateId: draft.sections[0].items[0].id, decision: "accept" });
  const reviewed = (await repository.getImportedResumeDraft(draft.importId))!;
  const plan = await repository.reconcileImportedResume({ importId: reviewed.importId, expectedDraftRevision: reviewed.revision, profileId: profile.id });
  const request = { importId: reviewed.importId, expectedDraftRevision: reviewed.revision, expectedReconciliationRevision: plan.revision,
    targetProfileId: profile.id, expectedProfileVersion: profile.version, operationId: "replay-operation-id" };
  const frozen = await repository.freezeProfileIntakeRequest({ ...request, personId: profile.personId!,
    confirmation: { sessionId: "replay-session", turnId: "confirm-turn", messageId: "confirm-message", text } });
  const initial = { ...AgentRuntime.create("guided_profile_intake", "final_review"), id: "replay-session", personId: profile.personId,
    messages: [{ id: "confirm-message", turnId: "confirm-turn", role: "user" as const, content: text,
      kind: "text" as const, type: "text" as const, status: "complete" as const, createdAt: now }] };
  const task = new AgentTaskStateReducer().create(initial, "profile_intake");
  task.selectedEntities.profileVersion = profile.version;
  const persistence = new AgentSessionStore(repository);
  const session = await persistence.save({ ...initial, taskState: { ...task, knownSlots: { ...task.knownSlots,
    profileIntakeCommitOutcome: { status: "UNKNOWN", operationId: request.operationId, importId: request.importId,
      targetProfileId: profile.id, request: { personId: profile.personId, expectedDraftRevision: request.expectedDraftRevision,
        expectedReconciliationRevision: request.expectedReconciliationRevision, expectedProfileVersion: profile.version, frozen } } } } });
  const registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
  const unavailableExecutor = new CareerToolGatewayExecutor(registry, gateway);
  vi.spyOn(unavailableExecutor, "execute").mockResolvedValueOnce({ ok: false, operationId: request.operationId,
    toolName: "commit_profile_intake", artifactIds: [], completedAt: now,
    error: { code: "revision_conflict", message: "revision conflict", retryable: false } });
  const unavailableHost = new AgentHostStore({ repository, persistence, executor: unavailableExecutor });
  const unavailableSession = (await unavailableHost.adoptDurably(session))!;
  const unavailableLookup = vi.spyOn(repository, "getProfileIntakeOperationReceipt")
    .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("receipt_query_unavailable"));
  const unknown = await unavailableHost.dispatch({ type: "artifact_action", action: { type: "profile_intake_recover",
    operationId: request.operationId, mode: "replay" } }, { session: unavailableSession, pageContext: { pathname: "/ai-workspace", query: {} } });
  expect(unknown?.taskState?.knownSlots.profileIntakeCommitOutcome).toMatchObject({ status: "UNKNOWN", operationId: request.operationId });
  expect(unavailableExecutor.execute).not.toHaveBeenCalled();
  unavailableLookup.mockRestore();
  const host = new AgentHostStore({ repository, persistence, executor: new CareerToolGatewayExecutor(registry, gateway) });
  const adopted = (await host.adoptDurably(session))!;
  const queryHost = new AgentHostStore({ repository, persistence, executor: new CareerToolGatewayExecutor(registry, gateway) });
  const querySession = (await queryHost.adoptDurably(adopted))!;
  let releaseQuery!: () => void;
  let markQueryStarted!: () => void;
  const queryStarted = new Promise<void>((resolve) => { markQueryStarted = resolve; });
  const delayedQuery = new Promise<void>((resolve) => { releaseQuery = resolve; });
  const actualLookup = repository.getProfileIntakeOperationReceipt.bind(repository);
  const lookup = vi.spyOn(repository, "getProfileIntakeOperationReceipt").mockImplementationOnce(async (input) => {
    const result = await actualLookup(input);
    markQueryStarted();
    await delayedQuery;
    return result;
  });
  const pendingQuery = queryHost.dispatch({ type: "artifact_action", action: { type: "profile_intake_recover",
    operationId: request.operationId, mode: "query" } }, { session: querySession, pageContext: { pathname: "/ai-workspace", query: {} } });
  await queryStarted;
  const action = { type: "artifact_action" as const, action: { type: "profile_intake_recover" as const,
    operationId: request.operationId, mode: "replay" as const } };
  const [one, two] = await Promise.all([host.dispatch(action, { session: adopted, pageContext: { pathname: "/ai-workspace", query: {} } }),
    host.dispatch(action, { session: adopted, pageContext: { pathname: "/ai-workspace", query: {} } })]);
  expect(one?.taskState?.knownSlots.profileIntakeCommitOutcome).toMatchObject({ status: "UNKNOWN", operationId: request.operationId });
  expect(two?.taskState?.knownSlots.profileIntakeCommitOutcome).toMatchObject({ status: "UNKNOWN" });
  const newSession = await persistence.save(AgentRuntime.createConversationSession());
  queryHost.adopt(newSession);
  releaseQuery();
  expect((await pendingQuery)?.taskState?.knownSlots.profileIntakeCommitOutcome).toMatchObject({ status: "UNKNOWN" });
  expect(queryHost.getSnapshot().activeSession?.id).toBe(newSession.id);
  expect(queryHost.getSnapshot().activeSession?.taskState?.knownSlots.profileIntakeCommitOutcome).toBeUndefined();
  lookup.mockRestore();
  expect((await repository.getProfile(profile.id))?.version).toBe(profile.version);
  expect(canonicalProfileLibraryItems((await repository.getProfile(profile.id))!)).toHaveLength(0);
  expect(await repository.getProfileIntakeOperationReceipt({ ...request, personId: profile.personId!, frozen })).toBeUndefined();
});

it.each(["normal", "not_sent", "response_lost", "conflict", "stale_before"] as const)("freezes the original confirmation before the Repository write (%s)", async (mode) => {
  db = new CareerAdaptDb(`intake-first-confirm-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const now = new Date().toISOString();
  const oldFact = { id: "old-fact", statement: "参与课程项目。", category: "experience", confirmedByUser: true, riskLevel: "low",
    createdAt: now, updatedAt: now, provenance: [{ sourceType: "user_input", sourceId: "old-source", sourceText: "参与课程项目。",
      confidence: 1, confirmedByUser: true, riskLevel: "low", createdAt: now }] };
  const oldData = mode === "normal" ? { experiences: [{ id: "old-exp", type: "project", organization: "旧项目", role: "成员",
    facts: [oldFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: now, updatedAt: now }],
    structuredFacts: [{ data: { id: "old-item", sectionType: "project", title: "旧项目", current: false,
      description: "参与课程项目。", highlights: [], outcomes: [], tools: [], customFields: [] },
    factIds: [oldFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }] } : { experiences: [] };
  const profile = await repository.saveProfile(CareerProfileSchema.parse({ id: "first-profile", createdAt: now, updatedAt: now,
    version: 1, schemaVersion: "career-profile-v2", name: "匿名", basics: { name: "匿名", links: [] },
    preference: { targetRoles: [], targetCities: [], industries: [] }, ...oldData, skills: [], evidence: [] }));
  await repository.setActiveProfileId(profile.id);
  const jobText = "岗位职责\n参与示例数据分析项目。\n任职要求\n具备数据分析实践经验。";
  const jobA = JobDescriptionSchema.parse({ id: "impact-job-a", title: "数据岗位", company: null, source: "manual", rawText: jobText,
    requirementGraph: analyzeJobDescriptionV4({ rawText: jobText }).graph, createdAt: now, updatedAt: now });
  let existingJob: ReturnType<typeof buildJobBranchFromProfile> | undefined;
  if (mode === "normal") {
    await repository.saveJobDescription(jobA);
    existingJob = buildJobBranchFromProfile({ profile, jobId: jobA.id, jobTitle: jobA.title, jobVersion: jobA.updatedAt,
      operationId: "impact-existing-branch", name: "已有岗位简历", selectedCanonicalItemIds: ["old-item"],
      requirementMatchIds: [], sourceMatchSetHash: "existing-match", now });
    await repository.saveResumeBranch(existingJob.branch);
    await db.resumeRevisions.put(existingJob.firstRevision);
  }
  const raw = "我参与了示例数据分析项目。";
  const prepared = adaptConversationMessageToIntakeDraft({ sessionId: "first-session", messageId: "source-message",
    turnId: "source-turn", text: raw, capturedAt: now, semanticResult: { mode: "ai", providerStatus: "available",
      candidates: [{ id: "first-item", label: "示例数据分析", sourceQuote: raw, normalization: {
        sectionType: "project", normalizedText: "参与示例数据分析项目。", structuredItem: { id: "first-item", sectionType: "project",
          title: "示例数据分析", description: "参与示例数据分析项目。", current: false, highlights: [], tools: [], outcomes: [], customFields: [] },
        confidence: 0.9, needsConfirmation: false, needsNormalization: false, fieldEvidence: [] } }] } });
  const draft = await repository.saveImportedResumeDraft(prepared.draft, 0);
  const service = new BrowserAgentToolService(repository, new ProfileIntakeSemanticService(async () => ({ ok: false, errorCode: "provider_unavailable" })));
  await service.reviewProfileIntake({ importId: draft.importId, expectedDraftRevision: draft.revision,
    candidateId: draft.sections[0].items[0].id, decision: "accept" });
  const reviewed = (await repository.getImportedResumeDraft(draft.importId))!;
  const projection = buildConversationIntakeReviewProjectionFromDraft(reviewed);
  const initial = { ...AgentRuntime.create("guided_profile_intake", "final_review"), id: "first-session", personId: profile.personId, activeProfileId: profile.id,
    profileVersionNumber: profile.profileVersionNumber ?? 1, profileRevision: profile.version,
    messages: [{ id: "confirm-message", turnId: "confirm-turn", role: "user" as const, content: "确认",
      kind: "text" as const, type: "text" as const, status: "complete" as const, createdAt: now }] };
  const task = new AgentTaskStateReducer().create(initial, "profile_intake");
  task.selectedEntities.profileVersion = profile.version;
  const persistence = new AgentSessionStore(repository);
  const session = await persistence.save({ ...initial, taskState: { ...task, knownSlots: { ...task.knownSlots,
    targetProfileId: profile.id, expectedProfileVersion: profile.version, intakeImportId: reviewed.importId,
    expectedIntakeDraftRevision: reviewed.revision, profileIntakeReviewProjection: projection } } });
  const registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
  const executor = new CareerToolGatewayExecutor(registry, gateway);
  const host = new AgentHostStore({ repository, persistence, executor });
  const adopted = (await host.adoptDurably(session))!;
  const realCommit = repository.confirmProfileIntake.bind(repository);
  let persistedBeforeWrite = false;
  const commit = vi.spyOn(repository, "confirmProfileIntake").mockImplementationOnce(async (input) => {
    const checkpoint = (await persistence.get("first-session"))?.taskState?.knownSlots.profileIntakeCommitOutcome as
      { operationId?: string; request?: { frozen?: { fingerprint?: string; confirmation?: { messageId?: string } } } } | undefined;
    persistedBeforeWrite = checkpoint?.operationId === input.operationId
      && checkpoint.request?.frozen?.fingerprint === input.frozen?.fingerprint
      && checkpoint.request?.frozen?.confirmation?.messageId === (mode === "stale_before" ? "new-confirm-message" : "confirm-message");
    if (mode === "not_sent") throw new Error("synthetic_request_not_sent");
    if (mode === "conflict") await repository.saveProfile({ ...profile, version: profile.version + 1,
      name: "其他页面的更新", basics: { ...profile.basics, name: "其他页面的更新" } });
    const result = await realCommit(input);
    if (mode === "response_lost") throw new Error("synthetic_response_lost");
    return result;
  });
  if (mode === "stale_before") await repository.saveProfile({ ...profile, version: profile.version + 1,
    name: "其他页面的更新", basics: { ...profile.basics, name: "其他页面的更新" } });
  const result = await (host as unknown as { finalizeProfileIntakeAtHostBoundary: (input: unknown, decision: unknown) => Promise<AgentSession> })
    .finalizeProfileIntakeAtHostBoundary({ current: adopted, taskState: adopted.taskState, turnId: "confirm-turn",
      userMessageId: "confirm-message", thinkingMessageId: "thinking-message", now, controller: new AbortController() }, {});
  expect(commit).toHaveBeenCalledTimes(mode === "stale_before" ? 0 : 1);
  if (mode !== "stale_before") expect(persistedBeforeWrite).toBe(true);
  const originalOutcome = result.taskState?.knownSlots.profileIntakeCommitOutcome as { operationId: string; status: string } | undefined;
  if (mode === "stale_before") {
    expect(originalOutcome).toBeUndefined();
    expect(result.taskState?.knownSlots.profileIntakeReviewStale).toBe(true);
  } else expect(originalOutcome?.status).toBe(mode === "normal" ? "COMMITTED_VERIFIED" : mode === "conflict" ? "NOT_COMMITTED" : "UNKNOWN");
  if (mode === "conflict" || mode === "stale_before") {
    const original = structuredClone(result.taskState?.knownSlots.profileIntakeCommitOutcome);
    const restored = (await host.adoptDurably(result))!;
    const rechecked = await host.dispatch({ type: "artifact_action", action: { type: "profile_intake_recheck",
      operationId: originalOutcome?.operationId ?? "profile-intake-preflight" } }, { session: restored, pageContext: { pathname: "/ai-workspace", query: {} } });
    if (mode === "conflict") expect(rechecked?.taskState?.knownSlots.profileIntakePreviousOperations).toEqual([original]);
    else expect(rechecked?.taskState?.knownSlots.profileIntakeReviewStale).toBeUndefined();
    expect(rechecked?.taskState?.knownSlots.profileIntakeCommitOutcome).toBeUndefined();
    expect(rechecked?.taskState?.knownSlots.expectedProfileVersion).toBe(profile.version + 1);
    expect((await repository.getProfile(profile.id))?.name).toBe("其他页面的更新");
    expect(canonicalProfileLibraryItems((await repository.getProfile(profile.id))!)).toHaveLength(0);
    expect(rechecked?.taskState?.knownSlots.profileIntakeExplicitCommit).toBe(false);
    const reconfirmed = await persistence.save({ ...rechecked!, messages: [...rechecked!.messages,
      { id: "new-confirm-message", turnId: "new-confirm-turn", role: "user", content: "确认",
        kind: "text", type: "text", status: "complete", createdAt: now }] });
    const completed = await (host as unknown as { finalizeProfileIntakeAtHostBoundary: (input: unknown, decision: unknown) => Promise<AgentSession> })
      .finalizeProfileIntakeAtHostBoundary({ current: reconfirmed, taskState: reconfirmed.taskState, turnId: "new-confirm-turn",
        userMessageId: "new-confirm-message", thinkingMessageId: "new-thinking", now, controller: new AbortController() }, {});
    const newOutcome = completed.taskState?.knownSlots.profileIntakeCommitOutcome as { operationId: string; status: string;
      request: { frozen: { fingerprint: string; expectedProfileVersion: number } } };
    expect(newOutcome, JSON.stringify({ stage: completed.taskState?.stage, status: completed.taskState?.completionStatus,
      messages: completed.messages.slice(-2), slots: completed.taskState?.knownSlots.intakeReconciliation })).toBeDefined();
    expect(newOutcome.status).toBe("COMMITTED_VERIFIED");
    if (originalOutcome) {
      expect(newOutcome.operationId).not.toBe(originalOutcome.operationId);
      expect(newOutcome.request.frozen.fingerprint).not.toBe((original as { request: { frozen: { fingerprint: string } } }).request.frozen.fingerprint);
    }
    expect(newOutcome.request.frozen.expectedProfileVersion).toBe(profile.version + 1);
    if (mode === "conflict") expect(completed.taskState?.knownSlots.profileIntakePreviousOperations).toEqual([original]);
    else expect(persistedBeforeWrite).toBe(true);
    expect((await repository.getProfile(profile.id))?.name).toBe("其他页面的更新");
    expect(canonicalProfileLibraryItems((await repository.getProfile(profile.id))!)).toHaveLength(1);
  } else if (mode !== "normal") {
    const versionBeforeRecovery = (await repository.getProfile(profile.id))?.version;
    expect(versionBeforeRecovery).toBe(mode === "not_sent" ? profile.version : profile.version + 1);
    const restored = (await host.adoptDurably(result))!;
    const recovered = await host.dispatch({ type: "artifact_action", action: { type: "profile_intake_recover",
      operationId: originalOutcome!.operationId, mode: "replay" } }, { session: restored, pageContext: { pathname: "/ai-workspace", query: {} } });
    expect(recovered?.taskState?.knownSlots.profileIntakeCommitOutcome).toMatchObject({ status: mode === "not_sent" ? "UNKNOWN" : "COMMITTED_VERIFIED", operationId: originalOutcome!.operationId });
    if (mode === "response_lost") expect(recovered?.taskState).toMatchObject({ stage: "profile_complete", completionStatus: "waiting_for_user" });
    expect(commit).toHaveBeenCalledTimes(1);
  }
  if (mode === "normal") {
    expect(result.taskState?.knownSlots.profileImpactEvidence).toMatchObject({ status: "ready", personId: profile.personId,
      profileId: profile.id, profileRevision: profile.version + 1, operationId: originalOutcome!.operationId });
    const job = jobA;
    await repository.saveJobDescription(job);
    await repository.saveJobDescription({ ...job, id: "impact-job-b", title: "运营岗位" });
    await repository.saveJobDescription({ ...job, id: "impact-job-unselected", title: "其他岗位" });
    const persisted = (await persistence.get(result.id))!;
    expect({ personId: persisted.personId, activeProfileId: persisted.activeProfileId, profileRevision: persisted.profileRevision, profileVersionNumber: persisted.profileVersionNumber, selected: persisted.taskState?.selectedEntities }).toMatchObject({ personId: profile.personId, activeProfileId: profile.id, profileRevision: profile.version + 1, profileVersionNumber: 1, selected: { profileId: profile.id, profileVersion: profile.version + 1 } });
    const initialBinding = resolveCareerSessionBinding({ sessionId: persisted.id, session: persisted });
    expect(initialBinding).toEqual({ agentSessionId: result.id, personId: profile.personId!, profileId: profile.id,
      profileVersionNumber: profile.profileVersionNumber ?? 1, profileRevision: profile.version + 1 });
    const suggested = await gateway.execute("career.job.propose_impact_selection", { jobIds: [job.id, "impact-job-b"] },
      { agentSessionId: result.id, operationId: "impact-selection-suggestion", careerSessionBinding: initialBinding! });
    expect(suggested.ok).toBe(true);
    expect(suggested.data).toMatchObject({ jobIds: [job.id, "impact-job-b"] });
    const staged = new AgentTaskStateReducer().reduce(result.taskState!, { type: "tool_observation",
      toolName: "propose_profile_impact_selection", observation: suggested.data });
    expect(staged.knownSlots.profileImpactPendingSelection).toEqual([job.id, "impact-job-b"]);
    const clarification = await gateway.execute("career.job.propose_impact_selection", {
      jobIds: [job.id, "impact-job-b"], clarificationRequired: true, question: "你想分析哪一个岗位？"
    }, { agentSessionId: result.id, operationId: "impact-selection-clarify", careerSessionBinding: initialBinding! });
    expect(clarification.ok).toBe(true);
    expect(clarification.data).toMatchObject({ clarificationRequired: true, candidates: [
      { order: 1, id: job.id }, { order: 2, id: "impact-job-b" }
    ] });
    const pending = new AgentTaskStateReducer().reduce(result.taskState!, { type: "tool_observation",
      toolName: "propose_profile_impact_selection", observation: clarification.data });
    expect(pending.knownSlots.profileImpactPendingSelection).toEqual([]);
    expect(pending.knownSlots.profileImpactPendingInteraction).toMatchObject({ kind: "clarify_jobs",
      jobIds: [job.id, "impact-job-b"] });
    await persistence.save({ ...result, id: "impact-clarification-session", taskState: pending });
    const recalled = await gateway.execute("career.job.list", {}, { agentSessionId: "impact-clarification-session",
      operationId: "impact-selection-recall", careerSessionBinding: { ...initialBinding!, agentSessionId: "impact-clarification-session" } });
    expect(recalled.data).toMatchObject({ pendingInteraction: { kind: "clarify_jobs", candidates: [
      { order: 1, id: job.id }, { order: 2, id: "impact-job-b" }
    ] } });
    const second = await gateway.execute("career.job.propose_impact_selection", { jobIds: ["impact-job-b"] },
      { agentSessionId: "impact-clarification-session", operationId: "impact-selection-second",
        careerSessionBinding: { ...initialBinding!, agentSessionId: "impact-clarification-session" } });
    const resolved = new AgentTaskStateReducer().reduce(pending, { type: "tool_observation",
      toolName: "propose_profile_impact_selection", observation: second.data });
    expect(resolved.knownSlots.profileImpactPendingSelection).toEqual(["impact-job-b"]);
    expect(resolved.knownSlots.profileImpactPendingInteraction).toMatchObject({ kind: "confirm_jobs" });
    const resumesBefore = await repository.listResumeBranches();
    const active = (await host.adoptDurably(result))!;
    const analyzed = await host.dispatch({ type: "artifact_action", action: { type: "profile_impact_analyze",
      operationId: originalOutcome!.operationId, jobIds: [job.id, "impact-job-b"] } },
    { session: active, pageContext: { pathname: "/ai-workspace", query: {} } });
    const report = analyzed?.taskState?.knownSlots.profileImpactReport as { jobs: Array<{ jobId: string; status: string }> };
    expect(report.jobs.map(item => item.jobId)).toEqual([job.id, "impact-job-b"]);
    expect(report.jobs.every(item => item.status === "ANALYZED")).toBe(true);
    expect(analyzed?.artifactRefs.some(item => item.kind === "resume_impact")).toBe(true);
    expect(await repository.listResumeBranches()).toEqual(resumesBefore);
    const reportData = analyzed!.taskState!.knownSlots.profileImpactReport as { changes: Array<{ id: string }> };
    const proposalSession = await host.dispatch({ type: "artifact_action", action: { type: "profile_impact_prepare", jobId: job.id,
      branchId: existingJob!.branch.id, itemId: reportData.changes[0].id } },
    { session: analyzed!, pageContext: { pathname: "/ai-workspace", query: {} } });
    const proposal = proposalSession!.taskState!.knownSlots.profileImpactProposal as { id: string; status: string };
    expect(proposal.status).toBe("pending");
    expect(await repository.getResumeBranch(existingJob!.branch.id)).toEqual(existingJob!.branch);
    const ignored = await host.dispatch({ type: "artifact_action", action: { type: "profile_impact_decide", proposalId: proposal.id, decision: "ignore" } },
      { session: proposalSession!, pageContext: { pathname: "/ai-workspace", query: {} } });
    expect(await repository.getResumeBranch(existingJob!.branch.id)).toEqual(existingJob!.branch);
    const proposedAgain = await host.dispatch({ type: "artifact_action", action: { type: "profile_impact_prepare", jobId: job.id,
      branchId: existingJob!.branch.id, itemId: reportData.changes[0].id } },
    { session: ignored!, pageContext: { pathname: "/ai-workspace", query: {} } });
    const nextProposal = proposedAgain!.taskState!.knownSlots.profileImpactProposal as { id: string };
    const oldItem = existingJob!.branch.structuredContentItems!.find(item => item.data.sectionType === "project")!;
    if (oldItem.data.sectionType !== "project") throw new Error("project_fixture_expected");
    const diff: ResumeTailoringDiff = { target: { sectionId: "project", itemId: oldItem.id, fieldPath: "description" },
      operation: "replace", original: oldItem.data.description!, value: "参与课程项目工作。", reason: "清晰说明已有经历",
      requirementIds: [], targetKeywords: [], supportLevel: "verified", evidenceRefs: [{ type: "experience_fact", experienceId: "old-exp",
        factId: oldFact.id, factText: oldFact.statement, factQuote: oldFact.statement }] };
    const ignoredDiff = { ...diff, value: "参与课程项目并完成成果。" };
    const executeReal = executor.execute.bind(executor);
    vi.spyOn(executor, "execute").mockImplementation(async args => {
      if (args.toolName !== "generate_tailoring_changes") return executeReal(args);
      const input = args.toolInput as { session: { plan: object } };
      return { ok: true, toolName: args.toolName, operationId: args.operationId, artifactIds: [], completedAt: now,
        data: { session: { ...input.session, plan: { ...input.session.plan, diffs: [diff, ignoredDiff] } } } };
    });
    const stagedReview = await host.dispatch({ type: "artifact_action", action: { type: "profile_impact_decide", proposalId: nextProposal.id, decision: "generate" } },
      { session: proposedAgain!, pageContext: { pathname: "/ai-workspace", query: {} } });
    expect((stagedReview!.taskState!.knownSlots.profileImpactProposal as { diffs: unknown[] }).diffs).toHaveLength(2);
    const naturalReview = await gateway.execute("career.resume.propose_impact_review", { proposalId: nextProposal.id, decisions: [
      { index: 1, decision: "accept" }, { index: 2, decision: "edit", editedValue: "参与了课程项目。" }, { index: 3, decision: "reject" }
    ] }, { agentSessionId: stagedReview!.id, operationId: "impact-natural-review", careerSessionBinding: initialBinding! });
    expect(naturalReview.ok).toBe(true);
    const reviewState = new AgentTaskStateReducer().reduce(stagedReview!.taskState!, { type: "tool_observation",
      toolName: "propose_impact_review", observation: naturalReview.data });
    const reviewed = await persistence.save({ ...stagedReview!, taskState: reviewState });
    expect(await repository.getResumeBranch(existingJob!.branch.id)).toEqual(existingJob!.branch);
    const confirmed = await host.dispatch({ type: "artifact_action", action: { type: "profile_impact_decide", proposalId: nextProposal.id, decision: "confirm" } },
      { session: reviewed!, pageContext: { pathname: "/ai-workspace", query: {} } });
    expect(confirmed?.taskState?.knownSlots.profileImpactProposal).toMatchObject({ status: "applied" });
    expect((await repository.getResumeBranch(existingJob!.branch.id))?.revision).toBe(existingJob!.branch.revision + 1);
    expect(JSON.stringify(await repository.getResumeBranch(existingJob!.branch.id))).toContain("参与了课程项目。");
    expect(JSON.stringify(await repository.getResumeBranch(existingJob!.branch.id))).not.toContain("参与课程项目并完成成果。");
    expect(await repository.getResumeRevision(existingJob!.firstRevision.id)).toEqual(existingJob!.firstRevision);
    const binding = { agentSessionId: analyzed!.id, personId: profile.personId!, profileId: profile.id,
      profileVersionNumber: profile.profileVersionNumber ?? 1, profileRevision: profile.version + 1 };
    const impactRead = await gateway.execute("career.context.retrieve", { profileId: profile.id, query: "岗位影响" }, {
      agentSessionId: analyzed!.id, operationId: "impact-context-current", careerSessionBinding: binding });
    expect(impactRead.ok).toBe(true);
    expect(impactRead.data).toMatchObject({ profileImpact: { sessionId: analyzed!.id, status: "current", jobs: [
      { jobId: job.id }, { jobId: "impact-job-b" }
    ] } });
    await repository.saveJobDescription({ ...job, title: "数据岗位已更新" });
    const staleCandidates = await gateway.execute("career.job.list", {}, { agentSessionId: "impact-clarification-session",
      operationId: "impact-selection-stale", careerSessionBinding: { ...initialBinding!, agentSessionId: "impact-clarification-session" } });
    expect(staleCandidates.data).toMatchObject({ pendingInteractionStale: true });
    expect(staleCandidates.data).not.toHaveProperty("pendingInteraction");
    const staleRead = await gateway.execute("career.context.retrieve", { profileId: profile.id, query: "岗位影响" }, {
      agentSessionId: analyzed!.id, operationId: "impact-context-stale", careerSessionBinding: binding });
    expect(staleRead.data).toMatchObject({ profileImpact: { status: "stale", jobs: [] } });
    const freshSession = AgentRuntime.createConversationSession();
    await persistence.save(freshSession);
    const freshContext = await gateway.execute("career.context.retrieve", { profileId: profile.id, query: "岗位影响" }, {
      agentSessionId: freshSession.id, operationId: "impact-context-fresh", careerSessionBinding: { ...binding, agentSessionId: freshSession.id } });
    expect(freshContext.ok).toBe(true);
    expect(freshContext.data).not.toHaveProperty("profileImpact");
    const retrieved = await gateway.execute("career.profile.get", { profileId: profile.id }, {
      agentSessionId: freshSession.id, userMessageId: "fresh-session-message", operationId: "fresh-session-profile-read",
      careerSessionBinding: { agentSessionId: freshSession.id, personId: profile.personId!, profileId: profile.id,
        profileVersionNumber: profile.profileVersionNumber ?? 1, profileRevision: profile.version + 1 }
    });
    expect(retrieved.ok).toBe(true);
    expect(JSON.stringify(retrieved)).toContain("示例数据分析");
  }
  expect((await repository.getProfile(profile.id))?.version).toBe(profile.version + (mode === "not_sent" ? 0 : mode === "conflict" || mode === "stale_before" ? 2 : 1));
});

it("keeps an impact answer visible while the intake workflow remains unfinished", async () => {
  db = new CareerAdaptDb(`ux011-impact-answer-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const persistence = new AgentSessionStore(repository);
  const service = new BrowserAgentToolService(repository);
  const registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
  const host = new AgentHostStore({ repository, persistence, executor: new CareerToolGatewayExecutor(registry, gateway) });
  const initial = AgentRuntime.create("guided_profile_intake", "structure_facts");
  const task = new AgentTaskStateReducer().create(initial, "profile_intake");
  const session = await persistence.save({ ...initial, taskState: { ...task, stage: "structure_facts",
    completionStatus: "waiting_for_user", knownSlots: { ...task.knownSlots, profileImpactReport: { binding: { profileId: "profile" } } } } });
  host.adopt(session);
  const shell = await host.beginRuntimeShell({ session, userMessage: "这段经历对岗位有什么帮助？", runtimeId: "hermes" });
  const final = await host.applyRuntimeEvent({ type: "turn_completed", sessionId: session.id, turnId: shell.turnId,
    timestamp: new Date().toISOString(), message: "岗位要求：数据分析；证据：已确认项目。" }, shell.assistantMessageId);
  expect(final?.messages.find(message => message.id === shell.assistantMessageId)?.content).toContain("岗位要求：数据分析");
  expect(final?.taskState).toMatchObject({ stage: "structure_facts" });
  expect(final?.taskState?.completionStatus).not.toBe("completed");
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
