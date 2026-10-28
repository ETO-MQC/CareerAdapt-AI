import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

test("R1 bundled save/recovery and next-task model selection", async ({ page }) => {
  const baseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL!;
  await page.addInitScript(({ baseUrl }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ provider: "openai-compatible", baseUrl, model: "careeradapt-test", apiKeyConfigured: true })), { baseUrl });
  await page.goto("/ai-workspace");
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90000 });
  const control = async (model: string, allowPending = false) => {
    const settings = { provider: "openai-compatible", baseUrl, model, credentialAction: "unchanged" };
    const r = await page.request.post("/api/agent/runtime/hermes/control", { headers: { Origin: new URL(page.url()).origin, "x-ai-config": Buffer.from(encodeURIComponent(JSON.stringify(settings))).toString("base64") }, data: { action: "update_config" } });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    writeFileSync(".tmp/r1-control-last.json", JSON.stringify({ receipt: body.receipt, config: body.snapshot?.runtimeConfig, reason: body.reason }, null, 2));
    if (allowPending && !body.ok) expect(["deferred", "failed"]).toContain(body.receipt.applyStatus);
    else expect(body.ok).toBe(true);
    if (body.ok) await page.evaluate(settings => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ ...settings, apiKeyConfigured: true })), settings);
    return body.snapshot;
  };
  const greet = async () => {
    const count = await page.locator('[data-message-role="assistant"]').count();
    await page.getByLabel("描述你的求职任务").fill("你好");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(page.locator('[data-message-role="assistant"]')).toHaveCount(count + 1, { timeout: 90000 });
    await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("Hermes hermetic runtime 已就绪", { timeout: 90000 });
    await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot.activeRunId).toBeFalsy();
  };
  await greet();
  const hot = await control("r1-hot-model");
  expect(hot.runtimeConfig).toMatchObject({ applyStatus: "applied", verified: true, restartPerformed: false });
  const previousCount = await page.locator('[data-message-role="assistant"]').count();
  await page.getByLabel("描述你的求职任务").fill("你好");
  const started = page.waitForResponse(r => r.url().endsWith("/api/agent/runtime/hermes") && r.request().postDataJSON()?.action === "run_start");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const oldRunId = (await (await started).json()).data.runId;
  expect(oldRunId).toBeTruthy();
  const root = path.resolve(".electron-build/hermes-runtime-v4");
  execFileSync(path.join(root, "python/python.exe"), ["-c", "from hermes_cli.config import load_config,save_config; c=load_config(); c['user_r1']={'keep':[1,2,3]}; c['model']['temperature']=0.37; save_config(c)"], {
    env: { ...process.env, PYTHONPATH: [path.join(root, "source"), path.join(root, "site-packages")].join(path.delimiter), PYTHONUTF8: "1" }, windowsHide: true
  });
  const pending = await control("Qwen3.8-27B", true);
  if (pending.runtimeConfig.applyStatus !== "applied") {
    expect(pending.runtimeConfig.active.model).toBe("r1-hot-model");
    expect(pending.runtimeConfig.restartPerformed).toBe(false);
  }
  await expect(page.locator('[data-message-role="assistant"]')).toHaveCount(previousCount + 1, { timeout: 90000 });
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("Hermes hermetic runtime 已就绪", { timeout: 90000 });
  await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot.activeRunId).toBeFalsy();
  const recovered = pending.runtimeConfig.applyStatus === "applied" ? pending : await control("Qwen3.8-27B");
  expect(recovered.runtimeConfig).toMatchObject({ applyStatus: "applied", verified: true, restartPerformed: true, active: { model: "Qwen3.8-27B", baseUrl } });
  await greet();
  const config = readFileSync(path.join(process.env.HERMES_HOME!, "config.yaml"), "utf8");
  expect(config).toContain("user_r1:");
  expect(config).toContain("temperature: 0.37");
  writeFileSync(".tmp/r1-hermes-browser-evidence.json", JSON.stringify({ hot: hot.runtimeConfig, deferred: pending.runtimeConfig, recovered: recovered.runtimeConfig, oldRunPreserved: true, userValuesRetained: true }, null, 2));
});
