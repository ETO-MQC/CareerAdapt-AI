import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionSchema, AgentTaskStateSchema, type AgentSession } from "@/agent/contracts/agentSession";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import { ResumeTailoringPlanSchema } from "@/domain/schemas";
import { TailoringSessionSchema, createTailoringSessionCommand, tailoringDiffId } from "@/services/jobs/tailoringCommands";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { subscribeResumeRepositoryMutation, type ResumeRepositoryMutation } from "@/services/storage/resumeRepositoryEvents";
import type { ResumeArtifactWriteCheckpoint } from "@/agent/contracts/resumeArtifactWrite";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  vi.useRealTimers();
  db?.close();
  await db?.delete();
  db = undefined;
});

describe("P4.5c.1.9 durable agent session and artifact closure", () => {
  it("checkpoints streamed text and keeps a recoverable Hermes turn after reload", async () => {
    vi.useFakeTimers();
    const base = AgentRuntime.create("conversation", "collecting_intent", "耐久流式测试");
    let persisted: AgentSession | undefined;
    const save = vi.fn(async (value: AgentSession) => {
      persisted = value;
      return value;
    });
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save } as never
    });
    const shell = await host.beginRuntimeShell({
      session: base,
      userMessage: "继续",
      runtimeId: "hermes"
    });
    const now = new Date().toISOString();
    await host.applyRuntimeEvent({
      type: "progress",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: now,
      message: "正在继续…",
      data: {
        runHandle: {
          runId: "hermes-run-durable",
          hermesSessionId: "hermes-session-durable",
          careerAgentSessionId: shell.session.id,
          turnId: shell.turnId,
          status: "running",
          startedAt: now,
          lastEventAt: now
        }
      }
    }, shell.assistantMessageId);
    const savesBeforeDelta = save.mock.calls.length;

    await host.applyRuntimeEvent({
      type: "text_delta",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      delta: "这是刷新前已经产生、必须保留下来的中途文本。"
    }, shell.assistantMessageId);
    expect(save).toHaveBeenCalledTimes(savesBeforeDelta);

    await vi.advanceTimersByTimeAsync(800);
    expect(persisted?.messages.find((message) => message.id === shell.assistantMessageId)?.content)
      .toContain("刷新前已经产生");

    const reloadedHost = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save } as never
    });
    reloadedHost.adopt(persisted!);
    expect(reloadedHost.getSnapshot().activeSession?.activeTurn?.status).toBe("running");
    expect(reloadedHost.getSnapshot().activeSession?.hermesRun?.runId).toBe("hermes-run-durable");
    expect(reloadedHost.getSnapshot().activeSession?.messages.find((message) => message.id === shell.assistantMessageId)?.content)
      .toContain("刷新前已经产生");
  });

  it("repairs a committed artifact from its receipt without creating a duplicate branch", async () => {
    const fixture = await createTailoringFixture("durable-repair");
    const operationId = "durable-repair-apply";
    const result = await fixture.service.applyTailoringChanges({
      session: fixture.tailoringSession,
      selectedDiffs: [fixture.diff],
      confirmedRequirementIds: []
    }, operationId);
    const receipt = result.artifactReceipt;
    const completedCheckpoint = await fixture.repository.getResumeArtifactWriteCheckpoint(operationId);
    if (!receipt || !completedCheckpoint) throw new Error("durable_artifact_fixture_missing");
    const beforeCount = (await fixture.repository.listResumeBranches(demoCareerProfile.id))
      .filter((branch) => branch.branchPurpose === "job_specific").length;
    const crashed = makeCrashedTailoringSession(fixture, {
      ...completedCheckpoint,
      status: "write_pending",
      updatedAt: new Date().toISOString()
    });
    const save = vi.fn(async (value: AgentSession) => value);
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save } as never,
      repository: fixture.repository
    });
    host.adopt(crashed);

    await vi.waitFor(() => {
      expect(host.getSnapshot().activeSession?.taskState?.completionStatus).toBe("completed");
    });
    const repaired = host.getSnapshot().activeSession;
    expect(repaired?.taskState?.knownSlots.artifactReceipt).toMatchObject({
      operationId,
      status: "completed",
      resultResumeId: receipt.resultResumeId
    });
    expect(repaired?.messages.filter((message) => message.content === "已生成岗位定制简历，并应用了 1 项已确认修改。")).toHaveLength(1);
    expect((await fixture.repository.listResumeBranches(demoCareerProfile.id))
      .filter((branch) => branch.branchPurpose === "job_specific")).toHaveLength(beforeCount);
    expect(repaired?.activeTurn?.runtimeFailureDiagnostics?.lastArtifactWrite).toMatchObject({
      status: "write_completed",
      repositoryReadBackVerified: true,
      resumeListVisibilityVerified: true
    });
  });

  it("keeps a pre-commit crash recoverable and never reports success without a receipt", async () => {
    const fixture = await createTailoringFixture("durable-before-commit");
    const operationId = "durable-before-commit-write";
    const now = new Date().toISOString();
    const checkpoint: ResumeArtifactWriteCheckpoint = {
      schemaVersion: 1,
      operationId,
      checkpointId: `resume-artifact-write:${operationId}`,
      workflowId: "tailor_existing_resume",
      profileId: demoCareerProfile.id,
      expectedProfileRevision: demoCareerProfile.version,
      sourceResumeId: fixture.general.branch.id,
      sourceResumeRevisionId: fixture.general.branch.currentRevisionId ?? undefined,
      jobId: fixture.job.id,
      acceptedDiffIds: [tailoringDiffId(fixture.diff)],
      changedFieldPaths: [],
      status: "write_pending",
      createdAt: now,
      updatedAt: now
    };
    await fixture.repository.saveResumeArtifactWriteCheckpoint(checkpoint);
    const crashed = makeCrashedTailoringSession(fixture, checkpoint);
    const save = vi.fn(async (value: AgentSession) => value);
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save } as never,
      repository: fixture.repository
    });
    host.adopt(crashed);

    await vi.waitFor(() => {
      expect(host.getSnapshot().activeSession?.activeTurn?.status).toBe("waiting_for_user");
    });
    const recovered = host.getSnapshot().activeSession;
    expect(recovered?.taskState?.completionStatus).toBe("waiting_for_user");
    expect(recovered?.taskState?.knownSlots.tailoringApplyFailure).toMatchObject({
      code: "artifact_write_interrupted_before_commit",
      recoverable: true
    });
    expect(recovered?.taskState?.knownSlots.artifactReceipt).toBeUndefined();
    expect(recovered?.messages.some((message) => message.content === "已生成岗位定制简历，并应用了 1 项已确认修改。")).toBe(false);
    expect(await fixture.repository.getResumeArtifactReceipt(operationId)).toBeUndefined();
  });

  it("does not turn an unverified post-commit read into a success receipt", async () => {
    const fixture = await createTailoringFixture("durable-readback-failure");
    const operationId = "durable-readback-failure-apply";
    const revisionSpy = vi.spyOn(fixture.repository, "getResumeRevision").mockResolvedValue(undefined);

    await expect(fixture.service.applyTailoringChanges({
      session: fixture.tailoringSession,
      selectedDiffs: [fixture.diff],
      confirmedRequirementIds: []
    }, operationId)).rejects.toMatchObject({ code: "artifact_commit_visibility_verification_failed" });
    revisionSpy.mockRestore();

    expect(await fixture.repository.getResumeArtifactReceipt(operationId)).toBeUndefined();
    expect(await fixture.repository.getResumeArtifactWriteCheckpoint(operationId)).toMatchObject({
      status: "visibility_verification_failed",
      safeErrorCode: "artifact_commit_visibility_verification_failed"
    });
  });

  it("publishes a typed branch mutation for an already-mounted Resume Center", async () => {
    const fixture = await createTailoringFixture("resume-center-signal");
    const operationId = "resume-center-signal-apply";
    const mutations: ResumeRepositoryMutation[] = [];
    const unsubscribe = subscribeResumeRepositoryMutation((event) => mutations.push(event));
    try {
      const result = await fixture.service.applyTailoringChanges({
        session: fixture.tailoringSession,
        selectedDiffs: [fixture.diff],
        confirmedRequirementIds: []
      }, operationId);
      expect(mutations).toContainEqual(expect.objectContaining({
        type: "created",
        profileId: demoCareerProfile.id,
        branchId: result.resultResumeId,
        revisionId: result.resultResumeRevisionId,
        operationId
      }));
    } finally {
      unsubscribe();
    }
  });

  it("rejects a stale session snapshot without appending its stale transcript", async () => {
    db = new CareerAdaptDb(`DurableSessionCAS-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const firstAt = "2026-08-15T10:00:00.000Z";
    const secondAt = "2026-08-15T10:00:01.000Z";
    const base = AgentRuntime.create("conversation", "collecting_intent", "会话 CAS");
    const firstMessage = {
      id: "durable-cas-first",
      turnId: "durable-cas-turn-1",
      role: "user" as const,
      content: "第一轮",
      kind: "text" as const,
      type: "text" as const,
      status: "complete" as const,
      createdAt: firstAt
    };
    const secondMessage = {
      id: "durable-cas-second",
      turnId: "durable-cas-turn-2",
      role: "assistant" as const,
      content: "第二轮已保存",
      kind: "text" as const,
      type: "text" as const,
      status: "complete" as const,
      createdAt: secondAt
    };
    await repository.saveAgentSession({ ...base, messages: [firstMessage], updatedAt: firstAt });
    const current = await repository.getAgentSession(base.id);
    if (!current) throw new Error("durable_cas_fixture_missing");
    await repository.saveAgentSession({
      ...current,
      messages: [...current.messages, secondMessage],
      updatedAt: secondAt
    });
    await repository.saveAgentSession({
      ...base,
      messages: [firstMessage, {
        ...secondMessage,
        id: "durable-cas-stale",
        content: "旧快照不应写入"
      }],
      updatedAt: firstAt
    });

    const stored = await repository.getAgentSession(base.id);
    expect(stored?.messages.map((message) => message.id)).toEqual(["durable-cas-first", "durable-cas-second"]);
    expect(stored?.messages.some((message) => message.content === "旧快照不应写入")).toBe(false);
  });
});

async function createTailoringFixture(label: string) {
  const job = demoJobDescriptions[0];
  const now = "2026-08-15T10:00:00.000Z";
  const general = buildGeneralBranchFromProfile({
    profile: demoCareerProfile,
    operationId: `durable-general-${label}`,
    name: "通用简历",
    includeProfileFacts: true,
    includeProfileBasics: true,
    now
  });
  const summary = general.branch.structuredContentItems?.find((item) => item.data.sectionType === "summary");
  if (!summary || summary.data.sectionType !== "summary") throw new Error("durable_summary_fixture_missing");
  db = new CareerAdaptDb(`DurableArtifact-${label}-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  await repository.saveProfile(demoCareerProfile);
  await repository.saveJobDescription(job);
  await repository.saveResumeBranch(general.branch);
  await db.resumeRevisions.put(general.firstRevision);
  const created = createTailoringSessionCommand({
    operationId: `durable-tailoring-${label}`,
    profile: demoCareerProfile,
    branch: general.branch,
    job
  });
  const diff = {
    target: { sectionId: "summary", itemId: summary.id, fieldPath: "text" as const },
    operation: "replace" as const,
    original: summary.data.text,
    value: "基于数据分析项目完成结构化交付，并突出与目标岗位相关的分析经验。",
    reason: "验证耐久岗位产物写入",
    requirementIds: [],
    targetKeywords: [],
    evidenceRefs: [{
      type: "experience_fact" as const,
      experienceId: demoCareerProfile.experiences[0].id,
      factId: demoCareerProfile.experiences[0].facts[0].id,
      factQuote: demoCareerProfile.experiences[0].facts[0].statement,
      factText: demoCareerProfile.experiences[0].facts[0].statement
    }],
    supportLevel: "verified" as const
  };
  const plan = ResumeTailoringPlanSchema.parse({
    ...created.session.plan,
    questionPlan: created.session.plan.questionPlan
      ? { ...created.session.plan.questionPlan, status: "completed", activeQuestionId: undefined, completedAt: now }
      : undefined,
    diffs: [diff],
    diffReviews: [{ diffId: tailoringDiffId(diff), status: "accepted", updatedAt: now }]
  });
  const tailoringSession = TailoringSessionSchema.parse({
    ...created.session,
    plan,
    revision: 2,
    generatedDiffRevision: 1
  });
  return { repository, service: new BrowserAgentToolService(repository), job, general, diff, tailoringSession };
}

function makeCrashedTailoringSession(
  fixture: Awaited<ReturnType<typeof createTailoringFixture>>,
  checkpoint: ResumeArtifactWriteCheckpoint
) {
  const now = new Date().toISOString();
  const base = AgentRuntime.create("tailor_existing_resume", "confirm_apply", "耐久岗位产物恢复");
  const initialTask = new AgentTaskStateReducer().create(base, "create_tailored_resume");
  const taskState = AgentTaskStateSchema.parse({
    ...initialTask,
    stage: "confirm_apply",
    activeGoal: "confirm_apply",
    completionStatus: "waiting_for_confirmation",
    selectedEntities: {
      ...initialTask.selectedEntities,
      profileId: demoCareerProfile.id,
      profileVersion: demoCareerProfile.version,
      resumeId: fixture.general.branch.id,
      resumeRevisionId: fixture.general.branch.currentRevisionId,
      jobId: fixture.job.id
    },
    knownSlots: {
      ...initialTask.knownSlots,
      tailoringSession: fixture.tailoringSession,
      acceptedDiffIds: [tailoringDiffId(fixture.diff)],
      acceptedDiffCount: 1,
      artifactWriteCheckpoint: checkpoint
    },
    updatedAt: now
  });
  return AgentSessionSchema.parse({
    ...base,
    activeProfileId: demoCareerProfile.id,
    profileRevision: demoCareerProfile.version,
    activeResumeId: fixture.general.branch.id,
    activeJobId: fixture.job.id,
    runtimeId: "hermes",
    taskState,
    messages: [{
      id: "durable-artifact-thinking",
      turnId: "durable-artifact-turn",
      role: "assistant",
      content: "正在生成岗位简历…",
      kind: "assistant_thinking",
      type: "assistant_thinking",
      status: "thinking",
      streaming: true,
      createdAt: now
    }],
    activeTurn: {
      id: "durable-artifact-turn",
      sessionId: base.id,
      runtimeId: "hermes",
      preferredRuntime: "hermes",
      attemptedRuntime: "hermes",
      finalRuntime: "hermes",
      executionOwner: "hermes",
      status: "running",
      startedAt: now,
      runtimeFailureDiagnostics: {
        lastArtifactWrite: {
          operationId: checkpoint.operationId,
          checkpointId: checkpoint.checkpointId,
          status: checkpoint.status
        }
      }
    },
    updatedAt: now
  });
}
