import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";
const hermes = process.env.HERMES_SOURCE_DIR || path.join(process.env.LOCALAPPDATA, "hermes/hermes-agent");
const desktop = path.join(hermes, "apps/desktop");
const req = createRequire(path.join(desktop, "package.json"));
const root = path.resolve(".artifacts/p520b2b2-profile-plugin/smoke-" + Date.now());
const home = path.join(root, "home");
const pluginDir = path.join(home, "desktop-plugins/careeradapt-profile-packaging-poc");
fs.mkdirSync(pluginDir, { recursive: true });
fs.copyFileSync(".artifacts/p520b2b2-profile-plugin/production-like/plugin.js", path.join(pluginDir, "plugin.js"));
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
  await page.getByText("CareerAdapt Profile", { exact: true }).first().waitFor({ timeout: 60000 });
  await page.getByText("CareerAdapt Profile", { exact: true }).first().click();
  await page.getByRole("article", { name: "CareerAdapt Profile read only" }).waitFor({ timeout: 10000 });
  evidence.route = await page.evaluate(() => location.hash);
  evidence.text = await page.locator(".ca-profile-poc").innerText();
  evidence.styleCount = await page.locator("style[data-careeradapt-profile-poc]").count();
  await page.screenshot({ path: path.join(root, "profile.png"), fullPage: true });
  // Nested Host scrollers clip locator screenshots; capture a tall viewport instead.
  await page.setViewportSize({ width: 1280, height: 2400 });
  await page.screenshot({ path: path.join(root, "profile-full.png"), fullPage: true });
  await page.getByRole("region", { name: "语言" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, "profile-bottom.png") });
  await page.getByRole("heading", { name: "虚构同学·星舟" }).scrollIntoViewIfNeeded();
  for (const label of ["基础资料", "教育经历", "工作经历", "项目经历", "奖项", "技能", "语言"]) {
    await page.getByRole("region", { name: label }).waitFor();
  }
  await page.getByRole("button", { name: "重新加载合成资料" }).click();
  await page.getByRole("heading", { name: "虚构同学·星舟" }).waitFor();
  evidence.clientRefresh = "PASS";
  await page.reload();
  await page.getByRole("heading", { name: "虚构同学·星舟" }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(root, "refreshed.png"), fullPage: true });
  evidence.pageRefresh = "PASS";
  await page.evaluate(() => { location.hash = "/"; });
  await page.locator(".ca-profile-poc").waitFor({ state: "detached" });
  if (await page.locator("style[data-careeradapt-profile-poc]").count() !== 0) throw new Error("Navigate away CSS leak");
  await page.screenshot({ path: path.join(root, "away.png") });
  await page.getByText("CareerAdapt Profile", { exact: true }).first().click();
  await page.getByRole("heading", { name: "虚构同学·星舟" }).waitFor();
  evidence.navigateAwayReturn = "PASS";
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
    await page.evaluate(async () => { const store = await import("/src/contrib/plugins-store.ts"); await store.setPluginEnabled("careeradapt-profile-packaging-poc", false); });
    await page.locator("style[data-careeradapt-profile-poc]").waitFor({ state: "detached", timeout: 5000 });
    if (await page.locator(".ca-profile-poc").count()) throw new Error("Disabled UI remains");
    if (await page.getByText("CareerAdapt Profile", { exact: true }).count()) throw new Error("Disabled navigation remains");
    await page.screenshot({ path: path.join(root, "disabled-" + i + ".png") });
    await page.evaluate(async () => { const store = await import("/src/contrib/plugins-store.ts"); await store.setPluginEnabled("careeradapt-profile-packaging-poc", true); });
    await page.getByText("CareerAdapt Profile", { exact: true }).first().click();
    await page.locator(".ca-profile-poc").waitFor({ timeout: 5000 });
    if (await page.locator("style[data-careeradapt-profile-poc]").count() !== 1) throw new Error("Style leak");
    await page.screenshot({ path: path.join(root, "enabled-" + i + ".png"), fullPage: true });
    const version = await page.evaluate(async () => (await import("/src/contrib/registry.ts")).$registryVersion.get());
    fs.appendFileSync(path.join(pluginDir, "plugin.js"), "\n// hot reload " + i + "\n");
    await page.waitForFunction(async version => (await import("/src/contrib/registry.ts")).$registryVersion.get() > version, version, { timeout: 10000 });
    await page.locator(".ca-profile-poc").waitFor({ timeout: 5000 });
    if (await page.locator("style[data-careeradapt-profile-poc]").count() !== 1) throw new Error("Hot reload style leak");
    const contributionCounts = await page.evaluate(async () => {
      const { registry } = await import("/src/contrib/registry.ts");
      return ["routes", "sidebar.nav"].map(area => registry.getArea(area).filter(c => c.source === "plugin:careeradapt-profile-packaging-poc").length);
    });
    if (contributionCounts.some(count => count !== 1)) throw new Error("Duplicate or missing contribution");
    if (await page.locator(".ca-profile-poc").count() !== 1) throw new Error("Duplicate React view");
    evidence.lifecycle.push({ cycle: i, disabledStyles: 0, enabledStyles: 1, diskHotReloadStyles: 1, contributionCounts });
  }
  evidence.inventory = await page.evaluate(async () => (await import("/src/contrib/plugins-store.ts")).$pluginRecords.get()["careeradapt-profile-packaging-poc"]);
  evidence.desktopVersion = await app.evaluate(({ app }) => app.getVersion());
  evidence.electronVersion = await app.evaluate(() => process.versions.electron);
  evidence.revocation = "BLOCKED; B2-B1 evidence retained; no backend in this plugin";
  evidence.status = evidence.errors.length || evidence.consoleErrors.length ? "FAIL" : "PASS";
} catch (error) {
  evidence.status = "FAIL"; evidence.failure = String(error);
  if (app) { const page = await app.firstWindow().catch(() => null); if (page) { evidence.body = (await page.locator("body").innerText()).slice(0, 12000); await page.screenshot({ path: path.join(root, "failure.png") }).catch(() => {}); } }
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  fs.writeFileSync("docs/architecture/evidence/p520b2b2-profile-plugin-smoke-" + (process.env.P520B2B2_RUN || "final") + ".json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}
if (evidence.status !== "PASS") process.exitCode = 1;
