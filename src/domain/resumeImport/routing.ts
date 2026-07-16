import type {
  DocumentRecognitionPreferences,
  ImportQualityReport,
  ResumeSourceKind
} from "@/domain/schemas";

export type DocumentImportRoute =
  | "pdfjs"
  | "docx"
  | "local_ocr"
  | "manual_review"
  | "opendataloader";

export type DocumentImportRoutingDecision = {
  route: DocumentImportRoute;
  reason: string;
  fallbackRoute?: Exclude<DocumentImportRoute, "opendataloader">;
  canUseOcr: boolean;
  ocrExpectedSlow: boolean;
  experimental: boolean;
};

export function selectDocumentImportRoute(input: {
  sourceKind: ResumeSourceKind | "pdf";
  preferences: DocumentRecognitionPreferences;
  qualityReport?: ImportQualityReport;
  ocrReady?: boolean;
  openDataLoaderReady?: boolean;
}): DocumentImportRoutingDecision {
  const { preferences } = input;
  if (input.sourceKind === "docx") {
    return decision("docx", "DOCX 使用结构化段落、列表和表格解析。", {
      canUseOcr: false
    });
  }
  if (input.sourceKind === "standard_json" || input.sourceKind === "external_json") {
    return decision("manual_review", "结构化 JSON 经过 Schema 校验后进入人工核对。", {
      canUseOcr: false
    });
  }
  if (preferences.parsingMode === "manual_review") {
    return decision("manual_review", "已按设置跳过自动路线选择，仅保留人工核对。", {
      canUseOcr: preferences.localOcrEnabled
    });
  }
  if (preferences.parsingMode === "local_ocr") {
    if (preferences.localOcrEnabled && input.ocrReady !== false) {
      return decision("local_ocr", "已按设置强制使用本地 OCR；识别通常比文本解析更慢。", {
        fallbackRoute: "manual_review",
        canUseOcr: true,
        ocrExpectedSlow: true
      });
    }
    return decision("manual_review", "已选择本地 OCR，但引擎当前不可用，将降级为人工核对。", {
      canUseOcr: false
    });
  }
  if (preferences.parsingMode === "text_layer") {
    return decision("pdfjs", "已按设置优先使用 PDF 文本层，不会自动切换 OCR。", {
      fallbackRoute: "manual_review",
      canUseOcr: preferences.localOcrEnabled
    });
  }

  const quality = input.qualityReport;
  const damagedTextLayer = quality?.recommendedRoute === "ocr_ai";
  if (damagedTextLayer) {
    if (preferences.localOcrEnabled && input.ocrReady !== false) {
      return decision("local_ocr", "文本层缺失或质量过低，自动切换到本地 OCR。", {
        fallbackRoute: "manual_review",
        canUseOcr: true,
        ocrExpectedSlow: true
      });
    }
    return decision("manual_review", "文本层质量过低且本地 OCR 不可用，将降级为人工核对。", {
      canUseOcr: false
    });
  }

  const complexLayout = quality?.layoutComplexity === "multi_column" || quality?.layoutComplexity === "table";
  if (complexLayout && preferences.openDataLoaderExperimental && input.openDataLoaderReady !== false) {
    return decision("opendataloader", "检测到复杂数字 PDF，已启用 OpenDataLoader 实验解析。", {
      fallbackRoute: "pdfjs",
      canUseOcr: preferences.localOcrEnabled,
      experimental: true
    });
  }

  return decision("pdfjs", quality
    ? "文本层质量可用，使用 PDF.js 坐标阅读顺序解析。"
    : "将先检查 PDF 文本层质量，再决定是否需要本地 OCR。", {
    fallbackRoute: "manual_review",
    canUseOcr: preferences.localOcrEnabled
  });
}

function decision(
  route: DocumentImportRoute,
  reason: string,
  overrides: Partial<Omit<DocumentImportRoutingDecision, "route" | "reason">> = {}
): DocumentImportRoutingDecision {
  return {
    route,
    reason,
    canUseOcr: true,
    ocrExpectedSlow: route === "local_ocr",
    experimental: route === "opendataloader",
    ...overrides
  };
}
