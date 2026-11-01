/* eslint-disable @typescript-eslint/no-require-imports -- Electron Main and ELECTRON_RUN_AS_NODE share this standalone CommonJS qualification entry. */
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const [mode, database, output] = process.argv.slice(2);
function probe() {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(database);
  if (mode === "busy") {
    db.exec("PRAGMA busy_timeout=30");
    try { db.exec("INSERT INTO qualification VALUES(3, 'busy')"); process.exit(2); }
    catch (e) { fs.writeFileSync(output, JSON.stringify({ code: e.code, errcode: e.errcode, errstr: e.errstr, message: e.message })); db.close(); return; }
  }
  if (mode === "crash") { db.exec("BEGIN IMMEDIATE; INSERT INTO qualification VALUES(4,'uncommitted')"); process.abort(); }
  if (mode === "read") {
    const rows = db.prepare("SELECT * FROM qualification ORDER BY id").all();
    fs.writeFileSync(output, JSON.stringify({ versions: process.versions, rows })); db.close(); return;
  }
  const result = { versions: process.versions, platform: process.platform, mode: process.env.ELECTRON_RUN_AS_NODE ? "embedded-node" : process.versions.electron ? "electron-main" : "sidecar-node", module: "node:sqlite" };
  db.exec("CREATE TABLE qualification(id INTEGER PRIMARY KEY, value TEXT); BEGIN IMMEDIATE; INSERT INTO qualification VALUES(1,'committed'); COMMIT; BEGIN IMMEDIATE; INSERT INTO qualification VALUES(2,'rollback'); ROLLBACK");
  result.rowsAfterRollback = db.prepare("SELECT * FROM qualification").all();
  db.exec("BEGIN IMMEDIATE");
  const busyOut = output + ".busy.json";
  const childEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  const busy = spawnSync(process.execPath, [__filename, "busy", database, busyOut], { env: childEnv, windowsHide: true, timeout: 10000, encoding: "utf8" });
  result.busy = { exit: busy.status, error: busy.error?.message, evidence: fs.existsSync(busyOut) ? JSON.parse(fs.readFileSync(busyOut)) : null };
  db.exec("ROLLBACK"); db.close();
  const crash = spawnSync(process.execPath, [__filename, "crash", database, output + ".crash"], { env: childEnv, windowsHide: true, timeout: 10000, encoding: "utf8" });
  result.crash = { exit: crash.status, signal: crash.signal, error: crash.error?.message };
  const reopened = new DatabaseSync(database);
  result.rowsAfterCrash = reopened.prepare("SELECT * FROM qualification ORDER BY id").all();
  result.integrity = reopened.prepare("PRAGMA integrity_check").get();
  result.sqliteVersion = reopened.prepare("SELECT sqlite_version() AS version").get().version;
  reopened.close();
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
}
if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
  const { app } = require("electron");
  app.setPath("userData", path.join(path.dirname(database), "isolated-user-data"));
  app.whenReady().then(() => { try { probe(); app.exit(0); } catch (e) { fs.writeFileSync(output, JSON.stringify({ error: e.stack, versions: process.versions })); app.exit(1); } });
} else { probe(); }
