import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const sourceRoot = path.join(projectRoot, ".next", "standalone");
const targetRoot = path.join(projectRoot, ".electron-build", "standalone-v2");

if (!fs.existsSync(sourceRoot)) {
  throw new Error(`Next standalone output was not found: ${sourceRoot}`);
}

// A widened Turbopack root also widens Next's tracing root. The standalone
// app then lives below a relative project directory, with shared dependencies
// beside it. Flatten that supported layout into the Electron resource contract.
const filesManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, ".next", "required-server-files.json"), "utf8"));
const tracingRoot = path.resolve(filesManifest.config.outputFileTracingRoot || projectRoot);
const relativeApp = path.relative(tracingRoot, projectRoot);
if (path.isAbsolute(relativeApp) || relativeApp.split(path.sep).includes("..")) throw new Error("Invalid standalone tracing root");
const appSourceRoot = fs.existsSync(path.join(sourceRoot, "server.js")) ? sourceRoot : path.join(sourceRoot, relativeApp);
if (!fs.existsSync(path.join(appSourceRoot, "server.js"))) throw new Error("Standalone app server was not found in the traced application directory");

const activeRealPaths = new Set();
const activeLinks = new Set();
const copiedLinks = new Set();

function copyPortable(sourcePath, targetPath) {
  const sourceStat = fs.lstatSync(sourcePath);

  if (sourceStat.isSymbolicLink()) {
    const originalTarget = fs.realpathSync(sourcePath);
    const relativeTarget = path.relative(tracingRoot, originalTarget);
    const tracedTarget = path.join(sourceRoot, relativeTarget);
    // Next can preserve the application's original node_modules Junction.
    // Prefer the traced dependency closure, not the entire development install.
    const useTraced = !path.isAbsolute(relativeTarget) && !relativeTarget.split(path.sep).includes("..")
      && fs.existsSync(tracedTarget) && !fs.lstatSync(tracedTarget).isSymbolicLink();
    const resolvedPath = useTraced ? tracedTarget : originalTarget;
    const linkKey = `${resolvedPath}\0${path.resolve(targetPath)}`;
    if (activeRealPaths.has(resolvedPath) || activeLinks.has(resolvedPath) || copiedLinks.has(linkKey)) return;
    activeLinks.add(resolvedPath);
    try {
    copyPortable(resolvedPath, targetPath);

    // pnpm keeps a package's sibling dependencies next to the symlink target.
    // Bring those siblings into the portable node_modules directory as well.
    const packageDirectory = path.dirname(resolvedPath);
    if (path.basename(packageDirectory) === "node_modules") {
      const targetPackageDirectory = path.dirname(targetPath);
      for (const entry of fs.readdirSync(packageDirectory)) {
        if (entry === ".bin" || entry === ".pnpm" || entry === "electron") continue;
        copyPortable(
          path.join(packageDirectory, entry),
          path.join(targetPackageDirectory, entry)
        );
      }
    }
    copiedLinks.add(linkKey);
    } finally {
      activeLinks.delete(resolvedPath);
    }
    return;
  }

  if (sourceStat.isDirectory()) {
    const resolvedPath = fs.realpathSync(sourcePath);
    if (activeRealPaths.has(resolvedPath)) return;

    activeRealPaths.add(resolvedPath);
    fs.mkdirSync(targetPath, { recursive: true });

    for (const entry of fs.readdirSync(sourcePath)) {
      if (path.basename(sourcePath) === "node_modules" && entry === ".pnpm") {
        continue;
      }
      if (path.basename(sourcePath) === "node_modules" && entry === "electron") {
        continue;
      }
      copyPortable(path.join(sourcePath, entry), path.join(targetPath, entry));
    }

    activeRealPaths.delete(resolvedPath);
    return;
  }

  if (sourceStat.isFile()) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

if (appSourceRoot !== sourceRoot && fs.existsSync(path.join(sourceRoot, "node_modules"))) {
  copyPortable(path.join(sourceRoot, "node_modules"), path.join(targetRoot, "node_modules"));
}
const runtimeEntries = [".next", "node_modules", "skills", "server.js", "package.json"];
for (const entry of runtimeEntries) {
  const sourcePath = path.join(appSourceRoot, entry);
  if (fs.existsSync(sourcePath)) copyPortable(sourcePath, path.join(targetRoot, entry));
}

// Next's production server still imports this directory on supported releases.
const packagedDev = path.join(targetRoot, "node_modules/next/dist/server/dev");
const sourceDev = path.join(appSourceRoot, "node_modules/next/dist/server/dev");
if (!fs.existsSync(packagedDev) && fs.existsSync(sourceDev)) copyPortable(sourceDev, packagedDev);

const serverPath = path.join(targetRoot, "server.js");
if (!fs.existsSync(serverPath)) {
  throw new Error(`Portable standalone output is missing server.js: ${serverPath}`);
}

// Do not ship this workstation's tracing paths. Resolve them at the installed location.
const server = fs.readFileSync(serverPath, "utf8");
const configMatch = /^const nextConfig = (\{[^\r\n]+\})$/mu.exec(server);
if (!configMatch) throw new Error("Standalone server configuration could not be located");
const portableConfig = JSON.parse(configMatch[1]);
portableConfig.outputFileTracingRoot = ".";
if (portableConfig.turbopack) portableConfig.turbopack.root = ".";
const runtimePaths = "\nnextConfig.outputFileTracingRoot = __dirname\nif (nextConfig.turbopack) nextConfig.turbopack.root = __dirname";
fs.writeFileSync(serverPath, server.replace(configMatch[0], `const nextConfig = ${JSON.stringify(portableConfig)}${runtimePaths}`), "utf8");
const packagedManifest = path.join(targetRoot, ".next", "required-server-files.json");
if (fs.existsSync(packagedManifest)) {
  const value = JSON.parse(fs.readFileSync(packagedManifest, "utf8"));
  value.appDir = "."; value.relativeAppDir = "."; value.config = portableConfig;
  fs.writeFileSync(packagedManifest, JSON.stringify(value), "utf8");
}

console.log(`Prepared portable Next standalone output at ${targetRoot}`);
