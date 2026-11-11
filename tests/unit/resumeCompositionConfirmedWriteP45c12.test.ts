import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore, branchSessionFromEditedUserMessage } from "@/agent/runtime/AgentHostStore";
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
import { projectBusinessWorkflowProgress } from "@/agent/runtime/businessWorkflowProgress";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  if (db) await db.delete();
  db = undefined;
});

describe("P4.5c.1.2 confirmed composition write boundary", () => {
  it.each(["success", "retry_fit", "retry_conflict", "nonretry_fit", "source_conflict", "stop_during_fit", "stop_after_commit"])("H2 persisted compose confirmation and %s preserve committed entities", async scenario => {
    const fixture = await createFixture();
    const jobResult = await fixture.gateway.execute("career.workflow.job_intake", {
      persistence: "save", rawText: "岗位：软件工程师\n岗位职责：参与产品开发与测试。\n任职要求：本科及以上学历，熟悉 Python，具备项目开发与团队协作经验。"
    }, { operationId: "h1-save-job", userMessageId: "h1-user", sourceUserMessageId: "h1-user", sourceUserMessage: "先保存该岗位", logicalTurnId: "h1-job-turn", careerSessionBinding: fixture.binding("session-idempotent"), confirmed: true, confirmationCount: 1 });
    expect(jobResult.ok, JSON.stringify(jobResult.error)).toBe(true);
    const jobId = (jobResult.data as { workflowCheckpoint: { jobId: string } }).workflowCheckpoint.jobId;
    const original = fixture.sessions.get("session-idempotent")!;
    original.taskState!.selectedEntities.jobId = jobId;
    original.activeJobId = jobId;
    original.taskState!.knownSlots.nextAction = { kind: "job_fit", jobId, profileId: fixture.profile.id };
    if (scenario === "source_conflict") (original.taskState!.knownSlots.nextAction as Record<string, unknown>).originSessionId = "different-session";
    const profileBefore = await fixture.repository.getProfile(fixture.profile.id);
    const host = fixture.createHost("session-idempotent");
    const execute = fixture.gateway.execute.bind(fixture.gateway);
    let fitAttempts = 0;
    const calls: string[] = [];
    vi.spyOn(fixture.gateway, "execute").mockImplementation(async (name, input, context) => {
      calls.push(name);
      if (name === "career.workflow.job_fit" && (scenario.startsWith("retry") || scenario === "nonretry_fit") && fitAttempts++ === 0) {
        return { ok: false, artifacts: [], receipt: { toolName: name, operationId: context!.operationId!, status: "failed", completedAt: new Date().toISOString() }, error: { code: "provider_timeout", category: "provider", message: "synthetic fit interruption", recoverable: scenario !== "nonretry_fit" } };
      }
      const result = await execute(name, input, context);
      if (name === "career.workflow.compose_resume" && result.ok && scenario === "stop_after_commit"
        || name === "career.workflow.job_fit" && scenario === "stop_during_fit") await host.interrupt(original.id);
      return result;
    });
    const restored = await host.adoptDurably(JSON.parse(JSON.stringify(original)));
    const prepared = await host.prepareRuntimeUserEvent({ session: restored!, event: directGenerateEvent(), pageContext: fixture.pageContext(original.id) });
    let completed = await host.executeConfirmedResumeComposition({ session: prepared.session,
      command: prepared.event as ConfirmResumeCompositionCommand, pageContext: fixture.pageContext(original.id), turnId: prepared.turnId });
    if (scenario === "stop_after_commit") {
      expect(calls).not.toContain("career.workflow.job_fit");
      expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toHaveLength(1);
      expect(await fixture.repository.getProfile(fixture.profile.id)).toEqual(profileBefore);
      expect(completed?.taskState?.knownSlots.nextAction).toBeTruthy();
      const before = await fixture.repository.listResumeBranches(fixture.profile.id);
      const resumed = await host.prepareRuntimeUserEvent({ session: completed!, event: { type: "option_selected", action: { type: "retry_current_step" } }, pageContext: fixture.pageContext(original.id) });
      expect(resumed.session.taskState?.completionStatus).toBe("completed");
      expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toEqual(before);
      expect(await fixture.repository.listResumeRevisions(before[0].id)).toHaveLength(1);
      return;
    }
    if (scenario === "source_conflict" || scenario === "stop_during_fit") {
      expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toHaveLength(1);
      expect(await fixture.repository.getProfile(fixture.profile.id)).toEqual(profileBefore);
      if (scenario === "source_conflict") {
        expect(calls).not.toContain("career.workflow.job_fit");
        expect(completed?.taskState?.knownSlots.continuationFailure).toMatchObject({ code: "continuation_entity_conflict", retryable: false });
      } else {
        expect(completed?.activeTurn?.status).toBe("aborted");
        expect(completed?.taskState?.knownSlots.fitAnalysis).toBeTruthy();
      }
      return;
    }
    if (scenario === "retry_conflict" || scenario === "nonretry_fit") {
      const before = await fixture.repository.listResumeBranches(fixture.profile.id);
      if (scenario === "retry_conflict") {
        (completed!.taskState!.knownSlots.nextAction as Record<string, unknown>).jobId = "another-job";
        await host.adoptDurably(completed!);
        await expect(host.prepareRuntimeUserEvent({ session: completed!, event: { type: "option_selected", action: { type: "retry_current_step" } }, pageContext: fixture.pageContext(original.id) })).rejects.toThrow("continuation_entity_conflict");
      } else {
        expect(completed?.messages.at(-1)?.options?.some(option => option.action.type === "retry_current_step")).not.toBe(true);
        await host.prepareRuntimeUserEvent({ session: completed!, event: { type: "option_selected", action: { type: "retry_current_step" } }, pageContext: fixture.pageContext(original.id) });
      }
      expect(calls.filter(name => name === "career.workflow.job_fit")).toHaveLength(1);
      expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toEqual(before);
      expect(await fixture.repository.getProfile(fixture.profile.id)).toEqual(profileBefore);
      return;
    }
    if (scenario === "retry_fit") {
      expect(completed?.taskState?.completionStatus).toBe("failed");
      const branchesBefore = await fixture.repository.listResumeBranches(fixture.profile.id);
      const revisionsBefore = await fixture.repository.listResumeRevisions(branchesBefore[0].id);
      const reloaded = fixture.createHost("session-idempotent");
      await reloaded.adoptDurably(JSON.parse(JSON.stringify(completed)));
      const retried = await reloaded.prepareRuntimeUserEvent({ session: reloaded.getSnapshot().activeSession!, event: { type: "option_selected", action: { type: "retry_current_step" } }, pageContext: fixture.pageContext(original.id) });
      expect(retried.deterministicTerminal).toBe(true);
      completed = retried.session;
      expect(projectBusinessWorkflowProgress(completed).state).toBe("completed");
      expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toEqual(branchesBefore);
      expect(await fixture.repository.listResumeRevisions(branchesBefore[0].id)).toEqual(revisionsBefore);
      expect(calls.filter(name => name === "career.workflow.compose_resume")).toHaveLength(1);
      expect(calls.filter(name => name === "career.workflow.job_fit")).toHaveLength(2);
    }
    expect(completed?.taskState).toMatchObject({ workflowId: "analyze_job_fit", completionStatus: "completed", selectedEntities: { jobId } });
    const branches = await fixture.repository.listResumeBranches(fixture.profile.id);
    expect(branches).toHaveLength(1);
    expect(completed?.taskState?.selectedEntities.resumeId).toBe(branches[0].id);
    expect(completed?.taskState?.knownSlots.fitAnalysis).toBeTruthy();
    expect(completed?.artifactRefs.find(artifact => artifact.kind === "job_fit_overview")?.binding).toMatchObject({ sessionId: original.id, jobId, resumeBranchId: branches[0].id, revisionId: branches[0].currentRevisionId });
    expect(completed?.taskState?.knownSlots.nextAction).toBeUndefined();
    expect(await fixture.repository.getProfile(fixture.profile.id)).toEqual(profileBefore);
    expect(await fixture.repository.listJobDescriptions()).toHaveLength(1);
    if (scenario === "success") {
      const revisionsBefore = await fixture.repository.listResumeRevisions(branches[0].id);
      const jobsBefore = await fixture.repository.listJobDescriptions();
      const user = completed!.messages.find(message => message.role === "user")!;
      expect(user).toBeTruthy();
      const edited = branchSessionFromEditedUserMessage(completed!, user.id, "改成一个新的任务")!;
      const { userMessageId: _userMessageId, appendUserMessage: _appendUserMessage, updateExistingUserMessage: _updateExistingUserMessage, assistantMessageId: _assistantMessageId, ...editedSession } = edited;
      void [_userMessageId, _appendUserMessage, _updateExistingUserMessage, _assistantMessageId];
      await host.adoptDurably(editedSession);
      expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toEqual(branches);
      expect(await fixture.repository.listResumeRevisions(branches[0].id)).toEqual(revisionsBefore);
      expect(await fixture.repository.listJobDescriptions()).toEqual(jobsBefore);
      expect(await fixture.repository.getProfile(fixture.profile.id)).toEqual(profileBefore);
    }
  });
  it("H2 captures the same-turn continuation when Hermes selects compose after a completed Job task", async () => {
    const f = await createFixture();
    const original = f.sessions.get("session-idempotent")!;
    original.taskState = new AgentTaskStateReducer().create(original, "ingest_job", { workflowId: "job_ingestion", step: "completed" });
    original.taskState.workflowId = "job_ingestion";
    original.taskState.completionStatus = "completed";
    original.taskState.selectedEntities = { profileId: f.profile.id, jobId: "bound-job" };
    // Formal Job selection lives in TaskState; the legacy session alias may
    // remain empty after the real confirmed intake path.
    original.activeJobId = undefined;
    const host = f.createHost(original.id);
    await host.adoptDurably(original);
    const shell = await host.beginRuntimeShell({ session: original, userMessage: "基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配。", runtimeId: "hermes" });
    const result = await f.gateway.execute("career.workflow.compose_resume", { mode: "general", profileId: f.profile.id }, { operationId: "h2-compose-proposal", careerSessionBinding: f.binding(original.id), requireSessionBinding: true });
    expect(result.ok).toBe(true);
    await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: original.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), toolName: "career.workflow.compose_resume", operationId: "h2-compose-proposal", data: { result } }, shell.assistantMessageId);
    const restored = await new AgentSessionStore(f.repository).get(original.id);
    expect(restored?.taskState?.workflowId).toBe("compose_resume");
    expect(restored?.taskState?.knownSlots.nextAction).toMatchObject({ kind: "job_fit", originSessionId: original.id, originTurnId: shell.turnId, jobId: "bound-job", profileId: f.profile.id });
    expect(await f.repository.listResumeBranches(f.profile.id)).toHaveLength(0);
  });
  it("consumes a restored confirmation and exposes a source-bound recovery action after writing fails", async () => {
    const profile = migrateCareerProfileToV2(demoCareerProfile);
    const fallback = transportFallbackComposition(profile);
    const writer = writerSequence(fallback, aiComposition(profile));
    const fixture = await createFixture({ composition: fallback, writer });
    const host = fixture.createHost("session-idempotent");
    const session = fixture.sessions.get("session-idempotent")!;
    const restored = await host.adoptDurably({ ...session, pendingConfirmation: {
      id: "failed-restore-confirmation", operationId: "restored-compose-op", toolName: "career.workflow.compose_resume", title: "确认", description: "保存已审核提案",
      status: "pending", destructive: false, requestedAt: new Date().toISOString()
    }, pendingToolCall: { toolName: "career.workflow.compose_resume", operationId: "restored-compose-op",
      input: { mode: "general", profileId: fixture.profile.id, expectedProfileRevision: fixture.profile.version } } });
    const pageContext = fixture.pageContext(session.id);
    const failed = await host.resolveConfirmation(true, pageContext, restored!);
    expect(failed?.pendingConfirmation).toBeUndefined();
    expect(failed?.pendingToolCall).toBeUndefined();
    expect(failed?.taskState?.knownSlots.resumeCompositionWriteFailure).toBeTruthy();
    expect(failed?.messages.some(message => message.options?.some(option => option.label === "直接生成"))).toBe(true);
    expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toHaveLength(0);
    const prepared = await host.prepareRuntimeUserEvent({ session: failed!, event: directGenerateEvent(), pageContext });
    const recovered = await host.executeConfirmedResumeComposition({ session: prepared.session,
      command: prepared.event as ConfirmResumeCompositionCommand, pageContext, turnId: prepared.turnId });
    expect(recovered?.taskState?.completionStatus).toBe("completed");
    expect(projectBusinessWorkflowProgress(recovered!).state).toBe("completed");
    expect(recovered?.pendingConfirmation).toBeUndefined();
    const branches = await fixture.repository.listResumeBranches(fixture.profile.id);
    expect(branches).toHaveLength(1);
    expect(await fixture.repository.listResumeRevisions(branches[0].id)).toHaveLength(1);
  });
  it("confirms a first facade proposal from a task-free conversation through the existing Repository gate", async () => {
    const fixture = await createFixture();
    const host = fixture.createHost("session-idempotent");
    const session = AgentSessionSchema.parse({ ...fixture.sessions.get("session-idempotent")!, taskState: undefined, workflowState: undefined });
    await host.adoptDurably(session);
    const shell = await host.beginRuntimeShell({ session, userMessage: "根据资料生成通用简历", runtimeId: "hermes" });
    const projected = await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: session.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), toolName: "career.workflow.compose_resume", operationId: "first-facade-plan",
      data: { result: { ok: true, data: { status: "waiting_for_confirmation", workflowStage: "review_composition",
        workflowCheckpoint: { ...fixture.checkpoint, kind: "resume_composition", proposal: fixture.checkpoint.compositionResult.proposal } } } }
    }, shell.assistantMessageId);
    expect(projected?.taskState?.knownSlots.resumeCompositionCheckpoint).toMatchObject({ checkpointId: fixture.checkpoint.checkpointId });
    expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toHaveLength(0);
    const pageContext = fixture.pageContext(session.id);
    const restored = await host.adoptDurably({ ...projected!, pendingConfirmation: {
      id: "restore-confirmation", operationId: "first-facade-plan", toolName: "career.workflow.compose_resume", title: "确认", description: "确认已核对提案",
      status: "pending", destructive: false, requestedAt: new Date().toISOString(), turnId: shell.turnId
    }, pendingToolCall: { toolName: "career.workflow.compose_resume", operationId: "first-facade-plan", turnId: shell.turnId,
      input: { mode: "general", profileId: fixture.profile.id, expectedProfileRevision: fixture.profile.version } } });
    const planWrite = vi.spyOn(fixture.repository, "saveResumeCompositionCheckpoint");
    const completed = await host.resolveConfirmation(true, pageContext, restored!);
    expect(planWrite).not.toHaveBeenCalled();
    expect(completed?.taskState?.completionStatus).toBe("completed");
    expect(projectBusinessWorkflowProgress(completed!).state).toBe("completed");
    await host.resolveConfirmation(true, pageContext, completed!);
    const branches = await fixture.repository.listResumeBranches(fixture.profile.id);
    expect(branches).toHaveLength(1);
    expect(await fixture.repository.listResumeRevisions(branches[0].id)).toHaveLength(1);
  });
  it("preserves the proposal on Repository failure and recovers the same confirmation without duplicate Revisions", async () => {
    const fixture = await createFixture();
    const host = fixture.createHost("session-idempotent");
    const session = fixture.sessions.get("session-idempotent")!;
    const pageContext = fixture.pageContext(session.id);
    const prepared = await host.prepareRuntimeUserEvent({ session, event: directGenerateEvent(), pageContext });
    const command = prepared.event as ConfirmResumeCompositionCommand;
    const write = vi.spyOn(fixture.repository, "ensureGeneralResumeFromProfile").mockRejectedValueOnce(new Error("simulated Repository write failure"));
    const failed = await host.executeConfirmedResumeComposition({ session: prepared.session, command, pageContext, turnId: prepared.turnId });
    expect(write).toHaveBeenCalledTimes(1);
    expect(failed?.taskState?.completionStatus).not.toBe("completed");
    expect(failed?.taskState?.knownSlots.resumeCompositionCheckpoint).toMatchObject({ checkpointId: fixture.checkpoint.checkpointId });
    expect(await fixture.repository.listResumeBranches(fixture.profile.id)).toHaveLength(0);
    const recovered = await host.executeConfirmedResumeComposition({ session: failed!, command, pageContext, turnId: prepared.turnId });
    expect(recovered?.taskState?.completionStatus).toBe("completed");
    const branches = await fixture.repository.listResumeBranches(fixture.profile.id);
    expect(branches).toHaveLength(1);
    expect(await fixture.repository.listResumeRevisions(branches[0].id)).toHaveLength(1);
  });
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
    const source = await fixture.repository.getResumeSourceFingerprint(seeded.branch.id);
    const selectedCheckpoint = await fixture.repository.saveResumeCompositionCheckpoint(createResumeCompositionCheckpoint({
      composition: { ...fixture.checkpoint.compositionResult, sourceResumeId: seeded.branch.id },
      source: source!
    }));
    expect(selectedCheckpoint.sourceBranchId).toBe(seeded.branch.id);
    const updateSpy = vi.spyOn(fixture.repository, "ensureGeneralResumeFromProfile");
    // Another branch can be more recently updated without becoming the target.
    const other = await fixture.repository.ensureGeneralResumeFromProfile({
      profileId: fixture.profile.id, operationId: "other-general", mode: "create_new"
    });
    const otherBefore = await fixture.repository.getResumeBranch(other.branch.id);
    fixture.sessions.set("session-update", await new AgentSessionStore(fixture.repository).save(
      { ...makeSession("session-update", fixture.profile, selectedCheckpoint), sessionRevision: fixture.sessions.get("session-update")!.sessionRevision }
    ));
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
      branchMode: "update_existing",
      sourceResumeId: seeded.branch.id,
      sourceFingerprint: source
    });
    const completed = await host.executeConfirmedResumeComposition({
      session: prepared.session,
      command: prepared.event as ConfirmResumeCompositionCommand,
      pageContext,
      turnId: prepared.turnId
    });
    expect(completed?.taskState?.stage, JSON.stringify(completed?.messages.at(-1))).toBe("resume_ready");
    expect(updateSpy.mock.calls.at(-1)?.[0]).toMatchObject({ sourceResumeId: seeded.branch.id, expectedSourceRevisionId: seeded.branch.currentRevisionId });
    expect((await fixture.repository.listResumeBranches(fixture.profile.id)).map((branch) => branch.id).sort()).toEqual([seeded.branch.id, other.branch.id].sort());
    expect(await fixture.repository.listResumeRevisions(seeded.branch.id)).toHaveLength(2);
    expect(await fixture.repository.getResumeBranch(other.branch.id)).toEqual(otherBefore);
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
    expect(assistant?.status).toBe("complete");
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
    const adopted = await host.adoptDurably(session);
    const shell = await host.beginRuntimeShell({
      session: adopted ?? session,
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
