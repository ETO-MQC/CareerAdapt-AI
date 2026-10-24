import { expect, test } from "@playwright/test";

test("Web development accepts a write-only key and applies a model for the next task", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const secret = "e2e-dummy-provider-key";
  const actions: string[] = [];
  const active = { provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "before-model",
    credentialConfigured: true, credentialSource: "server_env", configFingerprint: "before", configGeneration: 1, source: "runtime_readback" };
  const snapshot = { overallState: "ready", processReady: true, apiReady: true, providerReady: true,
    careerMcpReady: true, toolSurfaceReady: true, runReady: true, careerSkillsReady: true,
    credentialConfigured: true, model: active.model, runtimeConfig: { active, desired: active, applyStatus: "applied", verified: true } };
  await page.addInitScript(() => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1", model: "before-model", apiKeyConfigured: true }));
  });
  await page.route("**/api/agent/runtime/hermes/control", async (route) => {
    const credentialStatus = { available: true, configured: true, source: "session_memory" };
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { ok: true, snapshot, credentialStatus } });
      return;
    }
    const body = route.request().postDataJSON();
    actions.push(body.action);
    const control = { ok: true, snapshot, receipt: { applyStatus: "applied", verified: true,
      restartPerformed: body.action === "set_credential" } };
    if (body.action === "set_credential") {
      expect(body.credential.apiKey).toBe(secret);
      expect(route.request().headers()["x-ai-config"] ?? "").not.toContain(secret);
    }
    await route.fulfill({ json: body.action === "set_credential" ? { ...credentialStatus, ok: true, control } : control });
  });
  await page.route("**/api/agent/runtime/hermes/health", (route) => route.fulfill({ json: { available: false, runtimeId: "hermes" } }));
  await page.goto("/settings?category=ai");
  const key = page.getByLabel("API Key", { exact: true });
  await expect(key).toBeEnabled();
  await expect(page.getByText(/Key 仅保留在本机服务端内存中/)).toBeVisible();
  for (const selector of [".ai-runtime-credential-help", ".ai-runtime-save-state"]) {
    const metrics = await page.locator(selector).evaluate((element) => ({
      height: element.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(element).lineHeight)
    }));
    expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight + 2);
  }
  if (process.env.AI_CONFIG_SCREENSHOT) {
    await page.screenshot({ path: `${process.env.AI_CONFIG_SCREENSHOT}.png`, fullPage: true });
  }
  await key.fill(secret);
  await page.getByRole("button", { name: "测速", exact: true }).click();
  await expect(page.getByText(/新 API Key 尚未应用/)).toBeVisible();
  await page.getByRole("button", { name: "保存并应用", exact: true }).click();
  await expect(key).toHaveValue("");
  expect(actions).toContain("set_credential");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(secret);
  await page.locator("#ai-model").fill("next-model");
  await page.getByRole("button", { name: "保存并应用", exact: true }).click();
  await expect(page.getByText("配置已应用，下一轮任务使用所选模型；当前运行不受影响。", { exact: true })).toBeVisible();
  expect(actions).toContain("update_config");
  expect(actions).not.toContain("restart");
});

test("restart progress clears on Ready in both settings tabs and retains a failure reason", async ({ page }) => {
  const active = { provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "test-model",
    credentialConfigured: true, configFingerprint: "test", configGeneration: 1, source: "runtime_readback" };
  const ready = { overallState: "ready", processReady: true, apiReady: true, providerReady: true,
    careerMcpReady: true, toolSurfaceReady: true, runReady: true, careerSkillsReady: true,
    credentialConfigured: true, model: active.model, runtimeConfig: { active, applyStatus: "applied", verified: true } };
  let state: Record<string, unknown> = ready;
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
    provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "test-model", apiKeyConfigured: true
  })));
  await page.route("**/api/agent/runtime/hermes/control", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { ok: true, snapshot: state,
        credentialStatus: { available: true, configured: true, source: "session_memory" } } });
      return;
    }
    const body = route.request().postDataJSON();
    if (body.action === "restart") {
      state = { ...ready, overallState: "restarting", processReady: false, apiReady: false, runReady: false,
        runtimeConfig: { active, applyStatus: "restarting_runtime", verified: false } };
    }
    await route.fulfill({ json: { ok: true, snapshot: state, receipt: { accepted: true, executed: true } } });
  });
  await page.route("**/api/agent/runtime/hermes/health", (route) => route.fulfill({ json: { available: false, runtimeId: "hermes" } }));
  await page.goto("/settings?category=hermes");
  await page.getByRole("button", { name: "重启 AI Agent", exact: true }).click();
  await expect(page.locator("p.settings-save-state")).toHaveText("正在重启 AI Agent…");
  await page.getByRole("button", { name: "AI 配置 接口与模型设置", exact: true }).click();
  await expect(page.locator(".ai-runtime-save-state")).toHaveText("正在重启 AI Agent…");
  state = ready;
  await expect(page.locator(".ai-runtime-save-state")).toHaveCount(0, { timeout: 10000 });
  await page.getByRole("button", { name: "AI Agent 服务与 Career 工具状态", exact: true }).click();
  await expect(page.getByText("正在重启 AI Agent…", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "重启 AI Agent", exact: true }).click();
  await expect(page.locator("p.settings-save-state")).toHaveText("正在重启 AI Agent…");
  state = { ...ready, overallState: "degraded", providerReady: false, runReady: false,
    reasonCode: "provider_auth_invalid", runtimeConfig: { active, applyStatus: "failed", reasonCode: "provider_auth_invalid", verified: false } };
  await expect(page.getByText("API Key 无效或没有模型权限。", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("正在重启 AI Agent…", { exact: true })).toHaveCount(0);
});
