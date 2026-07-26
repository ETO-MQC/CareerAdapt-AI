import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCapabilityBroker } from "@/agent/kernel/AgentCapabilityBroker";
import { AgentCanonicalEntityGuard } from "@/agent/kernel/AgentCanonicalEntityGuard";
import { AgentContextAssembler } from "@/agent/kernel/AgentContextAssembler";
import { AgentContextWindow } from "@/agent/kernel/AgentContextWindow";
import { agentSkillRegistry } from "@/agent/kernel/AgentSkillRegistry";
import { AgentObservationCache } from "@/agent/kernel/AgentObservationCache";
import { AgentKernel } from "@/agent/kernel/AgentKernel";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";
import regressionFixture from "../fixtures/agent-conversation-2026-07-26.regression.json";
import fs from "node:fs";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  if (db) await db.delete();
  db = undefined;
});

describe("P4.2 agent reliability regressions", () => {
  it("narrows capabilities to the minimum sufficient action", () => {
    const broker = new AgentCapabilityBroker();
    const base = AgentRuntime.create("tailor_existing_resume", "analyze_job");
    expect(broker.allowedToolNames({ session: base, userMessage: "你好", workflowToolNames: ["list_jobs", "get_profile"] })).toEqual([]);
    expect(broker.allowedToolNames({
      session: { ...base, activeProfileId: "profile-1" },
      userMessage: "我的名字是不是错了",
      workflowToolNames: []
    })).toEqual(["get_profile"]);
    expect(broker.allowedToolNames({ session: base, userMessage: "我想应聘一个岗位", workflowToolNames: [] })).toEqual(["list_jobs"]);
    expect(broker.allowedToolNames({
      session: base,
      userMessage: longJd(),
      workflowToolNames: ["list_jobs", "get_profile"]
    })).toEqual(["parse_job_description", "commit_job"]);
  });

  it("accepts raw JD text without authoritative identity fields", () => {
    const registry = createAgentToolRegistry(stubServices({}));
    expect(registry.require("parse_job_description").inputSchema.safeParse({ rawText: longJd() }).success).toBe(true);
    expect(registry.require("commit_job").inputSchema.safeParse({ rawText: longJd(), graph: {} }).success).toBe(false);
  });

  it("allows zero skills for casual conversation even inside tailoring", () => {
    expect(agentSkillRegistry.discover({
      workflowId: "tailor_existing_resume",
      step: "analyze_job",
      userMessage: "你好",
      selectedEntities: { resumeId: "resume-1", jobId: "job-1" }
    })).toEqual([]);
  });

  it("keeps full transcript while building a bounded model context and periodic summary", () => {
    const session = withMessages(AgentRuntime.create("agent_quick_action", "collecting_intent"), 120, 300);
    const result = new AgentContextWindow().build(session, "继续讨论第 3 轮项目");
    expect(session.messages).toHaveLength(420);
    expect(result.messages.length).toBeLessThanOrEqual(21);
    expect(result.conversationSummary).toContain("用户：");
  });

  it("persists 100+ dialogue turns plus 300 activities and rejects stale metadata", async () => {
    db = new CareerAdaptDb(`AgentDurability-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const original = withMessages(AgentRuntime.create("agent_quick_action", "collecting_intent"), 120, 300);
    const saved = await repository.saveAgentSession(original);
    const reloaded = await repository.getAgentSession(saved.id);
    expect(reloaded?.messages).toHaveLength(420);
    expect(reloaded?.messages[0]?.content).toBe("dialogue-0");

    const fresh = structuredClone(reloaded!);
    const stale = structuredClone(reloaded!);
    fresh.title = "newer task";
    fresh.updatedAt = "2026-07-26T12:00:02.000Z";
    fresh.messages.push(message("newer-message", "user", "new intent", fresh.updatedAt));
    const committed = await repository.saveAgentSession(fresh);

    stale.title = "stale task";
    stale.updatedAt = "2026-07-26T12:00:01.000Z";
    stale.messages.push(message("stale-message", "assistant", "late old result", stale.updatedAt));
    const afterStale = await repository.saveAgentSession(stale);
    expect(afterStale.title).toBe(committed.title);
    expect(afterStale.messages.map((entry) => entry.id)).toEqual(expect.arrayContaining(["newer-message", "stale-message"]));
  }, 15_000);

  it("reuses an unchanged authoritative observation across turns", async () => {
    const getProfile = vi.fn(async () => ({ profile: { id: "profile-1", name: "示例用户" } }));
    const services = stubServices({ getProfile });
    const registry = createAgentToolRegistry(services);
    const model = {
      completeWithTools: vi.fn()
        .mockResolvedValueOnce({ stopReason: "tool_calls", toolCalls: [{ id: "profile-read-1", name: "get_profile", arguments: { profileId: "profile-1" } }] })
        .mockResolvedValueOnce({ stopReason: "final", text: "示例用户" })
        .mockResolvedValueOnce({ stopReason: "tool_calls", toolCalls: [{ id: "profile-read-2", name: "get_profile", arguments: { profileId: "profile-1" } }] })
        .mockResolvedValueOnce({ stopReason: "final", text: "示例用户" })
    };
    const kernel = new AgentKernel({
      model,
      executor: new AgentExecutor(registry),
      toolResolver: new AgentToolResolver(registry),
      observationCache: new AgentObservationCache()
    });
    const session = { ...AgentRuntime.create("agent_quick_action", "collecting_intent"), activeProfileId: "profile-1" };
    await kernel.runTurn({ session, pageContext: { pathname: "/ai-workspace", query: {} }, userMessage: "我的名字是什么" });
    await kernel.runTurn({ session, pageContext: { pathname: "/profile", query: {} }, userMessage: "我的名字是不是错了" });
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it("places canonical entity preservation in the stable policy", () => {
    const session = AgentRuntime.create("agent_quick_action", "collecting_intent");
    const prompt = new AgentContextAssembler().assemble({
      session,
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "你好",
      memory: { working: {}, userPreferences: [], episodic: [], procedural: [], careerProfilePointers: [] },
      activeSkills: []
    });
    expect(prompt).toContain("Never shorten, nickname, translate, normalize, paraphrase, or autocorrect");
    expect(prompt).toContain("Do not address the user by name in casual greetings");
    const guard = new AgentCanonicalEntityGuard();
    guard.observe({ profile: { name: regressionFixture.canonicalName } });
    expect(guard.preserve("你好明启！")).toBe(`你好${regressionFixture.canonicalName}！`);
  });

  it("mounts the single Agent host above route pages and resumes confirmations", () => {
    const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
    const workspace = fs.readFileSync("src/components/agent/AgentWorkspace.tsx", "utf8");
    expect(layout.indexOf("<AgentRuntimeProvider>")).toBeLessThan(layout.indexOf("<ModeAwareAppShell>"));
    expect(workspace).toContain("resumeKernelAfterConfirmation");
    expect(workspace).toContain("[AUTHORITATIVE_TOOL_OBSERVATION]");
    expect(workspace).toContain("[USER_REJECTED_ACTION]");
  });
});

function withMessages(session: AgentSession, dialogueCount: number, activityCount: number): AgentSession {
  const createdAt = "2026-07-26T12:00:00.000Z";
  const messages: AgentMessage[] = [
    ...Array.from({ length: dialogueCount }, (_, index) =>
      message(`dialogue-${index}`, index % 2 ? "assistant" : "user", `dialogue-${index}`, createdAt)
    ),
    ...Array.from({ length: activityCount }, (_, index) => ({
      ...message(`tool-${index}`, "tool", `activity-${index}`, createdAt),
      kind: "tool_status" as const,
      type: "tool_status" as const,
      toolName: "get_profile"
    }))
  ];
  return { ...session, messages, updatedAt: createdAt };
}

function message(id: string, role: AgentMessage["role"], content: string, createdAt: string): AgentMessage {
  return { id, role, content, createdAt, updatedAt: createdAt };
}

function longJd() {
  return `Vibe Coding AI Coding 任务设计专家
岗位职责：使用真实开发工作流持续测试 coding agent，设计可复现任务与 verifier。
任职要求：熟悉 Cursor、Claude Code、Codex，能够定位复杂任务失败并提供验证材料。
工作内容包括多步骤开发、跨文件修改、调试、真实环境配置和 reward hacking 检测。`.repeat(3);
}

function stubServices(overrides: Partial<AgentToolServices>): AgentToolServices {
  const result = async () => ({ ok: true });
  return {
    listResumes: result, listProfiles: result, listJobs: result,
    getActiveProfile: result, getProfile: result, searchProfileFacts: result,
    getResume: result, getResumeRevision: result, getJob: result,
    getAgentTaskContext: result, searchAgentSessions: result, skillsList: result, skillView: result,
    parseResumeFile: result, createResumeImportDraft: result, commitResumeImport: result,
    parseJobDescription: result, commitJob: result, analyzeJobFit: result,
    createTailoringSession: result, answerTailoringQuestion: result,
    previewTailoringChanges: result, applyTailoringChanges: result, exportResume: result,
    ...overrides
  };
}
