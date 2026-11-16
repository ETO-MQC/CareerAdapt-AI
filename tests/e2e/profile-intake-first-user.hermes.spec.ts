import { expect, test, type Page } from "@playwright/test";
import { readStore } from "./support/p51CoreWorkflow";

const narrative = "我最近在某科技公司做了产品运营实习，时间是2026年7月至9月，主要负责用户反馈整理、竞品分析和产品功能优化。";

async function currentSession(page: Page) {
  const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  return (await readStore(page, "agentSessions")).find((row) => row.id === id);
}

test("first user confirmation freezes the intake before the real Repository commits", async ({ page }) => {
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
        }, { once: true });
      }
      if (this.name === "profiles" && sessionStorage.getItem("test-intake-confirming") === "1") {
        const events = JSON.parse(sessionStorage.getItem("test-intake-events") ?? "[]") as string[];
        events.push("profile-write-start");
        sessionStorage.setItem("test-intake-events", JSON.stringify(events));
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  }, { baseUrl: providerUrl });
  await page.route("**/api/ai/structured**", async (route) => {
    const body = route.request().postDataJSON() as { task?: string; input?: { rawNarrative?: string } };
    if (body.task !== "profile-intake-semantic") return route.continue();
    const raw = body.input?.rawNarrative ?? "";
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task,
      promptVersion: "isolated-internship", output: { candidates: [{ candidateKey: "internship-one", sectionType: "internship",
        sourceSpan: { start: 0, end: raw.length }, structuredItem: { id: "internship-one", sectionType: "internship",
          organization: "某科技公司", role: "产品运营", startDate: "2026-07", endDate: "2026-09", current: false,
          description: "负责用户反馈整理、竞品分析和产品功能优化。", highlights: [], customFields: [] },
        professionalText: raw, uncertainFields: [] }], followUpQuestions: [] },
      meta: { provider: "synthetic", model: "isolated-internship", latencyMs: 1 } }) });
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
  await page.getByLabel("描述你的求职任务").fill(narrative);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(async () => {
    const state = (await currentSession(page))?.taskState as { knownSlots?: { profileIntakeReviewProjection?: { candidates?: unknown[] } } } | undefined;
    return JSON.stringify(state?.knownSlots?.profileIntakeReviewProjection?.candidates ?? []);
  }).toContain("某科技公司");
  expect(await readStore(page, "profiles")).toEqual(profilesBefore);
  await page.getByLabel("描述你的求职任务").fill("完成整理");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(async () => (await currentSession(page))?.taskState).toMatchObject({ stage: "final_review" });
  await page.getByRole("button", { name: /产物 [0-9]+/ }).click();
  const review = page.getByRole("region", { name: "最终资料草稿审核" });
  await expect(review).toContainText("某科技公司");
  await review.getByRole("button", { name: "编辑", exact: true }).first().click();
  await review.getByLabel("角色", { exact: true }).fill("产品运营实习生");
  await review.getByRole("button", { name: "保存并采用", exact: true }).click();
  expect(await readStore(page, "profiles")).toEqual(profilesBefore);
  await page.evaluate(() => { sessionStorage.setItem("test-intake-events", "[]"); sessionStorage.setItem("test-intake-confirming", "1"); });
  await page.getByLabel("描述你的求职任务").fill("确认");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(async () => (await currentSession(page))?.taskState).toMatchObject({ knownSlots: {
    profileIntakeCommitOutcome: { status: "COMMITTED_VERIFIED" } } });
  const session = await currentSession(page);
  const task = session?.taskState as { knownSlots: { profileIntakeCommitOutcome: { operationId: string; request: { frozen: { fingerprint: string } } } } };
  const outcome = task.knownSlots.profileIntakeCommitOutcome;
  expect(outcome.request.frozen.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem("test-intake-events") ?? "[]") as string[]);
  expect(events.indexOf(`checkpoint:${outcome.operationId}`)).toBeGreaterThanOrEqual(0);
  expect(events.indexOf("profile-write-start")).toBeGreaterThan(events.indexOf(`checkpoint:${outcome.operationId}`));
  const receipt = (await readStore(page, "appMeta")).find((row) => row.key === `profileIntakeOperation:v1:${outcome.operationId}`);
  expect(receipt).toBeTruthy();
});
