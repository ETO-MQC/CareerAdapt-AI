import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(scriptDir, "..", "skills", "career");
const args = process.argv.slice(2);
const targetArgIndex = args.indexOf("--target");
const requestedTarget = targetArgIndex >= 0 ? args[targetArgIndex + 1] : undefined;
const force = args.includes("--force");

if (targetArgIndex >= 0 && !requestedTarget) {
  throw new Error("--target requires a directory path");
}

const hermesHome = process.env.HERMES_HOME?.trim()
  || (process.platform === "win32"
    ? process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local", "hermes")
    : path.join(os.homedir(), ".hermes"));
const targetRoot = path.resolve(requestedTarget || path.join(hermesHome, "skills", "careeradapt"));

if (!fs.existsSync(sourceRoot)) throw new Error(`Career skills source is missing: ${sourceRoot}`);
fs.mkdirSync(targetRoot, { recursive: true });

const skillNames = fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(sourceRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

for (const name of skillNames) {
  const source = path.join(sourceRoot, name);
  const target = path.join(targetRoot, name);
  if (fs.existsSync(target) && !force) {
    console.log(`skip ${name} (already exists; pass --force to update)`);
    continue;
  }
  fs.cpSync(source, target, { recursive: true, force });
  console.log(`${force ? "updated" : "installed"} ${name}`);
}

console.log(`Hermes skill root: ${targetRoot}`);
