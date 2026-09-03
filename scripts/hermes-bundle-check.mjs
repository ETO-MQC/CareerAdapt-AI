import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.resolve(process.env.HERMES_RUNTIME_ROOT?.trim() || path.join(projectRoot, ".electron-build", "hermes-runtime-v4"));

try {
  const manifest = readJson(path.join(bundleRoot, "runtime-manifest.json"));
  assert(manifest.format === 2, "runtime manifest format must be 2");
  assert(manifest.runtime === "hermes-agent", "runtime manifest does not identify hermes-agent");
  for (const field of [
    "hermesVersion",
    "hermesGitCommit",
    "hermesSourceTreeHash",
    "pythonVersion",
    "sitePackagesFingerprint",
    "careerAdaptPatchVersion",
    "careerAdaptPatchHash",
    "careerSkillsHash"
  ]) {
    assert(typeof manifest[field] === "string" && manifest[field].trim(), `runtime manifest field missing: ${field}`);
  }
  assert(manifest.careerAdaptPatchVersion === "careeradapt-api-toolsets-v1", "CareerAdapt runtime patch version is not pinned");

  const requiredPaths = [
    ".build-complete",
    manifest.sourceRoot || "source",
    manifest.pythonRoot || "python",
    manifest.sitePackagesRoot || "site-packages",
    manifest.bundledSkillsRoot || "skills",
    path.join(manifest.sourceRoot || "source", "hermes_cli"),
    path.join(manifest.sourceRoot || "source", "gateway"),
    path.join(manifest.sourceRoot || "source", "gateway", "platforms", "api_server.py")
  ];
  for (const relativePath of requiredPaths) assert(fs.existsSync(path.join(bundleRoot, relativePath)), `bundled runtime path missing: ${relativePath}`);

  const pythonRoot = path.join(bundleRoot, manifest.pythonRoot || "python");
  const pythonExecutable = process.platform === "win32" ? path.join(pythonRoot, "python.exe") : path.join(pythonRoot, "bin", "python");
  assert(fs.existsSync(pythonExecutable), `bundled Python executable missing: ${pythonExecutable}`);
  const sourceRoot = path.join(bundleRoot, manifest.sourceRoot || "source");
  const sitePackagesRoot = path.join(bundleRoot, manifest.sitePackagesRoot || "site-packages");
  const pythonEnvironment = {
    ...process.env,
    HERMES_RUNTIME_MODE: "bundled",
    HERMES_RUNTIME_ROOT: bundleRoot,
    PYTHONHOME: pythonRoot,
    PYTHONPATH: [sourceRoot, sitePackagesRoot].join(path.delimiter)
  };
  const { stdout } = await execFileAsync(pythonExecutable, [
    "-c",
    "import json, sys; import hermes_cli; import gateway.run; import gateway.platforms.api_server; print(json.dumps({'python': '.'.join(map(str, sys.version_info[:3])), 'imports': True}))"
  ], {
    cwd: bundleRoot,
    env: pythonEnvironment,
    windowsHide: true,
    maxBuffer: 1_000_000
  });
  const importCheck = JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
  assert(importCheck.imports === true, "bundled Hermes import check did not complete");
  assert(importCheck.python === manifest.pythonVersion, `bundled Python version mismatch: ${importCheck.python} != ${manifest.pythonVersion}`);

  console.log(`[Hermes bundle-check] PASS root=${bundleRoot}`);
  console.log(`[Hermes bundle-check] version=${manifest.hermesVersion} commit=${manifest.hermesGitCommit.slice(0, 12)} patch=${manifest.careerAdaptPatchVersion}`);
} catch (error) {
  console.error(`[Hermes bundle-check] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  assert(fs.existsSync(filePath), `file missing: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
