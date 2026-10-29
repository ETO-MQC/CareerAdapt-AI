import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerToolGateway, CareerToolGatewayExecutor } from "@/agent/tools/CareerToolGateway";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import type { TailoringServiceResult } from "@/services/jobs/tailoringService";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { compileResumeComposition, createResumeCompositionCheckpoint, type CareerResumeWritingService } from "@/domain/resumeComposition";
import { classifyHermesRunFailure } from "@/agent/runtime/hermes/hermesRunReliability";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { CareerAdaptMcpBridgeClient } from "@/agent/mcp/CareerAdaptMcpBridgeClient";
import type { CareerToolResult } from "@/agent/tools/CareerToolGateway";

const JD = "公司：Core Test\n岗位：前端工程师\n工作地点：上海\n岗位职责\n1. 负责 React 应用开发。\n任职要求\n1. 熟悉 TypeScript 或 JavaScript。\n2. 具备团队协作能力。";
let db: CareerAdaptDb;
afterEach(async () => { vi.unstubAllGlobals(); db?.close(); if (db) await db.delete(); });
async function fixture() {
  db = new CareerAdaptDb(`Core51-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const profile = migrateCareerProfileToV2(demoCareerProfile);
  await repository.saveProfile(profile);
  await repository.setActiveProfileId(profile.id);
  const service = new BrowserAgentToolService(repository);
  const registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
  const context = { confirmed: true, confirmationCount: 1, userMessageId: "core-user", careerSessionBinding: {
    agentSessionId: "core-session", personId: profile.personId!, profileId: profile.id,
    profileVersionNumber: profile.profileVersionNumber ?? 1, profileRevision: profile.version
  } };
  return { repository, profile, service, registry, gateway, context };
}
describe("P5.1 Core production workflow boundaries", () => {
  it("accepts a confirmed JD receipt as the canonical ingest_job goal at Hermes terminal", async () => {
    const f = await fixture();
    const persistence = new AgentSessionStore(f.repository);
    const initial = await persistence.save(AgentRuntime.createConversationSession());
    const host = new AgentHostStore({ kernel: {} as never, repository: f.repository, persistence,
      executor: new CareerToolGatewayExecutor(f.registry, f.gateway) });
    host.adopt(initial);
    const prepared = await host.prepareRuntimeTask({ session: initial, userMessage: "保存这个岗位" });
    const shell = await host.beginRuntimeShell({ session: prepared, userMessage: "保存这个岗位", runtimeId: "hermes" });
    const result = await f.gateway.execute("career.workflow.job_intake", { rawText: JD, persistence: "save" }, {
      ...f.context, careerSessionBinding: { ...f.context.careerSessionBinding, agentSessionId: initial.id },
      operationId: "completed-job", userMessageId: shell.userMessageId
    });
    await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), toolName: "career.workflow.job_intake", operationId: "completed-job", data: { result } }, shell.assistantMessageId);
    const terminal = await host.applyRuntimeEvent({ type: "turn_completed", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), message: "Hermes 已收到岗位保存结果。" }, shell.assistantMessageId);
    expect(terminal?.taskState).toMatchObject({ rootGoal: "ingest_job", workflowId: "job_ingestion", completionStatus: "completed" });
    expect(terminal?.activeTurn?.status).toBe("completed");
    expect(terminal?.messages.find(message => message.id === shell.assistantMessageId)?.content).toContain("Hermes 已收到岗位保存结果。");
    expect(await f.repository.listJobDescriptions()).toHaveLength(1);
  });
  it.each(["accept", "reject", "stop", "expired"])("keeps the original MCP response pending until the scoped confirmation: %s", async (decision) => {
    const f = await fixture();
    const client = new CareerAdaptMcpBridgeClient();
    const responses: CareerToolResult[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.action === "result") responses.push(body.result);
      return Response.json({ ok: true, bridgeId: "core-bridge", token: "synthetic-token", requests: [] });
    }));
    let notify: () => void = () => undefined;
    const shown = new Promise<void>(resolve => { notify = resolve; });
    const context = { sessionId: "core-session", turnId: "core-turn", assistantMessageId: "core-assistant", userMessageId: "core-user" };
    const request = { id: "original-mcp-call", operationId: "pending-job", name: "career.workflow.job_intake",
      input: { rawText: JD, persistence: "save" }, careerSessionBinding: f.context.careerSessionBinding,
      sourceUserMessageId: "core-user", ...(decision === "expired" ? { expiresAt: Date.now() - 1 } : {}) };
    try {
      await client.start(f.gateway, undefined, () => { notify(); });
      await client.setConfirmationContext(context);
      const executing = (client as unknown as { execute(value: typeof request): Promise<void> }).execute(request);
      await shown;
      expect(responses).toHaveLength(0);
      expect(await f.repository.listJobDescriptions()).toHaveLength(0);
      expect(client.resolvePendingWrite("other-session", context.turnId, request.operationId, true)).toBe(false);
      if (decision === "stop") await client.stop();
      else if (decision === "expired") client.resolvePendingWrite(context.sessionId, context.turnId, request.operationId, true);
      else {
        expect(client.resolvePendingWrite(context.sessionId, context.turnId, request.operationId, decision !== "reject")).toBe(true);
        expect(client.resolvePendingWrite(context.sessionId, context.turnId, request.operationId, true)).toBe(false);
      }
      await executing;
      expect(await f.repository.listJobDescriptions()).toHaveLength(decision === "accept" ? 1 : 0);
      if (decision === "accept") expect(responses[0]).toMatchObject({ ok: true, data: { status: "completed" } });
      else expect(responses[0]).toMatchObject({ ok: false, error: { code: decision === "expired" ? "mcp_bridge_timeout"
        : decision === "stop" ? "mcp_bridge_tool_failed" : "user_confirmation_rejected" } });
    } finally { await client.stop(); }
  });
  it("strictly renders a confirmed Repository general branch", async () => {
    const f = await fixture();
    const source = await f.repository.ensureGeneralResumeFromProfile({ profileId: f.profile.id, operationId: "source", mode: "create_new" });
    expect(() => mapBranchToResumeRenderModel({ branch: source.branch, profile: f.profile })).not.toThrow();
  });
  it("keeps MCP failure distinct from Provider throttling, Companion failure and unknown errors", () => {
    expect(classifyHermesRunFailure({ code: "career_mcp_unreachable", failureLayer: "mcp" })).toMatchObject({ failureLayer: "mcp", safeErrorCategory: "mcp_connection" });
    expect(classifyHermesRunFailure({ code: "provider_http_429", failureLayer: "provider", httpStatus: 429 })).toMatchObject({ failureLayer: "provider", safeErrorCategory: "provider_rate_limit", httpStatus: 429 });
    expect(classifyHermesRunFailure({ code: "hermes_companion_unreachable", failureLayer: "companion" }).failureLayer).toBe("companion");
    expect(classifyHermesRunFailure({ code: "unclassified_error", message: "Provider 429 MCP key" }).safeErrorCategory).toBe("unknown");
  });

  it("captures the source revision before the AI writer runs", async () => {
    const f = await fixture();
    const source = await f.repository.ensureGeneralResumeFromProfile({ profileId: f.profile.id, operationId: "source", mode: "create_new" });
    const fallback = compileResumeComposition({ profile: f.profile, mode: "general" });
    const writer = { writeWithExecution: async () => {
      await f.repository.ensureGeneralResumeFromProfile({ profileId: f.profile.id, sourceResumeId: source.branch.id, operationId: "concurrent-edit", mode: "update_existing" });
      return { output: fallback.writingOutput, execution: fallback.writingExecution };
    } } as unknown as CareerResumeWritingService;
    const service = new BrowserAgentToolService(f.repository, undefined, writer);
    const proposal = await service.planResumeComposition({ profileId: f.profile.id, expectedProfileRevision: f.profile.version, mode: "general", sourceResumeId: source.branch.id });
    expect(proposal.checkpoint.sourceRevisionId).toBe(source.branch.currentRevisionId);
    expect((await f.repository.getResumeBranch(source.branch.id))?.currentRevisionId).not.toBe(proposal.checkpoint.sourceRevisionId);
  });

  it("rejects a composition checkpoint after the target Job version changes", async () => {
    const f = await fixture();
    await f.gateway.execute("career.workflow.job_intake", { rawText: JD, persistence: "save" }, { ...f.context, operationId: "job" });
    const job = (await f.repository.listJobDescriptions())[0];
    const source = await f.repository.ensureGeneralResumeFromProfile({ profileId: f.profile.id, operationId: "source", mode: "create_new" });
    const composition = compileResumeComposition({ profile: f.profile, job, mode: "job_specific", sourceResumeId: source.branch.id });
    const checkpoint = await f.repository.saveResumeCompositionCheckpoint(createResumeCompositionCheckpoint({ composition, jobRevision: job.updatedAt,
      source: (await f.repository.getResumeSourceFingerprint(source.branch.id))! }));
    await f.repository.saveJobDescription({ ...job, updatedAt: new Date(Date.parse(job.updatedAt) + 1_000).toISOString() });
    await expect(f.service.reviewResumeComposition({ profileId: f.profile.id, expectedProfileRevision: f.profile.version,
      mode: "job_specific", jobId: job.id, sourceResumeId: source.branch.id, checkpointId: checkpoint.checkpointId })).rejects.toMatchObject({ code: "resume_composition_job_stale" });
    expect(await f.repository.listResumeBranches()).toHaveLength(1);
  });
  it.each(["workflow", "conversation"])("projects one resumable Host confirmation from a %s session and saves without a second semantic Run", async (kind) => {
    const f = await fixture();
    const persistence = new AgentSessionStore(f.repository);
    const initial = await persistence.save(kind === "conversation"
      ? AgentRuntime.createConversationSession()
      : AgentRuntime.create("agent_quick_action", "collecting_intent"));
    const host = new AgentHostStore({ kernel: {} as never, repository: f.repository, persistence,
      executor: new CareerToolGatewayExecutor(f.registry, f.gateway) });
    host.adopt(initial);
    const prepared = await host.prepareRuntimeTask({ session: initial, userMessage: "保存这个岗位" });
    const shell = await host.beginRuntimeShell({ session: prepared, userMessage: "保存这个岗位", runtimeId: "hermes" });
    const pending = await f.gateway.execute("career.workflow.job_intake", { rawText: JD, persistence: "save" }, {
      agentSessionId: initial.id, userMessageId: shell.userMessageId,
      confirmed: false, confirmationCount: 0, operationId: "host-intake"
    });
    await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), toolName: "career.workflow.job_intake", operationId: "host-intake",
      data: { result: pending } }, shell.assistantMessageId);
    const projected = await host.applyRuntimeEvent({ type: "approval_required", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), toolName: "career.workflow.job_intake", operationId: "confirm-host-intake",
      data: { contract: { sourceToolName: "career.workflow.job_intake" }, input: { rawText: JD, persistence: "save" } }
    }, shell.assistantMessageId);
    expect(projected?.pendingToolCall).toMatchObject({ toolName: "career.workflow.job_intake", input: { rawText: JD } });
    expect(host.getSnapshot().turnStatus).toBe("waiting_for_confirmation");
    expect(projected?.activeTurn?.status).toBe("waiting_for_confirmation");
    expect(await f.repository.listJobDescriptions()).toHaveLength(0);
    await host.applyRuntimeEvent({ type: "turn_completed", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), message: "岗位解析已完成，请核对后保存。" }, shell.assistantMessageId);
    const result = await host.resolveConfirmation(true, { route: "/ai-workspace", query: {} }, projected);
    expect(result?.taskState, JSON.stringify(result?.messages.at(-1))).toMatchObject({ workflowId: "job_ingestion", stage: "completed", completionStatus: "completed" });
    expect(await f.repository.listJobDescriptions()).toHaveLength(1);
    expect(result?.pendingConfirmation).toBeUndefined();
  });

  it("returns each requirement's real evidence, provenance and confirmation state through the Facade", async () => {
    const f = await fixture();
    await f.gateway.execute("career.workflow.job_intake", { rawText: JD, persistence: "save" }, { ...f.context, operationId: "job" });
    const job = (await f.repository.listJobDescriptions())[0];
    const source = await f.repository.ensureGeneralResumeFromProfile({ profileId: f.profile.id, operationId: "general", mode: "create_new" });
    const profileBefore = await f.repository.getProfile(f.profile.id);
    const result = await f.gateway.execute<{ workflowCheckpoint: { result: { analysis: TailoringServiceResult } } }>("career.workflow.job_fit", {
      profileId: f.profile.id, resumeId: source.branch.id, jobId: job.id
    }, { ...f.context, operationId: "fit" });
    const mapping = result.data!.workflowCheckpoint.result.analysis.evidenceMapping!;
    expect(mapping.evaluations.map(item => item.requirementId)).toEqual(mapping.requirements.map(item => item.id));
    expect(mapping.evidenceUnits.length).toBeGreaterThan(0);
    expect(mapping.evidenceUnits.every(unit => unit.confirmed && (unit.factRefs.length > 0 || unit.supportLevel === "user_declared"))).toBe(true);
    expect(mapping.resumeEvidenceGraph.nodes.length).toBeGreaterThan(0);
    expect(await f.repository.getProfile(f.profile.id)).toEqual(profileBefore);
  });
  it("analyzes without any persistence and keeps unknown identity explicit", async () => {
    const f = await fixture();
    const result = await f.gateway.execute("career.workflow.job_intake", {
      rawText: "任职要求\n1. 熟悉 TypeScript 或 JavaScript。\n2. 具备团队协作能力。", persistence: "analyze_only"
    }, { ...f.context, operationId: "analyze" });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ status: "completed", workflowCheckpoint: { identity: { title: "unknown", company: "unknown" } } });
    expect(await f.repository.listJobDescriptions()).toHaveLength(0);
    expect(await f.repository.listJobListings()).toHaveLength(0);
    expect(await db.jobAnalysisDrafts.count()).toBe(0);
    expect(await db.rawInputs.count()).toBe(0);
  });

  it("reuses a person-independent JD parse after confirmation adds the resolved session binding", async () => {
    const f = await fixture();
    const parse = vi.spyOn(f.service, "parseJobDescription");
    const operationId = "binding-added-after-confirmation";
    const input = { rawText: JD, persistence: "save" };
    const first = await f.gateway.execute("career.workflow.job_intake", input, { agentSessionId: "core-session", operationId, userMessageId: "same-user" });
    expect(first.ok).toBe(false);
    const confirmed = await f.gateway.execute("career.workflow.job_intake", input, { ...f.context, operationId, userMessageId: "same-user" });
    expect(confirmed.ok, JSON.stringify(confirmed.error)).toBe(true);
    expect(confirmed.data).toMatchObject({ status: "completed" });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(await f.repository.listJobDescriptions()).toHaveLength(1);
  });

  it("saves idempotently, versions a changed JD under the same Job, and keeps raw sources", async () => {
    const f = await fixture();
    const before = await f.repository.getProfile(f.profile.id);
    const call = (rawText: string, operationId: string) => f.gateway.execute("career.workflow.job_intake", {
      rawText, persistence: "save", sourceUrl: "https://example.org/jobs/core"
    }, { ...f.context, operationId });
    const first = await call(JD, "save-1");
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    expect(first.data).toMatchObject({ status: "completed", workflowCheckpoint: { jobId: expect.any(String), jobRevision: expect.any(String) } });
    const saved = (await f.repository.listJobDescriptions())[0];
    expect(saved.location).toBe("上海");
    const repeat = await call(JD, "save-repeat");
    expect(repeat.data).toMatchObject({ workflowCheckpoint: { jobId: saved.id, idempotent: true } });
    const nextJd = JD.replace("团队协作能力", "团队协作及测试能力");
    const next = await call(nextJd, "save-2");
    expect(next.data, JSON.stringify(next.error)).toMatchObject({ status: "completed", workflowCheckpoint: { jobId: saved.id } });
    expect(await f.repository.listJobDescriptions()).toHaveLength(1);
    expect((await f.repository.getJobDescription(saved.id))?.rawText).toBe(nextJd);
    const listing = (await f.repository.listJobListings())[0];
    expect(listing.canonicalSourceUrl).toBe("https://example.org/jobs/core");
    const snapshots = await f.repository.listJobSnapshots(listing.id);
    expect(snapshots.map(snapshot => snapshot.rawText).sort()).toEqual([JD, nextJd].sort());
    expect(snapshots.map(snapshot => snapshot.version).sort()).toEqual([1, 2]);
    expect(await db.jobAnalysisDrafts.count()).toBe(2);
    expect(await f.repository.getProfile(f.profile.id)).toEqual(before);
    expect(JSON.stringify(next.data)).not.toContain(nextJd);
  });

  it("does not save without Host confirmation; failed or cancelled conversion rolls back ingestion", async () => {
    const f = await fixture();
    const waiting = await f.gateway.execute("career.workflow.job_intake", { rawText: JD, persistence: "save" }, {
      ...f.context, confirmed: false, confirmationCount: 0, operationId: "unconfirmed"
    });
    expect(waiting.data).toMatchObject({ status: "waiting_for_confirmation" });
    expect(await f.repository.listJobListings()).toHaveLength(0);
    const abort = new AbortController();
    const original = f.repository.saveJobAnalysisDraftRevision.bind(f.repository);
    vi.spyOn(f.repository, "saveJobAnalysisDraftRevision").mockImplementation(async (...args) => {
      const result = await original(...args); abort.abort(); return result;
    });
    const result = await f.gateway.execute("career.workflow.job_intake", { rawText: JD, persistence: "save" }, {
      ...f.context, signal: abort.signal, operationId: "cancelled"
    });
    expect(result.data).toMatchObject({ safeError: { code: expect.any(String) } });
    expect(await f.repository.listJobListings()).toHaveLength(0);
    expect(await db.jobSnapshots.count()).toBe(0);
    expect(await db.jobAnalysisDrafts.count()).toBe(0);
    expect(await db.rawInputs.count()).toBe(0);
    expect(await f.repository.listJobDescriptions()).toHaveLength(0);
  });

  it("rejects a stale general proposal at the Repository boundary and preserves both branches", async () => {
    const f = await fixture();
    const a = await f.repository.ensureGeneralResumeFromProfile({ profileId: f.profile.id, operationId: "a", mode: "create_new" });
    const b = await f.repository.ensureGeneralResumeFromProfile({ profileId: f.profile.id, operationId: "b", mode: "create_new" });
    const composition = compileResumeComposition({ profile: f.profile, mode: "general", sourceResumeId: a.branch.id });
    await f.repository.ensureGeneralResumeFromProfile({ profileId: f.profile.id, operationId: "edit-a", mode: "update_existing", sourceResumeId: a.branch.id });
    const before = await f.repository.listResumeBranches();
    await expect(f.repository.ensureGeneralResumeFromProfile({
      profileId: f.profile.id, operationId: "stale", mode: "update_existing", composition,
      sourceResumeId: a.branch.id, expectedSourceRevisionId: a.branch.currentRevisionId!
    })).rejects.toThrow();
    expect(await f.repository.listResumeBranches()).toEqual(before);
    expect(await f.repository.getResumeBranch(b.branch.id)).toEqual(b.branch);
  });

  it("Scenario C: switching Job regenerates the real EvidenceMatrix and rejects the unchanged old proposal", async () => {
    const f = await fixture();
    await f.gateway.execute("career.workflow.job_intake", { rawText: JD, persistence: "save" }, { ...f.context, operationId: "job-A" });
    const jobA = (await f.repository.listJobDescriptions())[0];
    await f.gateway.execute("career.workflow.job_intake", { rawText: JD.replace("前端工程师", "数据分析师").replace("React 应用开发", "SQL 数据分析"), persistence: "save" }, { ...f.context, operationId: "job-B" });
    const jobB = (await f.repository.listJobDescriptions()).find(job => job.id !== jobA.id)!;
    const source = (await f.repository.ensureGeneralResumeFromProfile({ profileId: f.profile.id, operationId: "switch-source", mode: "create_new" })).branch;
    const a = (await f.service.createTailoringSession({ profileId: f.profile.id, resumeId: source.id, jobId: jobA.id }, "proposal-A")).session;
    const oldSnapshot = structuredClone(a);
    const task = AgentTaskStateSchema.parse({ rootGoal: "tailor_existing_resume", activeGoal: "tailor_existing_resume", workflowId: "tailor_existing_resume",
      stage: "preview_changes", updatedAt: new Date().toISOString(), selectedEntities: { profileId: f.profile.id, sourceResumeId: source.id, jobId: jobB.id },
      knownSlots: { tailoringSession: a } });
    const call = vi.fn();
    const rejected = await executeCareerWorkflowFacade("career.workflow.tailor_resume", { checkpointId: a.id },
      { ...f.context, authoritativeTaskState: task }, "wrong-target-attempt", call);
    expect(rejected.data).toMatchObject({ status: "failed", safeError: { code: "tailoring_checkpoint_target_mismatch" } });
    expect(call).not.toHaveBeenCalled();
    const b = (await f.service.createTailoringSession({ profileId: f.profile.id, resumeId: source.id, jobId: jobB.id }, "proposal-B")).session;
    expect(b.candidateEvidenceMatrix!.binding.jobId).toBe(jobB.id);
    expect(a.candidateEvidenceMatrix!.binding.jobId).toBe(jobA.id);
    expect(b.candidateEvidenceMatrix!.analysisId).not.toBe(a.candidateEvidenceMatrix!.analysisId);
    expect(a).toEqual(oldSnapshot);
    expect(await f.repository.getJobDescription(jobA.id)).toEqual(jobA);
    expect(await f.repository.getResumeBranch(source.id)).toEqual(source);
    expect(await f.repository.listResumeBranches()).toHaveLength(1);
  });

  it("inherits the selected source template, typography, and section order in Profile-to-Job composition", async () => {
    const f = await fixture();
    await f.gateway.execute("career.workflow.job_intake", { rawText: JD, persistence: "save" }, { ...f.context, operationId: "job" });
    const job = (await f.repository.listJobDescriptions())[0];
    const general = await f.repository.ensureGeneralResumeFromProfile({ profileId: f.profile.id, operationId: "source", mode: "create_new" });
    const source = general.branch;
    const initial = await f.repository.getResumePresentationConfig(source.id);
    const custom = { ...initial, presentationRevision: initial.presentationRevision + 1, templateId: "modern-operations" as const,
      canonicalSectionOrder: ["skills", "project", "education"] as typeof initial.canonicalSectionOrder,
      typography: { ...initial.typography, bodyTextScale: "small" as const } };
    await f.repository.saveResumePresentationConfig({ branchId: source.id, expectedBranchRevision: source.revision,
      expectedRevisionId: source.currentRevisionId!, expectedPresentationRevision: initial.presentationRevision,
      operationId: "style", nextConfig: custom });
    const sourceConfig = await f.repository.getResumePresentationConfig(source.id);
    const fingerprint = await f.repository.getResumeSourceFingerprint(source.id);
    const created = await f.repository.createJobSpecificBranchFromProfile({ profileId: f.profile.id, jobId: job.id,
      operationId: "job-branch", name: "Core targeted", selectedCanonicalItemIds: f.profile.structuredFacts!.map(entry => entry.data.id),
      requirementMatchIds: [], sourceResumeId: source.id, expectedSourceRevisionId: source.currentRevisionId!,
      expectedSourceContentHash: fingerprint!.contentHash, expectedSourcePresentationHash: fingerprint!.presentationHash });
    const target = await f.repository.getResumePresentationConfig(created.branch.id);
    expect(target).toMatchObject({ templateId: sourceConfig.templateId, typography: sourceConfig.typography, canonicalSectionOrder: sourceConfig.canonicalSectionOrder });
    expect(await f.repository.getResumeBranch(source.id)).toEqual(source);
    expect(await f.repository.getResumePresentationConfig(source.id)).toEqual(sourceConfig);
    expect(created.branch).toMatchObject({ jobId: job.id, sourceJobVersion: job.updatedAt, sourceBranchId: source.id, sourceRevisionId: source.currentRevisionId });
  });
});
