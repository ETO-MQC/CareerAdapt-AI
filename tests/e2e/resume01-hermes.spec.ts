import { test, expect, type Page } from "@playwright/test";
import { prepareCoreSourceResume, readStore, installCoreWritingProvider } from "./support/p51CoreWorkflow";

async function fresh(page: Page) {
  const previous = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"))).not.toBe(previous);
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    return (await readStore(page, "agentSessions")).some(row => row.id === id && row.id !== previous);
  }).toBe(true);
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90_000 });
  await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
}
async function send(page: Page, text: string) {
  await page.getByLabel("描述你的求职任务").fill(text);
  await expect(page.getByLabel("描述你的求职任务")).toHaveValue(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click({ timeout: 15_000 });
}
test("RESUME01 real Hermes review-only then explicit confirmed improvement isolates Profile", async ({ page }, info) => {
  const baseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  const apiKey = process.env.HERMES_INTEGRATION_PROVIDER_KEY;
  if (!baseUrl || !apiKey) throw new Error("synthetic_provider_missing");
  await page.addInitScript(settings => localStorage.setItem("careeradapt-ai-settings", JSON.stringify(settings)),
    { baseUrl, apiKey, model: "careeradapt-test", provider: "openai-compatible", credentialAction: "replace" });
  await page.goto("/ai-workspace");
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90_000 });
  await expect.poll(async () => (await readStore(page, "appMeta")).some(row => row.key === "demoSeededAt")).toBe(true);
  await prepareCoreSourceResume(page);
  const branches = await readStore(page, "resumeBranches");
  const revisions = await readStore(page, "resumeRevisions");
  const profiles = await readStore(page, "profiles");
  await page.goto("/ai-workspace");
  await fresh(page);
  await send(page, "P51-C02-COMPOSE UPDATE RESUME01-REVIEW 完整审阅当前通用简历，只读，不修改。");
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("RESUME01REVIEWDONE", { timeout: 90_000 });
  expect(await readStore(page, "resumeBranches")).toEqual(branches);
  expect(await readStore(page, "resumeRevisions")).toEqual(revisions);
  expect(await readStore(page, "profiles")).toEqual(profiles);
  await expect(page.locator(".agent-confirmation")).toHaveCount(0);
  await info.attach("review-only", { body: await page.screenshot(), contentType: "image/png" });
  await fresh(page);
  await installCoreWritingProvider(page);
  await send(page, "P51-C02-COMPOSE UPDATE 根据审阅生成改善提案，等待我的明确确认，不同步个人资料库。");
  await expect(page.locator(".agent-confirmation")).toBeVisible();
  expect(await readStore(page, "resumeRevisions")).toEqual(revisions);
  expect(await readStore(page, "profiles")).toEqual(profiles);
  await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(async () => (await readStore(page, "resumeRevisions")).length).toBe(revisions.length + 1);
  expect(await readStore(page, "profiles")).toEqual(profiles);
  const after = await readStore(page, "resumeBranches");
  expect(after).toHaveLength(branches.length);
  expect(after.filter(branch => branch.currentRevisionId !== branches.find(old => old.id === branch.id)?.currentRevisionId)).toHaveLength(1);
  await info.attach("confirmed-improvement", { body: await page.screenshot(), contentType: "image/png" });
});
