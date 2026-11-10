import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
const { verifyHermesBundle } = createRequire(import.meta.url)("../../electron/hermesBundleIdentity.js");
function fixture() {
  const project = mkdtempSync(path.join(os.tmpdir(), "hermes-bundle-identity-"));
  const root = path.join(project, "resources", "hermes-runtime");
  const lock = { hermesVersion: "0.19.0", careerAdaptPatchVersion: "locked-patch" };
  const hashes: Record<string, string> = {};
  for (const file of ["gateway/platforms/api_server.py", "agent/transports/chat_completions.py", "agent/chat_completion_helpers.py", "hermes_cli/timeouts.py", "tools/mcp_tool.py"]) {
    const target = path.join(root, "source", file); mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "verified fixture"); hashes[file] = createHash("sha256").update("verified fixture").digest("hex");
  }
  for (const file of [".build-complete", "python/python.exe", "source/hermes_cli/main.py"]) {
    const target = path.join(root, file); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, "fixture");
  }
  const manifest = { ...lock, careerAdaptPatchHash: hashes["gateway/platforms/api_server.py"], careerAdaptReasoningPatchHashes: hashes, careerAdaptEfficiencyPatchHashes: hashes };
  mkdirSync(path.join(project, "scripts"), { recursive: true });
  writeFileSync(path.join(project, "scripts/hermes-runtime-lock.json"), JSON.stringify(lock));
  writeFileSync(path.join(root, "runtime-lock.json"), JSON.stringify(lock));
  writeFileSync(path.join(root, "runtime-manifest.json"), JSON.stringify(manifest));
  return { project, root, manifest };
}
describe("same pinned bundle in development and packaged resources", () => {
  it("verifies both project lock and self-contained packaged lock", () => {
    const f = fixture(); expect(verifyHermesBundle(f.root, f.project)).toEqual({ ok: true });
    expect(verifyHermesBundle(f.root, path.join(f.project, "app.asar"))).toEqual({ ok: true });
  });
  it("refuses a missing runtime instead of accepting an installed same-version Hermes", () => {
    const f = fixture(); expect(verifyHermesBundle(path.join(f.project, "absent"), f.project)).toMatchObject({ ok: false, reason: "hermes_bundled_runtime_missing" });
  });
  it("rejects a stale patch identity even when the upstream version is the same", () => {
    const f = fixture(); writeFileSync(path.join(f.root, "runtime-manifest.json"), JSON.stringify({ ...f.manifest, careerAdaptPatchVersion: "old" }));
    expect(verifyHermesBundle(f.root, f.project)).toMatchObject({ ok: false, reason: "hermes_bundled_runtime_invalid" });
  });
  it("rejects changed API-server code under an otherwise valid manifest", () => {
    const f = fixture(); writeFileSync(path.join(f.root, "source/gateway/platforms/api_server.py"), "unpatched");
    expect(verifyHermesBundle(f.root, f.project)).toMatchObject({ ok: false, reason: "hermes_bundled_runtime_invalid" });
  });
});
