import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { NextResponse } from "next/server";
import { decodeAiSettingsFromHeader, type AiSettings } from "@/services/storage/aiSettings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_RUNTIME_URL = "http://127.0.0.1:8642";
const START_TIMEOUT_MS = 35_000;
const POLL_INTERVAL_MS = 500;

let companionProcess: ChildProcess | undefined;
let companionProcessError: string | undefined;
let startInFlight: Promise<ControlResult> | undefined;

type ControlResult =
  | { ok: true; status: "ready" | "already_ready"; runtimeUrl: string }
  | { ok: false; code: string; message: string };

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { action?: unknown };
  if (body.action !== "start") {
    return NextResponse.json({
      ok: false,
      error: { code: "hermes_control_bad_request", message: "只支持启动 Hermes。" }
    }, { status: 400 });
  }

  const customSettings = readCustomSettings(request.headers.get("x-ai-config"));
  const result = await ensureHermesStarted(environmentWithCustomSettings(customSettings));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: { code: result.code, message: result.message } }, { status: 503 });
  }
  return NextResponse.json({ ok: true, data: { status: result.status, runtimeUrl: result.runtimeUrl } }, {
    headers: { "Cache-Control": "no-store" }
  });
}

async function ensureHermesStarted(environment: NodeJS.ProcessEnv): Promise<ControlResult> {
  if (startInFlight) return startInFlight;
  startInFlight = startHermes(environment).finally(() => {
    startInFlight = undefined;
  });
  return startInFlight;
}

async function startHermes(environment: NodeJS.ProcessEnv): Promise<ControlResult> {
  let effectiveEnvironment = environment;
  let runtimeUrl = (effectiveEnvironment.HERMES_RUNTIME_URL?.trim() || DEFAULT_RUNTIME_URL).replace(/\/$/u, "");
  const existing = await probeHealth(runtimeUrl, effectiveEnvironment);
  if (existing.ok) return { ok: true, status: "already_ready", runtimeUrl };

  // A managed child may be between spawn and its first health response. Do
  // not reallocate its listening port while it is still starting.
  if (companionProcess && companionProcess.exitCode === null) {
    return waitForHealth(runtimeUrl, effectiveEnvironment, companionProcess);
  }

  const allocatedRuntimeUrl = await allocateRuntimePort(runtimeUrl);
  if (allocatedRuntimeUrl !== runtimeUrl) {
    runtimeUrl = allocatedRuntimeUrl;
    effectiveEnvironment = { ...effectiveEnvironment, HERMES_RUNTIME_URL: runtimeUrl };
    // The Next process proxies all subsequent Hermes traffic through this
    // address, so keep its in-process environment aligned with the child.
    process.env.HERMES_RUNTIME_URL = runtimeUrl;
  }

  const projectRoot = process.env.CAREERADAPT_APP_PATH?.trim() || process.cwd();
  const companionScript = "electron/hermesCompanion.js";
  companionProcessError = undefined;

  const child = spawn(process.execPath, [companionScript, "start"], {
    cwd: projectRoot,
    env: effectiveEnvironment,
    windowsHide: true,
    stdio: "ignore"
  });
  companionProcess = child;
  child.once("exit", () => {
    if (companionProcess === child) companionProcess = undefined;
  });
  child.once("error", () => {
    companionProcessError = "hermes_companion_script_missing";
    if (companionProcess === child) companionProcess = undefined;
  });
  return waitForHealth(runtimeUrl, effectiveEnvironment, child);
}

async function allocateRuntimePort(runtimeUrl: string) {
  let url: URL;
  try {
    url = new URL(runtimeUrl);
  } catch {
    return runtimeUrl;
  }
  if (!isLocalHost(url.hostname)) return runtimeUrl;
  const preferredPort = Number(url.port || 8642);
  if (await isPortAvailable(preferredPort, url.hostname)) return runtimeUrl;
  for (let offset = 1; offset <= 100; offset += 1) {
    const candidate = preferredPort + offset;
    if (candidate > 65_535 || !await isPortAvailable(candidate, url.hostname)) continue;
    url.port = String(candidate);
    return url.toString().replace(/\/$/u, "");
  }
  return runtimeUrl;
}

function isLocalHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isPortAvailable(port: number, host: string) {
  return new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

async function waitForHealth(runtimeUrl: string, environment: NodeJS.ProcessEnv, child: ChildProcess): Promise<ControlResult> {
  const startedAt = Date.now();
  let lastStatus: number | undefined;
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (companionProcessError) {
      return {
        ok: false,
        code: companionProcessError,
        message: "找不到 Hermes 启动组件，请重新启动应用。"
      };
    }
    if (child.exitCode !== null && child.exitCode !== undefined) {
      return {
        ok: false,
        code: "hermes_companion_start_failed",
        message: "Hermes 启动失败，请查看 Hermes 运行日志。"
      };
    }
    const health = await probeHealth(runtimeUrl, environment);
    if (health.ok) return { ok: true, status: "ready", runtimeUrl };
    lastStatus = health.status;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return {
    ok: false,
    code: "hermes_companion_start_timeout",
    message: lastStatus ? `Hermes 尚未就绪（HTTP ${lastStatus}），请稍后重试。` : "Hermes 尚未就绪，请稍后重试。"
  };
}

async function probeHealth(runtimeUrl: string, environment: NodeJS.ProcessEnv) {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = environment.HERMES_RUNTIME_API_KEY?.trim()
    || environment.HERMES_API_KEY?.trim()
    || environment.AI_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  try {
    let response = await fetch(`${runtimeUrl}/health`, {
      headers,
      signal: AbortSignal.timeout(2_000),
      cache: "no-store"
    });
    if (response.status === 404) {
      response = await fetch(`${runtimeUrl}/api/health`, {
        headers,
        signal: AbortSignal.timeout(2_000),
        cache: "no-store"
      });
    }
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: undefined };
  }
}

function readCustomSettings(value: string | null): AiSettings | undefined {
  return value ? decodeAiSettingsFromHeader(value) : undefined;
}

function environmentWithCustomSettings(settings: AiSettings | undefined): NodeJS.ProcessEnv {
  if (!settings) return { ...process.env };
  return {
    ...process.env,
    ...(settings.baseUrl.trim() ? { AI_BASE_URL: settings.baseUrl.trim().slice(0, 20_000) } : {}),
    ...(settings.apiKey.trim() ? { AI_API_KEY: settings.apiKey.trim().slice(0, 20_000) } : {}),
    ...(settings.model.trim() ? { AI_MODEL: settings.model.trim().slice(0, 20_000) } : {})
  };
}
