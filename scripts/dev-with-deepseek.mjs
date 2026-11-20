import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import companion from "../electron/hermesCompanion.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = companion.loadCareerAdaptEnvironment(projectRoot);
const baseUrl = environment.CAREERADAPT_DEEPSEEK_BASE_URL?.trim();
const model = environment.CAREERADAPT_DEEPSEEK_MODEL?.trim();
const apiKey = environment.CAREERADAPT_DEEPSEEK_API_KEY?.trim();
if (baseUrl !== "https://api.deepseek.com" || model !== "deepseek-flash" || !apiKey) {
  throw new Error("DeepSeek local configuration is missing or has an unexpected endpoint/model.");
}

// Browser-owned settings can override server defaults. Use an isolated origin
// so selecting this process never overwrites or silently reuses another profile.
const port = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 3210, maxAttempts: 1 });
if (!port) throw new Error("DeepSeek's local port 3210 is occupied; stop the other process before starting this profile.");
Object.assign(environment, {
  AI_PROVIDER: "openai-compatible", AI_BASE_URL: baseUrl, AI_MODEL: model, AI_API_KEY: apiKey,
  HERMES_PROVIDER: "openai-compatible", HERMES_BASE_URL: baseUrl, HERMES_MODEL: model,
  HERMES_CUSTOM_CAREERADAPT_API_KEY: apiKey,
  CAREERADAPT_APP_PORT: String(port), PORT: String(port),
  CAREERAD_NEXT_DIST_DIR: ".tmp/deepseek-local-next",
  HERMES_HOME: path.join(projectRoot, ".tmp", "deepseek-local-hermes")
});
const child = spawn(process.execPath, ["--max-old-space-size=4096", path.join(projectRoot, "scripts/dev-with-hermes.mjs")], {
  cwd: projectRoot, env: environment, stdio: "inherit", windowsHide: true
});
child.once("error", error => { console.error(`DeepSeek development startup failed: ${error.message}`); process.exitCode = 1; });
child.once("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
