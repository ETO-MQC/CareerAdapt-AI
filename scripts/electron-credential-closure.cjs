/* eslint-disable @typescript-eslint/no-require-imports -- Launch the actual CommonJS Electron product. */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
const fixtureRoot = fs.mkdtempSync(path.join(root, ".tmp/credential-closure-"));
const profile = path.join(fixtureRoot, "profile");
fs.mkdirSync(profile);
const evidencePath = process.env.CLOSURE_EVIDENCE_PATH || path.join(root, ".tmp/r1-closure-evidence.json");
const key = `closure-synthetic-${crypto.randomBytes(16).toString("hex")}`;
const evidence = { baseline: "d8c31c3", kind: "actual Electron development product + real IPC + synthetic Provider", attempts: Number(process.env.CLOSURE_ROUND || "1"), verificationHypothesis: "Await IPC status in Node polling; async waitForFunction predicates can resolve false without waiting. Use normal window shutdown and check process exit plus Local State.", phases: [], requests: [], packaged: "BLOCKED; no new package built" };
let child;
let browser;
let provider;

function saveEvidence() {
  const content = JSON.stringify(evidence, (name, value) => name === "exited" ? undefined : value, 2);
  fs.writeFileSync(`${evidencePath}.pending`, content);
  fs.renameSync(`${evidencePath}.pending`, evidencePath);
}

function timeout(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]).finally(() => clearTimeout(timer));
}

async function port() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const value = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return value;
}

function receipt(result) {
  return { credentialWriteOk: result.ok, credentialConfigured: result.configured, credentialSource: result.source, configurationOk: result.control?.ok, applyStatus: result.control?.receipt?.applyStatus, verified: result.control?.receipt?.verified, restartPerformed: result.control?.receipt?.restartPerformed, reason: result.control?.receipt?.reasonCode || result.control?.reason };
}

async function main() {
  provider = http.createServer(async (request, response) => {
    const authenticated = request.headers.authorization === `Bearer ${key}`;
    const url = new URL(request.url, "http://127.0.0.1");
    if (!authenticated) { response.writeHead(401); response.end('{"error":{"message":"synthetic unauthorized"}}'); return; }
    if (url.pathname === "/v1/models") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: ["closure-model", "Qwen3.8-27B"].map(id => ({ id })) }));
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") { response.writeHead(404); response.end(); return; }
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body || "{}");
    evidence.requests.push({ model: payload.model, path: url.pathname, authenticated, status: 200 });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "closure-response", object: "chat.completion", model: payload.model, choices: [{ message: { role: "assistant", content: '{"ok":true}' }, finish_reason: "stop" }] }));
  });
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  const appPort = await port();
  const runtimePort = await port();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const dist = path.relative(root, path.join(fixtureRoot, "next"));

  async function launch(restore, profilePath = profile, corrupt = false) {
    const debugPort = await port();
    const env = { ...process.env, NODE_ENV: "development", CLOSURE_PROFILE: profilePath,
      CAREERAD_NEXT_DIST_DIR: dist, CAREERADAPT_APP_PORT: String(appPort), PORT: String(appPort),
      CAREERADAPT_HERMES_HOME: path.join(profilePath, "hermes"), HERMES_HOME: path.join(profilePath, "hermes"),
      HERMES_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`, HERMES_WEB_CONTROL_ENABLED: "false",
      AI_PROVIDER: "openai-compatible", HERMES_PROVIDER: "openai-compatible", AI_BASE_URL: baseUrl, HERMES_BASE_URL: baseUrl,
      AI_MODEL: "closure-model", HERMES_MODEL: "closure-model", HERMES_INFERENCE_MODEL: "closure-model",
      AI_API_KEY: restore ? "" : key, HERMES_CUSTOM_CAREERADAPT_API_KEY: restore ? "" : key,
      OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", HERMES_API_KEY: "", HERMES_RUNTIME_API_KEY: "", API_SERVER_KEY: "",
      CAREERADAPT_CREDENTIAL_SOURCE: "", PADDLEOCR_VL_ENDPOINT: "http://127.0.0.1:1", NEXT_TELEMETRY_DISABLED: "1" };
    delete env.ELECTRON_RUN_AS_NODE;
    const phase = { restoredLaunch: restore, corruptLaunch: corrupt, events: [] };
    evidence.phases.push(phase);
    saveEvidence();
    child = spawn(require("electron"), [`--remote-debugging-port=${debugPort}`, path.join(root, "tests/support/electron-product-closure.cjs")], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const processHandle = child;
    phase.pid = processHandle.pid;
    phase.exited = new Promise(resolve => processHandle.once("exit", (code, signal) => { phase.exitCode = code; phase.signal = signal; saveEvidence(); resolve(); }));
    const consume = stream => {
      let pending = "";
      stream.on("data", chunk => {
        pending += chunk.toString();
        const lines = pending.split(/\r?\n/u); pending = lines.pop();
        for (const line of lines) {
          if (line.startsWith('{"closureEvent"')) phase.events.push(JSON.parse(line));
          if (/credential_store_read_failed|hermes_renderer_not_ready|careeradapt_app_not_ready/u.test(line)) phase.safeStartupReason = line.includes("credential_store_read_failed") ? "credential_store_read_failed" : line.includes("hermes_renderer_not_ready") ? "hermes_renderer_not_ready" : "careeradapt_app_not_ready";
        }
        saveEvidence();
      });
    };
    consume(child.stdout); consume(child.stderr);
    if (corrupt) {
      await timeout(phase.exited, 25_000, "corrupt startup did not terminate normally");
      assert(phase.events.some(event => event.code === "credential_store_read_failed"));
      phase.explicitRestoreFailure = true;
      delete phase.exited; child = undefined;
      return;
    }
    let connected;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error("product exited before IPC window");
      try {
        if (!browser) browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 });
        connected = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith(appUrl));
        if (connected && await connected.evaluate(() => Boolean(window.careerAdaptDesktop)).catch(() => false)) break;
      } catch { /* Bound startup wait for the local debugging socket and product page only. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!connected) throw new Error("product IPC window unavailable within startup budget");
    await connected.waitForFunction(() => Boolean(window.careerAdaptDesktop), null, { timeout: 15_000 });
    // Capture storage independently, even when runtime readiness later blocks the scenario.
    phase.credentialAtIpc = await connected.evaluate(() => window.careerAdaptDesktop.describeProviderCredential());
    saveEvidence();
    const readyDeadline = Date.now() + 90_000;
    let status;
    while (Date.now() < readyDeadline) {
      status = await connected.evaluate(() => window.careerAdaptDesktop.getHermesStatus());
      phase.lastRuntimeStatus = { state: status?.overallState, reason: status?.reasonCode, providerReady: status?.providerReady, careerMcpReady: status?.careerMcpReady, applyStatus: status?.runtimeConfig?.applyStatus };
      saveEvidence();
      if (status?.overallState === "ready") break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(status?.overallState, "ready", "actual awaited product READY not reached");
    phase.rendererAndRuntimeReady = true;
    return { page: connected, phase };
  }

  async function closeNormally(page, phase) {
    // Real window close -> product window-all-closed -> app.quit, without taskkill or app.exit.
    await page.evaluate(() => window.close()).catch(() => undefined);
    await timeout(phase.exited, 25_000, "normal product exit did not complete");
    assert.equal(phase.exitCode, 0);
    phase.localStateOnDisk = fs.existsSync(path.join(profile, "Local State"));
    saveEvidence();
    assert.equal(phase.localStateOnDisk, true);
    delete phase.exited;
    browser = undefined; child = undefined;
  }

  async function requestModel(page, model) {
    const header = Buffer.from(encodeURIComponent(JSON.stringify({ provider: "openai-compatible", baseUrl, model }))).toString("base64");
    const response = await page.request.post(`${appUrl}/api/ai/test`, { headers: { "x-ai-test-mode": "latency", "x-ai-config": header } });
    const body = await response.json();
    const result = { localHttpStatus: response.status(), ok: body.ok, code: body.code, model: body.model || body.configuration?.model, credentialSource: body.configuration?.sources?.credential };
    assert.equal(result.ok, true);
    return result;
  }

  let { page, phase } = await launch(false);
  phase.beforeSave = await page.evaluate(() => window.careerAdaptDesktop.describeProviderCredential());
  assert.equal(phase.beforeSave.configured, false);
  const saved = await page.evaluate(({ key, baseUrl }) => window.careerAdaptDesktop.setProviderCredential({ apiKey: key, provider: "openai-compatible", baseUrl, model: "closure-model" }), { key, baseUrl });
  phase.save = receipt(saved);
  saveEvidence();
  assert.equal(saved.ok, true); assert.equal(saved.control.ok, true);
  assert.equal(saved.control.receipt.applyStatus, "applied");
  phase.encryptedAtRest = !fs.readFileSync(path.join(profile, "provider-credentials.json"), "utf8").includes(key);
  assert.equal(phase.encryptedAtRest, true);
  phase.modelRequest = await requestModel(page, "closure-model");
  saveEvidence();

  const rejected = await page.evaluate(key => window.careerAdaptDesktop.setProviderCredential({ apiKey: key, provider: "openai-compatible", baseUrl: "invalid-url", model: "closure-model" }), key);
  phase.failedConfigurationWrite = receipt(rejected);
  assert.equal(rejected.ok, true); assert.equal(rejected.control.ok, false);
  assert.equal(rejected.control.receipt.applyStatus, "failed");
  phase.afterFailedApply = await page.evaluate(() => window.careerAdaptDesktop.describeProviderCredential());
  saveEvidence();
  assert.equal(phase.afterFailedApply.configured, true);
  // Explicitly restore valid coordinates after the deliberate validation failure.
  const valid = await page.evaluate(baseUrl => window.careerAdaptDesktop.updateHermesConfig({ provider: "openai-compatible", baseUrl, model: "closure-model", apiKey: "", credentialAction: "unchanged" }), baseUrl);
  assert.equal(valid.ok, true);
  await closeNormally(page, phase);

  ({ page, phase } = await launch(true));
  phase.recoveredCredential = await page.evaluate(() => window.careerAdaptDesktop.describeProviderCredential());
  saveEvidence();
  assert.equal(phase.recoveredCredential.configured, true);
  assert.equal(phase.recoveredCredential.source, "secure_store");
  phase.modelRequest = await requestModel(page, "closure-model");
  const switched = await page.evaluate(baseUrl => window.careerAdaptDesktop.updateHermesConfig({ provider: "openai-compatible", baseUrl, model: "Qwen3.8-27B", apiKey: "", credentialAction: "unchanged" }), baseUrl);
  phase.modelSwitch = { ok: switched.ok, ...switched.receipt };
  assert.equal(switched.ok, true); assert.equal(switched.receipt.restartPerformed, false);
  phase.switchedModelRequest = await requestModel(page, "Qwen3.8-27B");
  await closeNormally(page, phase);

  const corruptProfile = path.join(fixtureRoot, "corrupt-profile");
  fs.mkdirSync(corruptProfile);
  const corrupted = JSON.parse(fs.readFileSync(path.join(profile, "provider-credentials.json"), "utf8"));
  corrupted.encryptedApiKey = Buffer.from("invalid synthetic ciphertext").toString("base64");
  const corruptedText = JSON.stringify(corrupted);
  fs.writeFileSync(path.join(corruptProfile, "provider-credentials.json"), corruptedText);
  await launch(true, corruptProfile, true);
  assert.equal(fs.readFileSync(path.join(corruptProfile, "provider-credentials.json"), "utf8"), corruptedText);
  evidence.status = "PASS";
}

main().catch(error => {
  evidence.status = "BLOCKED_OR_FAILED";
  evidence.failure = String(error.message).split(key).join("[redacted]").replace(/Bearer\s+\S+/giu, "Bearer [redacted]").slice(0, 1200);
  process.exitCode = 1;
  saveEvidence();
}).finally(async () => {
  // Never turn a stuck exit into normal-exit evidence. No forced process termination here.
  if (child?.exitCode === null) evidence.remainingTestPid = child.pid;
  saveEvidence();
  if (browser) {
    const productPage = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith("http://127.0.0.1:"));
    if (productPage) await productPage.evaluate(() => window.close()).catch(() => undefined);
    const pendingExit = evidence.phases.at(-1)?.exited;
    if (pendingExit) await timeout(pendingExit, 25_000, "cleanup exit not observed").catch(() => { evidence.cleanupExitUnverified = true; });
    await browser.close().catch(() => undefined);
  }
  if (provider) { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
  for (const phase of evidence.phases) delete phase.exited;
  saveEvidence();
  console.log(JSON.stringify(evidence, null, 2));
});
