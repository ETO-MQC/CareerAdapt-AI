/* eslint-disable @typescript-eslint/no-require-imports -- Actual Electron product integration harness. */
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");
const { _electron } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const evidence = { baseline: "4c0cf96976704bbc5b98f5fd1892663c8a8c2665", phases: [], status: "RUNNING" };
const output = path.join(root, ".tmp/p51-core-readiness.json");
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
    phase.status = { state: status?.overallState, reason: status?.reasonCode, runtimeUrl: status?.runtimeUrl,
      processReady: status?.processReady, apiReady: status?.apiReady, providerReady: status?.providerReady,
      careerMcpReady: status?.careerMcpReady, lifecycle: status?.latestLifecycleEntries };
    phase.probe = await application.evaluate(async () => {
      const runtimeUrl = process.env.HERMES_RUNTIME_URL;
      const key = process.env.API_SERVER_KEY;
      const probes = [];
      for (const suffix of ["/health", "/api/health"]) {
        for (const authenticated of [true, false]) {
          try {
            const result = await fetch(`${runtimeUrl}${suffix}`, { headers: authenticated ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(4_000) });
            probes.push({ suffix, authenticated, status: result.status });
          } catch (error) { probes.push({ suffix, authenticated, code: error.cause?.code || error.name }); }
        }
      }
      return { runtimeUrl, keyConfigured: Boolean(key), probes };
    });
    const health = await page.request.get(`${appUrl}/api/agent/runtime/hermes/health`);
    const body = await health.json();
    phase.nextHealth = { httpStatus: health.status(), reason: body.reason, runtimeUrl: body.runtimeUrl,
      diagnostics: body.runtimeHealth?.diagnostics, providerStatus: body.providerStatus };
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
      assert.equal(result.ok, true);
      const config = Buffer.from(encodeURIComponent(JSON.stringify({ provider: "openai-compatible", baseUrl: provider.baseUrl, model: "Qwen3.8-27B" }))).toString("base64");
      const response = await page.request.post(`${appUrl}/api/ai/test`, { headers: { "x-ai-test-mode": "latency", "x-ai-config": config } });
      phase.request = { status: response.status(), ok: (await response.json()).ok };
      assert.equal(phase.request.ok, true);
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
  console.log(JSON.stringify(evidence, null, 2));
});
