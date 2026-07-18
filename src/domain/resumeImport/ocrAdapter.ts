import {
  ResumeOcrHealthResponseSchema,
  ResumeOcrSuccessResponseSchema,
  type ResumeOcrBlock,
  type ResumeOcrHealthResponse,
  type ResumeOcrProgressStage
} from "@/domain/schemas";
import { layoutDocumentFromSourceBlocks, type LayoutDocument } from "./layoutDocument";
import { buildLayoutGraph, type LayoutGraph } from "./layoutGraph";
import { LocalDeterministicSemanticResolver, type ResumeSemanticTree } from "./resumeSemanticTree";

export type ResumeOcrAdapterResult =
  | {
      ok: true;
      text: string;
      engine: "paddleocr-vl-local";
      engineVersion: string;
      pageCount: number;
      blocks: ResumeOcrBlock[];
      elapsedMs: number;
      warnings: string[];
      layoutDocument: LayoutDocument;
      layoutGraph: LayoutGraph;
      semanticTree: ResumeSemanticTree;
    }
  | {
      ok: false;
      code: "engine_unavailable" | "unsupported_file" | "empty_ocr_text" | "timeout" | "cancelled" | "invalid_response" | "request_failed";
      message: string;
      engine: "paddleocr-vl-local";
      warnings: string[];
    };

export type ResumeOcrProgress = {
  stage: ResumeOcrProgressStage;
  completedPages?: number;
  totalPages?: number;
  message: string;
};

export type ResumeOcrRunOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: ResumeOcrProgress) => void;
};

export interface ResumeOcrAdapter {
  readonly engine: "paddleocr-vl-local";
  health(signal?: AbortSignal): Promise<ResumeOcrHealthResponse>;
  recognize(file: File, options?: ResumeOcrRunOptions): Promise<ResumeOcrAdapterResult>;
}

export type ResumeOcrBenchmarkResult = {
  engine: "paddleocr-vl-local";
  classification: "A" | "B" | "C";
  productStatus: string;
  supported: boolean;
  elapsedMs: number;
  sampleTextLength: number;
  model: {
    name: "PaddleOCR-VL-1.6";
    version: string;
    cpu: "available" | "unavailable" | "unknown";
    gpu: "available" | "unavailable" | "unknown";
    vramMb: number | null;
  };
  conclusion: string;
  recommendation: "use_manual_fallback" | "adapter_ready";
  notes: string[];
};

const OCR_ENGINE_NAME = "paddleocr-vl-local" as const;
const OCR_ENDPOINT = "/api/resume-import/ocr";
const DEFAULT_OCR_TIMEOUT_MS = 120_000;

export function createLocalPaddleOcrAdapter(input: {
  fetchImpl?: typeof fetch;
  endpoint?: string;
} = {}): ResumeOcrAdapter {
  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = input.endpoint ?? OCR_ENDPOINT;
  return {
    engine: OCR_ENGINE_NAME,
    async health(signal) {
      try {
        const response = await fetchImpl(endpoint, { method: "GET", cache: "no-store", signal });
        const parsed = ResumeOcrHealthResponseSchema.safeParse(await response.json());
        if (parsed.success) return parsed.data;
      } catch {
        // Converted to the explicit unavailable result below; no source content is logged.
      }
      return unavailableHealth("本地 OCR 服务未连接。");
    },
    async recognize(file, options = {}) {
      if (!isSupportedOcrFile(file)) return failure("unsupported_file", "OCR 仅接收 PDF、PNG 或 JPG。", []);
      if (options.signal?.aborted) return failure("cancelled", "OCR 已取消。", []);

      options.onProgress?.({ stage: "checking_engine", message: "正在检查本地 OCR 引擎…" });
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(
        () => controller.abort(new DOMException("OCR timeout", "TimeoutError")),
        options.timeoutMs ?? DEFAULT_OCR_TIMEOUT_MS
      );

      try {
        const health = await this.health(controller.signal);
        if (!health.ok || !health.configured || !health.modelAvailable || !health.runtimeAvailable) {
          return failure("engine_unavailable", health.message, ["识别结果不会绕过导入核对或 Fact Guard。"]);
        }

        options.onProgress?.({ stage: "uploading", message: "正在把文件发送到本机 OCR 进程…" });
        const body = new FormData();
        body.set("file", file, file.name);
        const response = await fetchImpl(endpoint, { method: "POST", body, signal: controller.signal });
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) {
          const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
            ? payload.message
            : "本地 OCR 请求失败。";
          return failure(response.status === 503 ? "engine_unavailable" : "request_failed", message, []);
        }

        options.onProgress?.({ stage: "normalizing", message: "正在校验 OCR 来源块…" });
        const parsed = ResumeOcrSuccessResponseSchema.safeParse(payload);
        if (!parsed.success) return failure("invalid_response", "本地 OCR 返回格式无效，结果未进入导入草稿。", []);
        if (!parsed.data.text.trim() || !parsed.data.blocks.some((block) => block.text.trim())) {
          return failure("empty_ocr_text", "OCR 未识别到可核对文字。", parsed.data.warnings);
        }

        options.onProgress?.({
          stage: "completed",
          completedPages: parsed.data.pageCount,
          totalPages: parsed.data.pageCount,
          message: "OCR 识别完成，等待逐项核对。"
        });
        const layoutDocument = layoutDocumentFromSourceBlocks({
          pageCount: parsed.data.pageCount,
          engine: "paddleocr_vl",
          blocks: parsed.data.blocks.map((block) => ({
            ...block,
            sourceEngine: "paddleocr_vl" as const,
            sourceEngineVersion: parsed.data.engineVersion,
            extractionConfidence: block.confidence
          }))
        });
        const layoutGraph = buildLayoutGraph(layoutDocument);
        const semanticTree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument, layoutGraph });
        return {
          ok: true,
          text: parsed.data.text,
          engine: parsed.data.engine,
          engineVersion: parsed.data.engineVersion,
          pageCount: parsed.data.pageCount,
          blocks: parsed.data.blocks,
          elapsedMs: parsed.data.elapsedMs,
          warnings: parsed.data.warnings,
          layoutDocument,
          layoutGraph,
          semanticTree
        };
      } catch (error) {
        if (options.signal?.aborted) return failure("cancelled", "OCR 已取消。", []);
        if (controller.signal.aborted) return failure("timeout", "本地 OCR 超时，未保存不完整结果。", []);
        return failure("request_failed", error instanceof Error ? error.message : "本地 OCR 请求失败。", []);
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
      }
    }
  };
}

const defaultOcrAdapter = createLocalPaddleOcrAdapter();

export function runResumeOcrAdapter(file: File, options?: ResumeOcrRunOptions) {
  return defaultOcrAdapter.recognize(file, options);
}

export async function benchmarkResumeOcrAdapter(adapter: ResumeOcrAdapter = defaultOcrAdapter): Promise<ResumeOcrBenchmarkResult> {
  const startedAt = performance.now();
  const health = await adapter.health();
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
  const supported = health.ok && health.configured && health.modelAvailable && health.runtimeAvailable;
  return {
    engine: OCR_ENGINE_NAME,
    classification: supported ? "A" : health.modelAvailable ? "B" : "C",
    productStatus: supported ? "本地 PaddleOCR-VL Adapter 已就绪；输出仍必须进入逐项核对。" : health.message,
    supported,
    elapsedMs,
    sampleTextLength: 0,
    model: {
      name: "PaddleOCR-VL-1.6",
      version: "1.6",
      cpu: health.runtimeAvailable ? "available" : "unknown",
      gpu: health.device?.toLowerCase().includes("gpu") ? "available" : "unknown",
      vramMb: null
    },
    conclusion: supported ? "Adapter、模型与运行时健康检查通过。" : "OCR 不可用时明确降级到原文保留和人工核对，不伪装成功。",
    recommendation: supported ? "adapter_ready" : "use_manual_fallback",
    notes: [health.message]
  };
}

function isSupportedOcrFile(file: File) {
  return file.type === "image/png" || file.type === "image/jpeg" || file.type === "application/pdf";
}

function failure(
  code: Extract<ResumeOcrAdapterResult, { ok: false }>["code"],
  message: string,
  warnings: string[]
): ResumeOcrAdapterResult {
  return { ok: false, code, message, engine: OCR_ENGINE_NAME, warnings };
}

function unavailableHealth(message: string): ResumeOcrHealthResponse {
  return {
    ok: false,
    engine: OCR_ENGINE_NAME,
    configured: false,
    modelAvailable: false,
    runtimeAvailable: false,
    message
  };
}
