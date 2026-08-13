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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const aiConfigHeader = request.headers.get("x-ai-config");
  const customSettings: AiSettings | undefined = aiConfigHeader ? decodeAiSettingsFromHeader(aiConfigHeader) : undefined;

  const configuration = resolveEffectiveAiConfiguration(customSettings);
  const provider = new OpenAiCompatibleProvider(customSettings);
  const started = Date.now();
  let transportProbe: Awaited<ReturnType<typeof probeAiProviderTransport>> | undefined;

  try {
    transportProbe = await probeAiProviderTransport(configuration, request.signal);
    if (transportProbe.failureCode) {
      return NextResponse.json({
        ok: false,
        code: transportProbe.failureCode,
        message: safeTransportMessage(transportProbe.failureCode),
        configuration: provider.configurationDiagnostic,
        diagnostics: transportProbe.diagnostics
      }, { status: transportProbe.failureCode === "request_cancelled" ? 499 : 502 });
    }

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
      configuration: provider.configurationDiagnostic,
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
      configuration: provider.configurationDiagnostic
    });
    return NextResponse.json({
      ok: false,
      code,
      message: safeTransportMessage(code),
      configuration: provider.configurationDiagnostic,
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
