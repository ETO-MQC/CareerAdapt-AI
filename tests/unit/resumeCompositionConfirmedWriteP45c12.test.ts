import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { projectTaskStateToWorkflowState } from "@/agent/runtime/projectTaskStateToWorkflowState";
import type { ConfirmResumeCompositionCommand, RuntimeUserEvent } from "@/agent/runtime/RuntimeUserEvent";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerAdaptMcpAdapter } from "@/agent/mcp/CareerAdaptMcpAdapter";
import { CareerToolGateway, CareerToolGatewayExecutor } from "@/agent/tools/CareerToolGateway";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import {
  CareerResumeWritingService,
  compileResumeComposition,
  createResumeCompositionCheckpoint,
  type CareerResumeWritingOutput,
  type ResumeCompositionResult
} from "@/domain/resumeComposition";
import type { CareerProfile } from "@/domain/schemas";
import { AgentSessionSchema, type AgentSession } from "@/agent/contracts/agentSession";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  if (db) await db.delete();
  db = undefined;
});

describe("P4.5c.1.2 confirmed composition write boundary", () => {
  it("binds the active Career profile before a natural-language compose task starts", async () => {
    const fixture = await createFixture();
    const host = fixture.createHost("session-natural");
    const session = fixture.sessions.get("session-natural")!;
    const prepared = await host.prepareRuntimeTask({
      session,
      userMessage: "用我的资料库生成一份通用简历"
    });

    expect(prepared).toMatchObject({
      personId: fixture.profile.personId,
      activeProfileId: fixture.profile.id,
      profileVersionNumber: fixture.profile.profileVersionNumber ?? 1,
      profileRevision: fixture.profile.version
    });
    expect(prepared.taskState).toMatchObject({
      workflowId: "compose_resume",
      selectedEntities: {
        profileId: fixture.profile.id,
        profileVersion: fixture.profile.version
      }
    });
  });

  it("uses one canonical Host command for typed text and the Direct Generate button", async () => {
    const fixture = await createFixture();
    const textHost = fixture.createHost("session-text");
    const buttonHost = fixture.createHost("session-button");
    const textSession = fixture.sessions.get("session-text")!;
    const buttonSession = fixture.sessions.get("session-button")!;

    const textPrepared = await textHost.prepareRuntimeUserEvent({
      session: textSession,
      event: { type: "text_message", text: "直接生成" },
      pageContext: fixture.pageContext("session-text")
    });
    const buttonPrepared = await buttonHost.prepareRuntimeUserEvent({
      session: buttonSession,
      event: directGenerateEvent(),
      pageContext: fixture.pageContext("session-button")
    });

    expect(textPrepared.deterministicTerminal).toBe(true);
    expect(buttonPrepared.deterministicTerminal).toBe(true);
    expect(textPrepared.event).toMatchObject({ type: "confirm_resume_composition", branchMode: "create_new" });
    expect(buttonPrepared.event).toMatchObject({ type: "confirm_resume_composition", branchMode: "create_new" });
    expect(commandWithoutSession(textPrepared.event)).toEqual(commandWithoutSession(buttonPrepared.event));
  });

  it("executes the confirmed checkpoint once, projects resume_ready, and makes a second click idempotent", async () => {
    const fixture = await createFixture();
    const host = fixture.createHost("session-idempotent");
    const session = fixture.sessions.get("session-idempotent")!;
    const pageContext = fixture.pageContext(session.id);
    const prepared = await host.prepareRuntimeUserEvent({
      session,
      event: directGenerateEvent(),
      pageContext
    });
    expect(prepared.event.type).toBe("confirm_resume_composition");

    const command = prepared.event as ConfirmResumeCompositionCommand;
    const [completed, concurrentReplay] = await Promise.all([
      host.executeConfirmedResumeComposition({
        session: prepared.session,
        command,
        pageContext,
        turnId: prepared.turnId
      }),
      host.executeConfirmedResumeComposition({
        session: prepared.session,
        command,
        pageContext,
        turnId: prepared.turnId
      })
    ]);
    expect(concurrentReplay?.taskState?.knownSlots.resumeCompositionResult).toMatchObject({
      resumeId: expect.any(String),
      revisionId: expect.any(String)
    });
    expect(completed?.taskState).toMatchObject({
      workflowId: "compose_resume",
      stage: "resume_ready",
      completionStatus: "completed"
    });
    expect(completed?.taskState?.knownSlots.resumeCompositionResult).toMatchObject({
      resumeId: expect.any(String),
      revisionId: expect.any(String)
    });
    expect(completed?.taskState?.knownSlots.resumeCompositionPendingInformationNeed).toBeUndefined();
    expect(completed?.artifactRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "quality_result", entityType: "resume_branch" })
    ]));
    expect(completed?.messages.some((message) =>
      message.metadata?.confirmedWriteCompleted === true
      && (message.metadata?.confirmedWrite as Record<string, unknown> | undefined)?.confirmed === true
      && (message.metadata?.confirmedWrite as Record<string, unknown> | undefined)?.confirmationCount === 1
    )).toBe(true);
    const branchesAfterFirstWrite = await fixture.repository.listResumeBranches(fixture.profile.id);
    expect(branchesAfterFirstWrite).toHaveLength(1);

    const secondPrepared = await host.prepareRuntimeUserEvent({
      session: completed!,
      event: directGenerateEvent(),
      pageContext
    });
    const second = await host.executeConfirmedResumeComposition({
      session: secondPrepared.session,
      command: secondPrepared.event as ConfirmResumeCompositionCommand,
      pageContext,
      turnId: secondPrepared.turnId
    });
    expect(second?.taskState?.selectedEntities.resumeId).toBe(completed?.taskState?.selectedEntities.resumeId);
    expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toHaveLength(1);
    expect(await fixture.repository.listResumeRevisions(completed!.taskState!.selectedEntities.resumeId!)).toHaveLength(1);
  });

  it("does not let an MCP checkpoint call create a branch without Host confirmation", async () => {
    const fixture = await createFixture();
    const calls: Array<Record<string, unknown>> = [];
    const gateway = fixture.gateway;
    const adapter = new CareerAdaptMcpAdapter({
      listContracts: () => gateway.listContracts(),
      execute: async (name, input, context) => {
        calls.push({ name, ...(context ?? {}) });
        return gateway.execute(name, input, context);
      }
    });
    const checkpoint = fixture.checkpoint;
    const response = await adapter.callTool(
      "career.workflow.compose_resume",
      {
        profileId: fixture.profile.id,
        expectedProfileRevision: fixture.profile.version,
        mode: "general",
        checkpointId: checkpoint.checkpointId
      },
      {
        operationId: "mcp-compose-no-host-confirmation",
        careerSessionBinding: fixture.binding("session-mcp"),
        requireSessionBinding: true,
        confirmationRequested: true
      }
    );

    expect(calls[0]).toMatchObject({ confirmed: false, confirmationCount: 0 });
    expect(response.structuredContent).toBeDefined();
    expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toHaveLength(0);
  });

  it("rejects a stale checkpoint without writing and returns to review", async () => {
    const fixture = await createFixture();
    const host = fixture.createHost("session-stale");
    const session = fixture.sessions.get("session-stale")!;
    const pageContext = fixture.pageContext(session.id);
    const prepared = await host.prepareRuntimeUserEvent({
      session,
      event: directGenerateEvent(),
      pageContext
    });
    const command = prepared.event as ConfirmResumeCompositionCommand;
    const stale = { ...command, contentHash: "fnv-stale-checkpoint" };
    const recovered = await host.executeConfirmedResumeComposition({
      session: prepared.session,
      command: stale,
      pageContext,
      turnId: prepared.turnId
    });

    expect(recovered?.taskState).toMatchObject({
      workflowId: "compose_resume",
      stage: "review_composition",
      completionStatus: "waiting_for_user"
    });
    expect(recovered?.taskState?.knownSlots.resumeCompositionDecision).toBeUndefined();
    expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toHaveLength(0);
  });

  it("keeps update_existing behind an explicit user selection", async () => {
    const fixture = await createFixture();
    const seeded = await fixture.repository.ensureGeneralResumeFromProfile({
      profileId: fixture.profile.id,
      operationId: "seed-existing-general-resume",
      composition: fixture.checkpoint.compositionResult,
      mode: "create_new"
    });
    const host = fixture.createHost("session-update");
    const session = fixture.sessions.get("session-update")!;
    const pageContext = fixture.pageContext(session.id);
    const prepared = await host.prepareRuntimeUserEvent({
      session,
      event: { type: "text_message", text: "更新现有简历" },
      pageContext
    });

    expect(prepared.event).toMatchObject({
      type: "confirm_resume_composition",
      branchMode: "update_existing"
    });
    const completed = await host.executeConfirmedResumeComposition({
      session: prepared.session,
      command: prepared.event as ConfirmResumeCompositionCommand,
      pageContext,
      turnId: prepared.turnId
    });
    expect(completed?.taskState?.stage).toBe("resume_ready");
    expect((await fixture.repository.listResumeBranches(fixture.profile.id)).map((branch) => branch.id)).toEqual([seeded.branch.id]);
    expect(await fixture.repository.listResumeRevisions(seeded.branch.id)).toHaveLength(2);
  });

  it("keeps a transport-failed checkpoint recoverable and writes nothing", async () => {
    const failedComposition = transportFallbackComposition(migrateCareerProfileToV2(demoCareerProfile));
    const writer = writerSequence(failedComposition, failedComposition);
    const fixture = await createFixture({ composition: failedComposition, writer });
    const beforeCheckpoint = fixture.checkpoint;
    const host = fixture.createHost("session-idempotent");
    const session = fixture.sessions.get("session-idempotent")!;
    const pageContext = fixture.pageContext(session.id);
    const prepared = await host.prepareRuntimeUserEvent({ session, event: directGenerateEvent(), pageContext });
    const failed = await host.executeConfirmedResumeComposition({
      session: prepared.session,
      command: prepared.event as ConfirmResumeCompositionCommand,
      pageContext,
      turnId: prepared.turnId
    });

    expect(writer.writeWithExecution).toHaveBeenCalledTimes(1);
    expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toHaveLength(0);
    expect(failed?.taskState?.completionStatus).toBe("waiting_for_user");
    expect(failed?.taskState?.knownSlots.resumeCompositionCheckpoint).toMatchObject({
      checkpointId: beforeCheckpoint.checkpointId,
      contentHash: beforeCheckpoint.contentHash
    });
    expect(failed?.messages.some((message) => message.content.includes("AI 简历撰写服务连接失败"))).toBe(true);
  });

  it("retries the same checkpoint after transport recovery and creates one branch and revision", async () => {
    const failedComposition = transportFallbackComposition(migrateCareerProfileToV2(demoCareerProfile));
    const successfulComposition = aiComposition(migrateCareerProfileToV2(demoCareerProfile));
    const writer = writerSequence(failedComposition, successfulComposition);
    const fixture = await createFixture({ composition: failedComposition, writer });
    const host = fixture.createHost("session-idempotent");
    const session = fixture.sessions.get("session-idempotent")!;
    const pageContext = fixture.pageContext(session.id);
    const prepared = await host.prepareRuntimeUserEvent({ session, event: directGenerateEvent(), pageContext });
    const command = prepared.event as ConfirmResumeCompositionCommand;
    const failed = await host.executeConfirmedResumeComposition({ session: prepared.session, command, pageContext, turnId: prepared.turnId });
    const retried = await host.executeConfirmedResumeComposition({ session: failed!, command, pageContext, turnId: prepared.turnId });

    expect(writer.writeWithExecution).toHaveBeenCalledTimes(2);
    expect(retried?.taskState).toMatchObject({ stage: "resume_ready", completionStatus: "completed" });
    expect(retried?.taskState?.knownSlots.resumeCompositionCheckpoint).toMatchObject({
      checkpointId: fixture.checkpoint.checkpointId,
      contentHash: fixture.checkpoint.contentHash
    });
    const branches = await fixture.repository.listResumeBranches(fixture.profile.id);
    expect(branches).toHaveLength(1);
    expect(await fixture.repository.listResumeRevisions(branches[0].id)).toHaveLength(1);
    expect(retried?.messages.filter((message) => message.metadata?.confirmedWriteCompleted === true)).toHaveLength(1);
  });

  it("coalesces concurrent retries for the same failed checkpoint", async () => {
    const failedComposition = transportFallbackComposition(migrateCareerProfileToV2(demoCareerProfile));
    const successfulComposition = aiComposition(migrateCareerProfileToV2(demoCareerProfile));
    const writer = writerSequence(failedComposition, successfulComposition, 30);
    const fixture = await createFixture({ composition: failedComposition, writer });
    const host = fixture.createHost("session-idempotent");
    const session = fixture.sessions.get("session-idempotent")!;
    const pageContext = fixture.pageContext(session.id);
    const prepared = await host.prepareRuntimeUserEvent({ session, event: directGenerateEvent(), pageContext });
    const command = prepared.event as ConfirmResumeCompositionCommand;
    const failed = await host.executeConfirmedResumeComposition({ session: prepared.session, command, pageContext, turnId: prepared.turnId });
    const [firstRetry, concurrentRetry] = await Promise.all([
      host.executeConfirmedResumeComposition({ session: failed!, command, pageContext, turnId: prepared.turnId }),
      host.executeConfirmedResumeComposition({ session: failed!, command, pageContext, turnId: prepared.turnId })
    ]);

    expect(writer.writeWithExecution).toHaveBeenCalledTimes(2);
    expect(firstRetry?.taskState?.completionStatus).toBe("completed");
    expect(concurrentRetry?.taskState?.completionStatus).toBe("completed");
    const branches = await fixture.repository.listResumeBranches(fixture.profile.id);
    expect(branches).toHaveLength(1);
    expect(await fixture.repository.listResumeRevisions(branches[0].id)).toHaveLength(1);
  });

  it("rejects a same-checkpoint retry after the bound Profile revision changes", async () => {
    const failedComposition = transportFallbackComposition(migrateCareerProfileToV2(demoCareerProfile));
    const successfulComposition = aiComposition(migrateCareerProfileToV2(demoCareerProfile));
    const writer = writerSequence(failedComposition, successfulComposition);
    const fixture = await createFixture({ composition: failedComposition, writer });
    const host = fixture.createHost("session-idempotent");
    const session = fixture.sessions.get("session-idempotent")!;
    const pageContext = fixture.pageContext(session.id);
    const prepared = await host.prepareRuntimeUserEvent({ session, event: directGenerateEvent(), pageContext });
    const command = prepared.event as ConfirmResumeCompositionCommand;
    const failed = await host.executeConfirmedResumeComposition({ session: prepared.session, command, pageContext, turnId: prepared.turnId });
    await fixture.repository.saveProfile({
      ...fixture.profile,
      version: fixture.profile.version + 1,
      updatedAt: new Date().toISOString()
    });
    const stale = await host.executeConfirmedResumeComposition({ session: failed!, command, pageContext, turnId: prepared.turnId });

    expect(writer.writeWithExecution).toHaveBeenCalledTimes(1);
    expect(stale?.taskState).toMatchObject({ stage: "review_composition", completionStatus: "waiting_for_user" });
    expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toHaveLength(0);
  });

  it("keeps a runtime composition proposal actionable without creating a pending artifact", async () => {
    const fixture = await createFixture();
    const host = fixture.createHost("session-idempotent");
    const session = fixture.sessions.get("session-idempotent")!;
    const shell = await host.beginRuntimeShell({
      session,
      userMessage: "用我的资料库生成通用简历",
      runtimeId: "hermes",
      turnId: "runtime-compose-turn"
    });
    const facadeData = {
      status: "waiting_for_confirmation",
      nextAction: "request_confirmation",
      workflowCheckpoint: {
        kind: "resume_composition",
        checkpointId: fixture.checkpoint.checkpointId,
        profileId: fixture.checkpoint.profileId,
        profileRevision: fixture.checkpoint.profileRevision,
        mode: fixture.checkpoint.mode,
        proposal: fixture.checkpoint.compositionResult.proposal,
        blueprint: fixture.checkpoint.blueprint,
        metrics: fixture.checkpoint.compositionResult.metrics,
        compositionResult: fixture.checkpoint.compositionResult
      }
    };
    const completed = await host.applyRuntimeEvent({
      type: "tool_call_completed",
      sessionId: session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      toolName: "career.workflow.compose_resume",
      operationId: "runtime-compose-operation",
      data: {
        result: { ok: true, data: facadeData },
        contract: { sourceToolName: "compose_resume" }
      }
    }, shell.assistantMessageId);

    expect(completed?.taskState).toMatchObject({
      workflowId: "compose_resume",
      stage: "review_composition",
      completionStatus: "waiting_for_confirmation"
    });
    expect(completed?.artifactRefs.some((artifact) => artifact.kind === "quality_result")).toBe(false);

    const failed = await host.applyRuntimeEvent({
      type: "turn_completed",
      sessionId: session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      message: "个人简介\n项目经历\n- 搭建智能招聘平台并提升增长 99%，负责完整方案设计与交付。\n- 教育背景：某某大学本科。"
    }, shell.assistantMessageId);
    const assistant = failed?.messages.find((message) => message.id === shell.assistantMessageId);
    expect(assistant?.status).toBe("failed");
    expect(assistant?.options?.map((option) => option.label)).toEqual(expect.arrayContaining(["直接生成", "重新执行当前步骤"]));
    expect(failed?.artifactRefs.some((artifact) => artifact.entityId.startsWith("pending-") && artifact.kind === "quality_result")).toBe(false);
  });

  it("reprojects composition actions when the terminal runtime event arrives before the bridge result", async () => {
    const fixture = await createFixture();
    const host = fixture.createHost("session-idempotent");
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
    let task = reducer.create(base);
    task = reducer.reduce(task, {
      type: "new_root_task",
      goal: "compose_resume",
      workflowId: "compose_resume",
      stage: "select_profile_scope"
    });
    task = reducer.reduce(task, {
      type: "entity_revision",
      entityType: "profile",
      entityId: fixture.profile.id,
      version: fixture.profile.version
    });
    const session = AgentSessionSchema.parse({
      ...base,
      id: "session-runtime-race",
      personId: fixture.profile.personId,
      activeProfileId: fixture.profile.id,
      profileVersionNumber: fixture.profile.profileVersionNumber ?? 1,
      profileRevision: fixture.profile.version,
      taskState: task,
      workflowState: projectTaskStateToWorkflowState(task, base.workflowState),
      updatedAt: new Date().toISOString()
    });
    host.adopt(session);
    const shell = await host.beginRuntimeShell({
      session,
      userMessage: "用我的资料库生成通用简历",
      runtimeId: "hermes",
      turnId: "runtime-compose-race-turn"
    });
    const terminalPromise = host.applyRuntimeEvent({
      type: "turn_completed",
      sessionId: session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      message: "简历组装流程刚才没有完成，当前方向和已完成步骤已保留。"
    }, shell.assistantMessageId);
    const facadeData = {
      status: "waiting_for_confirmation",
      nextAction: "request_confirmation",
      workflowCheckpoint: {
        kind: "resume_composition",
        checkpointId: fixture.checkpoint.checkpointId,
        profileId: fixture.checkpoint.profileId,
        profileRevision: fixture.checkpoint.profileRevision,
        mode: fixture.checkpoint.mode,
        proposal: fixture.checkpoint.compositionResult.proposal,
        blueprint: fixture.checkpoint.blueprint,
        metrics: fixture.checkpoint.compositionResult.metrics,
        compositionResult: fixture.checkpoint.compositionResult
      }
    };
    const resultPromise = host.applyRuntimeEvent({
      type: "tool_call_completed",
      sessionId: session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      toolName: "career.workflow.compose_resume",
      operationId: "runtime-compose-race-operation",
      data: {
        result: { ok: true, data: facadeData },
        contract: { sourceToolName: "compose_resume" }
      }
    }, shell.assistantMessageId);
    await Promise.all([terminalPromise, resultPromise]);
    const recovered = host.getSnapshot().activeSession;

    expect(recovered?.taskState).toMatchObject({
      stage: "review_composition",
      completionStatus: "waiting_for_confirmation"
    });
    expect(recovered?.messages.find((message) => message.id === shell.assistantMessageId)?.options?.map((option) => option.label))
      .toEqual(expect.arrayContaining(["直接生成"]));
  });
});

function directGenerateEvent(): RuntimeUserEvent {
  return {
    type: "option_selected",
    optionId: "resume-composition-generate",
    action: {
      type: "answer",
      field: "resume-composition-decision",
      value: "直接生成"
    }
  };
}

function commandWithoutSession(event: RuntimeUserEvent) {
  if (event.type !== "confirm_resume_composition") return event;
  const { sessionId, ...command } = event;
  void sessionId;
  return command;
}

async function createFixture(options: { composition?: ResumeCompositionResult; writer?: CareerResumeWritingService } = {}) {
  db = new CareerAdaptDb(`CareerAdaptP45c12-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const profile = migrateCareerProfileToV2(demoCareerProfile);
  await repository.saveProfile(profile);
  await repository.setActiveProfileId(profile.id);
  const checkpoint = await repository.saveResumeCompositionCheckpoint(
    createResumeCompositionCheckpoint({
      composition: options.composition ?? aiComposition(profile)
    })
  );
  const service = new BrowserAgentToolService(repository, undefined, options.writer);
  const registry = createAgentToolRegistry(service);
  const rawExecutor = new AgentExecutor(registry);
  const gateway = new CareerToolGateway({
    registry,
    executor: rawExecutor,
    verifySessionBinding: async (binding) => {
      const current = await repository.getProfile(binding.profileId);
      return current
        && current.personId === binding.personId
        && current.version === binding.profileRevision
        ? { valid: true }
        : { valid: false, code: "career_session_binding_invalid", message: "binding invalid" };
    }
  });
  const executor = new CareerToolGatewayExecutor(registry, gateway);
  const persistence = new AgentSessionStore(repository);
  const sessions = new Map<string, AgentSession>();
  for (const id of ["session-text", "session-button", "session-idempotent", "session-mcp", "session-stale", "session-update"]) {
    const session = makeSession(id, profile, checkpoint);
    sessions.set(id, await persistence.save(session));
  }
  const naturalSession = AgentSessionSchema.parse({
    ...AgentRuntime.create("agent_quick_action", "collecting_intent"),
    id: "session-natural",
    updatedAt: new Date().toISOString()
  });
  sessions.set(naturalSession.id, await persistence.save(naturalSession));
  return {
    repository,
    profile,
    checkpoint,
    gateway,
    sessions,
    binding: (sessionId: string) => bindingFor(sessionId, profile),
    pageContext: (sessionId: string) => ({
      route: "/ai-workspace",
      agentSessionId: sessionId,
      personId: profile.personId,
      profileId: profile.id,
      profileVersionNumber: profile.profileVersionNumber ?? 1,
      profileRevision: profile.version,
      query: {}
    }),
    createHost(sessionId: string) {
      const host = new AgentHostStore({
        kernel: {} as never,
        executor,
        persistence,
        repository
      });
      host.adopt(sessions.get(sessionId)!);
      return host;
    }
  };
}

function aiComposition(profile: CareerProfile) {
  const fallback = compileResumeComposition({
    profile,
    mode: "general",
    targetDirection: "互联网技术 / AI 应用方向秋招"
  });
  const execution = { ...fallback.writingExecution! };
  delete execution.fallbackReason;
  const metrics = {
    ...fallback.metrics,
    bulletsGenerated: Math.max(1, fallback.metrics.bulletsGenerated),
    supportedClaims: Math.max(1, fallback.metrics.supportedClaims)
  };
  return {
    ...fallback,
    metrics,
    reviewResult: { ...fallback.reviewResult, metrics },
    writingExecution: {
      ...execution,
      mode: "ai" as const,
      provider: "test-provider",
      model: "test-model",
      promptVersion: "p45c12"
    }
  };
}

function transportFallbackComposition(profile: CareerProfile): ResumeCompositionResult {
  const composition = compileResumeComposition({
    profile,
    mode: "general",
    targetDirection: "互联网技术 / AI 应用方向秋招"
  });
  return {
    ...composition,
    writingExecution: {
      ...composition.writingExecution!,
      mode: "deterministic_fallback" as const,
      fallbackReason: "provider_tls_failed"
    }
  } as ResumeCompositionResult;
}

function writerSequence(
  failedComposition: ResumeCompositionResult,
  successfulComposition: ResumeCompositionResult,
  delayMs = 0
) {
  let callCount = 0;
  return {
    writeWithExecution: vi.fn(async () => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      callCount += 1;
      if (callCount === 1) {
        return {
          output: undefined,
          execution: {
            ...failedComposition.writingExecution!,
            mode: "deterministic_fallback" as const,
            fallbackReason: "provider_tls_failed"
          }
        };
      }
      const execution = { ...successfulComposition.writingExecution! };
      delete execution.fallbackReason;
      return {
        output: writingOutputWithGroundedBullet(successfulComposition),
        execution: {
          ...execution,
          mode: "ai" as const,
          provider: "test-real-provider",
          model: "test-real-model",
          promptVersion: "p45c13-test"
        }
      };
    })
  } as unknown as CareerResumeWritingService;
}

function writingOutputWithGroundedBullet(composition: ResumeCompositionResult): CareerResumeWritingOutput {
  const output = composition.writingOutput!;
  return {
    ...output,
    assets: output.assets.map((asset) => asset.sourceAssetId === "exp-ai-product"
      ? { ...asset, highlights: ["参与 AI 应用项目的需求梳理、原型设计和功能验收。"] }
      : asset)
  };
}

function makeSession(id: string, profile: CareerProfile, checkpoint: ReturnType<typeof createResumeCompositionCheckpoint>) {
  const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
  const reducer = new AgentTaskStateReducer();
  let task = reducer.create(base);
  task = reducer.reduce(task, {
    type: "new_root_task",
    goal: "create_resume_from_profile",
    workflowId: "build_resume_from_profile",
    stage: "select_profile_scope"
  });
  task = reducer.reduce(task, {
    type: "entity_revision",
    entityType: "profile",
    entityId: profile.id,
    version: profile.version
  });
  task = reducer.reduce(task, {
    type: "tool_observation",
    toolName: "plan_resume_composition",
    observation: {
      profileId: profile.id,
      profileRevision: profile.version,
      mode: "general",
      checkpoint,
      checkpointId: checkpoint.checkpointId,
      composition: checkpoint.compositionResult,
      compositionProposal: checkpoint.compositionResult.proposal,
      evidenceGraph: checkpoint.compositionResult.evidenceGraph,
      blueprint: checkpoint.blueprint,
      reviewResult: checkpoint.reviewResult,
      metrics: checkpoint.compositionResult.metrics,
      keywordCoverage: checkpoint.compositionResult.keywordCoverage,
      informationNeeds: checkpoint.compositionResult.informationNeeds
    }
  });
  const session = AgentSessionSchema.parse({
    ...base,
    id,
    personId: profile.personId,
    activeProfileId: profile.id,
    profileVersionNumber: profile.profileVersionNumber ?? 1,
    profileRevision: profile.version,
    taskState: task,
    workflowState: projectTaskStateToWorkflowState(task, base.workflowState),
    updatedAt: new Date().toISOString()
  });
  return session;
}

function bindingFor(sessionId: string, profile: CareerProfile) {
  return {
    agentSessionId: sessionId,
    personId: profile.personId!,
    profileId: profile.id,
    profileVersionNumber: profile.profileVersionNumber ?? 1,
    profileRevision: profile.version
  };
}
