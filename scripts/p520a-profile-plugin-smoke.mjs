import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";
const hermes = process.env.HERMES_SOURCE_DIR || path.join(process.env.LOCALAPPDATA, "hermes/hermes-agent");
const desktop = path.join(hermes, "apps/desktop");
const req = createRequire(path.join(desktop, "package.json"));
const root = path.resolve(".artifacts/p520a-profile-plugin/smoke-" + Date.now());
const home = path.join(root, "home");
const pluginDir = path.join(home, "desktop-plugins/careeradapt-profile-poc");
fs.mkdirSync(pluginDir, { recursive: true });
fs.copyFileSync(".artifacts/p520a-profile-plugin/production-like/plugin.js", path.join(pluginDir, "plugin.js"));
fs.writeFileSync(path.join(home, "config.yaml"), "model:\n  default: poc-offline\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n  api_key: poc-not-a-secret\n");
fs.writeFileSync(path.join(home, ".env"), "");
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value && !/(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_BASE_URL)$/.test(key) && !key.startsWith("HERMES") && key !== "ELECTRON_RUN_AS_NODE"));
Object.assign(env, { HERMES_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: path.join(root, "user-data"), HERMES_DESKTOP_IGNORE_EXISTING: "1", HERMES_DESKTOP_HERMES_ROOT: hermes, HERMES_DESKTOP_APP_NAME: "CareerAdaptPoC-" + Date.now(), HERMES_DESKTOP_DEV_SERVER: "http://127.0.0.1:5174" });
let app;
const evidence = { status: "RUNNING", root, mode: "Real locked Desktop Electron main/preload/renderer, Vite development serving; isolated home; offline provider", errors: [], consoleErrors: [] };
try {
  app = await _electron.launch({ executablePath: req("electron"), args: [desktop, "--disable-gpu", "--no-sandbox"], env, cwd: desktop, timeout: 30000 });
  const page = await app.firstWindow({ timeout: 30000 });
  page.on("pageerror", e => evidence.errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") evidence.consoleErrors.push(m.text()); });
  await page.screenshot({ path: path.join(root, "initial.png") });
  await page.getByText("Career Profile", { exact: true }).first().waitFor({ timeout: 60000 });
  await page.getByText("Career Profile", { exact: true }).first().click();
  await page.getByRole("article", { name: "CareerAdapt Profile read only" }).waitFor({ timeout: 10000 });
  evidence.route = await page.evaluate(() => location.hash);
  evidence.text = await page.locator(".ca-profile-poc").innerText();
  evidence.styleCount = await page.locator("style[data-careeradapt-profile-poc]").count();
  await page.screenshot({ path: path.join(root, "profile.png"), fullPage: true });
  evidence.themes = [];
  for (const mode of ["light", "dark", "light"]) {
    const current = await page.evaluate(() => document.documentElement.dataset.hermesMode);
    if (current !== mode) await page.keyboard.press("Shift+X");
    await page.waitForFunction(mode => document.documentElement.dataset.hermesMode === mode, mode, { timeout: 5000 });
    evidence.themes.push(await page.locator(".ca-profile-poc").evaluate(el => { const style = getComputedStyle(el); return { mode: document.documentElement.dataset.hermesMode, color: style.color, background: style.backgroundColor, styles: document.querySelectorAll("style[data-careeradapt-profile-poc]").length }; }));
    await page.screenshot({ path: path.join(root, "profile-" + mode + ".png"), fullPage: true });
  }
  // Harness-only introspection of the REAL host loader; plugin imports public SDK only.
  evidence.lifecycle = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(async () => { const store = await import("/src/contrib/plugins-store.ts"); await store.setPluginEnabled("careeradapt-profile-poc", false); });
    await page.locator("style[data-careeradapt-profile-poc]").waitFor({ state: "detached", timeout: 5000 });
    await page.evaluate(async () => { const store = await import("/src/contrib/plugins-store.ts"); await store.setPluginEnabled("careeradapt-profile-poc", true); });
    await page.getByText("Career Profile", { exact: true }).first().click();
    await page.locator(".ca-profile-poc").waitFor({ timeout: 5000 });
    if (await page.locator("style[data-careeradapt-profile-poc]").count() !== 1) throw new Error("Style leak");
    const version = await page.evaluate(async () => (await import("/src/contrib/registry.ts")).$registryVersion.get());
    fs.appendFileSync(path.join(pluginDir, "plugin.js"), "\n// hot reload " + i + "\n");
    await page.waitForFunction(async version => (await import("/src/contrib/registry.ts")).$registryVersion.get() > version, version, { timeout: 10000 });
    await page.locator(".ca-profile-poc").waitFor({ timeout: 5000 });
    if (await page.locator("style[data-careeradapt-profile-poc]").count() !== 1) throw new Error("Hot reload style leak");
    evidence.lifecycle.push({ cycle: i, disabledStyles: 0, enabledStyles: 1, diskHotReloadStyles: 1 });
  }
  evidence.inventory = await page.evaluate(async () => (await import("/src/contrib/plugins-store.ts")).$pluginRecords.get()["careeradapt-profile-poc"]);
  evidence.status = evidence.errors.length || evidence.consoleErrors.length ? "FAIL" : "PASS";
} catch (error) {
  evidence.status = "FAIL"; evidence.failure = String(error);
  if (app) { const page = await app.firstWindow().catch(() => null); if (page) { evidence.body = (await page.locator("body").innerText()).slice(0, 12000); await page.screenshot({ path: path.join(root, "failure.png") }).catch(() => {}); } }
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  fs.writeFileSync("docs/architecture/evidence/p520a-profile-plugin-smoke-" + (process.env.P520A_RUN || "final") + ".json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}
if (evidence.status !== "PASS") process.exitCode = 1;
