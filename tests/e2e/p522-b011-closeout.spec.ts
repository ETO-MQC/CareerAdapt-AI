import "fake-indexeddb/auto";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { demoCareerProfile } from "@/data/demoProfile";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { demoJobDescriptions } from "@/data/demoJobs";
import { createTailoringSessionCommand } from "@/services/jobs/tailoringCommands";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentSessionSchema, AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { projectTaskStateIntoSession } from "@/agent/runtime/projectTaskStateToWorkflowState";
import { projectActiveTailoringQuestionToChat } from "@/agent/runtime/AgentHostStore";
import { readStore } from "./support/p51CoreWorkflow";
import { openManualPageTab } from "./support/g7b2Ui";

async function seedQuestion(page: Page) {
  const db = new CareerAdaptDb(`b011-fixture-${crypto.randomUUID()}`);
  const repo = new WorkspaceRepository(db);
  const syntheticProfile = structuredClone(demoCareerProfile);
  const educationFact = structuredClone(syntheticProfile.experiences[0].facts[0]);
  educationFact.id = "b011-education-fact"; educationFact.statement = "在示例大学完成经济管理本科教育。";
  educationFact.provenance = educationFact.provenance.map(source => ({ ...source, sourceId: "b011-education-source", sourceText: educationFact.statement }));
  syntheticProfile.experiences.push({ ...structuredClone(syntheticProfile.experiences[0]), id: "b011-education", type: "education", organization: "示例大学", role: "本科",
    startDate: "2022-09", endDate: "2026-06", facts: [educationFact], resumeDrafts: [], tags: [], evidenceIds: [] });
  await repo.saveProfile(syntheticProfile);
  await repo.setActiveProfileId(demoCareerProfile.id);
  const profile = (await repo.getProfile(demoCareerProfile.id))!;
  const general = (await repo.createGeneralResumeBranch({ profileId: profile.id, operationId: "b011-source-create", name: "B01.1 来源通用简历", includeProfileFacts: true, includeProfileBasics: true })).branch;
  const job = { ...structuredClone(demoJobDescriptions[0]), id: "b011-job", rawText: "负责数据分析与需求梳理，要求使用 Kubernetes 完成部署。",
    requirements: [...demoJobDescriptions[0].requirements, { ...demoJobDescriptions[0].requirements[0], id: "b011-kubernetes", sourceSpan: { start: 0, end: 21, text: "使用 Kubernetes 完成部署" }, category: "required_skill" as const, description: "使用 Kubernetes 完成部署", keywords: ["Kubernetes"], priority: "high" as const, hardConstraint: false }] };
  await repo.saveJobDescription(job);
  const otherJob = structuredClone(demoJobDescriptions[1]);
  await repo.saveJobDescription(otherJob);
  const other = await repo.createJobSpecificBranchFromProfile({ profileId: profile.id, jobId: otherJob.id,
    operationId: "b011-other-job", name: "其他岗位简历", selectedCanonicalItemIds: canonicalProfileLibraryItems(profile).map(item => item.id), requirementMatchIds: [] });
  const tailoring = createTailoringSessionCommand({ operationId: "b011-create-session", profile, branch: general, job, mode: "competitive" }).session;
  expect(tailoring.plan.questionPlan?.activeQuestionId).toBeTruthy();
  const base = AgentRuntime.create("tailor_existing_resume", "clarify_unsupported_facts", "B01.1 定制验收", {
    schemaVersion: "active-career-v1", selectedAt: new Date().toISOString(), personId: profile.personId!, profileId: profile.id, profileVersionNumber: profile.profileVersionNumber!, profileRevision: profile.version
  });
  const initial = new AgentTaskStateReducer().create(base, "create_tailored_resume");
  const state = AgentTaskStateSchema.parse({ ...initial, stage: "clarify_unsupported_facts", completionStatus: "waiting_for_user",
    selectedEntities: { ...initial.selectedEntities, profileId: profile.id, profileVersion: profile.version,
      resumeId: general.id, resumeRevisionId: general.currentRevisionId, jobId: job.id, tailoringSessionId: tailoring.id },
    knownSlots: { ...initial.knownSlots, tailoringSession: tailoring, questionPlan: tailoring.plan.questionPlan,
      activeQuestionId: tailoring.plan.questionPlan?.activeQuestionId }, updatedAt: new Date().toISOString() });
  const session = AgentSessionSchema.parse(projectActiveTailoringQuestionToChat(projectTaskStateIntoSession({ ...base,
    activeResumeId: general.id, activeJobId: job.id, runtimeId: "hermes" }, state), state));
  await repo.saveAgentSession(session);
  const records: Record<string, unknown[]> = {};
  for (const table of db.tables) records[table.name] = await table.toArray();
  db.close();
  // Initial synthetic workspace only. All measured answers, review, apply and export use the product UI/Repository.
  await page.evaluate(async ({ records, sessionId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("CareerAdaptDb"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const names = Object.keys(records).filter(name => records[name].length > 0);
    await new Promise<void>((resolve, reject) => { const tx = db.transaction(names, "readwrite"); for (const name of names) for (const row of records[name]) tx.objectStore(name).put(row); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close(); localStorage.setItem("careeradapt.agent.activeSessionId", sessionId);
  }, { records, sessionId: session.id });
  return { sessionId: session.id, sourceId: general.id, otherId: other.branch.id, jobId: job.id, questionId: tailoring.plan.questionPlan!.activeQuestionId! };
}

async function setup(page: Page) {
  await page.goto("/resume");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  await expect(skip.or(page.getByRole("button", { name: /从个人资料库创建/ }))).toBeVisible({ timeout: 15_000 });
  if (await skip.isVisible()) { await skip.click(); await page.waitForURL(/\/$/); await page.goto("/resume"); }
  await expect(page.getByRole("button", { name: /从个人资料库创建/ })).toBeVisible();
}

function installWriter(page: Page, fail = false) {
  const requests: Array<{ requestId: string; taskId: string; phase: string }> = [];
  return page.route("**/api/ai/structured", async route => {
    const body = route.request().postDataJSON() as { task: string; input: Record<string, unknown> };
    requests.push({ requestId: route.request().headers()["x-career-request-id"] ?? "missing", taskId: body.task, phase: "received" });
    if (fail) { await route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "provider_timeout", message: "Isolated model deadline", retryable: true } }) }); return; }
    expect(body.task).toBe("resume-tailor-diff");
    const input = body.input as unknown as { target: { sectionId: string; itemId: string; fieldPath: string }; currentContent: { fieldValue: string | string[] }; allowedEvidenceRefs: unknown[]; relevantRequirements: Array<{ requirementId: string }> };
    const original = input.currentContent.fieldValue;
    let value: string | string[] = original;
    if (input.target.sectionId === "summary") value = "基于数据分析项目完成结构化交付，并突出与目标岗位相关的分析经验。";
    if (input.target.sectionId === "project") {
      const rephrase = (line: string) => line.includes("需求梳理") ? "参与需求梳理、原型设计和功能验收等 AI 应用项目工作。" : line;
      value = Array.isArray(original) ? original.map(rephrase) : rephrase(original);
    }
    if (input.target.sectionId === "internship" && Array.isArray(original)) value = original.map(line => line.includes("公文") ? "协助整理公文流转与热线记录，保持信息记录准确和资料有序。" : line);
    const diffs = JSON.stringify(value) === JSON.stringify(original) ? [] : [{ target: { sectionId: input.target.sectionId, itemId: input.target.itemId, fieldPath: input.target.fieldPath }, operation: "replace", original, value,
      reason: "重组已确认项目事实，保持来源与职责范围", requirementIds: input.relevantRequirements.map(item => item.requirementId), targetKeywords: [], evidenceRefs: input.allowedEvidenceRefs, supportLevel: "verified" }];
    await route.fulfill({ contentType: "application/json; charset=utf-8", body: JSON.stringify({ ok: true, task: body.task, promptVersion: "b011-deterministic", output: { diffs, clarifications: [] }, meta: { provider: "deterministic-test", model: "b011", latencyMs: 1 } }) });
  }).then(() => requests);
}

async function active(page: Page, id: string) { return (await readStore(page, "agentSessions")).find(row => row.id === id)!; }

test("answer → unified Diff → partial rejection → confirmed independent Revision → reload → real PDF download", async ({ page }, info) => {
  test.setTimeout(150_000);
  await setup(page);
  const fixture = await seedQuestion(page);
  const traces: Array<Record<string, unknown>> = [];
  page.on("console", async message => { if (message.text().startsWith("[tailoring-request]")) traces.push(await message.args()[1].jsonValue()); });
  const profileBefore = await readStore(page, "profiles");
  const sourceBefore = (await readStore(page, "resumeBranches")).find(row => row.id === fixture.sourceId);
  const otherBefore = (await readStore(page, "resumeBranches")).find(row => row.id === fixture.otherId);
  const requests = await installWriter(page);
  await page.route("**/api/agent/stream", route => route.abort());
  await page.route("**/api/agent/runtime/hermes", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "unexpected_runtime_call", message: "Golden Journey must use its existing deterministic transition" } }) }));
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: /B01.1 定制验收 任务状态/ }).click();
  await expect(page.getByText("B01.1 定制验收", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("描述你的求职任务")).toBeVisible();
  await page.getByLabel("描述你的求职任务").fill("没有使用过 Kubernetes，不加入这项技能。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".agent-tailoring-inline")).toBeVisible({ timeout: 25_000 });
  const generated = await active(page, fixture.sessionId);
  writeFileSync(info.outputPath("after-answer.json"), JSON.stringify(generated.taskState));
  await info.attach("after-answer", { body: JSON.stringify(generated.taskState), contentType: "application/json" });
  const task = generated.taskState as { knownSlots: { tailoringSession: { plan: { clarificationAnswers: Array<{ questionId: string }>; diffs: Array<{ value: string | string[]; target: { itemId: string; fieldPath: string } }> } } } };
  expect(task.knownSlots.tailoringSession.plan.clarificationAnswers.some(answer => answer.questionId === fixture.questionId)).toBe(true);
  expect(task.knownSlots.tailoringSession.plan.diffs.length).toBeGreaterThanOrEqual(2);
  const planHashes = task.knownSlots.tailoringSession.plan as typeof task.knownSlots.tailoringSession.plan & { answerRevisionHash?: string; generatedDiffsBasedOnAnswerRevisionHash?: string };
  expect(planHashes.answerRevisionHash).toBeTruthy();
  expect(planHashes.generatedDiffsBasedOnAnswerRevisionHash).toBe(planHashes.answerRevisionHash);
  const acceptedDiff = task.knownSlots.tailoringSession.plan.diffs[0];
  const rejectedDiff = task.knownSlots.tailoringSession.plan.diffs[1];
  await page.reload();
  const preview = page.locator(".agent-tailoring-inline");
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "采用", exact: true }).click();
  await preview.getByRole("button", { name: "忽略", exact: true }).click();
  for (let i = 0; i < 8 && await preview.getByRole("button", { name: "忽略", exact: true }).isVisible(); i++) await preview.getByRole("button", { name: "忽略", exact: true }).click();
  await preview.getByRole("button", { name: /提交/ }).click();
  await expect(page.getByRole("button", { name: "生成岗位简历", exact: true })).toBeVisible();
  expect((await readStore(page, "resumeBranches")).some(row => row.jobId === fixture.jobId)).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "生成岗位简历", exact: true }).click();
  await expect.poll(async () => (await active(page, fixture.sessionId)).taskState).toMatchObject({ completionStatus: "completed" });
  const completed = await active(page, fixture.sessionId);
  writeFileSync(info.outputPath("completed-task.json"), JSON.stringify(completed.taskState));
  await info.attach("completed-task", { body: JSON.stringify(completed.taskState), contentType: "application/json" });
  const branches = await readStore(page, "resumeBranches");
  const target = branches.find(row => row.jobId === fixture.jobId && row.branchPurpose === "job_specific")!;
  expect(target).toBeTruthy();
  expect(branches.find(row => row.id === fixture.sourceId)).toEqual(sourceBefore);
  expect(branches.find(row => row.id === fixture.otherId)).toEqual(otherBefore);
  expect(await readStore(page, "profiles")).toEqual(profileBefore);
  await page.goto(`/resume?branchId=${target.id}`);
  await page.reload();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  await openManualPageTab(page);
  const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
  const responsePromise = page.waitForResponse(response => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST");
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const [download, response] = await Promise.all([downloadPromise, responsePromise]);
  expect(response.status()).toBe(200);
  const pdf = info.outputPath("tailored.pdf"); await download.saveAs(pdf);
  const binary = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
  const text = execFileSync(binary, [pdf, "-"], { encoding: "utf8" });
  const normalize = (value: string) => value.replace(/\s+/gu, "");
  for (const value of [acceptedDiff.value].flat()) expect(normalize(text)).toContain(normalize(value));
  for (const value of [rejectedDiff.value].flat()) expect(normalize(text)).not.toContain(normalize(value));
  for (const field of ["同学", "示例大学", "本科", "某政府部门", "AI 求职应用课程项目", "Stata", "Excel"]) expect(normalize(text)).toContain(normalize(field));
  expect(text).not.toContain("\uFFFD");
  expect(text).not.toContain("Kubernetes");
  const exports = await readStore(page, "exportRecords");
  expect(exports.some(row => row.branchId === target.id && row.revisionId === target.currentRevisionId && row.exportStatus === "direct_pdf_success")).toBe(true);
  writeFileSync(info.outputPath("pdf-text.txt"), text);
  writeFileSync(info.outputPath("model-ledger.json"), JSON.stringify({ requests, traces }));
  expect(traces.some(trace => trace.phase === "parsed")).toBe(true);
  writeFileSync(info.outputPath("export-records.json"), JSON.stringify(exports));
  await info.attach("pdf-text", { body: text, contentType: "text/plain" });
  await info.attach("model-ledger", { body: JSON.stringify(requests), contentType: "application/json" });
});

test("bounded state probe after the last answer", async ({ page }, info) => {
  await setup(page); const fixture = await seedQuestion(page); const ledger = await installWriter(page);
  await page.route("**/api/agent/stream", route => route.abort());
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: /B01.1 定制验收 任务状态/ }).click();
  await page.getByLabel("描述你的求职任务").fill("没有");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.waitForTimeout(1000);
  const state = await active(page, fixture.sessionId);
  writeFileSync(info.outputPath("probe-state.json"), JSON.stringify({ state, ledger }));
  await info.attach("probe-state", { body: JSON.stringify({ state, ledger }), contentType: "application/json" });
  expect((state.taskState as Record<string, unknown>).stage).toBe("preview_changes");
  expect(ledger.length).toBeGreaterThan(0);
});

test("model failure leaves a recoverable task and preserves the answered question", async ({ page }, info) => {
  await setup(page); const fixture = await seedQuestion(page); const ledger = await installWriter(page, true);
  await page.route("**/api/agent/stream", route => route.abort());
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: /B01.1 定制验收 任务状态/ }).click();
  await page.getByLabel("描述你的求职任务").fill("没有");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByText(/AI 简历撰写服务响应超时/).first()).toBeVisible();
  const failed = await active(page, fixture.sessionId);
  writeFileSync(info.outputPath("model-failure.json"), JSON.stringify({ taskState: failed.taskState, ledger }));
  expect(ledger).toHaveLength(1);
  expect((failed.taskState as { knownSlots: { tailoringSession: { plan: { clarificationAnswers: unknown[] } } } }).knownSlots.tailoringSession.plan.clarificationAnswers).toHaveLength(1);
  expect((await readStore(page, "resumeBranches")).some(row => row.jobId === fixture.jobId)).toBe(false);
  await page.reload();
  const retry = page.getByRole("button", { name: "重新执行当前步骤", exact: true });
  await expect(retry).toBeVisible();
  writeFileSync(info.outputPath("after-reload-failure.json"), JSON.stringify(await active(page, fixture.sessionId)));
  await installWriter(page);
  await retry.click();
  try { await expect(page.locator(".agent-tailoring-inline")).toBeVisible(); } finally { writeFileSync(info.outputPath("after-retry.json"), JSON.stringify(await active(page, fixture.sessionId))); }
  const recovered = await active(page, fixture.sessionId);
  expect((recovered.taskState as { knownSlots: { tailoringSession: { plan: { clarificationAnswers: unknown[] } } } }).knownSlots.tailoringSession.plan.clarificationAnswers).toHaveLength(1);
});
