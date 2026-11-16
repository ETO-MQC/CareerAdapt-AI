import { CareerAdaptDb } from "@/services/storage/db";
import { profileIntakeRequestFingerprint, WorkspaceRepository, type ProfileIntakeOperationRequest } from "@/services/storage/repositories";
import { CareerProfileSchema } from "@/domain/schemas";
import { adaptConversationMessageToIntakeDraft } from "@/domain/profileIntake/ConversationIntakeAdapter";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { ProfileIntakeSemanticService } from "@/domain/profileIntake/ProfileIntakeSemanticService";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";

const repositories = new Map<string, WorkspaceRepository>();
function repo(name: string) {
  let repository = repositories.get(name);
  if (!repository) { repository = new WorkspaceRepository(new CareerAdaptDb(name)); repositories.set(name, repository); }
  return repository;
}

async function prepare(name: string) {
  const repository = repo(name);
  const now = "2026-11-16T00:00:00.000Z";
  const profile = await repository.saveProfile(CareerProfileSchema.parse({ id: "browser-profile", name: "匿名",
    createdAt: now, updatedAt: now, version: 1, schemaVersion: "career-profile-v2",
    basics: { name: "匿名", links: [] }, preference: { targetRoles: [], targetCities: [], industries: [] },
    experiences: [], skills: [], evidence: [] }));
  const raw = "我参与了示例数据分析项目。";
  const draft = adaptConversationMessageToIntakeDraft({ sessionId: "browser-session", messageId: "browser-message",
    turnId: "browser-turn", text: raw, capturedAt: now, semanticResult: { mode: "ai", providerStatus: "available",
      candidates: [{ id: "browser-item", label: "示例数据分析", sourceQuote: raw, normalization: {
        sectionType: "project", normalizedText: "参与示例数据分析项目。", structuredItem: { id: "browser-item",
          sectionType: "project", title: "示例数据分析", description: "参与示例数据分析项目。", current: false,
          highlights: [], tools: [], outcomes: [], customFields: [] }, confidence: 0.9, needsConfirmation: false,
        needsNormalization: false, fieldEvidence: [] } }] } });
  const saved = await repository.saveImportedResumeDraft(draft.draft, 0);
  const service = new BrowserAgentToolService(repository, new ProfileIntakeSemanticService(async () => ({ ok: false, errorCode: "provider_unavailable" })));
  await service.reviewProfileIntake({ importId: saved.importId, expectedDraftRevision: saved.revision,
    candidateId: saved.sections[0].items[0].id, decision: "accept" });
  const reviewed = (await repository.getImportedResumeDraft(saved.importId))!;
  const plan = await repository.reconcileImportedResume({ importId: reviewed.importId, expectedDraftRevision: reviewed.revision, profileId: profile.id });
  const base = { importId: reviewed.importId, expectedDraftRevision: reviewed.revision,
    expectedReconciliationRevision: plan.revision, targetProfileId: profile.id, expectedProfileVersion: profile.version };
  const frozen = await repository.freezeProfileIntakeRequest({ ...base, personId: profile.personId!,
    confirmation: { sessionId: "browser-session", turnId: "confirm-turn", messageId: "confirm-message", text: "确认保存" } });
  return { base, frozen, personId: profile.personId! };
}

async function commit(name: string, request: ProfileIntakeOperationRequest) {
  try { return { ok: true as const, result: await repo(name).confirmProfileIntake(request) }; }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : String(error) }; }
}

async function prepareAlternative(name: string) {
  const repository = repo(name);
  const profile = (await repository.getProfile("browser-profile"))!;
  const raw = "我参与了另一项用户研究。";
  const draft = adaptConversationMessageToIntakeDraft({ sessionId: "browser-other-session", messageId: "browser-other-message",
    turnId: "browser-other-turn", text: raw, capturedAt: "2026-11-16T00:00:00.000Z", semanticResult: {
      mode: "ai", providerStatus: "available", candidates: [{ id: "browser-other-item", label: "用户研究", sourceQuote: raw,
        normalization: { sectionType: "project", normalizedText: "参与用户研究。", structuredItem: { id: "browser-other-item",
          sectionType: "project", title: "用户研究", description: "参与用户研究。", current: false,
          highlights: [], tools: [], outcomes: [], customFields: [] }, confidence: 0.9, needsConfirmation: false,
          needsNormalization: false, fieldEvidence: [] } }] } });
  const saved = await repository.saveImportedResumeDraft(draft.draft, 0);
  const service = new BrowserAgentToolService(repository, new ProfileIntakeSemanticService(async () => ({ ok: false, errorCode: "provider_unavailable" })));
  await service.reviewProfileIntake({ importId: saved.importId, expectedDraftRevision: saved.revision,
    candidateId: saved.sections[0].items[0].id, decision: "accept" });
  const reviewed = (await repository.getImportedResumeDraft(saved.importId))!;
  const plan = await repository.reconcileImportedResume({ importId: reviewed.importId, expectedDraftRevision: reviewed.revision, profileId: profile.id });
  const base = { importId: reviewed.importId, expectedDraftRevision: reviewed.revision,
    expectedReconciliationRevision: plan.revision, targetProfileId: profile.id, expectedProfileVersion: profile.version };
  const frozen = await repository.freezeProfileIntakeRequest({ ...base, personId: profile.personId!,
    confirmation: { sessionId: "browser-other-session", turnId: "other-confirm", messageId: "other-confirm-message", text: "确认保存另一项" } });
  return { base, frozen };
}

async function read(name: string) {
  const profile = (await repo(name).getProfile("browser-profile"))!;
  return { version: profile.version, itemCount: canonicalProfileLibraryItems(profile).length };
}

async function inspectUi(name: string, request: ProfileIntakeOperationRequest, personId: string) {
  const repository = repo(name);
  const profile = (await repository.getProfile(request.targetProfileId))!;
  const branches = await repository.listResumeBranches(request.targetProfileId);
  const revisions = await Promise.all(branches.map((branch) => repository.listResumeRevisions(branch.id)));
  const receipt = await repository.getProfileIntakeOperationReceipt({ ...request, personId });
  return { version: profile.version, itemCount: canonicalProfileLibraryItems(profile).length,
    branches, revisions, receiptOperationId: receipt?.operationId, receiptFingerprint: receipt?.requestFingerprint };
}

async function advanceProfile(name: string) {
  const profile = (await repo(name).getProfile("browser-profile"))!;
  return repo(name).updateCareerPreferences({ profileId: profile.id, expectedProfileRevision: profile.version,
    operationId: "browser-ui-preference-change", patch: { additions: { targetCities: ["上海"] } } });
}

async function seedLegacy(name: string) {
  await repo(name).setMeta("profileIntakeOperation:v1:browser-ui-original-operation", {
    profileId: "browser-profile", profileVersion: 2, importId: "historical", committedFactCount: 1, idempotent: false
  });
}

async function simulateLateOutcome(name: string, sessionId: string, expectedRevision: number) {
  const store = new AgentSessionStore(repo(name));
  const session = (await store.get(sessionId))!;
  const task = session.taskState!;
  const current = task.knownSlots.profileIntakeCommitOutcome as Record<string, unknown>;
  try {
    await store.saveIfRevision({ ...session, taskState: { ...task, knownSlots: { ...task.knownSlots,
      profileIntakeCommitOutcome: { ...current, status: "UNKNOWN" } } } }, expectedRevision);
    return "accepted";
  } catch (error) { return error instanceof Error ? error.message : String(error); }
}

function variant(request: ProfileIntakeOperationRequest) {
  if (!request.frozen) throw new Error("missing_frozen_request");
  const { fingerprint: _fingerprint, ...original } = request.frozen;
  void _fingerprint;
  const changed = { ...original, confirmation: { ...original.confirmation, text: "另一项确认" } };
  return { ...request, frozen: { ...changed, fingerprint: profileIntakeRequestFingerprint(changed) } };
}

async function prepareUi(name: string, alreadyCommitted: boolean) {
  const repository = repo(name);
  const prepared = await prepare(name);
  await repository.setActiveProfileId(prepared.base.targetProfileId);
  const request = { ...prepared.base, operationId: "browser-ui-original-operation", frozen: prepared.frozen };
  const branch = await repository.createGeneralResumeBranch({ profileId: request.targetProfileId,
    operationId: "browser-ui-general-resume", name: "隔离测试简历", includeProfileFacts: false, includeProfileBasics: false });
  if (alreadyCommitted) await repository.confirmProfileIntake(request);
  const now = new Date().toISOString();
  const initial = { ...AgentRuntime.create("guided_profile_intake", "final_review"), id: "browser-session",
    personId: prepared.personId, activeProfileId: request.targetProfileId, profileRevision: request.expectedProfileVersion,
    updatedAt: now, messages: [{ id: "confirm-message", turnId: "confirm-turn", role: "user" as const,
      content: "确认保存", kind: "text" as const, type: "text" as const, status: "complete" as const, createdAt: now }] };
  const task = new AgentTaskStateReducer().create(initial, "profile_intake");
  const session = await new AgentSessionStore(repository).save({ ...initial, taskState: { ...task, knownSlots: {
    ...task.knownSlots, targetProfileId: request.targetProfileId, expectedProfileVersion: request.expectedProfileVersion,
    intakeImportId: request.importId, expectedIntakeDraftRevision: request.expectedDraftRevision,
    profileIntakeCommitOutcome: { status: "UNKNOWN", operationId: request.operationId, importId: request.importId,
      targetProfileId: request.targetProfileId, request: { personId: prepared.personId,
        expectedDraftRevision: request.expectedDraftRevision, expectedReconciliationRevision: request.expectedReconciliationRevision,
        expectedProfileVersion: request.expectedProfileVersion, frozen: request.frozen } }
  } } });
  localStorage.setItem("careeradapt.agent.activeSessionId", session.id);
  return { request, personId: prepared.personId, sessionId: session.id, sessionRevision: session.sessionRevision,
    branch: branch.branch, revision: branch.revision,
    before: await inspectUi(name, { ...request, operationId: "not-yet-an-operation" }, prepared.personId) };
}

Object.assign(window, { intakeConcurrency: { prepare, prepareAlternative, commit, read, variant, prepareUi, inspectUi, advanceProfile, seedLegacy, simulateLateOutcome } });
