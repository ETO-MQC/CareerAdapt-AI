import { expect, test, type Page } from "@playwright/test";
import { readStore } from "./support/p51CoreWorkflow";

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
  await page.screenshot({ path: testInfo.outputPath("completed.png"), fullPage: true });
  await page.reload();
  await expect.poll(async () => (await readStore(page, "profiles")).find((profile) => profile.id === value.profileId)?.version)
    .toBe(value.profileVersion);
  expect((await readStore(page, "appMeta")).filter((row) => row.key === `profileIntakeOperation:v1:${outcome.operationId}`)).toHaveLength(1);
  await testInfo.attach("verified-operation.json", { contentType: "application/json", body: JSON.stringify({
    profileId: value.profileId, profileVersion: value.profileVersion, operationId: outcome.operationId,
    fingerprint: value.requestFingerprint, receipt: value, original, events, structuredResponses
  }, null, 2) });
  expect(structuredResponses).toContainEqual({ task: "profile-intake-semantic", status: 200 });
});
