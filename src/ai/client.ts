import { nanoid } from "nanoid";
import type { z } from "zod";
import { AiLogSchema, type AiLog, type AiTask } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { readAiSettings, hasCustomAiSettings, encodeAiSettingsForHeader } from "@/services/storage/aiSettings";
import type { SafeSchemaIssue, ResumeMapperResponseSnapshot } from "@/ai/resumeDocumentMapperDiagnostics";
import { readDocumentRecognitionPreferences } from "@/services/preferences/documentRecognition";
import { DEFAULT_MAPPING_TIMEOUT_SECONDS, RESUME_IMPORT_TIMEOUT_HEADER } from "@/domain/resumeImport/timeouts";

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
        attemptCount?: number;
        providerMessage?: string;
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
        safeErrorCode?: string;
        providerMessage?: string;
        failedIssues?: SafeSchemaIssue[];
        responseSnapshots?: ResumeMapperResponseSnapshot[];
        attempt?: number;
      };
    };

export async function invokeStructuredAi<TOutput>(input: {
  task: AiTask;
  businessInput: unknown;
  outputSchema: z.ZodType<TOutput>;
  signal?: AbortSignal;
}) {
  const aiSettings = readAiSettings();
  // V4-P0 S-2: the header carries provider coordinates only. The credential is never read here
  // (`readAiSettings` never restores it) and never travels in a request header; the server
  // resolves it from the main-process secure store or its own environment.
  const hasCustomSettings = hasCustomAiSettings();

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

type StructuredAiDiagnostics = {
  provider?: string;
  model?: string;
  attempt?: number;
  latencyMs?: number;
  safeErrorCode?: string;
  providerMessage?: string;
};

  if (hasCustomSettings) {
    headers["x-ai-config"] = encodeAiSettingsForHeader(aiSettings);
  }
  if (input.task === "resume-document-mapper") {
    headers[RESUME_IMPORT_TIMEOUT_HEADER] = String(readDocumentRecognitionPreferences().mappingTimeoutSeconds ?? DEFAULT_MAPPING_TIMEOUT_SECONDS);
  }

  const tailoringRequest = ["resume-optimization-planner", "resume-tailor", "resume-tailor-batch", "resume-tailor-diff"].includes(input.task);
  const deadlineSignal = tailoringRequest ? AbortSignal.timeout(45_000) : undefined;
  const requestSignal = deadlineSignal
    ? (input.signal ? AbortSignal.any([input.signal, deadlineSignal]) : deadlineSignal)
    : input.signal;
  const requestId = nanoid(12);
  if (tailoringRequest) headers["x-career-request-id"] = requestId;
  const trace = (phase: string, errorCategory?: string) => {
    if (tailoringRequest) console.info("[tailoring-request]", { requestId, taskId: input.task, phase,
      elapsedMs: Date.now() - requestStartedAt, ...(errorCategory ? { errorCategory } : {}) });
  };
  const requestInit: RequestInit = {
    method: "POST", headers, signal: requestSignal,
    body: JSON.stringify({ task: input.task, input: input.businessInput })
  };
  const requestStartedAt = Date.now();
  const elapsedMs = () => Math.max(0, Date.now() - requestStartedAt);
  let response: Response;
  let responseText: string;
  trace("request_started");
  try {
    response = await fetch("/api/ai/structured", requestInit);
    if (
      !tailoringRequest && input.task !== "resume-document-mapper"
      && [429, 502, 503].includes(response.status)
      && !input.signal?.aborted
    ) {
      await abortableDelay(response.status === 429 ? 500 : 250, input.signal);
      response = await fetch("/api/ai/structured", requestInit);
    }
    trace("response_headers");
    responseText = await response.text();
    trace("response_received");
  } catch {
    const errorCode = input.signal?.aborted ? "request_cancelled" : deadlineSignal?.aborted ? "provider_timeout" : "provider_unavailable";
    trace("failed", errorCode);
    return {
      ok: false as const,
      errorCode,
      diagnostics: {
        safeErrorCode: errorCode,
        provider: "server",
        attempt: 1,
        latencyMs: elapsedMs()
      } satisfies StructuredAiDiagnostics,
      log: createAiLog({
        task: input.task,
        status: "provider_failed",
        promptVersion: "server-registered",
        input: input.businessInput,
        errorCode
      })
    };
  }

  let payload: StructuredAiResponse<unknown>;
  try {
    payload = JSON.parse(responseText) as StructuredAiResponse<unknown>;
  } catch {
    trace("failed", "structured_endpoint_invalid_json");
    return {
      ok: false as const,
      errorCode: "structured_endpoint_invalid_json",
      diagnostics: {
        safeErrorCode: "structured_endpoint_invalid_json",
        provider: "server",
        attempt: 1,
        latencyMs: elapsedMs()
      } satisfies StructuredAiDiagnostics,
      log: createAiLog({
        task: input.task,
        status: "provider_failed",
        promptVersion: "server-registered",
        input: input.businessInput,
        meta: { outputLength: responseText.length },
        errorCode: "structured_endpoint_invalid_json"
      })
    };
  }

  if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || !payload.ok) {
    const errorCode = payload && typeof payload === "object" && "ok" in payload && !payload.ok
      ? payload.error.code
      : `provider_http_${response.status}`;
    trace("failed", errorCode);
    return {
      ok: false as const,
      errorCode,
      diagnostics: payload && typeof payload === "object" && "ok" in payload && !payload.ok
        ? {
            safeErrorCode: payload.meta?.safeErrorCode ?? errorCode,
            failedIssues: payload.meta?.failedIssues ?? [],
            responseSnapshots: payload.meta?.responseSnapshots,
            provider: payload.meta?.provider,
            model: payload.meta?.model,
            providerMessage: payload.meta?.providerMessage,
            attempt: payload.meta?.attempt,
            latencyMs: payload.meta?.latencyMs
          }
        : {
            safeErrorCode: errorCode,
            provider: "server",
            attempt: 1,
            latencyMs: elapsedMs()
          },
      log: createAiLog({
        task: input.task,
        status: "provider_failed",
        promptVersion: "server-registered",
        input: input.businessInput,
        meta: payload && typeof payload === "object" && "ok" in payload && !payload.ok ? payload.meta : undefined,
        errorCode
      })
    };
  }

  const parsed = input.outputSchema.safeParse(payload.output);

  if (!parsed.success) {
    trace("failed", "client_schema_validation_failed");
    return {
      ok: false as const,
      errorCode: "client_schema_validation_failed",
      diagnostics: {
        safeErrorCode: "client_schema_validation_failed",
        provider: payload.meta.provider,
        model: payload.meta.model,
        attempt: payload.meta.attemptCount ?? 1,
        latencyMs: payload.meta.latencyMs ?? elapsedMs()
      } satisfies StructuredAiDiagnostics,
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

  trace("parsed");
  return {
    ok: true as const,
    data: parsed.data,
    diagnostics: {
      provider: payload.meta.provider,
      model: payload.meta.model,
      attempt: payload.meta.attemptCount ?? 1,
      latencyMs: payload.meta.latencyMs ?? elapsedMs()
    } satisfies StructuredAiDiagnostics,
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
    attemptCount?: number;
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
    attemptCount: input.meta?.attemptCount,
    status: input.status,
    errorCode: input.errorCode,
    createdAt: now,
    updatedAt: now
  });
}
