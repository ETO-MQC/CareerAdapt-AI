import { NextResponse } from "next/server";
import {
  getWebHermesSupervisor,
  webHermesControlEnabled
} from "@/server/agent/webHermesSupervisor";
import { decodeAiSettingsFromHeader } from "@/services/storage/aiSettings";
import type {
  HermesControlAction,
  HermesControlResult,
  HermesStartSettings
} from "@/services/agent/hermesControl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTROL_ACTIONS = new Set<HermesControlAction>([
  "start",
  "stop",
  "restart",
  "recover",
  "update_config",
  "reset_config"
]);

export async function GET(request: Request) {
  const requestContext = resolveWebControlRequest(request);
  if (requestContext.response) return requestContext.response;
  const supervisor = getWebHermesSupervisor(requestContext.origin);
  const [config, configSchema] = await Promise.all([
    supervisor.getConfig(),
    supervisor.getConfigSchema()
  ]);
  return NextResponse.json({
    ok: true,
    snapshot: supervisor.getStatus(),
    config,
    configSchema
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const requestContext = resolveWebControlRequest(request);
  if (requestContext.response) return requestContext.response;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action;
  if (typeof action !== "string" || !CONTROL_ACTIONS.has(action as HermesControlAction)) {
    return errorResponse("hermes_control_action_invalid", 400);
  }

  const supervisor = getWebHermesSupervisor(requestContext.origin);
  const requestedSettings = decodeAiSettingsFromHeader(request.headers.get("x-ai-config") ?? "");
  const previous = supervisor.getStatus();
  const requestedAt = new Date().toISOString();

  try {
    const snapshot = await runAction(supervisor, action as HermesControlAction, body, requestedSettings);
    const safeReasonCode = snapshot.reasonCode || `${action}_completed`;
    const result: HermesControlResult = {
      ok: action === "start" ? snapshot.overallState !== "unavailable" : true,
      reason: snapshot.reasonCode,
      runtimeUrl: snapshot.runtimeUrl,
      snapshot,
      receipt: {
        action: action as HermesControlAction,
        requestedAt,
        accepted: true,
        executed: true,
        previousState: serviceState(previous),
        nextState: serviceState(snapshot),
        safeReasonCode,
        controlOwner: "web_supervisor"
      }
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const safeReasonCode = safeControlReason(error, `${action}_failed`);
    return NextResponse.json({
      ok: false,
      reason: safeReasonCode,
      snapshot: previous,
      receipt: {
        action: action as HermesControlAction,
        requestedAt,
        accepted: true,
        executed: false,
        previousState: serviceState(previous),
        nextState: serviceState(previous),
        safeReasonCode,
        controlOwner: "web_supervisor"
      }
    } satisfies HermesControlResult, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

async function runAction(
  supervisor: ReturnType<typeof getWebHermesSupervisor>,
  action: HermesControlAction,
  body: Record<string, unknown>,
  requestedSettings?: HermesStartSettings
) {
  if (action === "start") {
    return body.rendererReady === true
      ? supervisor.rendererHostReady(requestedSettings)
      : supervisor.ensureStarted(requestedSettings);
  }
  if (action === "stop") return supervisor.stop();
  if (action === "restart") return supervisor.restart(readRestartOptions(body.options));
  if (action === "recover") return supervisor.recover();
  if (action === "update_config") return supervisor.updateConfig(requestedSettings ?? emptySettings());
  return supervisor.resetConfig();
}

function resolveWebControlRequest(request: Request): { origin: string; response?: never } | { origin?: never; response: NextResponse } {
  if (!webHermesControlEnabled()) {
    return { response: errorResponse("web_control_disabled", 409, "Web Hermes 控制权未启用，请在开发环境设置 HERMES_WEB_CONTROL_ENABLED=true 后重启服务。") };
  }
  const requestUrl = new URL(request.url);
  const hostHeader = request.headers.get("host")?.trim();
  const originHeader = request.headers.get("origin")?.trim();
  let originUrl;
  try {
    // Next dev can normalize request.url to localhost even when the browser
    // reached the server through 127.0.0.1. Trust neither value in isolation:
    // use the browser Origin when present and require it to match the local
    // Host header, allowing only equivalent loopback aliases.
    originUrl = originHeader && originHeader !== "null"
      ? new URL(originHeader)
      : hostHeader
        ? new URL(`${requestUrl.protocol}//${hostHeader}`)
        : requestUrl;
  } catch {
    return { response: errorResponse("web_control_local_only", 403, "Hermes Web 控制只允许来自本机回环地址的同源请求。") };
  }
  if (!(originUrl.protocol === "http:" || originUrl.protocol === "https:") || !isLoopbackHostname(originUrl.hostname)) {
    return { response: errorResponse("web_control_local_only", 403, "Hermes Web 控制只允许来自本机回环地址的同源请求。") };
  }
  if (hostHeader) {
    try {
      const hostUrl = new URL(`${originUrl.protocol}//${hostHeader}`);
      if (!isLoopbackHostname(hostUrl.hostname) || canonicalLoopbackOrigin(hostUrl) !== canonicalLoopbackOrigin(originUrl)) {
        return { response: errorResponse("web_control_local_only", 403, "Hermes Web 控制只允许来自本机回环地址的同源请求。") };
      }
    } catch {
      return { response: errorResponse("web_control_local_only", 403, "Hermes Web 控制只允许来自本机回环地址的同源请求。") };
    }
  }
  return { origin: canonicalLoopbackOrigin(originUrl) };
}

function isLoopbackHostname(hostname: string) {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname.toLowerCase());
}

function canonicalLoopbackOrigin(url: URL) {
  return `${url.protocol}//127.0.0.1${url.port ? `:${url.port}` : ""}`;
}

function errorResponse(code: string, status: number, message = code) {
  return NextResponse.json({
    ok: false,
    error: { code, message }
  }, { status, headers: { "Cache-Control": "no-store" } });
}

function serviceState(snapshot: { overallState: string; processReady: boolean }) {
  if (snapshot.overallState === "stopped") return "stopped" as const;
  if (["starting", "api_ready", "syncing_career_tools", "restarting"].includes(snapshot.overallState)) return "starting" as const;
  if (snapshot.overallState === "stopping") return "stopping" as const;
  if (snapshot.overallState === "unavailable") return "unavailable" as const;
  return snapshot.processReady ? "running" as const : "unavailable" as const;
}

function safeControlReason(error: unknown, fallback: string) {
  const candidate = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
  return (candidate || fallback).replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 120);
}

function readRestartOptions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const options = value as Record<string, unknown>;
  return {
    ...(options.auto === true ? { auto: true } : {}),
    ...(typeof options.reason === "string" ? { reason: options.reason.slice(0, 160) } : {})
  };
}

function emptySettings(): HermesStartSettings {
  return { baseUrl: "", apiKey: "", model: "", provider: "openai-compatible" };
}
