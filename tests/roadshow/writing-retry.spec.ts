import { expect, test } from "@playwright/test";
import { core02Material } from "../e2e/support/core02Material";
import { installCoreWritingProvider, readStore } from "../e2e/support/p51CoreWorkflow";

test("writing failure preserves the draft and explicit retry saves once", async ({ page }) => {
  const baseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  if (!baseUrl) throw new Error("synthetic_hermes_provider_required");
  await page.addInitScript(({ providerUrl }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
    baseUrl: providerUrl, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true
  })), { providerUrl: baseUrl });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90_000 });
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
  const beforeProfiles = await readStore(page, "profiles");
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem("careeradapt-ai-settings") ?? "{}");
    localStorage.setItem("careeradapt.resumeImportAiPreference", JSON.stringify({ schemaVersion: "resume-import-ai-preference-v1",
      mode: "local", providerFingerprint: [settings.provider, settings.baseUrl, settings.model].join("|") }));
  });
  const send = async (message: string) => {
    await page.getByLabel("描述你的求职任务").fill(message);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
  };
  await page.locator('.agent-composer input[type="file"]').setInputFiles({ name: "anonymous-career.json",
    mimeType: "application/json", buffer: Buffer.from(JSON.stringify(core02Material)) });
  await send("P51-C02-MATERIAL，把这份职业材料整理到资料库");
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("已生成候选资料", { timeout: 60_000 });
  await page.getByRole("button", { name: "产物 1", exact: true }).click();
  await page.getByRole("button", { name: "查看来源与逐项核对", exact: true }).click();
  const dialog = page.getByTestId("agent-import-review-dialog");
  await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
  for (const label of ["确认此字段", "核对并保留来源"]) {
    const buttons = dialog.getByRole("button", { name: label, exact: true });
    while (await buttons.count()) await buttons.first().click();
  }
  await dialog.locator(".import-review-footer button.primary-button").click();
  await expect(dialog).not.toBeVisible();
  const profile = (await readStore(page, "profiles")).find(row => !beforeProfiles.some(old => old.id === row.id));
  expect(profile).toBeTruthy();
  const beforeBranches = await readStore(page, "resumeBranches");
  const beforeRevisions = await readStore(page, "resumeRevisions");
  await installCoreWritingProvider(page);
  let failWriting = true;
  let failures = 0;
  await page.route("**/api/ai/structured", async route => {
    const request = route.request().postDataJSON() as { task?: string };
    if (failWriting && request.task === "resume-career-writer") {
      failures++;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false,
        error: { code: "provider_unavailable", message: "isolated writing failure", retryable: true } }) });
      return;
    }
    await route.fallback();
  });
  await send("P51-C02-COMPOSE 根据这些资料帮我生成一份通用简历。");
  await expect(page.locator(".agent-confirmation")).toBeVisible({ timeout: 45_000 });
  await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
  const current = async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    return (await readStore(page, "agentSessions")).find(row => row.id === id);
  };
  await expect.poll(async () => Boolean(((await current())?.taskState as { knownSlots?: { resumeCompositionWriteFailure?: unknown } } | undefined)?.knownSlots?.resumeCompositionWriteFailure), { timeout: 30_000 }).toBe(true);
  expect(failures).toBeGreaterThan(0);
  expect(await readStore(page, "resumeBranches")).toEqual(beforeBranches);
  expect(await readStore(page, "resumeRevisions")).toEqual(beforeRevisions);
  await page.reload();
  await expect(page.getByRole("button", { name: "直接生成", exact: true }).last()).toBeVisible();
  failWriting = false;
  await page.getByRole("button", { name: "直接生成", exact: true }).last().dblclick();
  await expect.poll(async () => (await readStore(page, "resumeRevisions")).length, { timeout: 30_000 }).toBe(beforeRevisions.length + 1);
  expect((await readStore(page, "resumeBranches")).length).toBe(beforeBranches.length + 1);
  expect(((await current())?.taskState as { completionStatus?: string } | undefined)?.completionStatus).toBe("completed");
});
