import fs from "node:fs";
import { spawnSync } from "node:child_process";
import companion from "../electron/hermesCompanion.js";

// Server-only environment loader; never print settings or credentials.
const env = companion.loadCareerAdaptEnvironment(process.cwd());
const settings = {
  SKILLS_QUALITY_BASE_URL: env.AI_BASE_URL || env.HERMES_BASE_URL,
  SKILLS_QUALITY_API_KEY: env.AI_API_KEY || env.HERMES_CUSTOM_CAREERADAPT_API_KEY,
  SKILLS_QUALITY_MODEL: env.AI_MODEL || env.HERMES_MODEL
};
if (!settings.SKILLS_QUALITY_BASE_URL || !settings.SKILLS_QUALITY_API_KEY || !settings.SKILLS_QUALITY_MODEL) {
  console.log("QUALITY_COLLECTION_BLOCKED: server configuration missing");
  process.exit(2);
}
if (settings.SKILLS_QUALITY_BASE_URL.replace(/\/$/u, "") !== "https://developer.amd.com.cn/radeon/api/v1" || settings.SKILLS_QUALITY_MODEL !== "Qwen3.8-27B") {
  console.log("QUALITY_COLLECTION_BLOCKED: configuration differs from user-selected AMD provider/model");
  process.exit(2);
}
const output = "docs/quality/p5.1-sq1-quality-certification-20261031-amd-collection.json";
const resume = process.argv.includes("--resume");
if (!resume && fs.existsSync(output)) throw new Error("Existing evidence requires explicit --resume");
const child = spawnSync(process.execPath, ["scripts/skills-quality-eval.mjs", "--real-provider", resume ? "--resume" : "--output", output], {
  env: { ...process.env, ...settings }, stdio: "inherit", windowsHide: true
});
process.exitCode = child.status ?? 1;
