export type ResumeOcrAdapterResult =
  | {
      ok: true;
      text: string;
      engine: string;
      confidence?: number;
      warnings: string[];
    }
  | {
      ok: false;
      code: "engine_unavailable" | "unsupported_file" | "empty_ocr_text";
      message: string;
      engine: string;
      warnings: string[];
    };

export type ResumeOcrBenchmarkResult = {
  engine: string;
  supported: boolean;
  elapsedMs: number;
  sampleTextLength: number;
  recommendation: "use_json_fallback" | "adapter_ready";
  notes: string[];
};

const OCR_ENGINE_NAME = "local-browser-ocr-adapter";

export async function runResumeOcrAdapter(file: File): Promise<ResumeOcrAdapterResult> {
  const supported = file.type === "image/png" || file.type === "image/jpeg" || file.type === "application/pdf";
  if (!supported) {
    return {
      ok: false,
      code: "unsupported_file",
      message: "OCR 仅接收扫描 PDF、PNG 或 JPG。",
      engine: OCR_ENGINE_NAME,
      warnings: []
    };
  }
  return {
    ok: false,
    code: "engine_unavailable",
    message: "本地 OCR Adapter 已接入导入流程，但当前环境未安装可离线运行的 OCR 引擎。请使用 JSON 兜底或文本型 PDF/DOCX。",
    engine: OCR_ENGINE_NAME,
    warnings: ["未引入 PaddleOCR 运行时，避免把未经验证的大模型直接放入主应用。"]
  };
}

export async function benchmarkResumeOcrAdapter(): Promise<ResumeOcrBenchmarkResult> {
  const startedAt = performance.now();
  const result = await runResumeOcrAdapter(new File(["not-an-image"], "ocr-benchmark.png", { type: "image/png" }));
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
  return {
    engine: OCR_ENGINE_NAME,
    supported: result.ok,
    elapsedMs,
    sampleTextLength: result.ok ? result.text.length : 0,
    recommendation: result.ok ? "adapter_ready" : "use_json_fallback",
    notes: result.ok
      ? ["OCR Adapter 可返回文本，仍需用户在核对页逐字段确认。"]
      : [result.message, ...result.warnings]
  };
}
