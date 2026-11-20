import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import companion from "../electron/hermesCompanion.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = companion.loadCareerAdaptEnvironment(projectRoot);
const baseUrl = environment.CAREERADAPT_MIMO_BASE_URL?.trim();
const model = environment.CAREERADAPT_MIMO_MODEL?.trim();
const apiKey = environment.CAREERADAPT_MIMO_API_KEY?.trim();
if (baseUrl !== "https://developer.amd.com.cn/radeon/api/v1" || model !== "MiMo-V2.6-Flash" || !apiKey) {
  throw new Error("MiMo local configuration is missing or has an unexpected endpoint/model.");
}

// A separate port and build directory prevent reuse of the normal development
// server and its provider settings. The overrides exist only in this process tree.
const port = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 3200, maxAttempts: 100 });
if (!port) throw new Error("No local port is available for MiMo development.");
Object.assign(environment, {
  AI_PROVIDER: "openai-compatible", AI_BASE_URL: baseUrl, AI_MODEL: model, AI_API_KEY: apiKey,
  HERMES_PROVIDER: "openai-compatible", HERMES_BASE_URL: baseUrl, HERMES_MODEL: model,
  HERMES_CUSTOM_CAREERADAPT_API_KEY: apiKey,
  CAREERADAPT_APP_PORT: String(port), PORT: String(port),
  CAREERAD_NEXT_DIST_DIR: ".tmp/mimo-local-next",
  HERMES_HOME: path.join(projectRoot, ".tmp", "mimo-local-hermes")
});
const child = spawn(process.execPath, ["--max-old-space-size=4096", path.join(projectRoot, "scripts/dev-with-hermes.mjs")], {
  cwd: projectRoot, env: environment, stdio: "inherit", windowsHide: true
});
child.once("error", error => { console.error(`MiMo development startup failed: ${error.message}`); process.exitCode = 1; });
child.once("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
