import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { AgentExecutor, AgentConfirmationRequiredError } from "@/agent/runtime/agentExecutor";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { createCareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { ResumeImportOrchestrator } from "@/services/resumeImport/ResumeImportOrchestrator";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { projectJobGraphV4ToAnalyzerOutput } from "@/domain/jobOptimization/v3/project";
import { JobAnalysisDraftSchema } from "@/domain/schemas";
import { ingestCandidateListing, manualCandidateIdentity, parseCandidateToDraft } from "@/domain/jobDiscovery/candidatePipeline";
import { classifyAgentToolResult } from "@/agent/contracts/agentCapabilityOutcome";
import type { AgentSession } from "@/agent/contracts/agentSession";
import type { AgentPageContext } from "@/agent/contracts/agentContext";

// V4-P2-C 能力认证：真实 AgentHostStore -> Executor -> Registry ->
// BrowserAgentToolService -> WorkspaceRepository 全链路。
//
// 本文件不使用直接调用 service 的捷径，也不 mock Repository：每个写入维度都要
// 穿过真实确认闸、真实事务与真实 revision CAS。UI / MCP 路径的一致性由
// `workspaceRepositoryWriteParity` 用同一组 spy 方法证明。

const CANONICAL_JSON = readFileSync("tests/fixtures/resume-import/reconciliation-v2.json", "utf8");
const JD = "岗位：数据分析师\n职责\n- 使用 SQL 进行每日数据分析\n- 搭建指标看板\n要求\n3 年数据相关经验";
const PAGE_CONTEXT = { route: "/ai" } as AgentPageContext;
const USER_MESSAGE_ID = "user-msg-v4p2c";

let db: CareerAdaptDb | undefined;
let dbName = "";

afterEach(async () => {
  vi.restoreAllMocks();
  if (!db) return;
  const name = dbName;
  db.close();
  const handle = new CareerAdaptDb(name);
  handle.close();
  await handle.delete();
  db = undefined;
});

type Harness = {
  db: CareerAdaptDb;
  repository: WorkspaceRepository;
  service: BrowserAgentToolService;
  registry: ReturnType<typeof createAgentToolRegistry>;
  executor: AgentExecutor;
  host: AgentHostStore;
};

function harness(name = `v4p2c-chain-${crypto.randomUUID()}`): Harness {
  dbName = name;
  db = new CareerAdaptDb(name);
  const repository = new WorkspaceRepository(db);
  const service = new BrowserAgentToolService(repository);
  const registry = createAgentToolRegistry(service);
  const executor = new AgentExecutor(registry);
  const host = new AgentHostStore({
    executor,
    persistence: { save: async (value: AgentSession) => value } as never,
    repository
  });
  return { db, repository, service, registry, executor, host };
}

async function importDraft(repository: WorkspaceRepository, tag: string) {
  const orchestrator = new ResumeImportOrchestrator(repository);
  const file = new File([CANONICAL_JSON], `resume-${tag}.json`, { type: "application/json" });
  return orchestrator.prepare(
    { fileName: `resume-${tag}.json`, mimeType: "application/json", size: file.size, file },
    { semanticMode: "local" }
  );
}

/** 用真实 JSON 导入能力播种 Profile + 通用简历，不手工造数据。 */
async function seedProfile(repository: WorkspaceRepository, tag = "seed") {
  const prepared = await importDraft(repository, tag);
  await repository.confirmImportedResume({
    importId: prepared.importId,
    expectedDraftRevision: prepared.draftRevision,
    operationId: `op-seed-${tag}`,
    target: { mode: "new", profileName: `认证用户-${tag}`, createGeneralResume: true }
  });
  const [profile] = await repository.listProfiles();
  const general = (await repository.listResumeBranches()).find((branch) => branch.branchPurpose === "general")!;
  return { profile, general };
}

function sessionWithPendingCall(
  toolName: string,
  input: unknown,
  operationId: string,
  turnId: string,
  identity: { personId: string; profileId: string; profileVersionNumber: number; profileRevision: number },
  withUserMessage: boolean
): AgentSession {
  const base = AgentRuntime.create("job_ingestion", "confirm_commit");
  return {
    ...base,
    // Host 以 session 为绑定权威（pageContext 只检测不替换），因此会话必须携带
    // 真实人物/资料库身份，转换确认才会绑定到真正的 Profile。
    personId: identity.personId,
    activeProfileId: identity.profileId,
    profileVersionNumber: identity.profileVersionNumber,
    profileRevision: identity.profileRevision,
    activeTurn: {
      id: turnId,
      sessionId: base.id,
      ...(withUserMessage ? { sourceUserMessageId: USER_MESSAGE_ID, userMessageId: USER_MESSAGE_ID } : {}),
      preferredRuntime: "hermes",
      attemptedRuntime: "hermes",
      finalRuntime: "hermes",
      fallbackUsed: false,
      executionOwner: "runtime_continuation",
      status: "running",
      startedAt: new Date().toISOString()
    },
    pendingToolCall: { toolName, input, operationId, turnId },
    pendingConfirmation: {
      id: `confirmation-${operationId}`,
      operationId,
      toolName,
      title: "确认操作",
      description: "确认执行",
      status: "pending",
      requestedAt: new Date().toISOString()
    }
  } as unknown as AgentSession;
}

function bindingFor(
  profile: { personId?: string; id: string; profileVersionNumber?: number; version: number },
  agentSessionId: string
) {
  return {
    // V4-P2-C：播种后的导入确认已经建立 Person 绑定，这里只做类型收敛。
    personId: profile.personId ?? "person-v4p2c",
    profileId: profile.id,
    profileVersionNumber: profile.profileVersionNumber ?? 1,
    profileRevision: profile.version,
    agentSessionId
  };
}

describe("V4-P2-C: 记录岗位 capability certification (commit_job)", () => {
  it("first call / missing confirmation / confirmed / repeat", async () => {
    const { repository, executor, host } = harness();
    const { profile } = await seedProfile(repository);
    const input = { title: "数据分析师", company: "Acme", rawText: JD, graph: analyzeJobDescriptionV4({ rawText: JD }).graph };

    // 维度 2：缺少确认 —— Executor 确认闸必须拦住，且零写入。
    await expect(executor.execute({ toolName: "commit_job", toolInput: input, operationId: "op-job-1" }))
      .rejects.toBeInstanceOf(AgentConfirmationRequiredError);
    expect(await repository.listJobDescriptions()).toHaveLength(0);
    expect(await repository.listJobListings()).toHaveLength(0);

    // 维度 1 + 3：确认后执行，走真实 Host.resolveConfirmation。
    const identity = bindingFor(profile, "pending");
    const session = sessionWithPendingCall("commit_job", input, "op-job-1", "turn-job-1", identity, true);
    const resolved = await host.resolveConfirmation(true, PAGE_CONTEXT, session);
    expect(resolved).toBeTruthy();
    expect(await repository.listJobDescriptions()).toHaveLength(1);
    const listings = await repository.listJobListings();
    expect(listings).toHaveLength(1);
    expect(listings[0].sourceKey).toBe("local.manual");

    // 确认记录必须绑定 userMessageId 与会话身份。
    const confirmations = await (db as CareerAdaptDb).appMeta
      .filter((record) => record.key.startsWith("conversion-confirmation:"))
      .toArray();
    const consumed = confirmations[0].value as {
      state: string; userMessageId?: string; careerSessionBinding?: { agentSessionId: string; profileId: string };
    };
    expect(consumed.state).toBe("consumed");
    expect(consumed.userMessageId).toBe(USER_MESSAGE_ID);
    expect(consumed.careerSessionBinding?.agentSessionId).toBe(session.id);
    expect(consumed.careerSessionBinding?.profileId).toBe(profile.id);

    // 维度 4：重复执行 —— 同一 operationId 重放幂等，不产生第二个岗位。
    await host.resolveConfirmation(true, PAGE_CONTEXT, session);
    expect(await repository.listJobDescriptions()).toHaveLength(1);
    expect(await repository.listJobListings()).toHaveLength(1);
  });

  it("mid-chain failure (missing agent binding) stops before the conversion confirmation", async () => {
    const { repository, executor } = harness();
    const input = { title: "数据分析师", company: "Acme", rawText: JD, graph: analyzeJobDescriptionV4({ rawText: JD }).graph };

    // 维度 5：确认已给出，但 Agent 通道缺 careerSessionBinding / userMessageId。
    // 真实链路必须在建立转换确认之前快速失败，且不产生正式岗位。
    const result = await executor.execute({
      toolName: "commit_job",
      toolInput: input,
      operationId: "op-job-nb",
      confirmed: true,
      confirmationCount: 1
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("agent_confirmation_binding_missing");
    expect(classifyAgentToolResult(result).outcome).toBe("permanent_failure");

    // 候选岗位可以保留（P2-B 契约），但不得产生半完成的正式岗位或确认记录。
    expect(await repository.listJobDescriptions()).toHaveLength(0);
    expect((await repository.listJobListings()).find((listing) => listing.jobDescriptionId)).toBeUndefined();
    const confirmations = await (db as CareerAdaptDb).appMeta
      .filter((record) => record.key.startsWith("conversion-confirmation:"))
      .toArray();
    expect(confirmations).toHaveLength(0);
  });

  it("missing userMessageId through the Host is recorded as a tool failure with zero formal jobs", async () => {
    const { repository, host } = harness();
    const input = { title: "数据分析师", company: "Acme", rawText: JD, graph: analyzeJobDescriptionV4({ rawText: JD }).graph };
    const session = sessionWithPendingCall(
      "commit_job",
      input,
      "op-job-nb2",
      "turn-no-binding",
      { personId: "person-v4p2c", profileId: "profile-v4p2c", profileVersionNumber: 1, profileRevision: 0 },
      false
    );
    const resolved = await host.resolveConfirmation(true, PAGE_CONTEXT, session);
    expect(resolved).toBeTruthy();
    expect(await repository.listJobDescriptions()).toHaveLength(0);
    const confirmations = await (db as CareerAdaptDb).appMeta
      .filter((record) => record.key.startsWith("conversion-confirmation:"))
      .toArray();
    expect(confirmations).toHaveLength(0);
  });

  it("dimension 8: recording a job never writes the career profile", async () => {
    const { repository, executor, host } = harness();
    const { profile } = await seedProfile(repository);
    const profileBefore = JSON.stringify(await repository.getProfile(profile.id));
    const input = { title: "数据分析师", company: "Acme", rawText: JD, graph: analyzeJobDescriptionV4({ rawText: JD }).graph };
    const session = sessionWithPendingCall("commit_job", input, "op-job-noprofile", "turn-job-np", bindingFor(profile, "pending"), true);
    void executor;

    await host.resolveConfirmation(true, PAGE_CONTEXT, session);
    expect(await repository.listJobDescriptions()).toHaveLength(1);
    expect(JSON.stringify(await repository.getProfile(profile.id))).toBe(profileBefore);
    expect(await repository.listProfiles()).toHaveLength(1);
  });
});

describe("V4-P2-C: 修改并导出简历 capability certification (archive/restore/general resume)", () => {
  it("archive_resume: first call / missing confirmation / confirmed / repeat / revision conflict / no profile write", async () => {
    const { repository, executor } = harness();
    const { profile, general } = await seedProfile(repository);
    const binding = bindingFor(profile, "session-v4p2c");
    const profileBefore = JSON.stringify(await repository.getProfile(profile.id));

    // 缺少确认
    await expect(executor.execute({
      toolName: "archive_resume",
      toolInput: { resumeId: general.id, expectedRevision: general.revision },
      operationId: "op-archive-1"
    })).rejects.toBeInstanceOf(AgentConfirmationRequiredError);
    expect((await repository.getResumeBranch(general.id))?.lifecycleStatus).toBe("active");

    // 首次调用 + 确认后执行
    const archived = await executor.execute({
      toolName: "archive_resume",
      toolInput: { resumeId: general.id, expectedRevision: general.revision },
      operationId: "op-archive-1",
      confirmed: true,
      confirmationCount: 1,
      careerSessionBinding: binding
    });
    expect(archived.ok).toBe(true);
    expect(classifyAgentToolResult(archived).outcome).toBe("success");
    expect((await repository.getResumeBranch(general.id))?.lifecycleStatus).toBe("archived");

    // 重复执行：同一 operationId 幂等重放
    const replay = await executor.execute({
      toolName: "archive_resume",
      toolInput: { resumeId: general.id, expectedRevision: general.revision },
      operationId: "op-archive-1",
      confirmed: true,
      confirmationCount: 1,
      careerSessionBinding: binding
    });
    expect(replay.ok).toBe(true);

    // revision 冲突：陈旧 expectedRevision 必须被拒且不改变 revision。
    const current = (await repository.getResumeBranch(general.id))!;
    const conflict = await executor.execute({
      toolName: "archive_resume",
      toolInput: { resumeId: general.id, expectedRevision: general.revision },
      operationId: "op-archive-stale",
      confirmed: true,
      confirmationCount: 1,
      careerSessionBinding: binding
    });
    expect(conflict.ok).toBe(false);
    expect(classifyAgentToolResult(conflict).outcome).toBe("permanent_failure");
    expect((await repository.getResumeBranch(general.id))?.revision).toBe(current.revision);

    // 中途失败：状态前置不满足（active 已被归档）时拒绝，而不是重复写入。
    const notActive = await executor.execute({
      toolName: "archive_resume",
      toolInput: { resumeId: general.id, expectedRevision: current.revision },
      operationId: "op-archive-again",
      confirmed: true,
      confirmationCount: 1,
      careerSessionBinding: binding
    });
    expect(notActive.ok).toBe(false);

    // 恢复链路
    const restored = await executor.execute({
      toolName: "restore_resume",
      toolInput: { resumeId: general.id, expectedRevision: current.revision },
      operationId: "op-restore-1",
      confirmed: true,
      confirmationCount: 1,
      careerSessionBinding: binding
    });
    expect(restored.ok).toBe(true);
    expect((await repository.getResumeBranch(general.id))?.lifecycleStatus).toBe("active");

    // 维度 8：简历生命周期变更不得反向写资料库。
    expect(JSON.stringify(await repository.getProfile(profile.id))).toBe(profileBefore);
  });

  it("ensure_general_resume_from_profile: stale profile version blocks with zero writes", async () => {
    const { repository, executor } = harness();
    const { profile, general } = await seedProfile(repository);
    const binding = bindingFor(profile, "session-v4p2c");
    const profileBefore = JSON.stringify(await repository.getProfile(profile.id));

    // 缺少确认
    await expect(executor.execute({
      toolName: "ensure_general_resume_from_profile",
      toolInput: { targetProfileId: profile.id, expectedProfileVersion: profile.version, mode: "create_new" },
      operationId: "op-general-1"
    })).rejects.toBeInstanceOf(AgentConfirmationRequiredError);

    // revision 冲突
    const stale = await executor.execute({
      toolName: "ensure_general_resume_from_profile",
      toolInput: { targetProfileId: profile.id, expectedProfileVersion: profile.version + 5, mode: "create_new" },
      operationId: "op-general-stale",
      confirmed: true,
      confirmationCount: 1,
      careerSessionBinding: binding
    });
    expect(stale.ok).toBe(false);
    expect(classifyAgentToolResult(stale).outcome).toBe("permanent_failure");
    expect(await repository.listResumeBranches()).toHaveLength(1);

    // 确认后执行：update_existing 复用同一份通用简历，不静默创建第二份。
    const ok = await executor.execute({
      toolName: "ensure_general_resume_from_profile",
      toolInput: { targetProfileId: profile.id, expectedProfileVersion: profile.version, mode: "update_existing" },
      operationId: "op-general-2",
      confirmed: true,
      confirmationCount: 1,
      careerSessionBinding: binding
    });
    expect(ok.ok).toBe(true);
    const generalBranches = (await repository.listResumeBranches()).filter((b) => b.branchPurpose === "general");
    expect(generalBranches).toHaveLength(1);
    expect(generalBranches[0].id).toBe(general.id);

    // 重复执行：同一 operationId 幂等。
    const replay = await executor.execute({
      toolName: "ensure_general_resume_from_profile",
      toolInput: { targetProfileId: profile.id, expectedProfileVersion: profile.version, mode: "update_existing" },
      operationId: "op-general-2",
      confirmed: true,
      confirmationCount: 1,
      careerSessionBinding: binding
    });
    expect(replay.ok).toBe(true);
    expect((await repository.listResumeBranches()).filter((b) => b.branchPurpose === "general")).toHaveLength(1);

    expect(JSON.stringify(await repository.getProfile(profile.id))).toBe(profileBefore);
  });
});

describe("V4-P2-C: 导入或记录简历 capability certification (commit_resume_import)", () => {
  it("unresolved reconciliation is a structured failure with no partial commit", async () => {
    const { repository, executor } = harness();
    const first = await seedProfile(repository, "seed");
    const prepared = await importDraft(repository, "second");

    const unresolved = await executor.execute({
      toolName: "commit_resume_import",
      toolInput: {
        importId: prepared.importId,
        expectedDraftRevision: prepared.draftRevision,
        target: { mode: "existing", profileId: first.profile.id }
      },
      operationId: "op-import-unresolved",
      confirmed: true,
      confirmationCount: 1
    });
    expect(unresolved.ok).toBe(false);
    expect(classifyAgentToolResult(unresolved).outcome).toBe("permanent_failure");
    expect(await repository.listResumeBranches()).toHaveLength(1);
    expect(await databaseResumeImportOperationKeys()).toHaveLength(1); // 只剩 seed 那条
    expect((await repository.getImportedResumeDraft(prepared.importId))?.status).toBe("reviewing");
  });

  it("first call / missing confirmation / confirmed / repeat / restart recovery", async () => {
    const { repository, executor } = harness();
    await seedProfile(repository, "seed");
    const prepared = await importDraft(repository, "second");

    // 缺少确认
    await expect(executor.execute({
      toolName: "commit_resume_import",
      toolInput: {
        importId: prepared.importId,
        expectedDraftRevision: prepared.draftRevision,
        target: { mode: "new", profileName: "第二人物", createGeneralResume: true }
      },
      operationId: "op-import-noconfirm"
    })).rejects.toBeInstanceOf(AgentConfirmationRequiredError);
    expect(await repository.listProfiles()).toHaveLength(1);

    // 确认后执行：新建第二个人物 + 其通用简历。
    const committed = await executor.execute({
      toolName: "commit_resume_import",
      toolInput: {
        importId: prepared.importId,
        expectedDraftRevision: prepared.draftRevision,
        target: { mode: "new", profileName: "第二人物", createGeneralResume: true }
      },
      operationId: "op-import-ok",
      confirmed: true,
      confirmationCount: 1
    });
    expect(committed.ok).toBe(true);
    expect(classifyAgentToolResult(committed).outcome).toBe("success");
    expect(await repository.listProfiles()).toHaveLength(2);
    expect(await repository.listResumeBranches()).toHaveLength(2);

    // 重复执行：同一 operationId 幂等，不新建第三个分支。
    const replay = await executor.execute({
      toolName: "commit_resume_import",
      toolInput: {
        importId: prepared.importId,
        expectedDraftRevision: prepared.draftRevision,
        target: { mode: "new", profileName: "第二人物", createGeneralResume: true }
      },
      operationId: "op-import-ok",
      confirmed: true,
      confirmationCount: 1
    });
    expect(replay.ok).toBe(true);
    expect(await repository.listResumeBranches()).toHaveLength(2);

    // 维度 6：刷新 / 重启恢复 —— 关库重开后资料、分支与幂等记录都在。
    (db as CareerAdaptDb).close();
    const reopened = new CareerAdaptDb(dbName);
    const reopenedRepository = new WorkspaceRepository(reopened);
    expect(await reopenedRepository.listProfiles()).toHaveLength(2);
    expect(await reopenedRepository.listResumeBranches()).toHaveLength(2);
    const afterRestart = await executor.execute({
      toolName: "commit_resume_import",
      toolInput: {
        importId: prepared.importId,
        expectedDraftRevision: prepared.draftRevision,
        target: { mode: "new", profileName: "第二人物", createGeneralResume: true }
      },
      operationId: "op-import-ok",
      confirmed: true,
      confirmationCount: 1
    });
    expect(afterRestart.ok).toBe(true);
    expect(await reopenedRepository.listResumeBranches()).toHaveLength(2);
    reopened.close();
  });
});

describe("V4-P2-C: workspace repository write parity across UI, Agent and Hermes MCP", () => {
  it("resume import commit uses one WorkspaceRepository method on all three paths", async () => {
    const { repository, executor, service, registry } = harness();

    const confirmSpy = vi.spyOn(WorkspaceRepository.prototype, "confirmImportedResume");

    // 路径 A：UI —— ResumeImportWizard 直接调用 repository.confirmImportedResume。
    const uiDraft = await importDraft(repository, "ui");
    await repository.confirmImportedResume({
      importId: uiDraft.importId,
      expectedDraftRevision: uiDraft.draftRevision,
      operationId: "op-ui",
      target: { mode: "new", profileName: "UI 人物", createGeneralResume: true }
    });
    const uiCalls = confirmSpy.mock.calls.length;
    expect(uiCalls).toBe(1);

    // 路径 B：Agent —— Host/Executor/Registry/Service。
    const agentDraft = await importDraft(repository, "agent");
    const agentResult = await executor.execute({
      toolName: "commit_resume_import",
      toolInput: {
        importId: agentDraft.importId,
        expectedDraftRevision: agentDraft.draftRevision,
        target: { mode: "new", profileName: "Agent 人物", createGeneralResume: true }
      },
      operationId: "op-agent",
      confirmed: true,
      confirmationCount: 1
    });
    expect(agentResult.ok).toBe(true);
    expect(confirmSpy.mock.calls.length).toBe(uiCalls + 1);

    // 路径 C：Hermes MCP —— CareerToolGateway 走同一个 executor 与同一个 service。
    const mcpDraft = await importDraft(repository, "mcp");
    const gateway = createCareerToolGateway({ registry, executor });
    const mcpResult = await gateway.execute(
      "career.resume.import.commit",
      {
        importId: mcpDraft.importId,
        expectedDraftRevision: mcpDraft.draftRevision,
        target: { mode: "new", profileName: "MCP 人物", createGeneralResume: true }
      },
      {
        operationId: "op-mcp",
        confirmed: true,
        confirmationCount: 1,
        agentSessionId: "session-v4p2c"
      }
    );
    expect(mcpResult.ok).toBe(true);
    expect(confirmSpy.mock.calls.length).toBe(uiCalls + 2);

    // 三条路径落在同一个 Repository 方法上，没有第二套业务写入。
    const callees = new Set(confirmSpy.mock.instances.map(() => "confirmImportedResume"));
    expect(callees).toEqual(new Set(["confirmImportedResume"]));
    expect(await repository.listProfiles()).toHaveLength(3);
    void service;
  });

  it("job commit uses the same convertCandidateListing on the UI and Agent paths", async () => {
    const { repository, executor } = harness();
    const { profile } = await seedProfile(repository, "seed");
    const convertSpy = vi.spyOn(WorkspaceRepository.prototype, "convertCandidateListing");

    // 路径 A：Agent —— Executor -> Registry -> service.commitJob -> Repository。
    const agentInput = {
      title: "数据分析师",
      company: "Acme",
      rawText: JD,
      graph: analyzeJobDescriptionV4({ rawText: JD }).graph
    };
    const agentSessionId = "session-v4p2c";
    const agentResult = await executor.execute({
      toolName: "commit_job",
      toolInput: agentInput,
      operationId: "op-agent-job",
      confirmed: true,
      confirmationCount: 1,
      careerSessionBinding: bindingFor(profile, agentSessionId),
      userMessageId: USER_MESSAGE_ID
    });
    expect(agentResult.ok).toBe(true);
    expect(convertSpy.mock.calls.length).toBe(1);
    expect(await repository.listJobDescriptions()).toHaveLength(1);

    // 路径 B：UI —— JobsWorkspace 走 ingest -> parse -> jobs_workspace 确认 ->
    // convertCandidateListing，与 Agent 路径落到同一个 Repository 方法。
    const now = new Date().toISOString();
    const uiRawText = `${JD}
加分项：熟悉分布式系统与消息队列`;
    const identity = manualCandidateIdentity("后端工程师", "Beta");
    const ingested = await ingestCandidateListing(repository, {
      sourceKey: identity.sourceKey,
      externalId: identity.externalId,
      listingId: identity.listingId,
      // 正文必须与前一个岗位不同，否则会命中 content 级去重并等待用户决策。
      rawText: `${JD}\n加分项：熟悉分布式系统与消息队列`,
      title: "后端工程师",
      company: "Beta",
      now: new Date().toISOString()
    });
    expect(ingested.status).not.toBe("waiting_input");
    if (ingested.status === "waiting_input") throw new Error("unexpected duplicate for a distinct job");
    const parsed = await parseCandidateToDraft(repository, {
      listingId: ingested.listing.id,
      snapshotId: ingested.snapshot.id,
      draftId: "job-draft-ui-parity",
      now
    });
    await repository.saveJobAnalysisDraftRevision(JobAnalysisDraftSchema.parse({
      ...parsed.draft,
      title: "后端工程师",
      company: "Beta",
      status: "ai_validated",
      promptVersion: "jobs-workspace.v1",
      attemptCount: parsed.draft.attemptCount + 1,
      analyzerOutput: projectJobGraphV4ToAnalyzerOutput({
        graph: analyzeJobDescriptionV4({ rawText: uiRawText }).graph,
        title: "后端工程师",
        company: "Beta",
        now: now
      }),
      analysisRunStatus: "review_ready",
      updatedAt: now
    }), parsed.draft.revision);
    const uiConfirmation = await repository.createConversionConfirmation({
      channel: "jobs_workspace",
      operationId: "op-ui-job",
      listingId: ingested.listing.id,
      draftId: "job-draft-ui-parity",
      now
    });
    await repository.convertCandidateListing({
      listingId: ingested.listing.id,
      draftId: "job-draft-ui-parity",
      commitId: "commit-ui-job-1",
      confirmationId: uiConfirmation.confirmationId,
      expectedConfirmation: { channel: "jobs_workspace", operationId: "op-ui-job" },
      now
    });

    // 两条路径共 2 次调用，且都是同一个 WorkspaceRepository 方法。
    expect(convertSpy.mock.calls.length).toBe(2);
    expect(await repository.listJobDescriptions()).toHaveLength(2);
  });
});

async function databaseResumeImportOperationKeys() {
  const records = await (db as CareerAdaptDb).appMeta
    .filter((record) => record.key.startsWith("resumeImportOperation:"))
    .toArray();
  return records;
}