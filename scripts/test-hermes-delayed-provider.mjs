import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import companion from "../electron/hermesCompanion.js";

const root = process.cwd();
const bundleRoot = path.resolve(".electron-build/hermes-runtime-v4");
const runtime = { pythonRoot: path.join(bundleRoot, "python"), pythonExecutable: path.join(bundleRoot, "python/python.exe"),
  sourceRoot: path.join(bundleRoot, "source"), sitePackagesRoot: path.join(bundleRoot, "site-packages") };
const home = fs.mkdtempSync(path.join(root, ".tmp/p518b-delayed-"));
companion.ensureManagedHermesConfig(home, { baseUrl: "https://developer.amd.com.cn/radeon/api/v1", model: "Qwen3.8-27B", includeCareerAdaptMcp: false });
const result = spawnSync(runtime.pythonExecutable, ["tests/support/p518b-delayed-hermes.py", home, "docs/quality/p518b-delayed-hermes-20261031.json"], {
  env: { ...process.env, HERMES_HOME: home, PYTHONHOME: runtime.pythonRoot, PYTHONPATH: [runtime.sourceRoot, runtime.sitePackagesRoot].join(path.delimiter),
    HERMES_API_TIMEOUT: "18", HERMES_STREAM_READ_TIMEOUT: "1.2", HERMES_STREAM_STALE_TIMEOUT: "1.8", HERMES_API_CALL_STALE_TIMEOUT: "1.8", PYTHONUTF8: "1" },
  stdio: "inherit", windowsHide: true, timeout: 60000
});
process.exitCode = result.status ?? 1;
