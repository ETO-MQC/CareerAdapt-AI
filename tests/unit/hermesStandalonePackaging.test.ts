import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
const script = readFileSync(path.resolve("scripts/prepare-electron-standalone.mjs"));
function fixture(nested: boolean) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "hermes-portable-next-"));
  const project = path.join(parent, "project");
  const standalone = path.join(project, ".next/standalone");
  const app = nested ? path.join(standalone, "project") : standalone;
  const config = { outputFileTracingRoot: nested ? parent : project, turbopack: { root: parent } };
  for (const folder of ["scripts", ".next"]) mkdirSync(path.join(project, folder), { recursive: true });
  mkdirSync(path.join(app, ".next"), { recursive: true });
  writeFileSync(path.join(project, "scripts/prepare-electron-standalone.mjs"), script);
  const manifest = { config, appDir: project, relativeAppDir: "project" };
  writeFileSync(path.join(project, ".next/required-server-files.json"), JSON.stringify(manifest));
  writeFileSync(path.join(app, ".next/required-server-files.json"), JSON.stringify(manifest));
  writeFileSync(path.join(app, "server.js"), `const nextConfig = ${JSON.stringify(config)}\nprocess.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)\n`);
  mkdirSync(path.join(standalone, "node_modules/next"), { recursive: true });
  writeFileSync(path.join(standalone, "node_modules/next/index.js"), "fixture dependency");
  return { project, parent, app, output: path.join(project, ".electron-build/standalone-v2") };
}
describe("portable standalone packaging with a widened tracing root", () => {
  it("materializes a cyclic pnpm sibling dependency graph only once", () => {
    const f = fixture(false);
    const a = path.join(f.project, "store/a/node_modules/a"), b = path.join(f.project, "store/b/node_modules/b");
    for (const folder of [a, b]) { mkdirSync(folder, { recursive: true }); writeFileSync(path.join(folder, "index.js"), "dependency"); }
    const link = (source: string, target: string) => symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
    link(b, path.join(path.dirname(a), "b")); link(a, path.join(path.dirname(b), "a"));
    link(a, path.join(f.app, "node_modules/a"));
    execFileSync(process.execPath, [path.join(f.project, "scripts/prepare-electron-standalone.mjs")], { cwd: f.project, windowsHide: true, timeout: 3000 });
    expect(readFileSync(path.join(f.output, "node_modules/a/index.js"), "utf8")).toBe("dependency");
    expect(readFileSync(path.join(f.output, "node_modules/b/index.js"), "utf8")).toBe("dependency");
  });
  it.each([false, true])("copies application and shared dependencies with nested=%s", nested => {
    const f = fixture(nested);
    execFileSync(process.execPath, [path.join(f.project, "scripts/prepare-electron-standalone.mjs")], { cwd: f.project, windowsHide: true });
    expect(readFileSync(path.join(f.output, "node_modules/next/index.js"), "utf8")).toBe("fixture dependency");
    const server = readFileSync(path.join(f.output, "server.js"), "utf8");
    expect(server).toContain("nextConfig.outputFileTracingRoot = __dirname");
    expect(server).not.toContain(f.parent); expect(server).not.toContain(JSON.stringify(f.parent).slice(1, -1));
    const manifest = JSON.parse(readFileSync(path.join(f.output, ".next/required-server-files.json"), "utf8"));
    expect(manifest).toMatchObject({ appDir: ".", relativeAppDir: ".", config: { outputFileTracingRoot: ".", turbopack: { root: "." } } });
  });
});
