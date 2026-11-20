import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertRp01RuntimeParity, careerSkillsTreeHash } from "./rp01-preflight.mjs";
import identity from "../electron/hermesBundleIdentity.js";

export function developmentHermesBundleRoot(projectRoot) {
  const lock = fs.readFileSync(path.join(projectRoot, "scripts", "hermes-runtime-lock.json"));
  const skillsHash = careerSkillsTreeHash(path.join(projectRoot, "skills", "career"));
  const fingerprint = crypto.createHash("sha256").update(lock).update(skillsHash).digest("hex");
  const base = path.join(projectRoot, ".electron-build", `hermes-runtime-dev-${fingerprint}`);
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt}`;
    if (!fs.existsSync(candidate)) return candidate;
    if (identity.verifyHermesBundle(candidate, projectRoot).ok) {
      try {
        assertRp01RuntimeParity(projectRoot, candidate);
        return candidate;
      } catch {
        // Preserve a stale or incomplete bundle and try a fresh directory.
      }
    }
  }
}
