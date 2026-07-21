import { nanoid } from "nanoid";
import type { z } from "zod";
import { AiLogSchema, type AiLog, type AiTask } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { readAiSettings, encodeAiSettingsForHeader } from "@/services/storage/aiSettings";

type StructuredAiResponse<TOutput> =
  | {
      ok: true;
      task: AiTask;
      promptVersion: string;
      output: TOutput;
      meta: {
        provider: string;
        model: string;
        inputLength: number;
        outputLength: number;
        latencyMs: number;
      };
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
      meta?: {
        provider?: string;
        model?: string;
        inputLength?: number;
        outputLength?: number;
        latencyMs?: number;
      };
    };

export async function invokeStructuredAi<TOutput>(input: {
  task: AiTask;
  businessInput: unknown;
  outputSchema: z.ZodType<TOutput>;
  signal?: AbortSignal;
}) {
  const aiSettings = readAiSettings();
  const hasCustomSettings = aiSettings.apiKey.length > 0 || aiSettings.baseUrl.length > 0 || aiSettings.model.length > 0;

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (hasCustomSettings) {
    headers["x-ai-config"] = encodeAiSettingsForHeader(aiSettings);
  }

  const requestInit: RequestInit = {
    method: "POST", headers, signal: input.signal,
    body: JSON.stringify({ task: input.task, input: input.businessInput })
  };
  let response = await fetch("/api/ai/structured", requestInit);
  if ([429, 502, 503].includes(response.status) && !input.signal?.aborted) {
    await abortableDelay(response.status === 429 ? 500 : 250, input.signal);
    response = await fetch("/api/ai/structured", requestInit);
  }

  const payload = (await response.json()) as StructuredAiResponse<unknown>;

  if (!response.ok || !payload.ok) {
    return {
      ok: false as const,
      errorCode: payload.ok ? "unknown_error" : payload.error.code,
      log: createAiLog({
        task: input.task,
        status: "provider_failed",
        promptVersion: "server-registered",
        input: input.businessInput,
        meta: payload.ok ? undefined : payload.meta,
        errorCode: payload.ok ? "unknown_error" : payload.error.code
      })
    };
  }

  const parsed = input.outputSchema.safeParse(payload.output);

  if (!parsed.success) {
    return {
      ok: false as const,
      errorCode: "client_schema_validation_failed",
      log: createAiLog({
        task: input.task,
        status: "validation_failed",
        promptVersion: payload.promptVersion,
        input: input.businessInput,
        output: payload.output,
        meta: payload.meta,
        errorCode: "client_schema_validation_failed"
      })
    };
  }

  return {
    ok: true as const,
    data: parsed.data,
    promptVersion: payload.promptVersion,
    log: createAiLog({
      task: input.task,
      status: "success",
      promptVersion: payload.promptVersion,
      input: input.businessInput,
      output: payload.output,
      meta: payload.meta
    })
  };
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

export async function invokeStageBAi<TOutput>(input: {
  task: "profile-builder" | "jd-analyzer";
  businessInput: unknown;
  outputSchema: z.ZodType<TOutput>;
}) {
  return invokeStructuredAi(input);
}

function createAiLog(input: {
  task: AiTask;
  status: AiLog["status"];
  promptVersion: string;
  input: unknown;
  output?: unknown;
  meta?: {
    provider?: string;
    model?: string;
    inputLength?: number;
    outputLength?: number;
    latencyMs?: number;
  };
  errorCode?: string;
}) {
  const now = new Date().toISOString();
  const inputText = JSON.stringify(input.input);
  const outputText = input.output === undefined ? "" : JSON.stringify(input.output);

  return AiLogSchema.parse({
    id: `ai-log-${nanoid(10)}`,
    task: input.task,
    provider: input.meta?.provider ?? "server",
    model: input.meta?.model,
    promptVersion: input.promptVersion,
    inputHash: stableHashText(inputText),
    inputLength: input.meta?.inputLength ?? inputText.length,
    outputLength: input.meta?.outputLength ?? (outputText.length || undefined),
    latencyMs: input.meta?.latencyMs,
    status: input.status,
    errorCode: input.errorCode,
    createdAt: now,
    updatedAt: now
  });
}
