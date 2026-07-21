import "server-only";
import type { AiSettings } from "@/services/storage/aiSettings";

export type OpenAiCompatibleRequest = {
  systemPrompt: string;
  userPrompt: string;
  maxOutputChars: number;
  signal?: AbortSignal;
};

export type OpenAiCompatibleResponse = {
  output: unknown;
  provider: string;
  model: string;
  outputLength: number;
};

export class OpenAiCompatibleProvider {
  readonly provider: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(settings?: AiSettings) {
    this.provider = settings?.provider || process.env.AI_PROVIDER || "openai-compatible";
    this.model = settings?.model || process.env.AI_MODEL || "";
    this.baseUrl = settings?.baseUrl || process.env.AI_BASE_URL || "https://api.openai.com/v1";
    this.apiKey = settings?.apiKey || process.env.AI_API_KEY || "";
  }

  async invoke(request: OpenAiCompatibleRequest): Promise<OpenAiCompatibleResponse> {
    if (!this.apiKey || !this.model) {
      throw createAiProviderError("missing_ai_config", "AI_API_KEY and AI_MODEL are required.");
    }
    if (this.provider.toLowerCase().includes("anthropic") || /anthropic\.com|\/messages\/?$/i.test(this.baseUrl)) {
      throw createAiProviderError(
        "provider_protocol_mismatch",
        "The configured endpoint uses the Anthropic Messages protocol, but this provider requires an OpenAI-compatible chat/completions endpoint."
      );
    }

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt }
        ],
        temperature: 0.1
      }),
      signal: request.signal
    });

    if (!response.ok) {
      throw createAiProviderError(`provider_http_${response.status}`, `Provider returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (typeof content !== "string" || content.trim().length === 0) {
      throw createAiProviderError("empty_model_output", "Provider returned empty content.");
    }

    if (content.length > request.maxOutputChars) {
      throw createAiProviderError("model_output_too_large", "Provider output exceeded the task limit.");
    }

    return {
      output: parseJsonContent(content),
      provider: this.provider,
      model: this.model,
      outputLength: content.length
    };
  }
}

export class AiProviderError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export function createAiProviderError(code: string, message: string) {
  return new AiProviderError(code, message);
}

function parseJsonContent(content: string) {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models wrap JSON in explanatory text; try to extract the JSON object/array.
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try { return JSON.parse(objectMatch[0]); } catch { /* fall through */ }
    }
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try { return JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
    }
    throw createAiProviderError("invalid_json", "Provider returned content that is not valid JSON.");
  }
}
