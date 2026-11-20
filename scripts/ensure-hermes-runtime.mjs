import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import identity from "../electron/hermesBundleIdentity.js";
import { assertRp01RuntimeParity } from "./rp01-preflight.mjs";
import { developmentHermesBundleRoot } from "./development-hermes-path.mjs";

export async function ensureDevelopmentHermesBundle(projectRoot, environment = process.env) {
  const root = path.resolve(environment.HERMES_RUNTIME_ROOT || developmentHermesBundleRoot(projectRoot));
  if (!fs.existsSync(root)) {
    console.log("[Hermes] Preparing the locked project runtime for development...");
    const code = await new Promise((resolve, reject) => {
      const explicitRoot = Boolean(environment.HERMES_RUNTIME_ROOT);
      const script = explicitRoot ? "prepare-hermes-runtime.mjs" : "prepare-dev-hermes-runtime.mjs";
      const child = spawn(process.execPath, [path.join(projectRoot, "scripts", script)], {
        cwd: projectRoot, env: explicitRoot ? { ...environment, HERMES_RUNTIME_OUTPUT_DIR: root } : environment, windowsHide: true, stdio: "inherit"
      });
      child.once("error", reject); child.once("exit", code => resolve(code));
    });
    if (code !== 0) throw new Error("hermes_bundled_runtime_prepare_failed");
  }
  const result = identity.verifyHermesBundle(root, projectRoot);
  if (!result.ok) throw new Error(`${result.reason}: prepare a verified runtime in a new directory and set HERMES_RUNTIME_ROOT`);
  try {
    assertRp01RuntimeParity(projectRoot, root);
  } catch (error) {
    throw new Error(`Hermes runtime Skills do not match the project: ${error.message}. Run pnpm hermes:prepare:dev, then restart.`);
  }
  console.log("[Hermes] Locked project runtime verified.");
  return root;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await ensureDevelopmentHermesBundle(projectRoot);
}
