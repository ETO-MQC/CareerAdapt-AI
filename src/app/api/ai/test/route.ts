import { NextResponse, type NextRequest } from "next/server";
import { OpenAiCompatibleProvider, type AiProviderError } from "@/ai/providers/openAiCompatibleProvider";
import { decodeAiSettingsFromHeader, type AiSettings } from "@/services/storage/aiSettings";

export async function POST(request: NextRequest) {
  const aiConfigHeader = request.headers.get("x-ai-config");
  const customSettings: AiSettings | undefined = aiConfigHeader ? decodeAiSettingsFromHeader(aiConfigHeader) : undefined;

  const provider = new OpenAiCompatibleProvider(customSettings);
  const started = Date.now();

  try {
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
      latencyMs: Date.now() - started
    });
  } catch (error) {
    const raw = error as AiProviderError;
    const code = typeof raw.code === "string" ? raw.code : "provider_failed";
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, code, message }, { status: 502 });
  }
}
