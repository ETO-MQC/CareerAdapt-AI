import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const desktop = path.join(process.env.LOCALAPPDATA, "hermes/hermes-agent/apps/desktop");
const req = createRequire(path.join(desktop, "package.json"));
const executable = req("electron");
const root = path.resolve(".artifacts/p520b1-runtime/" + Date.now());
fs.mkdirSync(root, { recursive: true });
const results = [];
for (const [name, exe, embedded] of [["hermes-main", executable, false], ["hermes-node", executable, true], ["sidecar-candidate", process.execPath, true], ["careeradap-electron-main", createRequire(path.resolve("package.json"))("electron"), false]]) {
  const database = path.join(root, name + ".sqlite");
  const output = path.join(root, name + ".json");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (embedded) env.ELECTRON_RUN_AS_NODE = "1";
  const run = spawnSync(exe, [path.resolve("scripts/p520b1-runtime-probe.cjs"), "qualify", database, output], { env, windowsHide: true, timeout: 25000, encoding: "utf8" });
  const readOutput = output + ".read.json";
  const read = spawnSync(exe, [path.resolve("scripts/p520b1-runtime-probe.cjs"), "read", database, readOutput], { env, windowsHide: true, timeout: 15000, encoding: "utf8" });
  results.push({ name, exit: run.status, error: run.error?.message, stderr: run.stderr, result: fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : null, restart: { exit: read.status, error: read.error?.message, result: fs.existsSync(readOutput) ? JSON.parse(fs.readFileSync(readOutput)) : null }, executableBytes: fs.statSync(exe).size });
}
const sourceHead = spawnSync("git", ["-C", path.dirname(path.dirname(desktop)), "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
const evidence = { sourceHead: sourceHead.stdout.trim(), executableSha256: createHash("sha256").update(fs.readFileSync(executable)).digest("hex"), root, desktopPackage: JSON.parse(fs.readFileSync(path.join(desktop, "package.json"))).version, results };
fs.writeFileSync("docs/architecture/p5.2.0b1-runtime-results.json", JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(results.map(r => ({ name: r.name, exit: r.exit, node: r.result?.versions?.node, electron: r.result?.versions?.electron, sqlite: r.result?.sqliteVersion, error: r.result?.error, busy: r.result?.busy, restart: r.restart.exit })), null, 2));

for (const r of results) {
  assert.equal(r.exit, 0, r.name);
  assert.equal(r.restart.exit, 0, r.name);
  assert.deepEqual(r.result.rowsAfterRollback, [{ id: 1, value: "committed" }]);
  assert.deepEqual(r.result.rowsAfterCrash, [{ id: 1, value: "committed" }]);
  assert.deepEqual(r.restart.result.rows, [{ id: 1, value: "committed" }]);
  assert.equal(r.result.busy.exit, 0);
  assert.equal(r.result.busy.evidence.errcode, 5);
  assert.equal(r.result.integrity.integrity_check, "ok");
  assert.notEqual(r.result.crash.exit, 0);
  if (r.name.startsWith("hermes")) assert.equal(r.result.versions.electron, "40.10.2");
}
