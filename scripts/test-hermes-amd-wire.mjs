import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import companion from "../electron/hermesCompanion.js";

const root = process.cwd();
const bundleRoot = path.resolve(process.env.HERMES_RUNTIME_ROOT || path.join(root, ".electron-build/hermes-runtime-v4"));
const bundle = { pythonRoot: path.join(bundleRoot, "python"), pythonExecutable: path.join(bundleRoot, "python/python.exe"),
  sourceRoot: path.join(bundleRoot, "source"), sitePackagesRoot: path.join(bundleRoot, "site-packages") };
const home = fs.mkdtempSync(path.join(root, ".tmp", "amd-wire-"));
// Existing unrelated/user settings exercise the semantic merge as well as fresh generation.
fs.writeFileSync(path.join(home, "config.yaml"), "agent:\n  reasoning_effort: medium\n  reasoning_overrides:\n    OtherModel: medium\n  max_iterations: 42\n");
companion.ensureManagedHermesConfig(home, { baseUrl: "https://developer.amd.com.cn/radeon/api/v1", model: "Qwen3.8-27B", includeCareerAdaptMcp: false, bundledRuntime: bundle });
const mode = process.argv.includes("--unpatched") ? "unpatched" : "patched";
const output = path.join(root, "docs/quality", `amd-qwen-reasoning-${mode}-wire-20261031.json`);
if (fs.existsSync(output)) throw new Error("wire_evidence_exists");
const result = spawnSync(bundle.pythonExecutable, ["tests/support/hermes-amd-wire.py", home, output, mode], {
  env: { ...process.env, PYTHONHOME: bundle.pythonRoot, PYTHONPATH: [bundle.sourceRoot, bundle.sitePackagesRoot].join(path.delimiter), PYTHONUTF8: "1", HERMES_HOME: home },
  stdio: "inherit", windowsHide: true
});
process.exitCode = result.status ?? 1;
