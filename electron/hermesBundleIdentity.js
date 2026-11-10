/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Shared by development preflight and both product launchers. No external fallback.
function verifyHermesBundle(root, projectRoot) {
  if (!fs.existsSync(path.join(root, "runtime-manifest.json"))) return { ok: false, reason: "hermes_bundled_runtime_missing" };
  try {
    const sourceLock = path.join(projectRoot, "scripts", "hermes-runtime-lock.json");
    const lock = JSON.parse(fs.readFileSync(fs.existsSync(sourceLock) ? sourceLock : path.join(root, "runtime-lock.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "runtime-manifest.json"), "utf8"));
    if (Object.keys(lock).some(key => manifest[key] !== lock[key])) throw new Error("identity");
    for (const file of [".build-complete", "python/python.exe", "source/hermes_cli/main.py"]) {
      if (!fs.existsSync(path.join(root, file))) throw new Error("incomplete");
    }
    const hashes = {
      "gateway/platforms/api_server.py": manifest.careerAdaptPatchHash,
      ...manifest.careerAdaptReasoningPatchHashes,
      ...manifest.careerAdaptEfficiencyPatchHashes
    };
    for (const relative of ["gateway/platforms/api_server.py", "agent/transports/chat_completions.py", "agent/chat_completion_helpers.py", "hermes_cli/timeouts.py", "tools/mcp_tool.py"]) {
      const expected = hashes[relative];
      const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "source", relative))).digest("hex");
      if (!expected || actual !== expected) throw new Error("patch");
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "hermes_bundled_runtime_invalid" };
  }
}
module.exports = { verifyHermesBundle };
