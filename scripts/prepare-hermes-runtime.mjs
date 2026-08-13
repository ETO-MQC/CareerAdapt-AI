import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const targetRoot = path.join(projectRoot, ".electron-build", "hermes-runtime-v4");
const runtimeLock = JSON.parse(fs.readFileSync(path.join(scriptDirectory, "hermes-runtime-lock.json"), "utf8"));

const sourceRoot = path.resolve(
  process.env.HERMES_SOURCE_DIR?.trim()
    || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "hermes", "hermes-agent")
);
const venvRoot = path.resolve(process.env.HERMES_VENV_DIR?.trim() || path.join(sourceRoot, "venv"));
const pythonHome = path.resolve(
  process.env.HERMES_PYTHON_HOME?.trim()
    || readPyvenvHome(path.join(venvRoot, "pyvenv.cfg"))
    || path.join(sourceRoot, "python")
);
const sitePackages = path.resolve(
  process.env.HERMES_SITE_PACKAGES?.trim()
    || path.join(venvRoot, "Lib", "site-packages")
);

assertDirectory(sourceRoot, "Hermes source checkout");
assertDirectory(venvRoot, "Hermes virtual environment");
assertDirectory(pythonHome, "Hermes Python home");
assertDirectory(sitePackages, "Hermes site-packages");
assertFile(path.join(pythonHome, "python.exe"), "Hermes Python executable");

const hermesVersion = readProjectVersion(path.join(sourceRoot, "pyproject.toml"));
const hermesGitCommit = gitOutput(sourceRoot, ["rev-parse", "HEAD"]);
if (hermesVersion !== runtimeLock.hermesVersion || hermesGitCommit !== runtimeLock.hermesGitCommit) {
  throw new Error(
    `Hermes source identity is not approved. Expected ${runtimeLock.hermesVersion} @ ${runtimeLock.hermesGitCommit}, `
    + `received ${hermesVersion || "unknown"} @ ${hermesGitCommit || "unknown"}. Set HERMES_SOURCE_DIR to the pinned checkout.`
  );
}

const rootPythonFiles = fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".py")
  .map((entry) => entry.name);
const sourcePathspecs = [...sourceDirectoriesForFingerprint(), ...rootPythonFiles, "pyproject.toml"];
const sourceChanges = gitOutput(sourceRoot, ["status", "--porcelain", "--untracked-files=all", "--", ...sourcePathspecs]);
if (sourceChanges) {
  throw new Error(`Hermes source contains unapproved runtime changes:\n${sourceChanges}`);
}

const hermesSourceTreeHash = deterministicTreeHash(sourceRoot, {
  roots: sourcePathspecs.filter((entry) => entry !== "*.py"),
  includeRootPython: true
});
const sitePackagesFingerprint = deterministicTreeHash(sitePackages, { roots: ["."] });
const careerSkillsHash = deterministicTreeHash(path.join(projectRoot, "skills", "career"), { roots: ["."] });
const pythonVersion = readPyvenvVersion(path.join(venvRoot, "pyvenv.cfg"));
if (hermesSourceTreeHash !== runtimeLock.hermesSourceTreeHash
  || pythonVersion !== runtimeLock.pythonVersion
  || sitePackagesFingerprint !== runtimeLock.sitePackagesFingerprint) {
  throw new Error(
    "Hermes runtime dependencies do not match the approved lock: "
    + `source=${hermesSourceTreeHash}, python=${pythonVersion}, site-packages=${sitePackagesFingerprint}.`
  );
}

fs.mkdirSync(targetRoot, { recursive: true });

const pythonTarget = path.join(targetRoot, "python");
const sitePackagesTarget = path.join(targetRoot, "site-packages");
const sourceTarget = path.join(targetRoot, "source");
const skillsTarget = path.join(targetRoot, "skills");

copyTree(pythonHome, pythonTarget);
copyTree(sitePackages, sitePackagesTarget, { skipEditablePathFiles: true });

const sourceDirectories = sourceDirectoriesForFingerprint();

for (const directory of sourceDirectories) {
  const sourcePath = path.join(sourceRoot, directory);
  if (fs.existsSync(sourcePath)) copyTree(sourcePath, path.join(sourceTarget, directory));
}

for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
  if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".py") continue;
  copyTree(path.join(sourceRoot, entry.name), path.join(sourceTarget, entry.name));
}

const careerAdaptPatchHash = patchApiServerMcpToolsets(sourceTarget);

const careerSkillsSource = path.join(projectRoot, "skills", "career");
assertDirectory(careerSkillsSource, "CareerAdapt Hermes skills");
copyTree(careerSkillsSource, path.join(skillsTarget, "careeradapt"));

const buildEnvironment = {
  ...readEnvFile(path.join(projectRoot, ".env")),
  ...readEnvFile(path.join(projectRoot, ".env.local")),
  ...process.env
};

const licenseSource = path.join(sourceRoot, "LICENSE");
if (fs.existsSync(licenseSource)) copyTree(licenseSource, path.join(targetRoot, "LICENSE"));
fs.writeFileSync(
  path.join(targetRoot, "THIRD_PARTY_NOTICES.md"),
  [
    "# CareerAdapt AI bundled Hermes runtime",
    "",
    "CareerAdapt AI bundles the Hermes Agent runtime so users do not need to install Hermes separately.",
    "",
    "- Hermes Agent source: Nous Research hermes-agent",
    "- Hermes license: see LICENSE in this directory",
    "- API keys are not included in this runtime; CareerAdapt AI injects the configured key at process start.",
    "- The runtime is read-only application content. Mutable configuration, sessions, logs and skills are stored under the application user-data directory.",
    ""
  ].join("\n"),
  "utf8"
);

const manifest = {
  format: 2,
  runtime: "hermes-agent",
  hermesVersion,
  hermesGitCommit,
  hermesSourceTreeHash,
  pythonVersion,
  sitePackagesFingerprint,
  careerAdaptPatchVersion: runtimeLock.careerAdaptPatchVersion,
  careerAdaptPatchHash,
  careerSkillsHash,
  sourceRoot: "source",
  pythonRoot: "python",
  sitePackagesRoot: "site-packages",
  bundledSkillsRoot: "skills",
  providerBaseUrl: firstValue(buildEnvironment.HERMES_BASE_URL, buildEnvironment.AI_BASE_URL),
  model: firstValue(buildEnvironment.HERMES_MODEL, buildEnvironment.AI_MODEL),
  generatedAt: new Date().toISOString()
};
fs.writeFileSync(path.join(targetRoot, "runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(targetRoot, ".build-complete"), `${new Date().toISOString()}\n`, "utf8");

const fileCount = countFiles(targetRoot);
const byteCount = sumBytes(targetRoot);
console.log(`Prepared bundled Hermes runtime at ${targetRoot}`);
console.log(`Hermes version: ${manifest.hermesVersion || "unknown"}`);
console.log(`Hermes commit: ${manifest.hermesGitCommit}`);
console.log(`Python version: ${manifest.pythonVersion || "unknown"}`);
console.log(`Runtime size: ${(byteCount / 1024 / 1024).toFixed(1)} MB (${fileCount} files)`);

function readPyvenvHome(filePath) {
  if (!fs.existsSync(filePath)) return "";
  const line = fs.readFileSync(filePath, "utf8").split(/\r?\n/u).find((value) => /^\s*home\s*=\s*/iu.test(value));
  return line ? line.replace(/^\s*home\s*=\s*/iu, "").trim() : "";
}

function readPyvenvVersion(filePath) {
  if (!fs.existsSync(filePath)) return "";
  const line = fs.readFileSync(filePath, "utf8").split(/\r?\n/u).find((value) => /^\s*version_info\s*=\s*/iu.test(value));
  return line ? line.replace(/^\s*version_info\s*=\s*/iu, "").trim() : "";
}

function readProjectVersion(filePath) {
  if (!fs.existsSync(filePath)) return "";
  const content = fs.readFileSync(filePath, "utf8");
  return content.match(/^version\s*=\s*["']([^"']+)["']/mu)?.[1] || "";
}

function sourceDirectoriesForFingerprint() {
  return [
    "acp_adapter", "agent", "assets", "cron", "gateway", "hermes_cli",
    "infographic", "locales", "native", "plugins", "providers", "skills",
    "tools", "tui_gateway", "web"
  ];
}

function gitOutput(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true }).trim();
  } catch (error) {
    throw new Error(`Unable to verify Hermes git identity: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function deterministicTreeHash(baseDirectory, options) {
  const files = [];
  for (const root of options.roots) {
    const absolute = path.resolve(baseDirectory, root);
    if (!fs.existsSync(absolute)) continue;
    if (fs.statSync(absolute).isFile()) files.push(absolute);
    else collectFiles(absolute, files);
  }
  if (options.includeRootPython) {
    for (const entry of fs.readdirSync(baseDirectory, { withFileTypes: true })) {
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".py") files.push(path.join(baseDirectory, entry.name));
    }
  }
  const hash = crypto.createHash("sha256");
  for (const filePath of [...new Set(files)].sort((a, b) => a.localeCompare(b, "en"))) {
    const relative = path.relative(baseDirectory, filePath).split(path.sep).join("/");
    hash.update(relative).update("\0").update(fs.readFileSync(filePath)).update("\0");
  }
  return hash.digest("hex");
}

function collectFiles(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "__pycache__", ".pytest_cache"].includes(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(entryPath, files);
    else if (!entry.name.endsWith(".pyc") && !entry.name.endsWith(".pyo") && !entry.name.endsWith(".map")) files.push(entryPath);
  }
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match) continue;
    const value = match[2].replace(/\s+#.*$/u, "").trim();
    values[match[1]] = value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))
      ? value.slice(1, -1)
      : value;
  }
  return values;
}

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function assertDirectory(directory, label) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} was not found: ${directory}`);
  }
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} was not found: ${filePath}`);
  }
}

function patchApiServerMcpToolsets(targetSourceRoot) {
  const apiServerPath = path.join(targetSourceRoot, "gateway", "platforms", "api_server.py");
  assertFile(apiServerPath, "Hermes API-server source");
  const source = fs.readFileSync(apiServerPath, "utf8");
  const marker = "            data: List[Dict[str, Any]] = []";
  const handlerMarker = "    async def _handle_toolsets(self, request: \"web.Request\") -> \"web.Response\":";
  if (!source.includes(marker) || !source.includes(handlerMarker)) throw new Error("Hermes API-server toolset handler shape changed; MCP registry patch was not applied.");
  const insertion = [
    "            # Hermes registers live MCP servers after startup and the upstream v0.19",
    "            # endpoint only enumerates static configurable toolsets. Surface the",
    "            # live registry here so clients can verify the exact server-agent tool",
    "            # names without inferring readiness from a browser bridge count.",
    "            try:",
    "                from tools.registry import registry",
    "                registered_tools = registry.get_tool_to_toolset_map()",
    "                live_tools_by_toolset = {}",
    "                for tool_name, toolset_name in registered_tools.items():",
    "                    toolset_key = str(toolset_name)",
    "                    if not toolset_key.startswith(\"mcp-\"):",
    "                        continue",
    "                    live_tools_by_toolset.setdefault(toolset_key, []).append(str(tool_name))",
    "                for toolset_name, live_tools in sorted(live_tools_by_toolset.items()):",
    "                    if not str(toolset_name).startswith(\"mcp-\"):",
    "                        continue",
    "                    server_name = str(toolset_name)[len(\"mcp-\"):]",
    "                    if server_name not in enabled_toolsets and str(toolset_name) not in enabled_toolsets:",
    "                        continue",
    "                    live_tools = sorted(set(live_tools))",
    "                    if not live_tools:",
    "                        continue",
    "                    data.append({",
    "                        \"name\": str(toolset_name),",
    "                        \"label\": f\"MCP {server_name}\",",
    "                        \"description\": f\"Live MCP server registry for {server_name}.\",",
    "                        \"enabled\": True,",
    "                        \"configured\": True,",
    "                        \"tools\": live_tools,",
    "                    })",
    "            except Exception:",
    "                logger.exception(\"GET /v1/toolsets live MCP registry enrichment failed\")",
    "        except Exception:",
    "            logger.exception(\"GET /v1/toolsets failed\")"
  ].join("\n");
  if (source.includes("live MCP server registry for")) return crypto.createHash("sha256").update(source).digest("hex");
  const insertionPattern = /        except Exception:\r?\n            logger\.exception\("GET \/v1\/toolsets failed"\)/u;
  if (!insertionPattern.test(source)) throw new Error("Hermes API-server toolset handler insertion point changed; MCP registry patch was not applied.");
  const patched = source.replace(insertionPattern, insertion);
  fs.writeFileSync(apiServerPath, patched, "utf8");
  return crypto.createHash("sha256").update(patched).digest("hex");
}

function copyTree(sourcePath, targetPath, options = {}) {
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (entryPath) => shouldInclude(entryPath, options)
  });
}

function shouldInclude(entryPath, options) {
  const name = path.basename(entryPath);
  const extension = path.extname(name).toLowerCase();
  if (name === "__pycache__" || name === ".git" || name === ".pytest_cache") return false;
  if (options.skipEditablePathFiles && name.startsWith("__editable__")) return false;
  if (extension === ".pyc" || extension === ".pyo" || extension === ".map") return false;
  return true;
}

function countFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name);
    return total + (entry.isDirectory() ? countFiles(entryPath) : 1);
  }, 0);
}

function sumBytes(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return total + sumBytes(entryPath);
    return total + fs.statSync(entryPath).size;
  }, 0);
}
