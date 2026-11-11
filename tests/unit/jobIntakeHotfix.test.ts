import { buildQuickActionContextSnapshot } from "@/agent/workflows/QuickActionContextSnapshot";
import { JOB_INTAKE_INCIDENT_JD } from "../fixtures/jobIntakeIncident";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { afterEach, expect, it, vi } from "vitest";
import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerToolGateway, CareerToolGatewayExecutor } from "@/agent/tools/CareerToolGateway";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";

// Synthetic regression fixture; the incident's complete original JD was not supplied.
const JD = "  岗位：AI大模型与AI算法应用开发\n招聘批次：2027届校招\n投递时间：2026年11月1日至12月31日\n岗位职责\n1. 负责大模型应用开发和算法落地。\n2. 参与模型评测与部署。\n任职要求\n1. 2027届本科及以上学历，计算机或数学相关专业。\n2. 熟悉 Python、C++、Java 等至少一种编程语言。\n3. 掌握大模型原理或 AI 算法原理。\n4. 具备沟通和团队协作能力。\n优先条件\n1. 有模型部署经验者优先。\n";
let db: CareerAdaptDb;
afterEach(async () => { vi.restoreAllMocks(); db?.close(); if (db) await db.delete(); });
async function fixture() {
  db = new CareerAdaptDb(`JobHotfix-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const profile = migrateCareerProfileToV2(demoCareerProfile);
  await repository.saveProfile(profile);
  await repository.setActiveProfileId(profile.id);
  const service = new BrowserAgentToolService(repository);
  const registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
  const context = { agentSessionId: "hotfix-session", userMessageId: "user-1", sourceUserMessageId: "user-1",
    logicalTurnId: "turn-1", sourceUserMessage: "先保存岗位。", careerSessionBinding: {
      agentSessionId: "hotfix-session", personId: profile.personId!, profileId: profile.id,
      profileVersionNumber: profile.profileVersionNumber ?? 1, profileRevision: profile.version
    } };
  const save = (operationId = "save-1", rawText = JD) => gateway.execute("career.workflow.job_intake", { rawText, persistence: "save" }, { ...context, operationId });
  return { repository, service, registry, gateway, context, save };
}
function task(checkpoint: unknown) {
  const cp = checkpoint as Record<string, unknown>;
  return AgentTaskStateSchema.parse({ rootGoal: "ingest_job", workflowId: "job_ingestion", stage: "completed",
    selectedEntities: { jobId: cp.jobId }, knownSlots: { facadeCheckpoint: cp }, updatedAt: new Date().toISOString() });
}
it("J1/J7 saves unknown company through the real candidate/Repository chain with exact raw text and no repeated confirmation", async () => {
  const f = await fixture();
  const result = await f.save();
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  const cp = (result.data as { workflowCheckpoint: Record<string, unknown> }).workflowCheckpoint;
  expect(cp).toMatchObject({ businessStatus: "committed", persistenceVerified: true, health: "WORKABLE" });
  const job = await f.repository.getJobDescription(String(cp.jobId));
  expect(job).toMatchObject({ company: null, rawText: JD, identityEvidence: { company: { source: "missing", confirmed: false } } });
  expect(job!.requirements.length).toBeGreaterThan(0);
  expect(await f.repository.listJobDescriptions()).toHaveLength(1);
  const replay = await f.save();
  expect((replay.data as typeof result.data)).toMatchObject({ workflowCheckpoint: { jobId: cp.jobId, persistenceVerified: true } });
  expect(await f.repository.listJobDescriptions()).toHaveLength(1);
});
it("J2 follows the persisted task to update the same Job, preserving raw JD and every requirement", async () => {
  const f = await fixture();
  const first = await f.save();
  const cp = (first.data as { workflowCheckpoint: Record<string, unknown> }).workflowCheckpoint;
  const before = await f.repository.getJobDescription(String(cp.jobId));
  const update = () => f.gateway.execute("career.workflow.job_intake", { company: "华为", persistence: "save" }, {
    ...f.context, operationId: "company-1", userMessageId: "user-2", sourceUserMessage: "公司是华为。", authoritativeTaskState: task(cp)
  });
  const result = await update();
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  expect(result.data).toMatchObject({ status: "completed", workflowCheckpoint: { jobId: cp.jobId, persistenceVerified: true } });
  const after = await f.repository.getJobDescription(String(cp.jobId));
  expect(after).toMatchObject({ company: "华为", rawText: before!.rawText, requirements: before!.requirements,
    requirementGraph: before!.requirementGraph, identityEvidence: { company: { source: "user", quote: "华为", confirmed: true } } });
  expect(after!.id).toBe(before!.id);
  await update();
  expect(await f.repository.listJobDescriptions()).toHaveLength(1);
  expect((await f.repository.getJobDescription(before!.id))!.updatedAt).toBe(after!.updatedAt);
  const freshRepository = new WorkspaceRepository(db);
  expect(await freshRepository.getJobDescription(before!.id)).toEqual(after);
});
it("J3 saves an explicit company and keeps Profile and resume tables unchanged", async () => {
  const f = await fixture();
  const before = await db.profiles.toArray();
  const result = await f.save("known-company", `公司：华为\n${JD}`);
  expect(result.ok).toBe(true);
  expect((await f.repository.listJobDescriptions())[0].company).toBe("华为");
  expect(await db.profiles.toArray()).toEqual(before);
  expect(await db.resumeBranches.count()).toBe(0);
  expect(await db.resumeRevisions.count()).toBe(0);
});
it("J4 rejects an execution-completed receipt without independent persistence observations", async () => {
  const f = await fixture();
  const parsed = await f.service.parseJobDescription({ rawText: JD }, "parse-hotfix");
  const result = await executeCareerWorkflowFacade("career.workflow.job_intake", { rawText: JD, persistence: "save" },
    { ...f.context, confirmed: true }, "unproven", async name => ({ ok: true, artifacts: [],
      data: name === "career.job.parse" ? parsed : name === "career.job.commit" ? { jobId: "invented" } : {},
      receipt: { operationId: name, toolName: name, status: "completed", completedAt: new Date().toISOString() } }));
  expect(result.data.status).not.toBe("completed");
  expect(result.data.workflowCheckpoint).not.toHaveProperty("jobId");
  expect(result.data.safeError?.code).toBe("job_persistence_unverified");
  expect(await f.repository.listJobDescriptions()).toHaveLength(0);
});
it("J4 confirmation preserves the draft checkpoint and cannot claim a committed Job", async () => {
  const f = await fixture();
  const result = await f.gateway.execute("career.workflow.job_intake", { rawText: JD, persistence: "save" }, {
    ...f.context, sourceUserMessage: "分析一下这份岗位", operationId: "confirmation"
  });
  expect(result.receipt.status).toBe("confirmation_required");
  expect(result.data).toMatchObject({ status: "waiting_for_confirmation", workflowCheckpoint: { input: { rawText: JD } } });
  expect(await f.repository.listJobDescriptions()).toHaveLength(0);
});
it("J4 a lost response after persistence recovers by the existing candidate identity without duplicates", async () => {
  const f = await fixture();
  const readList = f.repository.listJobDescriptions.bind(f.repository);
  let responseLost = false;
  vi.spyOn(f.repository, "listJobDescriptions").mockImplementation(async () => {
    const jobs = await readList();
    if (jobs.length && !responseLost) { responseLost = true; throw new Error("read_timeout"); }
    return jobs;
  });
  const failed = await f.save();
  expect(failed.ok).toBe(false);
  expect(await db.jobDescriptions.count()).toBe(1);
  const recovered = await f.save();
  expect(recovered.ok, JSON.stringify(recovered.error)).toBe(true);
  expect(await db.jobDescriptions.count()).toBe(1);
});
it("J4 company update is atomic, rejects stale versions, and recovers its operation receipt", async () => {
  const f = await fixture();
  await f.save();
  const before = (await f.repository.listJobDescriptions())[0];
  const input = { jobId: before.id, company: "华为", expectedRevision: before.updatedAt, operationId: "atomic-update", userMessageId: "user-2" };
  const fail = () => { throw new Error("storage_failure"); };
  db.jobListings.hook("updating", fail);
  await expect(f.repository.completeJobCompany(input)).rejects.toThrow("storage_failure");
  db.jobListings.hook("updating").unsubscribe(fail);
  expect(await f.repository.getJobDescription(before.id)).toEqual(before);
  expect(await db.appMeta.get(`job-intake-company:${input.operationId}`)).toBeUndefined();
  const first = await f.repository.completeJobCompany(input);
  expect((await f.repository.completeJobCompany(input)).jobDescription).toEqual(first.jobDescription);
  await expect(f.repository.completeJobCompany({ ...input, operationId: "stale", company: "另一家公司" })).rejects.toThrow("revision_conflict");
});
it("J4 Host persists the real source/checkpoint and does not accept model-only success", async () => {
  const f = await fixture();
  const persistence = new AgentSessionStore(f.repository);
  const initial = await persistence.save(AgentRuntime.createConversationSession());
  const host = new AgentHostStore({ repository: f.repository, persistence, executor: new CareerToolGatewayExecutor(f.registry, f.gateway) });
  host.adopt(initial);
  const shell = await host.beginRuntimeShell({ session: initial, userMessage: JD, runtimeId: "hermes" });
  const result = await f.gateway.execute("career.workflow.job_intake", { rawText: JD, persistence: "save" }, {
    ...f.context, sourceUserMessage: "分析岗位", operationId: "host-pending" });
  await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: initial.id, turnId: shell.turnId,
    timestamp: new Date().toISOString(), toolName: "career.workflow.job_intake", operationId: "host-pending", data: { result } }, shell.assistantMessageId);
  const terminal = await host.applyRuntimeEvent({ type: "turn_completed", sessionId: initial.id, turnId: shell.turnId,
    timestamp: new Date().toISOString(), message: "岗位已保存成功" }, shell.assistantMessageId);
  expect(terminal!.taskState!.knownSlots.rawText).toBe(JD);
  expect(terminal!.taskState!.stage).not.toBe("collect_job_description");
  expect(terminal!.messages.find(m => m.id === shell.assistantMessageId)!.content).not.toBe("岗位已保存成功");
  expect(await f.repository.listJobDescriptions()).toHaveLength(0);
});

it("J5 original incident JD preserves three duties, three requirements, graduation, deadline and language alternatives", async () => {
  const { graph } = analyzeJobDescriptionV4({ rawText: JOB_INTAKE_INCIDENT_JD });
  const duties = graph.requirements.filter(node => node.section === "responsibility");
  expect(duties).toHaveLength(3);
  expect(duties.map(node => node.statement).join(" ")).toContain("RAG检索");
  const language = graph.requirements.find(node => node.statement.includes("至少一种编程语言"))!;
  expect(language.keywordLogic).toEqual({ relation: "any_of", terms: expect.arrayContaining(["Python", "C++", "Java"]) });
  expect(language.keywordLogic!.terms).toHaveLength(3);
  expect(graph.requirements.some(node => node.statement.includes("2027届"))).toBe(true);
  expect(graph.semanticUnits.find(unit => unit.text.startsWith("投递时间"))?.final?.disposition).toBe("metadata");
  expect(graph.requirements.some(node => node.statement.includes("投递时间"))).toBe(false);
  const compound = graph.requirements.find(node => node.statement.includes("掌握大模型原理"))!;
  expect(compound.statement).toContain("或AI算法原理");
  expect(compound.keywordLogic).toBeUndefined();
  expect(compound.hardConstraint).toBe(false);
  expect(graph.needsReview).toBe(true);
  expect(graph.issues.some(issue => issue.message.includes("复合 AND / OR"))).toBe(true);
  for (const node of graph.requirements) expect(JOB_INTAKE_INCIDENT_JD.slice(node.sourceSpan.start, node.sourceSpan.end)).toBe(node.sourceSpan.text);
  for (const unit of graph.semanticUnits) expect(JOB_INTAKE_INCIDENT_JD.slice(unit.sourceSpan.start, unit.sourceSpan.end)).toBe(unit.sourceSpan.text);
  const f = await fixture();
  const saved = await f.save("incident-save", JOB_INTAKE_INCIDENT_JD);
  expect(saved.ok, JSON.stringify(saved.error)).toBe(true);
  const job = (await f.repository.listJobDescriptions())[0];
  expect(job.rawText).toBe(JOB_INTAKE_INCIDENT_JD);
  expect(job.company).toBeNull();
  expect(job.identityEvidence?.title.source).toBe("missing");
  expect(job.requirementGraph!.requirements.filter(node => node.section === "responsibility")).toHaveLength(3);
});

it("J7 repeating the complete original JD after company completion preserves the listing and original Job", async () => {
  const f = await fixture(); await f.save();
  const before = (await f.repository.listJobDescriptions())[0];
  await f.repository.completeJobCompany({ jobId: before.id, company: "华为", expectedRevision: before.updatedAt, operationId: "full-text-completion", userMessageId: "u2" });
  const listingBefore = await db.jobListings.toArray();
  const repeated = await f.save("full-text-repeat");
  expect(repeated.ok, JSON.stringify(repeated.error)).toBe(true);
  expect(await db.jobListings.toArray()).toEqual(listingBefore);
  expect(await f.repository.listJobDescriptions()).toHaveLength(1);
  expect((await f.repository.getJobDescription(before.id))!.company).toBe("华为");
});
it("J4 failed creation rolls back formal writes and retains the source for explicit retry", async () => {
  const f = await fixture();
  const fail = () => { throw new Error("repository_unavailable"); };
  db.jobDescriptions.hook("creating", fail);
  const result = await f.save("create-failure");
  db.jobDescriptions.hook("creating").unsubscribe(fail);
  expect(result.ok).toBe(false);
  expect(result.data).toMatchObject({ workflowCheckpoint: { input: { rawText: JD } } });
  expect(await db.jobDescriptions.count()).toBe(0);
  const retry = await f.gateway.execute("career.workflow.job_intake", { persistence: "save" }, {
    ...f.context, operationId: "create-failure", retryFailedOperation: true,
    authoritativeTaskState: task((result.data as { workflowCheckpoint: unknown }).workflowCheckpoint)
  });
  expect(retry.ok, JSON.stringify(retry.error)).toBe(true);
  expect(await db.jobDescriptions.count()).toBe(1);
});
it("analyze-only bound company changes never write; conflicting saved company still needs confirmation", async () => {
  const f = await fixture(); const first = await f.save("company-known", `公司：原公司\n${JD}`);
  const cp = (first.data as { workflowCheckpoint: Record<string, unknown> }).workflowCheckpoint;
  const before = await f.repository.listJobDescriptions();
  const context = { ...f.context, authoritativeTaskState: task(cp), sourceUserMessage: "公司是华为。" };
  const readOnly = await f.gateway.execute("career.workflow.job_intake", { company: "华为", persistence: "analyze_only" }, { ...context, operationId: "read-only-company" });
  expect(readOnly.ok).toBe(true);
  expect(await f.repository.listJobDescriptions()).toEqual(before);
  const conflict = await f.gateway.execute("career.workflow.job_intake", { company: "华为", persistence: "save" }, { ...context, operationId: "conflict-company" });
  expect(conflict.receipt.status).toBe("confirmation_required");
  expect(await f.repository.listJobDescriptions()).toEqual(before);
});
it("does not invent a company or guess a Job from an unbound follow-up", async () => {
  const f = await fixture();
  const invented = await f.gateway.execute("career.workflow.job_intake", { rawText: JD, company: "虚构企业", persistence: "save" }, { ...f.context, operationId: "invented-company" });
  expect(invented.ok).toBe(false);
  expect(invented.error?.message).not.toMatch(/job_identity_source_missing/);
  const unbound = await f.gateway.execute("career.workflow.job_intake", { company: "华为", persistence: "save" }, { ...f.context, sourceUserMessage: "公司是华为。", operationId: "unbound-company" });
  expect(unbound.ok).toBe(false);
  expect(await db.jobDescriptions.count()).toBe(0);
});
it("different unknown-company JDs with the same title keep separate content identities", async () => {
  const f = await fixture();
  await f.save();
  const second = await f.save("second-unknown", JD.replace("模型评测与部署", "图像识别模型训练与评测"));
  expect(second.ok, JSON.stringify(second.error)).toBe(true);
  expect(await db.jobDescriptions.count()).toBe(2);
});
it("J2/J7 restores the actual Host task and binds a later company turn to the same persisted Job", async () => {
  const f = await fixture(); const persistence = new AgentSessionStore(f.repository);
  const initial = await persistence.save(AgentRuntime.createConversationSession());
  const host = new AgentHostStore({ repository: f.repository, persistence, executor: new CareerToolGatewayExecutor(f.registry, f.gateway) });
  host.adopt(initial);
  const run = async (text: string, input: Record<string, unknown>, operationId: string) => {
    const current = host.getSnapshot().activeSession!;
    const prepared = await host.prepareRuntimeTask({ session: current, userMessage: text });
    const shell = await host.beginRuntimeShell({ session: prepared, userMessage: text, runtimeId: "hermes" });
    const result = await f.gateway.execute("career.workflow.job_intake", input, { ...f.context, operationId,
      authoritativeTaskState: shell.session.taskState, sourceUserMessage: text, userMessageId: shell.userMessageId,
      careerSessionBinding: { ...f.context.careerSessionBinding, agentSessionId: initial.id } });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), toolName: "career.workflow.job_intake", operationId, data: { result } }, shell.assistantMessageId);
    return host.applyRuntimeEvent({ type: "turn_completed", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), message: "岗位已保存。" }, shell.assistantMessageId);
  };
  const first = await run(`先保存岗位。\n${JD}`, { rawText: JD, persistence: "save" }, "host-save-job");
  const id = first!.taskState!.selectedEntities.jobId;
  host.adopt((await persistence.get(initial.id))!);
  const second = await run("公司是华为。", { company: "华为", persistence: "save" }, "host-company-job");
  expect(second!.taskState!.selectedEntities.jobId).toBe(id);
  expect(second!.taskState!.knownSlots.company).toBe("华为");
  expect(second!.taskState!.knownSlots.rawText).toBe(JD);
  expect(second!.taskState!.knownSlots.jobPersistenceVerified).toBe(true);
  expect(second!.taskState!.stage).toBe("completed");
  expect((await f.repository.getJobDescription(id!))!.company).toBe("华为");
  expect(await db.jobDescriptions.count()).toBe(1);
});

it("a company-only user turn overrides model repetition of the old JD and updates the bound Job", async () => {
  const f = await fixture(); const first = await f.save();
  const cp = (first.data as { workflowCheckpoint: Record<string, unknown> }).workflowCheckpoint;
  const updated = await f.gateway.execute("career.workflow.job_intake", { rawText: JD, company: "华为", persistence: "save" }, {
    ...f.context, sourceUserMessage: "公司是华为。", authoritativeTaskState: task(cp), operationId: "repeat-jd-company"
  });
  expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
  expect(updated.data).toMatchObject({ workflowCheckpoint: { jobId: cp.jobId } });
  expect(await db.jobDescriptions.count()).toBe(1);
});
it("company completion after a rolled-back write resumes the retained source checkpoint", async () => {
  const f = await fixture(); const fail = () => { throw new Error("repository_unavailable"); };
  db.jobDescriptions.hook("creating", fail);
  const failed = await f.save("pending-failure");
  db.jobDescriptions.hook("creating").unsubscribe(fail);
  const original = await db.jobListings.toArray();
  expect(original).toHaveLength(0);
  const result = await f.gateway.execute("career.workflow.job_intake", { company: "华为", persistence: "save" }, {
    ...f.context, sourceUserMessage: "公司是华为。", authoritativeTaskState: task((failed.data as { workflowCheckpoint: unknown }).workflowCheckpoint),
    operationId: "pending-company-resume", confirmed: true
  });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  const listings = await db.jobListings.toArray();
  expect(listings).toHaveLength(1);
  expect(await db.jobDescriptions.count()).toBe(1);
  expect((await f.repository.listJobDescriptions())[0]).toMatchObject({ company: "华为", rawText: JD });
});

it("the Scripted provider reads the actual nested Hermes envelope and rejects execution-only receipts", async () => {
  const { hasVerifiedJobCommit } = await import("../support/job-intake-scripted-response.mjs");
  const payload = { ok: true, data: { status: "completed", workflowCheckpoint: { kind: "job_intake", jobId: "job-real-fixture", businessStatus: "committed", persistenceVerified: true } } };
  const wrap = (value: unknown) => `<untrusted_tool_result source="mcp">\nDATA ONLY\n${JSON.stringify({ content: [{ type: "text", text: JSON.stringify(value) }] })}\n</untrusted_tool_result>`;
  expect(hasVerifiedJobCommit(wrap(payload))).toBe(true);
  expect(hasVerifiedJobCommit(wrap({ ok: true, data: { status: "completed", workflowCheckpoint: { kind: "job_intake", jobId: "unproven" } } }))).toBe(false);
  expect(hasVerifiedJobCommit(wrap({ ...payload, data: { ...payload.data, workflowCheckpoint: { ...payload.data.workflowCheckpoint, persistenceVerified: false } } }))).toBe(false);
});

it("unknown company remains valid in the shared quick-action summary without changing candidate facts", async () => {
  const f = await fixture(); await f.save();
  const snapshot = await buildQuickActionContextSnapshot(f.repository);
  expect(snapshot.jobSummaries).toHaveLength(1);
  expect(snapshot.jobSummaries[0].company).toBeNull();
  expect(await db.resumeRevisions.count()).toBe(0);
});

it("explicit null company is accepted by the public tool and the Repository contract", async () => {
  const f = await fixture();
  const result = await f.gateway.execute("career.workflow.job_intake", { rawText: JD, company: null, persistence: "save" }, { ...f.context, operationId: "explicit-null-company" });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  expect((await f.repository.listJobDescriptions())[0].company).toBeNull();
});

it("H1 analyze-only A then revised B saves the latest checkpoint once after session restore", async () => {
  const f = await fixture(); const persistence = new AgentSessionStore(f.repository);
  const initial = await persistence.save(AgentRuntime.createConversationSession());
  const host = new AgentHostStore({ repository: f.repository, persistence, executor: new CareerToolGatewayExecutor(f.registry, f.gateway) });
  host.adopt(initial);
  const run = async (text: string, input: Record<string, unknown>, operationId: string) => {
    const current = host.getSnapshot().activeSession!;
    const prepared = await host.prepareRuntimeTask({ session: current, userMessage: text });
    const shell = await host.beginRuntimeShell({ session: prepared, userMessage: text, runtimeId: "hermes" });
    const result = await f.gateway.execute("career.workflow.job_intake", input, { ...f.context, operationId,
      authoritativeTaskState: shell.session.taskState, sourceUserMessage: text, userMessageId: shell.userMessageId,
      careerSessionBinding: { ...f.context.careerSessionBinding, agentSessionId: initial.id } });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), toolName: "career.workflow.job_intake", operationId, data: { result } }, shell.assistantMessageId);
    return host.applyRuntimeEvent({ type: "turn_completed", sessionId: initial.id, turnId: shell.turnId,
      timestamp: new Date().toISOString(), message: "当前步骤已处理。" }, shell.assistantMessageId);
  };
  await run(`分析JD：${JD}`, { rawText: JD, persistence: "analyze_only" }, "h1-analyze-a");
  expect(await f.repository.listJobDescriptions()).toHaveLength(0);
  const revised = JD.replace("模型评测与部署", "模型评测与测试");
  await run(`分析JD：${revised}`, { rawText: revised, persistence: "analyze_only" }, "h1-analyze-b");
  host.adopt((await persistence.get(initial.id))!);
  const saved = await run("先保存该岗位，再进行岗位匹配分析", { persistence: "save" }, "h1-save-b");
  const id = saved!.taskState!.selectedEntities.jobId!;
  expect((await f.repository.getJobDescription(id))!.rawText).toBe(revised);
  await run("保存该岗位", { persistence: "save" }, "h1-repeat-save");
  expect(await f.repository.listJobDescriptions()).toHaveLength(1);
});
