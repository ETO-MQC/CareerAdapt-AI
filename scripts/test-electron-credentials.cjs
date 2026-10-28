/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS launcher for Electron's main-process smoke test. */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
fs.mkdirSync(path.join(projectRoot, ".tmp"), { recursive: true });
const profile = fs.mkdtempSync(path.join(projectRoot, ".tmp/r1-dpapi-profile-"));
const evidence = [];
for (const phase of ["write", "read"]) {
  const env = { ...process.env, R1_PROFILE: profile, R1_PHASE: phase };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require("electron"), [path.join(projectRoot, "tests/support/electron-credential-smoke.cjs")], {
    env, windowsHide: true, encoding: "utf8", timeout: 20_000
  });
  const results = (result.stdout || "").split(/\r?\n/u).filter(line => line.startsWith("{")).map(line => JSON.parse(line));
  evidence.push({ phase, exitCode: result.status, signal: result.signal, error: result.error?.code, localStatePresent: fs.existsSync(path.join(profile, "Local State")), results });
  if (result.status !== 0 || results.length !== 1 || results[0].restored !== true) process.exitCode = 1;
}
// Keep the isolated encrypted fixture for inspection; never recursively delete profiles.
fs.writeFileSync(path.join(projectRoot, ".tmp/r1-dpapi-evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
