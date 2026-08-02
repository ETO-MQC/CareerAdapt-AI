import { NextResponse } from "next/server";
import { DocumentRecognitionModelIdSchema } from "@/domain/schemas";
import {
  DEFAULT_DOCUMENT_RECOGNITION_MODEL_ID
} from "@/domain/documentRecognition/modelCatalog";
import { downloadPaddleOcrVlModel } from "@/services/documentRecognition/modelDownload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({})) as { modelId?: unknown };
    const modelId = DocumentRecognitionModelIdSchema.parse(payload.modelId ?? DEFAULT_DOCUMENT_RECOGNITION_MODEL_ID);
    const result = await downloadPaddleOcrVlModel({ modelId, signal: request.signal });
    return NextResponse.json({
      ok: true,
      ...result,
      message: result.downloadedFiles
        ? `${result.modelLabel} 已下载到本机模型目录。`
        : `${result.modelLabel} 已存在，未重复下载。`
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ ok: false, cancelled: true, message: "模型下载已取消。" }, { status: 499 });
    }
    return NextResponse.json({
      ok: false,
      message: "模型下载未完成；请检查网络、磁盘空间后重试，未完成文件会保留以便重试。"
    }, { status: 502 });
  }
}
