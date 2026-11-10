import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium, _electron, expect } from "@playwright/test";
import companion from "../electron/hermesCompanion.js";
import { startFakeOpenAiProvider } from "../tests/support/fake-openai-compatible-provider.mjs";

const root = process.cwd(), mode = process.argv[2] || "web";
const evidence = path.join(root, "docs/quality/hermes-provider-fix-20261110", `${mode}-${Date.now()}`);
fs.mkdirSync(evidence, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), `hermes-provider-${mode}-`));
const provider = await startFakeOpenAiProvider({ responseForRequest: ({ messages, tools }) => {
  const last = messages.findLastIndex(message => message.role === "user");
  const text = JSON.stringify(messages[last]?.content || "");
  if (messages.slice(last + 1).some(message => message.role === "tool")) return { content: "已通过真实 Career 工具读取岗位列表。" };
  if (text.includes("列出当前岗位")) {
    const name = tools.map(tool => tool.function?.name).find(name => name === "career.job.list" || name?.endsWith("career_job_list"));
    if (!name) throw new Error("career_job_list_not_visible_to_provider");
    return { toolCall: { name, arguments: "{}" } };
  }
  return { content: "本地模型连接成功。" };
} });
const environment = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "Path", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ComSpec"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
const port = await companion.findAvailablePort({ preferredPort: mode === "web" ? 3196 : 3197, reservedPorts: [] });
const runtimePort = await companion.findAvailablePort({ preferredPort: mode === "web" ? 29872 : 29873, reservedPorts: [port] });
Object.assign(environment, { CAREERADAPT_APP_PORT: String(port), HERMES_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`, NEXT_TELEMETRY_DISABLED: "1" });
const requestTimeline = [];
const result = { mode, status: "RUNNING", realProviderCalls: 0, evidence, userData: home };
let child, browser, desktop, page, output;
const appUrl = `http://127.0.0.1:${port}`;
const status = async () => mode === "web"
  ? (await (await page.request.get(`${appUrl}/api/agent/runtime/hermes/control`)).json()).snapshot
  : page.evaluate(() => window.careerAdaptDesktop.getHermesStatus());
async function ready() { await expect.poll(async () => (await status())?.runReady, { timeout: 90_000 }).toBe(true); return status(); }
async function send(text, expected) {
  const before = await page.locator('.agent-message-row.is-assistant').count();
  await page.getByLabel("描述你的求职任务").fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(async () => page.locator('.agent-message-row.is-assistant').count(), { timeout: 90_000 }).toBeGreaterThan(before);
  await expect(page.locator('.agent-message-row.is-assistant').last()).toContainText(expected, { timeout: 90_000 });
  await expect.poll(async () => (await status()).activeRunId, { timeout: 30_000 }).toBeFalsy();
}
async function launchDesktop() {
  const executablePath = process.env.PROVIDER_FIX_PACKAGED_EXE;
  if (!executablePath || !fs.existsSync(executablePath)) throw new Error("packaged_executable_required");
  desktop = await _electron.launch({ executablePath, args: [`--user-data-dir=${home}`, "--disable-gpu"], env: environment, timeout: 90_000 });
  const mainOutput = fs.createWriteStream(path.join(evidence, "desktop.log"), { flags: "a" });
  desktop.process().stdout?.on("data", data => mainOutput.write(data));
  desktop.process().stderr?.on("data", data => mainOutput.write(data));
  desktop.process().once("exit", () => mainOutput.end());
  page = await desktop.firstWindow();
  page.on("response", response => {
    if (!response.url().endsWith("/api/agent/runtime/hermes")) return;
    const body = response.request().postDataJSON();
    requestTimeline.push({ at: new Date().toISOString(), action: body?.action, status: response.status() });
  });
  await desktop.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.hide(); });
  const identity = await desktop.evaluate(({ app, safeStorage }) => ({ packaged: app.isPackaged, userData: app.getPath("userData"), secureStorage: safeStorage.isEncryptionAvailable() }));
  expect(identity).toMatchObject({ packaged: true, userData: home, secureStorage: true });
  result.desktopIdentity = identity;
}
try {
  if (mode === "web") {
    const stage = path.join(root, ".tmp/rp011-app/provider-fix-source");
    const control = `synthetic-control-${randomUUID()}`;
    Object.assign(environment, { NODE_ENV: "development", CAREERADAPT_PROJECT_ROOT: stage, CAREERADAPT_BASE_URL: appUrl,
      HERMES_RUNTIME_ROOT: path.join(root, ".electron-build/hermes-runtime-v4"), HERMES_HOME: home,
      HERMES_WEB_CONTROL_ENABLED: "true", HERMES_RUNTIME_API_KEY: control, API_SERVER_KEY: control,
      AI_PROVIDER: "openai-compatible", AI_BASE_URL: provider.baseUrl, AI_MODEL: "careeradapt-test", HERMES_CUSTOM_CAREERADAPT_API_KEY: provider.apiKey,
      CAREERAD_NEXT_DIST_DIR: `.next-provider-${Date.now()}` });
    fs.writeFileSync(path.join(home, "config.yaml"), "memory:\n  nudge_interval: 0\ncurator:\n  enabled: false\n");
    output = fs.openSync(path.join(evidence, "server.log"), "a");
    child = spawn(process.execPath, [path.join(root, ".tmp/rp011-app/node_modules/next/dist/bin/next"), "dev", "-p", String(port)], { cwd: stage, env: environment, windowsHide: true, stdio: ["ignore", output, output] });
    await expect.poll(async () => { try { return (await fetch(`${appUrl}/api/agent/mcp`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, { timeout: 60_000 }).toBe(true);
    browser = await chromium.launch({ channel: "msedge", headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${appUrl}/setup`);
  } else { await launchDesktop(); }
  await expect(page.getByLabel("API 密钥", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await status())?.apiReady, { timeout: 90_000 }).toBe(true);
  await page.getByLabel("API 密钥", { exact: true }).fill(provider.apiKey);
  await page.getByLabel("API 地址", { exact: true }).fill(provider.baseUrl);
  await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await expect(page).not.toHaveURL(/\/setup$/u, { timeout: 90_000 });
  result.initial = await ready();
  console.log(`[${mode}] configuration READY`);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(provider.apiKey);
  expect(result.initial.runtimeConfig).toMatchObject({ active: { model: "careeradapt-test", credentialConfigured: true } });
  expect(result.initial).toMatchObject({ toolSurfaceReady: true, requiredCareerFacadesTotal: 10, requiredCareerFacadesReady: 10 });
  await page.goto(`${appUrl}/ai-workspace`);
  const context = page.locator('.career-context-trigger'); await expect(context).toBeVisible();
  if ((await context.innerText()).includes("选择人物")) {
    await context.click(); await page.getByRole("tab", { name: "新增人物" }).click();
    await page.getByLabel("人物名称").fill("运行时验收人物"); await page.getByRole("button", { name: "创建人物" }).click(); await page.getByRole("button", { name: "使用此版本" }).click();
    await expect(context).toContainText("运行时验收人物");
  }
  await send("请列出当前岗位", "已通过真实 Career 工具读取岗位列表。");
  console.log(`[${mode}] real Career tool completed`);
  await page.screenshot({ path: path.join(evidence, "tool-success.png"), fullPage: true });
  await page.goto(`${appUrl}/settings`); await page.getByRole("button", { name: /AI 配置/ }).click();
  await page.getByLabel("模型", { exact: true }).fill("provider-fix-next-model");
  await page.getByRole("button", { name: "保存并应用", exact: true }).click();
  await expect.poll(async () => (await status()).runtimeConfig?.active?.model, { timeout: 90_000 }).toBe("provider-fix-next-model");
  result.hot = await ready(); expect(result.hot.runtimeConfig).toMatchObject({ applyStatus: "applied", verified: true });
  if (result.hot.runtimeConfig.restartPerformed) {
    const configHome = mode === "web" ? home : path.join(home, "hermes");
    expect(fs.readdirSync(configHome).some(name => name.startsWith("config.yaml.recovery-") && name.endsWith(".bak"))).toBe(true);
    result.managedYamlRecoveryVerified = true;
  }
  await page.goto(`${appUrl}/ai-workspace`); await send("你好", "本地模型连接成功。");
  expect(provider.requests.at(-1).model).toBe("provider-fix-next-model");
  console.log(`[${mode}] next task uses selected model`);
  await page.screenshot({ path: path.join(evidence, "model-success.png"), fullPage: true });
  if (mode === "packaged") {
    await desktop.close(); desktop = undefined;
    const encrypted = fs.readFileSync(path.join(home, "provider-credentials.json"), "utf8");
    expect(encrypted).not.toContain(provider.apiKey);
    await launchDesktop();
    await expect(page.locator('.career-context-trigger')).toBeVisible({ timeout: 30_000 });
    result.restored = await ready();
    expect(result.restored.runtimeConfig.active).toMatchObject({ model: "provider-fix-next-model", credentialConfigured: true });
    // Renderer reapplies persisted model settings as managed_config. Verify the
    // credential's actual main-process origin instead of that projection label.
    result.restartCredentialOrigin = await desktop.evaluate(() => ({
      source: process.env.CAREERADAPT_CREDENTIAL_SOURCE,
      configured: Boolean(process.env.AI_API_KEY)
    }));
    expect(result.restartCredentialOrigin).toEqual({ source: "secure_store", configured: true });
    const stored = await page.evaluate(() => window.careerAdaptDesktop.describeProviderCredential());
    expect(stored.configured).toBe(true);
    await page.goto(`${appUrl}/ai-workspace`); await send("重启后你好", "本地模型连接成功。");
    result.restartCredentialRestored = true;
    console.log(`[${mode}] secure credential and model restored after restart`);
    await page.screenshot({ path: path.join(evidence, "restart-success.png"), fullPage: true });
  }
  expect(provider.requests.some(request => request.response?.toolCall?.name?.includes("career_job_list"))).toBe(true);
  expect(provider.requests.every(request => request.authorization === `Bearer ${provider.apiKey}`)).toBe(true);
  result.status = "PASS";
} catch (error) {
  result.status = "FAIL"; result.error = String(error); process.exitCode = 1;
  if (page) { try { await page.screenshot({ path: path.join(evidence, "failure.png"), fullPage: true }); result.failureSnapshot = await status(); } catch { /* retain the original failure */ } }
} finally {
  result.requestTimeline = requestTimeline;
  result.requests = provider.requests.map(request => ({ model: request.model, tools: request.toolNames, selectedTool: request.response?.toolCall?.name, providerAuthorizationMatched: request.authorization === `Bearer ${provider.apiKey}` }));
  fs.writeFileSync(path.join(evidence, "summary.json"), JSON.stringify(result, null, 2));
  if (desktop) await desktop.close();
  if (browser) { try { await page.request.post(`${appUrl}/api/agent/runtime/hermes/control`, { headers: { Origin: appUrl }, data: { action: "stop" }, timeout: 10_000 }); } catch { /* owned process also exits below */ } await browser.close(); }
  child?.kill(); if (output !== undefined) fs.closeSync(output);
  await provider.close();
  const log = path.join(evidence, "server.log");
  if (fs.existsSync(log)) fs.writeFileSync(log, fs.readFileSync(log, "utf8").replace(/token=careeradapt-token-[A-Za-z0-9_-]+/g, "token=[REDACTED]"));
}
console.log(`Provider fix ${mode}: ${result.status} ${evidence}`);
