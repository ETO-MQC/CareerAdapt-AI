import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ExtractedSourceBlockSchema } from "@/domain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const ResponseSchema = z.object({
  ok: z.literal(true),
  engine: z.literal("opendataloader"),
  engineVersion: z.string().min(1),
  text: z.string(),
  blocks: z.array(ExtractedSourceBlockSchema),
  warnings: z.array(z.string()).default([])
}).strict();

export async function GET() {
  const endpoint = configuredEndpoint();
  if (!endpoint) {
    return NextResponse.json({ ok: false, engine: "opendataloader", message: "OpenDataLoader 实验 sidecar 未配置。" });
  }
  try {
    const response = await fetch(`${endpoint}/health`, {
      cache: "no-store",
      headers: sidecarHeaders(),
      signal: AbortSignal.timeout(2_500)
    });
    const payload = await response.json().catch(() => undefined);
    return NextResponse.json(payload ?? { ok: false, engine: "opendataloader", message: "健康检查返回无效。" }, {
      status: response.ok ? 200 : 502
    });
  } catch {
    return NextResponse.json({ ok: false, engine: "opendataloader", message: "OpenDataLoader 实验 sidecar 未响应。" });
  }
}

export async function POST(request: NextRequest) {
  const endpoint = configuredEndpoint();
  if (!endpoint) return NextResponse.json({ message: "OpenDataLoader 实验 sidecar 未配置。" }, { status: 503 });
  const form = await request.formData().catch(() => undefined);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "缺少 PDF 文件。" }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ message: "PDF 为空或超过 30 MB。" }, { status: 413 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ message: "OpenDataLoader 实验解析仅支持 PDF。" }, { status: 415 });
  }
  const outgoing = new FormData();
  outgoing.set("file", file, sanitizeFileName(file.name));
  try {
    const response = await fetch(`${endpoint}/v1/parse`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: outgoing,
      cache: "no-store",
      signal: AbortSignal.timeout(90_000)
    });
    const payload = await response.json().catch(() => undefined);
    const parsed = ResponseSchema.safeParse(payload);
    if (!response.ok || !parsed.success) {
      return NextResponse.json({ message: readMessage(payload) ?? "OpenDataLoader 实验解析返回无效。" }, { status: 502 });
    }
    return NextResponse.json(parsed.data);
  } catch {
    return NextResponse.json({ message: "OpenDataLoader 实验 sidecar 未响应或解析超时。" }, { status: 503 });
  }
}

function configuredEndpoint() {
  const value = process.env.OPENDATALOADER_ENDPOINT?.trim().replace(/\/$/, "");
  return value && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(value) ? value : undefined;
}

function sidecarHeaders(): HeadersInit {
  const token = process.env.OPENDATALOADER_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/\u0000-\u001F\u007F]/g, "_").slice(0, 180) || "resume-input.pdf";
}

function readMessage(value: unknown) {
  if (!value || typeof value !== "object" || !("message" in value)) return undefined;
  return typeof value.message === "string" ? value.message : undefined;
}
