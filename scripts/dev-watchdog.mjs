import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const MEMORY_LIMIT_MB = 3072; // 3GB - restart before hitting 4GB
const CHECK_INTERVAL_MS = 30_000; // Check every 30 seconds

let child = null;
let restarting = false;

function startDev() {
  console.log("[Watchdog] Starting dev server...");

  // Use cmd.exe on Windows like dev-with-hermes.mjs does
  const command = "pnpm.cmd dev";
  child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    env: { ...process.env }
  });

  child.on("exit", (code) => {
    if (restarting) return;
    console.log(`[Watchdog] Dev server exited with code ${code}`);
    if (code !== 0) {
      console.log("[Watchdog] Restarting in 3 seconds...");
      setTimeout(startDev, 3000);
    }
  });

  child.on("error", (err) => {
    console.error("[Watchdog] Failed to start:", err.message);
  });
}

async function getTotalNodeMemoryUsage() {
  return new Promise((resolve) => {
    const ps = spawn("powershell", [
      "-Command",
      "Get-Process node -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum | Select-Object -ExpandProperty Sum"
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let output = "";
    ps.stdout.on("data", (data) => { output += data.toString(); });
    ps.on("close", () => {
      const bytes = parseInt(output.trim(), 10);
      resolve(isNaN(bytes) ? 0 : Math.round(bytes / (1024 * 1024)));
    });
  });
}

async function getMainProcessMemoryUsage() {
  // Find the Next.js main process (the one with highest memory)
  return new Promise((resolve) => {
    const ps = spawn("powershell", [
      "-Command",
      "Get-Process node -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 1 -ExpandProperty WorkingSet64"
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let output = "";
    ps.stdout.on("data", (data) => { output += data.toString(); });
    ps.on("close", () => {
      const bytes = parseInt(output.trim(), 10);
      resolve(isNaN(bytes) ? 0 : Math.round(bytes / (1024 * 1024)));
    });
  });
}

async function monitor() {
  // Wait a bit for the server to start
  await new Promise((resolve) => setTimeout(resolve, 10_000));

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));

    if (!child || child.exitCode !== null) continue;

    const mainMemMB = await getMainProcessMemoryUsage();
    const totalMemMB = await getTotalNodeMemoryUsage();

    console.log(`[Watchdog] Memory - Main: ${mainMemMB}MB, Total: ${totalMemMB}MB, Limit: ${MEMORY_LIMIT_MB}MB`);

    if (mainMemMB >= MEMORY_LIMIT_MB) {
      console.log(`[Watchdog] Memory limit exceeded (${mainMemMB}MB >= ${MEMORY_LIMIT_MB}MB). Restarting...`);
      restarting = true;

      // Kill all node processes
      const killPs = spawn("powershell", ["-Command", "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force"], {
        stdio: "inherit"
      });

      await new Promise((resolve) => {
        killPs.on("close", resolve);
        setTimeout(resolve, 5000); // Timeout after 5 seconds
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));
      restarting = false;
      startDev();
      // Wait for server to fully start before resuming monitoring
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("[Watchdog] Shutting down...");
  if (child) child.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (child) child.kill();
  process.exit(0);
});

startDev();
monitor();
