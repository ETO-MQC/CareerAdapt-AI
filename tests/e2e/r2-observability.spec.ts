import { expect, test } from "@playwright/test";

test("R2: saved credential remains visible when configuration and Companion fail", async ({ page }) => {
  let configured = false;
  const secret = "r2-ui-synthetic-key";
  const snapshot = { overallState: "degraded", processReady: true, apiReady: false, providerReady: false,
    careerMcpReady: true, toolSurfaceReady: false, runReady: false, careerSkillsReady: false,
    reasonCode: "hermes_companion_unreachable", runtimeConfig: { applyStatus: "failed", rollbackOccurred: false },
    model: "r2-model", updatedAt: new Date().toISOString(), restartAttempt: 0, uptimeMs: 0,
    careerDomainToolCount: 0, hermesCareerToolCount: 0, requiredCareerFacadesReady: 0,
    requiredCareerFacadesTotal: 7, latestLifecycleEntries: [] };
  await page.route("**/api/agent/runtime/hermes/control", async (route) => {
    const credentialStatus = () => ({ available: true, configured, source: "secure_store" });
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { ok: true, snapshot, credentialStatus: credentialStatus() } });
      return;
    }
    const body = route.request().postDataJSON();
    if (body.action === "set_credential") {
      expect(body.credential.apiKey).toBe(secret);
      configured = true;
      await route.fulfill({ json: { ...credentialStatus(), ok: true, control: { ok: false,
        reason: "hermes_companion_unreachable", snapshot,
        receipt: { applyStatus: "failed", verified: false, restartPerformed: false } } } });
      return;
    }
    await route.fulfill({ json: { ok: false, snapshot } });
  });
  await page.route("**/api/agent/runtime/hermes/health", (route) => route.fulfill({ status: 503,
    json: { available: false, reason: "hermes_companion_unreachable", providerStatus: "unknown" } }));
  await page.goto("/settings?category=ai");
  await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
  await page.goto("/settings?category=ai");
  await page.locator("#ai-model").fill("r2-model");
  const key = page.getByLabel("API Key", { exact: true });
  await key.fill(secret);
  await page.getByRole("button", { name: "保存并应用", exact: true }).click();
  await expect(key).toHaveValue("");
  await expect(page.getByText("API Key 已安全保存；配置应用与模型请求状态请分别查看。", { exact: true })).toBeVisible();
  await expect(page.getByText(/Hermes Companion 不可达/).first()).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(secret);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(secret);
  await page.getByRole("button", { name: "AI Agent 服务与 Career 工具状态", exact: true }).click();
  await expect(page.getByText(/Companion：未就绪 · Provider：未就绪 · MCP：就绪 · 配置应用：failed/)).toBeVisible();
});
