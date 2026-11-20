import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertRp01RuntimeParity } from "./rp01-preflight.mjs";
import identity from "../electron/hermesBundleIdentity.js";
import { developmentHermesBundleRoot } from "./development-hermes-path.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = developmentHermesBundleRoot(projectRoot);

if (fs.existsSync(runtimeRoot)) {
  const verification = identity.verifyHermesBundle(runtimeRoot, projectRoot);
  if (!verification.ok) throw new Error(`Existing development runtime failed verification: ${verification.reason}; retained at ${runtimeRoot}`);
  assertRp01RuntimeParity(projectRoot, runtimeRoot);
  console.log(`[Hermes] Development runtime already verified at ${runtimeRoot}`);
  process.exit(0);
}

console.log("[Hermes] Building a new locked development runtime; existing bundles will be retained.");
const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(projectRoot, "scripts", "prepare-hermes-runtime.mjs")], {
    cwd: projectRoot,
    env: { ...process.env, HERMES_RUNTIME_OUTPUT_DIR: runtimeRoot },
    windowsHide: true,
    stdio: "inherit"
  });
  child.once("error", reject);
  child.once("exit", (exitCode) => resolve(exitCode));
});
if (code !== 0) throw new Error(`Hermes preparation failed (exit ${code}); existing runtime was not changed.`);
const verification = identity.verifyHermesBundle(runtimeRoot, projectRoot);
if (!verification.ok) throw new Error(`Prepared Hermes bundle failed verification: ${verification.reason}`);
assertRp01RuntimeParity(projectRoot, runtimeRoot);

console.log(`[Hermes] Development runtime ready at ${runtimeRoot}`);
