/* eslint-disable @typescript-eslint/no-require-imports -- Actual Electron product integration harness. */
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { _electron } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const evidence = { baseline: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(), provider: "simulated", phases: [], status: "RUNNING" };
const output = path.join(root, `.tmp/p51-core-readiness-${Date.now()}.json`);
let application;
let productProcess;
let provider;
const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function main() {
  const { startFakeOpenAiProvider } = await import("../tests/support/fake-openai-compatible-provider.mjs");
  provider = await startFakeOpenAiProvider({ mode: "integration" });
  fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, ".tmp/core-readiness-"));
  const profile = path.join(fixture, "profile");
  fs.mkdirSync(profile);
  const appPort = await port();
  const runtimePort = await port();
  const appUrl = `http://127.0.0.1:${appPort}`;
  for (const restored of [false, true]) {
    const phase = { restored, startedAt: new Date().toISOString(), states: [] };
    evidence.phases.push(phase);
    save();
    const env = { ...process.env, NODE_ENV: "development", CLOSURE_PROFILE: profile,
      CAREERAD_NEXT_DIST_DIR: path.relative(root, path.join(fixture, "next")),
      CAREERADAPT_APP_PORT: String(appPort), PORT: String(appPort),
      CAREERADAPT_HERMES_HOME: path.join(profile, "hermes"), HERMES_HOME: path.join(profile, "hermes"),
      HERMES_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`, HERMES_WEB_CONTROL_ENABLED: "false",
      AI_PROVIDER: "openai-compatible", HERMES_PROVIDER: "openai-compatible",
      AI_BASE_URL: provider.baseUrl, HERMES_BASE_URL: provider.baseUrl,
      AI_MODEL: "careeradapt-test", HERMES_MODEL: "careeradapt-test", HERMES_INFERENCE_MODEL: "careeradapt-test",
      AI_API_KEY: restored ? "" : provider.apiKey, HERMES_CUSTOM_CAREERADAPT_API_KEY: restored ? "" : provider.apiKey,
      OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", HERMES_API_KEY: "", HERMES_RUNTIME_API_KEY: "", API_SERVER_KEY: "",
      PADDLEOCR_VL_ENDPOINT: "http://127.0.0.1:1", NEXT_TELEMETRY_DISABLED: "1" };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: require("electron"),
      args: [path.join(root, "tests/support/electron-product-closure.cjs")], cwd: root, env, timeout: 60_000 });
    productProcess = application.process();
    phase.pid = productProcess.pid;
    const page = await application.firstWindow({ timeout: 60_000 });
    await page.waitForURL(`${appUrl}/**`, { timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.careerAdaptDesktop), null, { timeout: 15_000 });
    phase.credential = await page.evaluate(() => window.careerAdaptDesktop.describeProviderCredential());
    const deadline = Date.now() + 70_000;
    let status;
    do {
      status = await page.evaluate(() => window.careerAdaptDesktop.getHermesStatus());
      if (phase.states.at(-1)?.state !== status?.overallState || phase.states.at(-1)?.reason !== status?.reasonCode) {
        phase.states.push({ at: new Date().toISOString(), state: status?.overallState, reason: status?.reasonCode });
        save();
      }
      if (status?.overallState === "ready" || status?.overallState === "degraded") break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    phase.capturedAt = new Date().toISOString();
    phase.status = { state: status?.overallState, reason: status?.reasonCode, runtimeUrl: status?.runtimeUrl,
      processReady: status?.processReady, apiReady: status?.apiReady, providerReady: status?.providerReady,
      careerMcpReady: status?.careerMcpReady, toolSurfaceReady: status?.toolSurfaceReady, runReady: status?.runReady,
      failureTimeSnapshot: status?.failureTimeSnapshot, runtimeConfig: status?.runtimeConfig,
      health: status?.health, lifecycle: status?.latestLifecycleEntries };
    phase.probe = await application.evaluate(async () => {
      const runtimeUrl = process.env.HERMES_RUNTIME_URL;
      const key = process.env.API_SERVER_KEY;
      const probes = [];
      for (const suffix of ["/health", "/health/detailed"]) {
        for (const authenticated of [true, false]) {
          try {
            const result = await fetch(`${runtimeUrl}${suffix}`, { headers: authenticated ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(4_000) });
            const body = await result.json().catch(() => ({}));
            probes.push({ suffix, authenticated, status: result.status,
              health: { status: body.status, version: body.version, activeRuns: body.active_runs } });
          } catch (error) { probes.push({ suffix, authenticated, code: error.cause?.code || error.name }); }
        }
      }
      return { runtimeUrl, keyConfigured: Boolean(key), probes };
    });
    const health = await page.request.get(`${appUrl}/api/agent/runtime/hermes/health`);
    const body = await health.json();
    phase.nextHealth = { httpStatus: health.status(), reason: body.reason, runtimeUrl: body.runtimeUrl,
      runtimeHealth: body.runtimeHealth, providerDiagnostic: body.providerDiagnostic, providerStatus: body.providerStatus };
    const listenerPort = Number(new URL(status.runtimeUrl).port);
    phase.listener = JSON.parse(execFileSync("powershell", ["-NoProfile", "-Command",
      `$listeners = Get-NetTCPConnection -LocalPort ${listenerPort} -State Listen -ErrorAction SilentlyContinue; @($listeners | ForEach-Object { $owner = Get-Process -Id $_.OwningProcess; [pscustomobject]@{ port = $_.LocalPort; pid = $_.OwningProcess; createdAt = $owner.StartTime.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress`],
      { encoding: "utf8", windowsHide: true }).trim() || "[]");
    save();
    assert.equal(status?.overallState, "ready", "actual product readiness failed; single capture stops here");
    if (!restored) {
      const result = await page.evaluate(({ apiKey, baseUrl }) => window.careerAdaptDesktop.setProviderCredential({ apiKey, baseUrl, provider: "openai-compatible", model: "careeradapt-test" }), { apiKey: provider.apiKey, baseUrl: provider.baseUrl });
      phase.saved = { ok: result.ok, applied: result.control?.receipt?.applyStatus };
      assert.equal(result.ok, true);
      assert.equal(result.control?.ok, true);
    } else {
      assert.equal(phase.credential.source, "secure_store");
      const result = await page.evaluate(baseUrl => window.careerAdaptDesktop.updateHermesConfig({ provider: "openai-compatible", baseUrl, model: "Qwen3.8-27B", apiKey: "", credentialAction: "unchanged" }), provider.baseUrl);
      phase.switched = { ok: result.ok, receipt: result.receipt };
      phase.afterSwitch = await page.evaluate(() => window.careerAdaptDesktop.getHermesStatus());
      save();
      assert.equal(result.ok, true);
      assert.equal(phase.afterSwitch.runtimeConfig?.verified, true);
      assert.equal(phase.afterSwitch.runtimeConfig?.activeFingerprint, phase.afterSwitch.runtimeConfig?.desiredFingerprint);
      phase.readback = await application.evaluate(async () => {
        const response = await fetch(`${process.env.HERMES_RUNTIME_URL}/api/model/options`, {
          headers: { Authorization: `Bearer ${process.env.API_SERVER_KEY}` }, signal: AbortSignal.timeout(5_000)
        });
        const body = await response.json();
        return { httpStatus: response.status, model: body.model, provider: body.provider };
      });
      const requestsBefore = provider.requests.length;
      await page.goto(`${appUrl}/ai-workspace`);
      await page.getByLabel("描述你的求职任务").fill("你好");
      const startResponse = page.waitForResponse(response => {
        if (!response.url().endsWith("/api/agent/runtime/hermes")) return false;
        return response.request().postDataJSON()?.action === "run_start";
      });
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      const response = await startResponse;
      await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-message-role="assistant"]'))
        .some(message => message.textContent.includes("你好，Hermes hermetic runtime 已就绪。")), null, { timeout: 60_000 });
      phase.request = { httpStatus: response.status(), providerRequests: provider.requests.length - requestsBefore,
        model: provider.requests.at(-1)?.model, uiCompleted: true };
      assert.equal(phase.request.httpStatus, 200);
      assert.equal(phase.request.providerRequests, 1);
      assert.equal(phase.request.model, "Qwen3.8-27B");
    }
    await application.close();
    phase.exitCode = productProcess.exitCode;
    assert.equal(phase.exitCode, 0);
    application = undefined;
    save();
  }
  evidence.status = "PASS";
}
main().catch(error => { evidence.status = "FAILED"; evidence.failure = error.message; save(); process.exitCode = 1; }).finally(async () => {
  if (application) { await application.close(); evidence.phases.at(-1).exitCode = productProcess.exitCode; }
  evidence.providerRequests = provider?.requests.map(request => ({ model: request.model, authenticated: request.authorization === `Bearer ${provider.apiKey}` }));
  await provider?.close();
  save();
  console.log(JSON.stringify({ evidenceFile: path.relative(root, output), status: evidence.status, phases: evidence.phases.map(phase => ({ restored: phase.restored, state: phase.status?.state, reason: phase.status?.reason, exitCode: phase.exitCode })) }, null, 2));
});
