import { CareerAdaptDb } from "@/services/storage/db";
import { profileIntakeRequestFingerprint, WorkspaceRepository, type ProfileIntakeOperationRequest } from "@/services/storage/repositories";
import { CareerProfileSchema, JobDescriptionSchema } from "@/domain/schemas";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization/v4/analyze";
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

async function prepare(name: string, withOldItem = false) {
  const repository = repo(name);
  const now = "2026-11-16T00:00:00.000Z";
  const oldFact = { id: "browser-old-fact", statement: "参与课程项目。", category: "experience", confirmedByUser: true, riskLevel: "low",
    createdAt: now, updatedAt: now, provenance: [{ sourceType: "user_input", sourceId: "browser-old-source", sourceText: "参与课程项目。",
      confidence: 1, confirmedByUser: true, riskLevel: "low", createdAt: now }] };
  const otherFact = { ...oldFact, id: "browser-old-fact-2", statement: "参与研究项目。",
    provenance: [{ ...oldFact.provenance[0], sourceId: "browser-old-source-2", sourceText: "参与研究项目。" }] };
  const oldData = withOldItem ? { experiences: [{ id: "browser-old-exp", type: "project", organization: "旧项目", role: "成员",
    facts: [oldFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: now, updatedAt: now },
    { id: "browser-old-exp-2", type: "project", organization: "研究项目", role: "成员",
      facts: [otherFact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: now, updatedAt: now }],
    structuredFacts: [{ data: { id: "browser-old-item", sectionType: "project", title: "旧项目", current: false,
      description: "参与课程项目。", highlights: [], outcomes: [], tools: [], customFields: [] },
    factIds: [oldFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] },
    { data: { id: "browser-old-item-2", sectionType: "project", title: "研究项目", current: false,
      description: "参与研究项目。", highlights: [], outcomes: [], tools: [], customFields: [] },
    factIds: [otherFact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }] } : { experiences: [] };
  const profile = await repository.saveProfile(CareerProfileSchema.parse({ id: "browser-profile", name: "匿名",
    createdAt: now, updatedAt: now, version: 1, schemaVersion: "career-profile-v2",
    basics: { name: "匿名", links: [] }, preference: { targetRoles: [], targetCities: [], industries: [] },
    ...oldData, skills: [], evidence: [] }));
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

async function prepareUi(name: string, alreadyCommitted: boolean, withOldItem = false) {
  const repository = repo(name);
  const prepared = await prepare(name, withOldItem);
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

async function prepareImpactUi(name: string) {
  const prepared = await prepareUi(name, false, true);
  const repository = repo(name);
  const now = "2026-11-16T00:00:00.000Z";
  const rawText = "岗位职责\n参与示例数据分析项目。\n参与课程项目和研究项目。\n任职要求\n具备数据分析实践经验。";
  const job = JobDescriptionSchema.parse({ id: "browser-impact-job", title: "数据分析岗位", company: "验收公司", source: "manual", rawText,
    requirementGraph: analyzeJobDescriptionV4({ rawText }).graph,
    requirements: [{ id: "browser-requirement", category: "responsibility", description: "参与示例数据分析项目。", priority: "high",
      hardConstraint: false, sourceSpan: { start: 5, end: 16, text: "参与示例数据分析项目。" }, confidence: 1, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now });
  await repository.saveJobDescription(job);
  await repository.saveJobDescription({ ...job, id: "browser-impact-job-b", company: "另一家公司" });
  const existing = await repository.createJobSpecificBranchFromProfile({ profileId: prepared.request.targetProfileId, jobId: job.id,
    operationId: "browser-existing-job", name: "已有岗位简历", selectedCanonicalItemIds: ["browser-old-item", "browser-old-item-2"], requirementMatchIds: [] });
  await repository.confirmProfileIntake(prepared.request);
  return { ...prepared, jobId: job.id, existing };
}

async function setVisibleSelectorJobs(name: string, count: number) {
  const repository = repo(name);
  const original = (await repository.getJobDescription("browser-impact-job"))!;
  for (let index = 2; index < 4; index++) {
    await repository.saveJobDescription({ ...original, id: `browser-selector-extra-${index}`,
      title: index === 3 ? "高级跨部门数据分析和复杂业务运营支持岗位长期名称测试" : "运营支持岗位" });
  }
  const ids = ["browser-impact-job", "browser-impact-job-b", "browser-selector-extra-2", "browser-selector-extra-3"];
  const jobs = await repository.listJobDescriptions();
  await repository.setMeta("jobWorkspace:archivedJobIds", jobs.filter(job => !ids.slice(0, count).includes(job.id)).map(job => job.id));
}

async function seedBindingJobs(name: string) {
  const repository = repo(name);
  const now = new Date().toISOString();
  for (const [index, title] of ["产品运营验收岗", "供应链验收岗"].entries()) {
    const rawText = "岗位职责\n负责用户反馈整理和竞品分析。\n任职要求\n具备相关实践经验。";
    await repository.saveJobDescription(JobDescriptionSchema.parse({ id: `binding-job-${index}`, title, company: "验收公司",
      source: "manual", rawText, requirementGraph: analyzeJobDescriptionV4({ rawText }).graph, createdAt: now, updatedAt: now }));
  }
}

async function seedGolden(name: string) {
  const repository = repo(name);
  const profileId = await repository.getActiveProfileId();
  const original = profileId ? await repository.getProfile(profileId) : undefined;
  if (!original) throw new Error("golden_profile_missing");
  const now = new Date().toISOString();
  const facts = ["参与课程项目。", "参与研究项目。"].map((statement, index) => ({ id: `golden-fact-${index}`, statement,
    category: "experience" as const, confirmedByUser: true, riskLevel: "low" as const, createdAt: now, updatedAt: now,
    provenance: [{ sourceType: "user_input" as const, sourceId: `golden-source-${index}`, sourceText: statement,
      confidence: 1, confirmedByUser: true, riskLevel: "low" as const, createdAt: now }] }));
  const profile = await repository.saveProfile({ ...original, version: original.version + 1,
    experiences: [...original.experiences, ...facts.map((fact, index) => ({ id: `golden-exp-${index}`, type: "project" as const,
      organization: `已有项目${index + 1}`, role: "成员", facts: [fact], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: now, updatedAt: now }))],
    structuredFacts: [...(original.structuredFacts ?? []), ...facts.map((fact, index) => ({ data: { id: `golden-item-${index}`,
      sectionType: "project" as const, title: `已有项目${index + 1}`, current: false, description: fact.statement,
      highlights: [], outcomes: [], tools: [], customFields: [] }, factIds: [fact.id], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] }))] });
  const general = await repository.createGeneralResumeBranch({ profileId: profile.id, operationId: "golden-general", name: "已有通用简历",
    includeProfileFacts: true, includeProfileBasics: true });
  const titles = ["产品运营验收岗", "供应链验收岗"];
  const jobs = await Promise.all(titles.map(async (title, index) => {
    const rawText = `岗位职责\n负责用户反馈整理和竞品分析。\n参与课程项目和研究项目。\n任职要求\n具备相关实践经验。`;
    const job = JobDescriptionSchema.parse({ id: `golden-job-${index}`, title, company: "验收公司", rawText, source: "manual",
      requirementGraph: analyzeJobDescriptionV4({ rawText }).graph,
      requirements: [{ id: `golden-req-${index}`, category: "responsibility", description: "负责用户反馈整理和竞品分析。",
        priority: "high", hardConstraint: false, sourceSpan: { start: 5, end: 20, text: "负责用户反馈整理和竞品分析。" },
        confidence: 1, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now });
    await repository.saveJobDescription(job);
    const branch = await repository.createJobSpecificBranchFromProfile({ profileId: profile.id, jobId: job.id,
      operationId: `golden-job-branch-${index}`, name: `${title}简历`, selectedCanonicalItemIds: ["golden-item-0", "golden-item-1"], requirementMatchIds: [] });
    return { job, branch };
  }));
  return { profileId: profile.id, general, jobs };
}

Object.assign(window, { intakeConcurrency: { prepare, prepareAlternative, commit, read, variant, prepareUi, prepareImpactUi, setVisibleSelectorJobs, seedBindingJobs, seedGolden, inspectUi, advanceProfile, seedLegacy, simulateLateOutcome } });
