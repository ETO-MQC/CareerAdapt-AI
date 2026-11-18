import { expect, test, type Page } from "@playwright/test";
import { readStore } from "./support/p51CoreWorkflow";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const narrative = "我最近在示例科技做了产品运营实习，时间是2026年7月至9月，主要负责用户反馈整理、竞品分析和产品功能优化。";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await page.screenshot({ path: testInfo.outputPath("official-service-failure.png"), fullPage: true });
  const stores = await Promise.all(["agentSessions", "profiles", "appMeta"].map(async (name) => ({
    name, rows: await readStore(page, name)
  })));
  await testInfo.attach("official-service-stores.json", {
    body: JSON.stringify(stores, null, 2), contentType: "application/json"
  });
});

async function currentSession(page: Page) {
  const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  return (await readStore(page, "agentSessions")).find((row) => row.id === id);
}

async function waitForHermesTurn(page: Page, previousRunId?: string) {
  await expect.poll(async () => {
    const session = await currentSession(page);
    const run = session?.hermesRun as { status?: string; runId?: string } | undefined;
    return run?.runId !== previousRunId ? run?.status : undefined;
  }, { timeout: 60_000 }).toBe("completed");
}

test("binding short: confirmed intake survives reload and Hermes selects two jobs", async ({ page }) => {
  test.setTimeout(180_000);
  const providerUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  if (!providerUrl) throw new Error("synthetic_hermes_provider_required");
  await page.addInitScript(({ baseUrl }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl,
    model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true })), { baseUrl: providerUrl });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await expect.poll(async () => { const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && Boolean((await response.json()).snapshot?.runReady); }, { timeout: 60_000 }).toBe(true);
  await page.locator(".career-context-trigger").click();
  const dialog = page.getByRole("dialog", { name: "人物与版本" });
  await dialog.getByRole("tab", { name: "新增人物" }).click();
  await dialog.getByLabel("人物名称").fill("最终验收人物");
  await dialog.getByRole("button", { name: "创建人物" }).click();
  await dialog.getByRole("button", { name: /最终验收人物/ }).first().click();
  await dialog.getByRole("button", { name: "使用此版本" }).click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  await page.evaluate(() => (window as unknown as { intakeConcurrency: { seedBindingJobs(name: string): Promise<void> } }).intakeConcurrency.seedBindingJobs("CareerAdaptDb"));
  const start = page.getByRole("button", { name: /从零整理我的经历/ });
  await expect(start).toBeEnabled();
  await start.click();
  await page.getByLabel("描述你的求职任务").fill(narrative);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const intake = page.getByRole("region", { name: "经历候选核对" });
  await expect(intake.getByRole("button", { name: "编辑后采用" })).toBeVisible({ timeout: 60_000 });
  await waitForHermesTurn(page);
  await intake.getByRole("button", { name: "编辑后采用" }).click();
  await intake.getByLabel("角色", { exact: true }).fill("产品运营实习生");
  await intake.getByRole("button", { name: "保存并采用", exact: true }).click();
  await page.getByLabel("描述你的求职任务").fill("完成整理");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const finalReview = page.getByRole("region", { name: "最终资料草稿审核" });
  await expect(finalReview).toBeVisible({ timeout: 30_000 });
  await finalReview.getByRole("button", { name: "全部采用" }).click();
  await finalReview.getByRole("button", { name: "确认并写入个人资料库" }).click();
  await expect.poll(async () => ((await currentSession(page))?.taskState as { knownSlots?: { profileIntakeCommitOutcome?: { status?: string } } })?.knownSlots?.profileIntakeCommitOutcome?.status,
    { timeout: 30_000 }).toBe("COMMITTED_VERIFIED");
  const committed = (await currentSession(page))!;
  const version = committed.profileRevision as number;
  expect((committed.taskState as { selectedEntities: { profileVersion: number } }).selectedEntities.profileVersion).toBe(version);
  await page.reload();
  const selector = page.getByRole("region", { name: "选择要分析的岗位" });
  await expect(selector).toBeVisible();
  await expect.poll(async () => { const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && Boolean((await response.json()).snapshot?.runReady); }, { timeout: 60_000 }).toBe(true);
  const priorRun = ((await currentSession(page))?.hermesRun as { runId?: string } | undefined)?.runId;
  await page.getByLabel("描述你的求职任务").fill("分析产品运营和供应链这两个岗位。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(selector.locator("input:checked")).toHaveCount(2, { timeout: 60_000 });
  await waitForHermesTurn(page, priorRun);
  const reloaded = (await currentSession(page))!;
  expect(reloaded.profileRevision).toBe(version);
  expect((reloaded.taskState as { selectedEntities: { profileVersion: number } }).selectedEntities.profileVersion).toBe(version);
  await expect(selector.locator("input:checked")).toHaveCount(2);
  await selector.getByRole("button", { name: "分析所选岗位" }).click();
  const report = page.getByRole("region", { name: "经历与岗位影响报告" });
  await expect(report).toContainText("产品运营验收岗");
  await expect(report).toContainText("供应链验收岗");
  await page.getByLabel("描述你的求职任务").fill("这段经历对岗位有什么帮助？");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("岗位要求：", { timeout: 60_000 });
});

test("final golden journey: confirmed intake, selected impact, reviewed revisions and new session", async ({ page, context }, info) => {
  test.setTimeout(300_000);
  const providerUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  if (!providerUrl) throw new Error("synthetic_hermes_provider_required");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(({ baseUrl }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl,
    model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true })), { baseUrl: providerUrl });
  await page.route("**/api/ai/structured", async route => {
    const body = route.request().postDataJSON() as { task?: string; input?: { target?: { sectionId: string; itemId: string; fieldPath: string };
      currentContent?: { fieldValue?: string | string[] }; relevantRequirements?: Array<{ requirementId: string }>; allowedEvidenceRefs?: unknown[] } };
    if (body.task !== "resume-tailor-diff" || !body.input?.target) return route.continue();
    const original = body.input.currentContent?.fieldValue ?? "";
    const change = (text: string) => text.replace("参与", "参与了");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task, promptVersion: "golden-fixture",
      output: { diffs: [{ target: { sectionId: body.input.target.sectionId, itemId: body.input.target.itemId, fieldPath: body.input.target.fieldPath },
        operation: "replace", original, value: Array.isArray(original) ? original.map(change) : change(original), reason: "依据已确认来源调整描述。",
        requirementIds: (body.input.relevantRequirements ?? []).map(item => item.requirementId), targetKeywords: [],
        evidenceRefs: body.input.allowedEvidenceRefs ?? [], supportLevel: "verified" }], clarifications: [] },
      meta: { provider: "fixture", model: "golden-test", inputLength: 1, outputLength: 1, latencyMs: 1 } }) });
  });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await expect.poll(async () => { const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && Boolean((await response.json()).snapshot?.runReady); }, { timeout: 60_000 }).toBe(true);
  await page.locator(".career-context-trigger").click();
  const dialog = page.getByRole("dialog", { name: "人物与版本" });
  await dialog.getByRole("tab", { name: "新增人物" }).click();
  await dialog.getByLabel("人物名称").fill("最终验收人物");
  await dialog.getByRole("button", { name: "创建人物" }).click();
  await dialog.getByRole("button", { name: /最终验收人物/ }).first().click();
  await dialog.getByRole("button", { name: "使用此版本" }).click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  const seeded = await page.evaluate(() => (window as unknown as { intakeConcurrency: { seedGolden(name: string): Promise<{
    profileId: string; general: { branch: { id: string } }; jobs: Array<{ job: { id: string }; branch: { branch: { id: string; revision: number }; revision: { id: string } } }> }> } }).intakeConcurrency.seedGolden("CareerAdaptDb"));
  const start = page.getByRole("button", { name: /从零整理我的经历/ });
  await expect(start).toBeEnabled();
  await start.click();
  await page.getByLabel("描述你的求职任务").fill(narrative);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const intake = page.getByRole("region", { name: "经历候选核对" });
  await expect(intake.getByRole("button", { name: "编辑后采用" })).toBeVisible({ timeout: 60_000 });
  await waitForHermesTurn(page);
  await intake.getByRole("button", { name: "编辑后采用" }).click();
  await intake.getByLabel("角色", { exact: true }).fill("产品运营实习生");
  await intake.getByRole("button", { name: "保存并采用", exact: true }).click();
  await page.getByLabel("描述你的求职任务").fill("完成整理");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const finalReview = page.getByRole("region", { name: "最终资料草稿审核" });
  await expect(finalReview).toBeVisible({ timeout: 30_000 });
  await finalReview.getByRole("button", { name: "全部采用" }).click();
  await finalReview.getByRole("button", { name: "确认并写入个人资料库" }).click();
  await expect.poll(async () => ((await currentSession(page))?.taskState as { knownSlots?: { profileIntakeCommitOutcome?: { status?: string } } })?.knownSlots?.profileIntakeCommitOutcome?.status,
    { timeout: 30_000 }).toBe("COMMITTED_VERIFIED");
  const profileAfter = (await readStore(page, "profiles")).find(row => row.id === seeded.profileId);
  const branchesBefore = await readStore(page, "resumeBranches");
  const revisionsBefore = await readStore(page, "resumeRevisions");
  const jobsBefore = await readStore(page, "jobDescriptions");
  await page.reload();
  const selector = page.getByRole("region", { name: "选择要分析的岗位" });
  await expect(selector).toBeVisible();
  await expect.poll(async () => { const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && Boolean((await response.json()).snapshot?.runReady); }, { timeout: 60_000 }).toBe(true);
  const priorRun = ((await currentSession(page))?.hermesRun as { runId?: string } | undefined)?.runId;
  await page.getByLabel("描述你的求职任务").fill("分析产品运营和供应链这两个岗位。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(selector.locator("input:checked")).toHaveCount(2, { timeout: 60_000 });
  await waitForHermesTurn(page, priorRun);
  await selector.getByRole("button", { name: "分析所选岗位" }).click();
  const report = page.getByRole("region", { name: "经历与岗位影响报告" });
  await expect(report).toContainText("产品运营验收岗");
  await expect(report).toContainText("供应链验收岗");
  await page.getByLabel("描述你的求职任务").fill("这段经历对岗位有什么帮助？");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("岗位要求：", { timeout: 60_000 });
  const jobA = report.locator(":scope > article").filter({ has: page.getByRole("heading", { name: "产品运营验收岗", exact: true }) });
  await jobA.getByLabel("岗位简历").selectOption(seeded.jobs[0].branch.branch.id);
  await jobA.getByLabel("资料变化").selectOption({ index: 1 });
  await jobA.getByRole("button", { name: "核对加入建议" }).click();
  await jobA.getByRole("button", { name: "生成岗位修改建议" }).click();
  const review = jobA.getByRole("region", { name: "核对经历加入建议" });
  const diffs = review.locator(":scope > article");
  await expect(diffs).toHaveCount(2, { timeout: 60_000 });
  const originalText = (await diffs.first().locator("del").innerText()).trim();
  const editedText = originalText.replace("参与", "参与了").replace(/。$/u, "");
  const ignoredText = (await diffs.nth(1).locator("ins").innerText()).trim();
  await page.getByLabel("描述你的求职任务").fill("第一条采用，第三条忽略。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(review.getByRole("button", { name: "采用经历", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await expect(diffs.nth(1).getByRole("button", { name: "已忽略", exact: true })).toBeVisible();
  await diffs.first().getByRole("button", { name: "编辑后采用", exact: true }).click();
  await diffs.first().getByLabel("编辑建议内容").fill(editedText);
  await diffs.first().getByRole("button", { name: "采用编辑" }).click();
  expect(await readStore(page, "resumeBranches")).toEqual(branchesBefore);
  expect(await readStore(page, "resumeRevisions")).toEqual(revisionsBefore);
  await review.getByRole("button", { name: "应用已选修改" }).click();
  await expect(jobA).toContainText("已保存新版本");
  const after = await readStore(page, "resumeBranches");
  const branch = after.find(row => row.id === seeded.jobs[0].branch.branch.id)!;
  expect(branch.revision).toBe(seeded.jobs[0].branch.branch.revision + 1);
  expect(after.filter(row => row.id !== branch.id)).toEqual(branchesBefore.filter(row => row.id !== branch.id));
  expect((await readStore(page, "profiles")).find(row => row.id === seeded.profileId)).toEqual(profileAfter);
  expect(await readStore(page, "jobDescriptions")).toEqual(jobsBefore);
  expect((await readStore(page, "resumeRevisions")).find(row => row.id === seeded.jobs[0].branch.revision.id)).toEqual(revisionsBefore.find(row => row.id === seeded.jobs[0].branch.revision.id));
  const resumePage = await context.newPage();
  await resumePage.goto(`/resume?branchId=${encodeURIComponent(String(branch.id))}`);
  const preview = resumePage.locator(".resume-preview-stage").getByTestId("resume-a4-page").first();
  await expect(preview).toContainText("用户反馈整理");
  await expect(preview).toContainText(editedText);
  await expect(preview).not.toContainText(ignoredText);
  await preview.screenshot({ path: info.outputPath("golden-preview.png") });
  const request = resumePage.waitForRequest(item => item.url().includes("/api/resume-export/pdf") && item.method() === "POST");
  const download = resumePage.waitForEvent("download");
  await resumePage.getByRole("button", { name: "下载 PDF", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ snapshot: { branchId: branch.id, currentRevisionId: branch.currentRevisionId } });
  const pdf = info.outputPath("golden.pdf");
  await (await download).saveAs(pdf);
  const binary = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
  const pdfText = execFileSync(binary, [pdf, "-"], { encoding: "utf8" }).replace(/\s/gu, "");
  expect(pdfText).toContain("用户反馈整理");
  expect(pdfText).toContain(editedText.replace(/\s/gu, ""));
  expect(pdfText).not.toContain(ignoredText.replace(/\s/gu, ""));
  await resumePage.close();
  const oldSession = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"))).not.toBe(oldSession);
  await expect(page.locator(".agent-conversation").getByText(narrative, { exact: true })).toHaveCount(0);
  await page.getByLabel("描述你的求职任务").fill("继续看看刚才那个产品运营岗位。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("请选择公司", { timeout: 60_000 });
  await page.getByLabel("描述你的求职任务").fill("选择验收公司产品运营岗位。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText(`当前岗位简历版本 ${branch.revision}`, { timeout: 60_000 });
  await page.screenshot({ path: info.outputPath("golden-new-session.png"), fullPage: true });
});

for (const conflict of [false, true]) test(`official structured service and Hermes intake ${conflict ? "with CAS conflict" : "through first confirmation"}`, async ({ page, context }, testInfo) => {
  const providerUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  if (!providerUrl) throw new Error("synthetic_hermes_provider_required");
  await page.addInitScript(({ baseUrl }) => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test",
      provider: "openai-compatible", apiKeyConfigured: true }));
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const record = value as { id?: string; taskState?: { knownSlots?: { profileIntakeCommitOutcome?: { status?: string; operationId?: string; request?: { frozen?: { fingerprint?: string } } } } } };
      const checkpoint = record.taskState?.knownSlots?.profileIntakeCommitOutcome;
      if (this.name === "agentSessions" && checkpoint?.status === "UNKNOWN" && checkpoint.request?.frozen?.fingerprint) {
        this.transaction.addEventListener("complete", () => {
          const events = JSON.parse(sessionStorage.getItem("test-intake-events") ?? "[]") as string[];
          events.push(`checkpoint:${checkpoint.operationId}`);
          sessionStorage.setItem("test-intake-events", JSON.stringify(events));
          sessionStorage.setItem("test-checkpoint-seen", "1");
        }, { once: true });
      }
      if (this.name === "profiles" && sessionStorage.getItem("test-intake-confirming") === "1") {
        const events = JSON.parse(sessionStorage.getItem("test-intake-events") ?? "[]") as string[];
        events.push("profile-write-start");
        sessionStorage.setItem("test-intake-events", JSON.stringify(events));
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (storeNames, mode, options) {
      const names = typeof storeNames === "string" ? [storeNames] : Array.from(storeNames);
      if (mode === "readwrite" && names.includes("profiles") && sessionStorage.getItem("test-pause-checkpoint") === "1"
        && sessionStorage.getItem("test-checkpoint-seen") === "1") {
        sessionStorage.setItem("test-pause-checkpoint", "0");
        window.alert("test-checkpoint-persisted");
      }
      return originalTransaction.call(this, storeNames, mode, options);
    };
  }, { baseUrl: providerUrl });
  const structuredResponses: Array<{ task: string; status: number }> = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/api/ai/structured")) return;
    const body = response.request().postDataJSON() as { task?: string };
    structuredResponses.push({ task: body.task ?? "", status: response.status() });
  });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/runtime/hermes/control");
    if (!response.ok()) return false;
    const body = await response.json();
    return Boolean(body.snapshot?.processReady && body.snapshot?.providerReady && body.snapshot?.careerMcpReady
      && body.snapshot?.toolSurfaceReady && body.snapshot?.runReady);
  }, { timeout: 60_000 }).toBe(true);
  await page.locator(".career-context-trigger").click();
  const contextDialog = page.getByRole("dialog", { name: "人物与版本" });
  await contextDialog.getByRole("tab", { name: "新增人物" }).click();
  await contextDialog.getByLabel("人物名称").fill("隔离验收人物");
  await contextDialog.getByRole("button", { name: "创建人物" }).click();
  await expect(contextDialog.getByRole("button", { name: /隔离验收人物/ }).first()).toBeVisible();
  await contextDialog.getByRole("button", { name: /隔离验收人物/ }).first().click();
  await contextDialog.getByRole("button", { name: "使用此版本" }).click();
  const start = page.getByRole("button", { name: /从零整理我的经历/ });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator('[data-agent-workflow-id="guided_profile_intake"][data-agent-task-stage="collect_experience"]')).toBeVisible();
  const profilesBefore = await readStore(page, "profiles");
  const branchesBefore = await readStore(page, "resumeBranches");
  const revisionsBefore = await readStore(page, "resumeRevisions");
  await page.getByLabel("描述你的求职任务").fill(narrative);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByText("示例科技", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const state = (await currentSession(page))?.taskState as { knownSlots?: { profileIntakeReviewProjection?: { candidates?: unknown[] } } } | undefined;
    return JSON.stringify(state?.knownSlots?.profileIntakeReviewProjection?.candidates ?? []);
  }).toContain("示例科技");
  await waitForHermesTurn(page);
  expect(await readStore(page, "profiles")).toEqual(profilesBefore);
  const review = page.getByRole("region", { name: "经历候选核对" });
  await review.getByRole("button", { name: "编辑后采用" }).click();
  await review.getByLabel("角色", { exact: true }).fill("产品运营实习生");
  await review.getByRole("button", { name: "保存并采用", exact: true }).click();
  await expect(review.getByRole("button", { name: /已核对 1\/1/ })).toBeVisible();
  expect(await readStore(page, "profiles")).toEqual(profilesBefore);
  await review.getByRole("button", { name: /已核对 1\/1/ }).click();
  await review.getByRole("button", { name: "重新打开" }).click();
  await review.getByRole("button", { name: "忽略" }).click();
  await expect(review.getByRole("button", { name: /已核对 1\/1/ })).toBeVisible();
  expect(await readStore(page, "profiles")).toEqual(profilesBefore);
  const previousRunId = ((await currentSession(page))?.hermesRun as { runId?: string } | undefined)?.runId;
  await page.getByLabel("描述你的求职任务").fill(narrative);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(review.getByRole("button", { name: "采用", exact: true })).toBeVisible({ timeout: 60_000 });
  await waitForHermesTurn(page, previousRunId);
  await review.getByRole("button", { name: "采用", exact: true }).click();
  await expect(review.getByRole("button", { name: /已核对 1\/1/ })).toBeVisible();
  expect(await readStore(page, "profiles")).toEqual(profilesBefore);
  await page.getByLabel("描述你的求职任务").fill("完成整理");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const finalReview = page.getByRole("region", { name: "最终资料草稿审核" });
  await expect(finalReview).toBeVisible({ timeout: 30_000 });
  await finalReview.getByRole("button", { name: "全部采用" }).click();
  const confirm = finalReview.getByRole("button", { name: "确认并写入个人资料库" });
  await expect(confirm).toBeEnabled();
  const profilePage = conflict ? await context.newPage() : undefined;
  if (profilePage) {
    await profilePage.goto("/profile");
    await profilePage.locator("#profile-name").fill("隔离人物更新");
  }
  await page.evaluate(() => { sessionStorage.setItem("test-intake-events", "[]"); sessionStorage.setItem("test-intake-confirming", "1"); });
  let original: { operationId: string; request: { frozen: { fingerprint: string } } } | undefined;
  if (profilePage) {
    await page.evaluate(() => sessionStorage.setItem("test-pause-checkpoint", "1"));
    const dialogPromise = page.waitForEvent("dialog");
    const confirmation = confirm.click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toBe("test-checkpoint-persisted");
    try {
      await profilePage.getByRole("button", { name: "保存基本信息" }).click();
      await expect.poll(async () => (await readStore(profilePage, "profiles")).find((profile) => profile.name === "隔离人物更新")?.version).toBe(2);
    } finally {
      await dialog.dismiss();
    }
    await confirmation;
    await expect.poll(async () => (await currentSession(page))?.taskState, { timeout: 30_000 }).toMatchObject({ knownSlots: {
      profileIntakeCommitOutcome: { status: "NOT_COMMITTED" } } });
    original = ((await currentSession(page))?.taskState as { knownSlots: { profileIntakeCommitOutcome: typeof original } }).knownSlots.profileIntakeCommitOutcome;
    await page.getByRole("button", { name: "重新核对" }).click();
    const latestReview = page.getByRole("region", { name: "最新资料对账" });
    await expect(latestReview).toBeVisible();
    await expect(latestReview).toContainText("示例科技");
    await expect(latestReview).toContainText("新增");
    await page.screenshot({ path: testInfo.outputPath("recheck.png"), fullPage: true });
    await expect.poll(async () => (await currentSession(page))?.taskState).toMatchObject({ knownSlots: {
      expectedProfileVersion: 2, profileIntakePreviousOperations: [original] } });
    await expect(finalReview.getByRole("button", { name: "确认并写入个人资料库" })).toBeEnabled();
    await finalReview.getByRole("button", { name: "确认并写入个人资料库" }).click();
  } else {
    await confirm.click();
  }
  await expect.poll(async () => (await currentSession(page))?.taskState, { timeout: 30_000 }).toMatchObject({ knownSlots: {
    profileIntakeCommitOutcome: { status: "COMMITTED_VERIFIED" } } });
  const session = await currentSession(page);
  const task = session?.taskState as { knownSlots: { profileIntakeCommitOutcome: { operationId: string; targetProfileId: string;
    request: { frozen: { fingerprint: string; expectedProfileVersion: number } } } } };
  const outcome = task.knownSlots.profileIntakeCommitOutcome;
  expect(outcome.request.frozen.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  if (original) {
    expect(outcome.operationId).not.toBe(original.operationId);
    expect(outcome.request.frozen.fingerprint).not.toBe(original.request.frozen.fingerprint);
    expect(outcome.request.frozen.expectedProfileVersion).toBe(2);
    expect((await readStore(page, "appMeta")).find((row) => row.key === `profileIntakeOperation:v1:${original!.operationId}`)).toBeUndefined();
    expect((session?.taskState as { knownSlots: { profileIntakePreviousOperations: unknown[] } }).knownSlots.profileIntakePreviousOperations).toEqual([original]);
    expect((await readStore(page, "profiles")).find((profile) => profile.id === outcome.targetProfileId)?.name).toBe("隔离人物更新");
  }
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem("test-intake-events") ?? "[]") as string[]);
  expect(events.indexOf(`checkpoint:${outcome.operationId}`)).toBeGreaterThanOrEqual(0);
  expect(events.indexOf("profile-write-start")).toBeGreaterThan(events.indexOf(`checkpoint:${outcome.operationId}`));
  const receipt = (await readStore(page, "appMeta")).find((row) => row.key === `profileIntakeOperation:v1:${outcome.operationId}`);
  expect(receipt).toBeTruthy();
  const value = receipt!.value as { profileId: string; profileVersion: number; requestFingerprint: string; committedItemCount: number };
  expect(value).toMatchObject({ profileId: outcome.targetProfileId, profileVersion: outcome.request.frozen.expectedProfileVersion + 1,
    requestFingerprint: outcome.request.frozen.fingerprint, committedItemCount: 1 });
  expect(await readStore(page, "resumeBranches")).toEqual(branchesBefore);
  expect(await readStore(page, "resumeRevisions")).toEqual(revisionsBefore);
  if (!conflict) {
    const jobsPage = await context.newPage();
    await jobsPage.goto("/jobs");
    for (const [title, requirement] of [["产品运营验收岗", "参与用户反馈整理和产品功能优化。"],
      ["跨境运营验收岗", "参与竞品分析和运营报告整理。"], ["未选验收岗", "负责设备维护和硬件测试。"]]) {
      await jobsPage.getByLabel("岗位名称").fill(title);
      await jobsPage.getByLabel("公司名称").fill("验收公司");
      await jobsPage.getByLabel("岗位描述").fill(`岗位职责\n${requirement}\n任职要求\n具备相关实践经验。`);
      await jobsPage.getByRole("button", { name: "保存并分析岗位" }).click();
      const jobDialog = jobsPage.getByRole("dialog", { name: title });
      await expect(jobDialog).toBeVisible();
      const manual = jobDialog.getByTestId("job-manual-mode-dialog");
      if (await manual.isVisible()) await manual.click();
      await jobDialog.getByTestId("commit-job").click();
      await expect(jobDialog).toBeHidden();
    }
    const selector = page.getByRole("region", { name: "选择要分析的岗位" });
    await expect(selector).toBeVisible();
    await selector.getByLabel(/产品运营验收岗/).check();
    await selector.getByLabel(/跨境运营验收岗/).check();
    await selector.getByRole("button", { name: "分析所选岗位" }).click();
    const report = page.getByRole("region", { name: "经历与岗位影响报告" });
    await expect(report).toBeVisible();
    await expect(report).toContainText("产品运营验收岗");
    await expect(report).toContainText("跨境运营验收岗");
    await expect(report).not.toContainText("未选验收岗");
    await expect(report).toContainText("证据：负责用户反馈整理");
    await expect(report).toContainText("可能与这项要求相关");
    expect(await readStore(page, "resumeBranches")).toEqual(branchesBefore);
    expect(await readStore(page, "resumeRevisions")).toEqual(revisionsBefore);
    await page.screenshot({ path: testInfo.outputPath("impact-report.png"), fullPage: true });
    await jobsPage.close();
  }
  await page.screenshot({ path: testInfo.outputPath("completed.png"), fullPage: true });
  await page.reload();
  await expect.poll(async () => (await readStore(page, "profiles")).find((profile) => profile.id === value.profileId)?.version)
    .toBe(value.profileVersion);
  if (!conflict) await expect(page.getByRole("region", { name: "经历与岗位影响报告" })).toContainText("产品运营验收岗");
  expect((await readStore(page, "appMeta")).filter((row) => row.key === `profileIntakeOperation:v1:${outcome.operationId}`)).toHaveLength(1);
  await testInfo.attach("verified-operation.json", { contentType: "application/json", body: JSON.stringify({
    profileId: value.profileId, profileVersion: value.profileVersion, operationId: outcome.operationId,
    fingerprint: value.requestFingerprint, receipt: value, original, events, structuredResponses
  }, null, 2) });
  expect(structuredResponses).toContainEqual({ task: "profile-intake-semantic", status: 200 });
  if (!conflict) {
    const profileBeforeResume = await readStore(page, "profiles");
    const report = page.getByRole("region", { name: "经历与岗位影响报告" });
    await report.getByRole("link", { name: "前往此岗位的简历工作区" }).first().click();
    await expect(page).toHaveURL(/\/jobs\?/);
    await page.getByTestId("analyze-profile-source").click();
    const recommendation = page.locator(".profile-recommendation-item").filter({ hasText: "示例科技" });
    await expect(recommendation).toBeVisible();
    if (!await recommendation.getByRole("checkbox").isChecked()) await recommendation.getByRole("checkbox").check();
    expect(await readStore(page, "resumeBranches")).toEqual(branchesBefore);
    await page.getByTestId("create-from-profile-source").click();
    await expect(page).toHaveURL(/\/resume\?.*branchId=/);
    const branchId = new URL(page.url()).searchParams.get("branchId");
    expect(branchId).toBeTruthy();
    const branch = (await readStore(page, "resumeBranches")).find(row => row.id === branchId)!;
    expect(branch.profileId).toBe(value.profileId);
    expect(branch.sourceProfileVersion).toBe(value.profileVersion);
    expect(JSON.stringify(branch)).toContain("用户反馈整理");
    expect(await readStore(page, "profiles")).toEqual(profileBeforeResume);
    const preview = page.getByTestId("resume-a4-page").first();
    await expect(preview).toContainText("用户反馈整理");
    await page.screenshot({ path: testInfo.outputPath("new-resume-preview.png"), fullPage: true });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
    const download = await downloadPromise;
    const pdf = testInfo.outputPath("new-resume.pdf");
    await download.saveAs(pdf);
    const binary = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
    expect(execFileSync(binary, [pdf, "-"], { encoding: "utf8" }).replace(/\s/gu, "")).toContain("用户反馈整理");
  }
});
