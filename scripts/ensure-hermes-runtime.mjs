import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import identity from "../electron/hermesBundleIdentity.js";

export async function ensureDevelopmentHermesBundle(projectRoot, environment = process.env) {
  const root = path.resolve(environment.HERMES_RUNTIME_ROOT || path.join(projectRoot, ".electron-build/hermes-runtime-v4"));
  if (!fs.existsSync(root)) {
    console.log("[Hermes] Preparing the locked project runtime for development...");
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(projectRoot, "scripts/prepare-hermes-runtime.mjs")], {
        cwd: projectRoot, env: { ...environment, HERMES_RUNTIME_OUTPUT_DIR: root }, windowsHide: true, stdio: "inherit"
      });
      child.once("error", reject); child.once("exit", code => resolve(code));
    });
    if (code !== 0) throw new Error("hermes_bundled_runtime_prepare_failed");
  }
  const result = identity.verifyHermesBundle(root, projectRoot);
  if (!result.ok) throw new Error(`${result.reason}: prepare a verified runtime in a new directory and set HERMES_RUNTIME_ROOT`);
  console.log("[Hermes] Locked project runtime verified.");
  return root;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await ensureDevelopmentHermesBundle(projectRoot);
}
