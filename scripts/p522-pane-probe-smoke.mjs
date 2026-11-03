import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";
const hermes = process.env.HERMES_SOURCE_DIR || path.join(process.env.LOCALAPPDATA, "hermes/hermes-agent");
const desktop = path.join(hermes, "apps/desktop");
const req = createRequire(path.join(desktop, "package.json"));
const root = path.resolve(".artifacts/p522-host-experience/smoke-" + Date.now());
const home = path.join(root, "home");
const pluginDir = path.join(home, "desktop-plugins/careeradapt-experience-p522");
fs.mkdirSync(pluginDir, { recursive: true });
fs.copyFileSync(".artifacts/p522-host-experience/production-like/plugin.js", path.join(pluginDir, "plugin.js"));
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
  await page.getByText("CareerAdapt", {exact:true}).first().waitFor({timeout:60000});
  await page.setViewportSize({width:1440,height:900});
  const probeDir=path.join(home,'desktop-plugins/careeradapt-pane-probe-p522');
  fs.mkdirSync(probeDir,{recursive:true});
  fs.copyFileSync('.artifacts/p522-host-experience/pane-probe/plugin.js',path.join(probeDir,'plugin.js'));
  await page.getByRole('button',{name:'New session',exact:true}).first().click();
  if(await page.getByRole('button',{name:'Show right sidebar',exact:true}).count()) await page.getByRole('button',{name:'Show right sidebar',exact:true}).click();
  await page.getByLabel('CareerAdapt Synthetic Artifact',{exact:true}).waitFor({timeout:10000});
  evidence.pane=await page.getByLabel('CareerAdapt Synthetic Artifact',{exact:true}).boundingBox();
  evidence.separators=await page.getByRole('separator').evaluateAll(es=>es.map(e=>({label:e.getAttribute('aria-label'),tabindex:e.getAttribute('tabindex'),outer:e.outerHTML.slice(0,700)})));
  evidence.buttons=await page.getByRole('button').evaluateAll(es=>es.map(e=>({label:e.getAttribute('aria-label'),text:e.textContent,title:e.getAttribute('title')})));
  await page.screenshot({path:path.join(root,'pane.png')});
  fs.writeFileSync(path.join(root,'body.txt'),await page.locator('body').innerText());
  evidence.desktopVersion=await app.evaluate(({app})=>app.getVersion());
  evidence.status='PASS';
} catch (error) {
  evidence.status = "FAIL"; evidence.failure = String(error);
  if (app) { const page = await app.firstWindow().catch(() => null); if (page) { evidence.body = (await page.locator("body").innerText()).slice(0, 12000); await page.screenshot({ path: path.join(root, "failure.png") }).catch(() => {}); } }
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  fs.writeFileSync("docs/architecture/evidence/p522/pane-probe-" + (process.env.P522_RUN || String(Date.now())) + ".json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}
if (evidence.status !== "PASS") process.exitCode = 1;
