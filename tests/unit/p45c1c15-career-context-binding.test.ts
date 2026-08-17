import { describe, expect, it } from "vitest";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { CareerToolGateway, type CareerToolResult } from "@/agent/tools/CareerToolGateway";
import { AgentRuntimeRouter } from "@/agent/runtime/AgentRuntimeRouter";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import { RuntimeStatusStore } from "@/agent/runtime/runtimeStatus";
import { resolveCareerSessionBinding } from "@/agent/runtime/careerSessionBinding";
import {
  careerContextBindingResolver,
  profileHasSufficientFacts
} from "@/agent/runtime/careerContextBindingResolver";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { AI_TRAINER_JD_V4 } from "../fixtures/aiTrainerJdV4";

const availableTailorTools = new Set([
  "career.profile.active",
  "career.profile.list",
  "career.resume.list",
  "career.job.parse",
  "career.tailoring.create_session"
]);

describe("P4.5c.1.15 Career context binding and canonical tailor flow", () => {
  it("resolves pinned, active, single, ambiguous, and missing profile context deterministically", () => {
    const pinned = careerContextBindingResolver.resolveProfile({
      sessionId: "session-1",
      pinnedBinding: {
        agentSessionId: "session-1",
        personId: "person-1",
        profileId: "profile-1",
        profileVersionNumber: 2,
        profileRevision: 7
      },
      profiles: []
    });
    expect(pinned).toMatchObject({ state: "bound", source: "pinned" });

    const active = careerContextBindingResolver.resolveProfile({
      sessionId: "session-1",
      activeProfile: profile("profile-2", "person-2"),
      profiles: [profile("profile-1", "person-1"), profile("profile-2", "person-2")]
    });
    expect(active).toMatchObject({ state: "bound", source: "active", profile: { id: "profile-2" } });

    const single = careerContextBindingResolver.resolveProfile({
      sessionId: "session-1",
      profiles: [profile("profile-1", "person-1")]
    });
    expect(single).toMatchObject({ state: "bound", source: "single", binding: { profileId: "profile-1" } });
    expect(profileHasSufficientFacts(profile("profile-1", "person-1", { experienceCount: 1 }))).toBe(true);

    const ambiguous = careerContextBindingResolver.resolveProfile({
      sessionId: "session-1",
      profiles: [profile("profile-1", "person-1"), profile("profile-2", "person-2")]
    });
    expect(ambiguous).toMatchObject({ state: "partially_bound", code: "needs_profile_choice" });

    const missing = careerContextBindingResolver.resolveProfile({ sessionId: "session-1", profiles: [] });
    expect(missing).toMatchObject({ state: "unbound", code: "needs_profile" });
  });

  it("uses the active healthy General Resume, asks for multiple sources, and routes profile-only sources", () => {
    expect(careerContextBindingResolver.resolveResumeSource({
      profileId: "profile-1",
      resumes: [{ id: "resume-1", profileId: "profile-1", purpose: "general" }],
      profileSufficient: true
    })).toMatchObject({ kind: "selected", resume: { id: "resume-1" }, source: "single_general" });

    expect(careerContextBindingResolver.resolveResumeSource({
      profileId: "profile-1",
      resumes: [
        { id: "resume-1", profileId: "profile-1", branchPurpose: "general", lifecycleStatus: "active", migrationStatus: "verified" },
        { id: "resume-2", profileId: "profile-1", branchPurpose: "general", lifecycleStatus: "active", migrationStatus: "verified" }
      ],
      profileSufficient: true
    })).toMatchObject({ kind: "choice", candidates: [{ id: "resume-1" }, { id: "resume-2" }] });

    expect(careerContextBindingResolver.resolveResumeSource({
      profileId: "profile-1",
      resumes: [],
      profileSufficient: true
    })).toMatchObject({ kind: "profile_route" });
    expect(careerContextBindingResolver.resolveResumeSource({
      profileId: "profile-1",
      resumes: [],
      profileSufficient: false
    })).toMatchObject({ kind: "needs_profile_facts" });
  });

  it("lets an unbound Hermes session reach run_start", async () => {
    expect(resolveCareerSessionBinding({
      sessionId: "agent-session-unbound",
      session: { id: "agent-session-unbound" },
      pageContext: {
        profileId: "profile-page-context",
        personId: "person-page-context",
        profileVersionNumber: 1,
        profileRevision: 1
      }
    })).toBeUndefined();
    let startedRequest: Record<string, unknown> | undefined;
    const runtime = new HermesCareerAgentRuntime({
      transport: {
        health: async () => ({ available: true, mcpConnected: true }),
        createSession: async () => ({ sessionId: "hermes-session-unbound", resumed: false }),
        resumeSession: async () => ({ sessionId: "hermes-session-unbound", resumed: true }),
        turn: async function* () { yield { type: "turn_completed" as const }; },
        startRun: async (request) => {
          startedRequest = request as unknown as Record<string, unknown>;
          return { runId: "run-unbound-1", status: "started" as const };
        },
        getRun: async () => ({ run_id: "run-unbound-1", status: "completed" as const }),
        runEvents: async function* () { yield { type: "turn_completed" as const, message: "你好" }; },
        approveRun: async () => ({ run_id: "run-unbound-1", status: "completed" as const }),
        stopRun: async () => ({ run_id: "run-unbound-1", status: "completed" as const }),
        toolCallback: async () => undefined,
        interrupt: async () => undefined
      },
      careerToolGateway: new CareerToolGateway(new AgentToolRegistry([]))
    });
    const events = [];
    for await (const event of runtime.runTurn({
      sessionId: "agent-session-unbound",
      turnId: "turn-unbound-1",
      userMessage: "你好",
      pageContext: {
        query: {},
        profileId: "profile-page-context",
        personId: "person-page-context",
        profileVersionNumber: 1,
        profileRevision: 1
      },
      session: { id: "agent-session-unbound", messages: [] } as never
    })) events.push(event);

    expect(startedRequest).toMatchObject({ userMessage: "你好", careerSessionBinding: undefined });
    expect(events.some((event) => event.type === "turn_completed")).toBe(true);
    expect(events.some((event) => event.type === "turn_failed" && event.error?.code === "career_session_binding_required")).toBe(false);
  });

  it("keeps domain preconditions in waiting_for_user without Hermes fallback", async () => {
    let nativeCalls = 0;
    const native = {
      id: "native" as const,
      async *runTurn() {
        nativeCalls += 1;
        yield {
          type: "turn_completed" as const,
          sessionId: "agent-session-domain",
          turnId: "turn-domain-1",
          timestamp: new Date().toISOString(),
          message: "native"
        };
      },
      pause: async () => undefined,
      interrupt: async () => undefined,
      resume: async () => undefined,
      capabilities: () => ({
        streaming: false,
        interruptible: true,
        resumable: true,
        toolCalls: true,
        approvals: true,
        offline: true
      })
    };
    const hermes = {
      id: "hermes" as const,
      async *runTurn() {
        throw Object.assign(new Error("profile selection required"), { code: "needs_profile" });
      },
      pause: async () => undefined,
      interrupt: async () => undefined,
      resume: async () => undefined,
      capabilities: () => ({
        streaming: true,
        interruptible: true,
        resumable: true,
        toolCalls: true,
        approvals: true,
        offline: false
      })
    };
    const router = new AgentRuntimeRouter({ native, hermes, configuration: { agentRuntime: "hermes" } });
    const events = [];
    for await (const event of router.runUserEvent(
      { type: "text_message", text: "帮我生成岗位简历" },
      { sessionId: "agent-session-domain", turnId: "turn-domain-1", userMessage: "帮我生成岗位简历", pageContext: { query: {} } }
    )) events.push(event);

    expect(nativeCalls).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "turn_completed",
      data: { safeErrorCode: "needs_profile", waitingForUser: true, domainFailure: true }
    });
  });

  it("does not downgrade Hermes health dimensions for a domain precondition", () => {
    const status = new RuntimeStatusStore({
      preferredRuntime: "hermes",
      activeRuntime: "hermes",
      status: "ready",
      processReady: true,
      apiReady: true,
      providerReady: true,
      runReady: true
    });
    const before = status.getSnapshot();
    status.recordRunFailure({ code: "needs_profile", message: "需要选择资料", retryable: false });
    expect(status.getSnapshot()).toEqual(before);
  });

  it("runs external targetText through profile resolution and the canonical tailor facade", async () => {
    const analyzed = analyzeJobDescriptionV4({ rawText: AI_TRAINER_JD_V4 });
    const calls: Array<{ name: string; context?: Record<string, unknown> }> = [];
    const result = await executeCareerWorkflowFacade(
      "career.workflow.tailor_resume",
      { targetText: AI_TRAINER_JD_V4 },
      { agentSessionId: "agent-session-tailor", availableCareerToolNames: availableTailorTools },
      "tailor-context-operation-1",
      async (name, input, context) => {
        calls.push({ name, context: context as Record<string, unknown> });
        if (name === "career.profile.active") {
          return atomicResult(name, { selected: true, profileId: "profile-1", personId: "person-1", version: 3, profileVersionNumber: 1 });
        }
        if (name === "career.profile.list") {
          return atomicResult(name, { profiles: [profile("profile-1", "person-1", { version: 3, experienceCount: 2 })] });
        }
        if (name === "career.resume.list") {
          return atomicResult(name, { resumes: [{ id: "resume-general-1", profileId: "profile-1", purpose: "general" }] });
        }
        if (name === "career.job.parse") {
          return atomicResult(name, { graph: analyzed.graph, candidateTitle: "AI训练师" });
        }
        if (name === "career.tailoring.create_session") {
          const value = input as { targetSnapshot?: unknown };
          return atomicResult(name, {
            session: {
              id: "tailoring-session-1",
              branch: { id: "resume-general-1" },
              targetSnapshot: value.targetSnapshot,
              plan: { questionPlan: { status: "completed" } }
            }
          });
        }
        throw new Error(`unexpected_tool:${name}`);
      }
    );

    expect(result.data.status).toBe("waiting_for_user");
    expect(calls.map((call) => call.name)).toEqual([
      "career.job.parse",
      "career.profile.active",
      "career.profile.list",
      "career.resume.list",
      "career.tailoring.create_session"
    ]);
    expect(calls.at(-1)?.context).toMatchObject({
      agentSessionId: "agent-session-tailor",
      careerSessionBinding: {
        personId: "person-1",
        profileId: "profile-1",
        profileRevision: 3
      },
      requireSessionBinding: true
    });
    expect(result.data.workflowCheckpoint).toMatchObject({
      targetSourceType: "pasted_jd",
      targetSnapshot: { sourceType: "pasted_jd" },
      profileId: "profile-1",
      resumeId: "resume-general-1"
    });
  });

  it("returns waiting_for_user for no profile, profile choice, and no General Resume without runtime failure", async () => {
    const noProfile = await runTailorWith(async (name) => {
      if (name === "career.job.parse") return atomicResult(name, { graph: analyzeJobDescriptionV4({ rawText: AI_TRAINER_JD_V4 }).graph });
      if (name === "career.profile.active") return atomicResult(name, { selected: false });
      if (name === "career.profile.list") return atomicResult(name, { profiles: [] });
      throw new Error(`unexpected_tool:${name}`);
    });
    expect(noProfile.data).toMatchObject({ status: "waiting_for_user", userPrompt: expect.stringContaining("当前还没有可用于定制的个人资料") });
    expect(noProfile.data.workflowCheckpoint).toMatchObject({ kind: "career_context", contextBindingState: "unbound" });

    const multipleProfiles = await runTailorWith(async (name) => {
      if (name === "career.job.parse") return atomicResult(name, { graph: analyzeJobDescriptionV4({ rawText: AI_TRAINER_JD_V4 }).graph });
      if (name === "career.profile.active") return atomicResult(name, { selected: false });
      if (name === "career.profile.list") return atomicResult(name, { profiles: [profile("profile-1", "person-1"), profile("profile-2", "person-2")] });
      throw new Error(`unexpected_tool:${name}`);
    });
    expect(multipleProfiles.data).toMatchObject({ status: "waiting_for_user" });
    expect(multipleProfiles.data.workflowCheckpoint).toMatchObject({ contextBindingState: "partially_bound" });
    expect((multipleProfiles.data.workflowCheckpoint.profileCandidates as unknown[]).length).toBe(2);

    const profileRoute = await runTailorWith(async (name) => {
      if (name === "career.profile.active") return atomicResult(name, { selected: true, profileId: "profile-1", personId: "person-1", version: 3, profileVersionNumber: 1 });
      if (name === "career.profile.list") return atomicResult(name, { profiles: [profile("profile-1", "person-1", { version: 3, experienceCount: 1 })] });
      if (name === "career.job.parse") return atomicResult(name, { graph: analyzeJobDescriptionV4({ rawText: AI_TRAINER_JD_V4 }).graph });
      if (name === "career.resume.list") return atomicResult(name, { resumes: [] });
      throw new Error(`unexpected_tool:${name}`);
    });
    expect(careerContextBindingResolver.resolveProfile({
      sessionId: "agent-session-context",
      activeProfile: { id: "profile-1", personId: "person-1", version: 3, profileVersionNumber: 1 },
      profiles: [profile("profile-1", "person-1", { version: 3, experienceCount: 1 })]
    })).toMatchObject({ state: "bound", profile: { experienceCount: 1 } });
    expect(profileHasSufficientFacts(profile("profile-1", "person-1", { version: 3, experienceCount: 1 }))).toBe(true);
    expect(profileRoute.data).toMatchObject({ status: "waiting_for_user" });
    expect(profileRoute.data.workflowCheckpoint).toMatchObject({ sourceRoute: "profile", profileRoute: "profile_to_resume", profileSufficient: true });
  });
});

async function runTailorWith(call: (name: string, input?: unknown, context?: unknown) => Promise<CareerToolResult>) {
  return executeCareerWorkflowFacade(
    "career.workflow.tailor_resume",
    { targetText: AI_TRAINER_JD_V4 },
    { agentSessionId: "agent-session-context", availableCareerToolNames: availableTailorTools },
    `tailor-context-${Math.random().toString(36).slice(2)}`,
    call
  );
}

function profile(id: string, personId: string, extra: Record<string, unknown> = {}) {
  return { id, personId, profileVersionNumber: 1, version: 1, ...extra };
}

function atomicResult(toolName: string, data: unknown): CareerToolResult {
  return {
    ok: true,
    data,
    artifacts: [],
    receipt: {
      operationId: `atomic-${toolName.replace(/[^A-Za-z0-9-]/gu, "-")}`,
      toolName,
      status: "completed",
      completedAt: "2026-08-17T00:00:00.000Z"
    }
  };
}
