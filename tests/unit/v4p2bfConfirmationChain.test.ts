import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type { AgentSession } from "@/agent/contracts/agentSession";
import type { AgentPageContext } from "@/agent/contracts/agentContext";

const NOW = "2026-10-07T00:00:00.000Z";
const USER_MESSAGE_ID = "user-msg-integration";

const JD = "职责：\n负责 Go 后端服务开发。\n要求：\n3 年以上经验。";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

const PAGE_CONTEXT: AgentPageContext = { route: "/jobs" } as AgentPageContext;

function integrationHost() {
  db = new CareerAdaptDb(`careeradapt-v4p2bf-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const service = new BrowserAgentToolService(repository);
  const registry = createAgentToolRegistry(service);
  const executor = new AgentExecutor(registry);
  const sessions = new Map<string, AgentSession>();
  const host = new AgentHostStore({
    executor,
    persistence: {
      save: async (value: AgentSession) => {
        sessions.set(value.id, structuredClone(value));
        return value;
      }
    } as never,
    repository
  });
  return { db, repository, host, sessions };
}

function commitJobSession(): AgentSession {
  const base = AgentRuntime.create("job_ingestion", "confirm_commit");
  const binding = {
    personId: "person-1",
    profileId: "profile-1",
    profileVersionNumber: 1,
    profileRevision: 0,
    agentSessionId: base.id
  };
  const operationId = "op-integration-commit";
  const session: AgentSession = {
    ...base,
    id: base.id,
    personId: binding.personId,
    activeProfileId: binding.profileId,
    profileVersionNumber: binding.profileVersionNumber,
    profileRevision: binding.profileRevision,
    activeTurn: {
      id: "turn-integration",
      sessionId: base.id,
      sourceUserMessageId: USER_MESSAGE_ID,
      userMessageId: USER_MESSAGE_ID,
      preferredRuntime: "native",
      attemptedRuntime: "native",
      finalRuntime: "native",
      fallbackUsed: false,
      executionOwner: "runtime_continuation",
      status: "running",
      startedAt: NOW
    },
    pendingToolCall: {
      toolName: "commit_job",
      input: {
        title: "Go 工程师",
        company: "Acme",
        rawText: JD,
        graph: analyzeGraphFor(JD)
      },
      operationId,
      turnId: "turn-integration"
    },
    pendingConfirmation: {
      id: `confirmation-${operationId}`,
      operationId,
      toolName: "commit_job",
      title: "确认保存岗位",
      description: "确认并保存岗位。",
      status: "pending",
      requestedAt: NOW
    }
  } as unknown as AgentSession;
  return session;
}

function analyzeGraphFor(rawText: string) {
  // 真实确定性分析器产出 V4 graph（无 AI）。
  return analyzeJobDescriptionV4({ rawText }).graph;
}

describe("V4-P2-B final confirmation chain: runtime integration", () => {
  it("AgentHostStore -> executor -> registry -> commitJob -> Repository: userMessageId lands in the confirmation record and is validated at consumption", async () => {
    const { repository, host } = integrationHost();
    const session = commitJobSession();

    const saved = await host.resolveConfirmation(true, PAGE_CONTEXT, session);
    expect(saved).toBeTruthy();

    // 正式岗位已创建；候选 listing 已转换。
    const listings = await repository.listJobListings();
    expect(listings).toHaveLength(1);
    expect(listings[0].sourceKey).toBe("local.manual");
    expect(listings[0].jobDescriptionId).toBeTruthy();
    const job = await repository.getJobDescription(listings[0].jobDescriptionId!);
    expect(job?.title).toBe("Go 工程师");

    const draft = await repository.getJobAnalysisDraft(listings[0].analysisDraftId!);
    expect(draft?.status).toBe("committed");

    // userMessageId + 会话绑定最终进入确认记录（consumed 信封仍保留全部绑定字段）。
    const confirmations = await (db as CareerAdaptDb).appMeta.filter((record) => record.key.startsWith("conversion-confirmation:")).toArray();
    expect(confirmations).toHaveLength(1);
    const record = confirmations[0].value as {
      state: string; userMessageId?: string; careerSessionBinding?: { agentSessionId: string }; channel: string; consumedCommitId?: string;
    };
    expect(record.state).toBe("consumed");
    expect(record.channel).toBe("agent");
    expect(record.userMessageId).toBe(USER_MESSAGE_ID);
    expect(record.careerSessionBinding?.agentSessionId).toBe(session.id);
    expect(record.consumedCommitId).toBeTruthy();

    // 重放同一确认：幂等（executor 层有 operationId 缓存；底层 convert 幂等重放已由单元测试覆盖）。
    const replay = await host.resolveConfirmation(true, PAGE_CONTEXT, session);
    expect(replay).toBeTruthy();
  });

  it("fails fast when the agent turn carries no userMessageId (no degraded conversion)", async () => {
    db = new CareerAdaptDb(`careeradapt-v4p2bf-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const service = new BrowserAgentToolService(repository);
    const registry = createAgentToolRegistry(service);
    const executor = new AgentExecutor(registry);
    const host = new AgentHostStore({
      executor,
      persistence: { save: async (value: AgentSession) => value } as never,
      repository
    });

    const base = AgentRuntime.create("job_ingestion", "confirm_commit");
    const session = {
      ...base,
      personId: "person-1",
      activeProfileId: "profile-1",
      profileVersionNumber: 1,
      profileRevision: 0,
      // activeTurn 无 userMessageId：agent 通道缺绑定字段。
      activeTurn: {
        id: "turn-no-msg",
        sessionId: base.id,
        preferredRuntime: "native",
        attemptedRuntime: "native",
        finalRuntime: "native",
        fallbackUsed: false,
        executionOwner: "runtime_continuation",
        status: "running",
        startedAt: NOW
      },
      pendingToolCall: {
        toolName: "commit_job",
        input: { title: "Go 工程师", company: "Acme", rawText: JD, graph: analyzeGraphFor(JD) },
        operationId: "op-no-msg",
        turnId: "turn-no-msg"
      },
      pendingConfirmation: {
        id: "confirmation-op-no-msg",
        operationId: "op-no-msg",
        toolName: "commit_job",
        title: "确认保存岗位",
        description: "确认并保存岗位。",
        status: "pending",
        requestedAt: NOW
      }
    } as unknown as AgentSession;

    // Agent 通道缺 userMessageId：commitJob 快速失败（executor 将其折叠为
    // 失败结果），正式岗位与转换确认都不得产生。
    const resolved = await host.resolveConfirmation(true, PAGE_CONTEXT, session);
    const failedTool = (resolved?.messages ?? []).find((m) => m.toolName === "commit_job" && m.status === "failed");
    expect(failedTool).toBeTruthy();
    expect(await repository.listJobDescriptions()).toHaveLength(0);
    const listings = await repository.listJobListings();
    expect(listings.find((listing) => listing.jobDescriptionId)).toBeUndefined();
    const confirmations = await (db as CareerAdaptDb).appMeta.filter((record) => record.key.startsWith("conversion-confirmation:")).toArray();
    expect(confirmations).toHaveLength(0);
  });
});
