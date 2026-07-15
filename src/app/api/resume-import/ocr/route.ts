import { NextResponse, type NextRequest } from "next/server";
import {
  ResumeOcrHealthResponseSchema,
  ResumeOcrSuccessResponseSchema
} from "@/domain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENGINE = "paddleocr-vl-local" as const;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

export async function GET() {
  const endpoint = configuredEndpoint();
  if (!endpoint) return NextResponse.json(unavailable("未配置 PADDLEOCR_VL_ENDPOINT；OCR 已明确降级为人工核对。"));
  try {
    const response = await fetchWithTimeout(`${endpoint}/health`, { headers: sidecarHeaders() }, 2_500);
    const payload = await response.json();
    const parsed = ResumeOcrHealthResponseSchema.safeParse(payload);
    if (!response.ok || !parsed.success) return NextResponse.json(unavailable("本地 OCR 健康检查失败。"));
    return NextResponse.json({ ...parsed.data, configured: true });
  } catch {
    return NextResponse.json(unavailable("本地 OCR 进程未响应。"));
  }
}

export async function POST(request: NextRequest) {
  const endpoint = configuredEndpoint();
  if (!endpoint) return NextResponse.json({ message: "本地 OCR 未配置。" }, { status: 503 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_BYTES + 1_000_000) {
    return NextResponse.json({ message: "OCR 文件超过 30 MB 限制。" }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ message: "OCR 请求必须是 multipart/form-data。" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "缺少 OCR 文件。" }, { status: 400 });
  if (!ALLOWED_MIME_TYPES.has(file.type)) return NextResponse.json({ message: "OCR 仅接收 PDF、PNG 或 JPG。" }, { status: 415 });
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return NextResponse.json({ message: "OCR 文件为空或超过 30 MB 限制。" }, { status: 413 });

  const outgoing = new FormData();
  outgoing.set("file", file, sanitizeFileName(file.name));
  try {
    const response = await fetchWithTimeout(`${endpoint}/v1/ocr`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: outgoing
    }, 120_000);
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : "本地 OCR 识别失败。";
      return NextResponse.json({ message }, { status: response.status === 503 ? 503 : 502 });
    }
    const parsed = ResumeOcrSuccessResponseSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "本地 OCR 返回格式无效。" }, { status: 502 });
    return NextResponse.json(parsed.data);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return NextResponse.json({ message: timedOut ? "本地 OCR 超时。" : "无法连接本地 OCR 进程。" }, { status: timedOut ? 504 : 503 });
  }
}

function configuredEndpoint() {
  const value = process.env.PADDLEOCR_VL_ENDPOINT?.trim().replace(/\/$/, "");
  return value && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(value) ? value : undefined;
}

function sidecarHeaders(): HeadersInit {
  const token = process.env.PADDLEOCR_VL_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal, cache: "no-store" });
}

function unavailable(message: string) {
  return {
    ok: false,
    engine: ENGINE,
    configured: false,
    modelAvailable: false,
    runtimeAvailable: false,
    message
  };
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/\u0000-\u001F\u007F]/g, "_").slice(0, 180) || "resume-input";
}
