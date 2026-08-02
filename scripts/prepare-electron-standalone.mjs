import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const sourceRoot = path.join(projectRoot, ".next", "standalone");
const targetRoot = path.join(projectRoot, ".electron-build", "standalone");

if (!fs.existsSync(sourceRoot)) {
  throw new Error(`Next standalone output was not found: ${sourceRoot}`);
}

const activeRealPaths = new Set();

function copyPortable(sourcePath, targetPath) {
  const sourceStat = fs.lstatSync(sourcePath);

  if (sourceStat.isSymbolicLink()) {
    const resolvedPath = fs.realpathSync(sourcePath);
    if (activeRealPaths.has(resolvedPath)) return;
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

copyPortable(sourceRoot, targetRoot);

const serverPath = path.join(targetRoot, "server.js");
if (!fs.existsSync(serverPath)) {
  throw new Error(`Portable standalone output is missing server.js: ${serverPath}`);
}

console.log(`Prepared portable Next standalone output at ${targetRoot}`);
