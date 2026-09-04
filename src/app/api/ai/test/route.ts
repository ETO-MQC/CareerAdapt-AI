import { NextResponse, type NextRequest } from "next/server";
import { OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";
import { resolveEffectiveAiConfiguration } from "@/ai/providers/effectiveConfiguration";
import {
  aiProviderErrorCode,
  classifyAiTransportError,
  safeTransportMessage
} from "@/ai/providers/transportError";
import {
  connectionDiagnosticsWithHttp,
  probeAiProviderTransport
} from "@/ai/providers/transportDiagnostics";
import { decodeAiSettingsFromHeader, type AiSettings } from "@/services/storage/aiSettings";
import { runtimeConfigFingerprint } from "@/services/agent/aiRuntimeConfiguration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const aiConfigHeader = request.headers.get("x-ai-config");
  const latencyTest = request.headers.get("x-ai-test-mode") === "latency";
  const customSettings: AiSettings | undefined = aiConfigHeader ? decodeAiSettingsFromHeader(aiConfigHeader) : undefined;

  const configuration = resolveEffectiveAiConfiguration(customSettings);
  const provider = new OpenAiCompatibleProvider(customSettings);
  const configFingerprint = await runtimeConfigFingerprint(configuration);
  const started = Date.now();
  let transportProbe: Awaited<ReturnType<typeof probeAiProviderTransport>> | undefined;

  try {
    if (!configuration.apiKey || !configuration.model) {
      return NextResponse.json({
        ok: false,
        code: "missing_ai_config",
        message: "请填写 API Key 和模型后再测试。",
        configuration: { ...provider.configurationDiagnostic, configFingerprint },
        configFingerprint,
        diagnostics: emptyProbeFromProvider()
      }, { status: 400 });
    }
    if (latencyTest) {
      const response = await provider.invoke({
        systemPrompt: "Output ONLY this raw JSON object: {\"ok\":true}.",
        userPrompt: "Return exactly {\"ok\":true}.",
        maxOutputChars: 64,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)])
      });
      const latencyMs = Date.now() - started;
      return NextResponse.json({
        ok: true,
        provider: response.provider,
        model: response.model,
        configuration: { ...provider.configurationDiagnostic, configFingerprint },
        configFingerprint,
        diagnostics: connectionDiagnosticsWithHttp(emptyProbeFromProvider(), {
          status: "reached",
          statusCode: 200,
          latencyMs
        }),
        latencyMs
      });
    }
    transportProbe = await probeAiProviderTransport(configuration, request.signal);
    if (transportProbe.failureCode) {
      return NextResponse.json({
        ok: false,
        code: transportProbe.failureCode,
        message: safeTransportMessage(transportProbe.failureCode),
        configuration: { ...provider.configurationDiagnostic, configFingerprint },
        configFingerprint,
        diagnostics: transportProbe.diagnostics
      }, { status: transportProbe.failureCode === "request_cancelled" ? 499 : 502 });
    }

    const modelsResult = await readProviderModels(configuration, request.signal);
    if (modelsResult.kind === "error") {
      return NextResponse.json({
        ok: false,
        code: modelsResult.code,
        message: modelsResult.message,
        configuration: { ...provider.configurationDiagnostic, configFingerprint },
        configFingerprint,
        diagnostics: connectionDiagnosticsWithHttp(transportProbe.diagnostics, modelsResult.http)
      }, { status: modelsResult.code === "request_cancelled" ? 499 : 502 });
    }
    if (modelsResult.kind === "models") {
      return NextResponse.json({
        ok: true,
        provider: configuration.provider,
        model: configuration.model,
        configuration: { ...provider.configurationDiagnostic, configFingerprint },
        configFingerprint,
        diagnostics: connectionDiagnosticsWithHttp(transportProbe.diagnostics, {
          status: "reached",
          statusCode: modelsResult.statusCode,
          latencyMs: modelsResult.latencyMs
        }),
        latencyMs: Date.now() - started
      });
    }

    // A compatible endpoint may not implement GET /models. Only then do the
    // cheap fallback completion; it never carries tools or a Career run.
    const response = await provider.invoke({
      systemPrompt: "Output ONLY a raw JSON object. No markdown, no explanation, no preamble. Exactly: {\"ok\":true}",
      userPrompt: "Respond now.",
      maxOutputChars: 8096,
      signal: AbortSignal.timeout(30_000)
    });

    return NextResponse.json({
      ok: true,
      provider: response.provider,
      model: response.model,
      configuration: { ...provider.configurationDiagnostic, configFingerprint },
      configFingerprint,
      diagnostics: connectionDiagnosticsWithHttp(transportProbe.diagnostics, {
        status: "reached",
        statusCode: 200,
        latencyMs: Date.now() - started - transportProbe.diagnostics.latencyMs
      }),
      latencyMs: Date.now() - started
    });
  } catch (error) {
    const code = aiProviderErrorCode(error, { requestSignal: request.signal });
    const diagnostic = classifyAiTransportError(error, { requestSignal: request.signal });
    console.warn("ai_provider_connection_test_failed", {
      code,
      configuration: { ...provider.configurationDiagnostic, configFingerprint }
    });
    return NextResponse.json({
      ok: false,
      code,
      message: safeTransportMessage(code),
      configuration: { ...provider.configurationDiagnostic, configFingerprint },
      configFingerprint,
      diagnostics: connectionDiagnosticsWithHttp(
        transportProbe?.diagnostics ?? emptyProbeFromProvider(),
        {
          status: diagnostic.phase === "http" ? "reached" : "not_reached",
          ...(diagnostic.httpStatus !== undefined ? { statusCode: diagnostic.httpStatus } : {}),
          error: diagnostic
        }
      )
    }, { status: code === "request_cancelled" ? 499 : 502 });
  }
}

function emptyProbeFromProvider() {
  return {
    runtime: process.version,
    dns: { status: "skipped" as const },
    tcp: { status: "skipped" as const },
    tls: { status: "skipped" as const },
    http: { status: "not_attempted" as const },
    latencyMs: 0
  };
}

async function readProviderModels(configuration: { baseUrl: string; apiKey: string; model: string }, requestSignal: AbortSignal) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${configuration.baseUrl.replace(/\/$/u, "")}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${configuration.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(10_000)]),
      cache: "no-store"
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // A reachable endpoint with a non-JSON /models response cannot prove
      // model presence, so use the single minimal completion fallback.
      return { kind: "fallback" as const };
    }
    const latencyMs = Date.now() - startedAt;
    if (response.status === 401 || response.status === 403) {
      return {
        kind: "error" as const,
        code: `provider_http_${response.status}`,
        message: response.status === 401 ? "API Key 无效或没有模型权限。" : "API Key 无效或没有模型权限。",
        http: { status: "reached" as const, statusCode: response.status, latencyMs }
      };
    }
    if (response.status === 429) {
      return {
        kind: "error" as const,
        code: "provider_http_429",
        message: "请求过于频繁，请稍后再试。",
        http: { status: "reached" as const, statusCode: response.status, latencyMs }
      };
    }
    if (response.ok) {
      const ids = modelIds(payload);
      if (ids && !ids.includes(configuration.model)) {
        return {
          kind: "error" as const,
          code: "provider_model_not_found",
          message: "未找到这个模型，请检查模型名称。",
          http: { status: "reached" as const, statusCode: response.status, latencyMs }
        };
      }
      if (ids) return { kind: "models" as const, statusCode: response.status, latencyMs };
    }
    return { kind: "fallback" as const };
  } catch (error) {
    const code = aiProviderErrorCode(error, { requestSignal });
    if (code === "request_cancelled") {
      return {
        kind: "error" as const,
        code,
        message: "连接测试已取消。",
        http: { status: "not_reached" as const, error: classifyAiTransportError(error, { requestSignal }) }
      };
    }
    if (code === "provider_dns_failed" || code === "provider_connection_failed" || code === "provider_timeout") {
      return {
        kind: "error" as const,
        code,
        message: "无法连接 API 地址，请检查地址和网络。",
        http: { status: "not_reached" as const, error: classifyAiTransportError(error, { requestSignal }) }
      };
    }
    return { kind: "fallback" as const };
  }
}

function modelIds(payload: unknown) {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : undefined;
  if (!rows) return undefined;
  return rows
    .map((item) => item && typeof item === "object" && !Array.isArray(item) && typeof (item as { id?: unknown }).id === "string"
      ? (item as { id: string }).id.trim()
      : "")
    .filter(Boolean);
}
