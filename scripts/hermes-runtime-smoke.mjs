import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import companion from "../electron/hermesCompanion.js";
import { startFakeOpenAiProvider } from "../tests/support/fake-openai-compatible-provider.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.resolve(process.env.HERMES_RUNTIME_ROOT?.trim() || path.join(projectRoot, ".electron-build", "hermes-runtime-v4"));
const providerKey = "careeradapt-test-provider-key";
const runtimeControlKey = "careeradapt-hermes-runtime-control-key";
const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "careerad-hermes-smoke-"));
const provider = await startFakeOpenAiProvider({ apiKey: providerKey, mode: "smoke" });
const runtimePort = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 19642, maxAttempts: 100 });
if (!runtimePort) throw new Error("no free port for hermetic Hermes smoke");
const runtimeUrl = `http://127.0.0.1:${runtimePort}`;
const environment = {
  ...process.env,
  NODE_ENV: "test",
  HERMES_RUNTIME_ROOT: bundleRoot,
  HERMES_RUNTIME_URL: runtimeUrl,
  HERMES_RUNTIME_API_KEY: runtimeControlKey,
  API_SERVER_KEY: runtimeControlKey,
  HERMES_API_KEY: "",
  HERMES_PROVIDER: "openai-compatible",
  HERMES_BASE_URL: provider.baseUrl,
  HERMES_MODEL: "careeradapt-test",
  HERMES_CUSTOM_CAREERADAPT_API_KEY: providerKey,
  AI_API_KEY: "",
  CAREERADAPT_BASE_URL: "http://127.0.0.1:1",
  HERMES_HOME: hermesHome,
  HERMES_RUNTIME_PROTOCOL: "official"
};
const handle = await companion.startHermesCompanion({
  projectRoot,
  environment,
  runtimeControlKey,
  hermesHome,
  hermesRuntimeRoot: bundleRoot,
  requireBundledRuntime: true,
  reuseExistingRuntime: false,
  watchMcpBridge: false,
  includeCareerAdaptMcp: false,
  timeoutMs: 60_000
});

try {
  if (!handle.ok) throw new Error(`Hermes runtime smoke could not start: ${handle.reason || "unknown"}`);
  assert(handle.runtimeApiKey === runtimeControlKey, "Hermes child did not retain the owner control key");
  const health = await requestJson(`${runtimeUrl}/health`, runtimeControlKey);
  assert(health.response.ok, `authenticated Hermes health failed: HTTP ${health.response.status}`);
  const models = await requestJson(`${runtimeUrl}/v1/models`, runtimeControlKey);
  assert(models.response.ok, `authenticated Hermes models failed: HTTP ${models.response.status}`);

  const wrongControlKeyResponse = await requestJson(`${runtimeUrl}/v1/models`, "wrong-hermes-control-key");
  assert(wrongControlKeyResponse.response.status === 401, `wrong control key returned HTTP ${wrongControlKeyResponse.response.status}`);
  assert(wrongControlKeyResponse.payload.error?.code === "gateway_auth_failed", "wrong control key did not fail at the Hermes gateway auth boundary");

  const started = await fetch(`${runtimeUrl}/v1/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${runtimeControlKey}` },
    body: JSON.stringify({ input: "你好", model: "careeradapt-test", instructions: "Return one short greeting." }),
    signal: AbortSignal.timeout(30_000)
  });
  const startedPayload = await started.json();
  assert(started.status === 202 && typeof startedPayload.run_id === "string", `Hermes run did not start: HTTP ${started.status}`);
  const events = await readRunEvents(`${runtimeUrl}/v1/runs/${encodeURIComponent(startedPayload.run_id)}/events`, runtimeControlKey);
  const completed = events.find((event) => event.event === "run.completed");
  const failed = events.find((event) => event.event === "run.failed");
  assert(!failed && completed && typeof completed.output === "string" && completed.output.length > 0, `Hermes run did not complete: ${JSON.stringify(failed || events.at(-1))}`);
  assert(provider.requests.length >= 1, "fake provider did not receive a model request");
  assert(provider.requests.every((request) => request.authorization === `Bearer ${providerKey}`), "runtime control key crossed into Provider Authorization");

  console.log(`[Hermes runtime-smoke] PASS runtime=${runtimeUrl}`);
  console.log(`[Hermes runtime-smoke] run=completed providerCalls=${provider.requests.length} controlAuth=runtime_control_auth`);
} finally {
  await companion.stopHermesCompanion(handle);
  await provider.close();
  console.log(`[Hermes runtime-smoke] hermesHome=${hermesHome}`);
}

async function requestJson(url, apiKey) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000)
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function readRunEvents(url, apiKey) {
  const response = await fetch(url, {
    headers: { Accept: "text/event-stream", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60_000)
  });
  assert(response.ok && response.body, `Hermes run event stream failed: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const value = line.slice("data:".length).trim();
      if (value && value !== "[DONE]") events.push(JSON.parse(value));
    }
    if (done) break;
  }
  return events;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
