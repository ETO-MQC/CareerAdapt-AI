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
  classification: "A" | "B" | "C";
  productStatus: string;
  supported: boolean;
  elapsedMs: number;
  sampleTextLength: number;
  fixture: {
    singleColumn: string;
    twoColumn: string;
  };
  model: {
    name: string;
    version: string;
    modelFile: string;
    modelSizeMb: number;
    cpu: "used" | "not_used";
    gpu: "used" | "not_used";
    vramMb: number | null;
  };
  measured: {
    singleColumnElapsedMs: number;
    twoColumnElapsedMs: number;
    peakMemoryMb: number;
    fieldCompleteness: number;
    recognizedFieldCount: number;
    expectedFieldCount: number;
    twoColumnOrderPreserved: boolean;
  };
  artifactPaths: {
    benchmark: string;
    singleColumnOutput: string;
    twoColumnOutput: string;
  };
  conclusion: string;
  recommendation: "use_json_fallback" | "adapter_ready";
  notes: string[];
};

const OCR_ENGINE_NAME = "local-browser-ocr-adapter";
const OCR_BENCHMARK_BASELINE = {
  classification: "B" as const,
  productStatus: "已完成本机 Tesseract OCR benchmark；正式产品集成仍后置，UI 不得宣称正式 OCR 支持。",
  fixture: {
    singleColumn: "artifacts/g7b2-ocr-benchmark/single-column-fixture.png",
    twoColumn: "artifacts/g7b2-ocr-benchmark/two-column-fixture.png"
  },
  model: {
    name: "Tesseract OCR",
    version: "tesseract v5.4.0.20240606",
    modelFile: "eng.traineddata",
    modelSizeMb: 3.9,
    cpu: "used" as const,
    gpu: "not_used" as const,
    vramMb: null
  },
  measured: {
    singleColumnElapsedMs: 436,
    twoColumnElapsedMs: 295,
    peakMemoryMb: 42.8,
    fieldCompleteness: 1,
    recognizedFieldCount: 11,
    expectedFieldCount: 11,
    twoColumnOrderPreserved: false
  },
  artifactPaths: {
    benchmark: "artifacts/g7b2-ocr-benchmark/benchmark.json",
    singleColumnOutput: "artifacts/g7b2-ocr-benchmark/single-column-output.txt",
    twoColumnOutput: "artifacts/g7b2-ocr-benchmark/two-column-output.txt"
  },
  conclusion: "单栏 fixture 字段完整率 11/11，但双栏顺序未保持；OCR 只能作为实验性能力保留，正式导入仍优先使用 JSON、DOCX 或文本型 PDF。"
};

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
    classification: OCR_BENCHMARK_BASELINE.classification,
    productStatus: OCR_BENCHMARK_BASELINE.productStatus,
    supported: result.ok,
    elapsedMs,
    sampleTextLength: result.ok ? result.text.length : 0,
    fixture: OCR_BENCHMARK_BASELINE.fixture,
    model: OCR_BENCHMARK_BASELINE.model,
    measured: OCR_BENCHMARK_BASELINE.measured,
    artifactPaths: OCR_BENCHMARK_BASELINE.artifactPaths,
    conclusion: OCR_BENCHMARK_BASELINE.conclusion,
    recommendation: result.ok ? "adapter_ready" : "use_json_fallback",
    notes: result.ok
      ? ["OCR Adapter 可返回文本，仍需用户在核对页逐字段确认。"]
      : [
          result.message,
          ...result.warnings,
          OCR_BENCHMARK_BASELINE.productStatus,
          OCR_BENCHMARK_BASELINE.conclusion
        ]
  };
}
