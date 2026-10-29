import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";
import { resolveEffectiveAiConfiguration } from "@/ai/providers/effectiveConfiguration";
import { aiProviderErrorCode } from "@/ai/providers/transportError";
import { decodeAiSettingsFromHeader } from "@/services/storage/aiSettings";
import { ResumeVisionRequestSchema, ResumeVisionOutputSchema, resumeVisionPrompt } from "@/domain/resumeImport/visionContract";
import { DEFAULT_VISION_TIMEOUT_SECONDS, RESUME_IMPORT_TIMEOUT_HEADER, ResumeImportTimeoutSecondsSchema } from "@/domain/resumeImport/timeouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const verifiedVisionConfigurations = new Set<string>();
function visionConfigurationKey(configuration: ReturnType<typeof resolveEffectiveAiConfiguration>) {
  return createHash("sha256").update(JSON.stringify(configuration)).digest("hex");
}

/** No material is transmitted during capability discovery. Unknown stays manual/OCR. */
export async function GET(request: Request) {
  const configuration = resolveEffectiveAiConfiguration(decodeAiSettingsFromHeader(request.headers.get("x-ai-config") ?? ""));
  const reply = (supported: boolean, reason: string) => NextResponse.json({ supported, reason }, { headers: { "Cache-Control": "no-store" } });
  if (!configuration.apiKey || !configuration.model) return reply(false, "vision_not_configured");
  if (verifiedVisionConfigurations.has(visionConfigurationKey(configuration))) return reply(true, "verified_image_request");
  try {
    const response = await fetch(`${configuration.baseUrl.replace(/\/$/u, "")}/models`, {
      headers: { Authorization: `Bearer ${configuration.apiKey}` },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]), cache: "no-store"
    });
    if (!response.ok) return reply(false, "vision_capability_unverified");
    const payload = await response.json() as { data?: Array<{ id?: string; input_modalities?: string[]; architecture?: { input_modalities?: string[] } }> };
    const model = Array.isArray(payload.data) ? payload.data.find((entry) => entry.id === configuration.model) : undefined;
    const modalities = model?.input_modalities ?? model?.architecture?.input_modalities;
    return reply(Array.isArray(modalities) && modalities.includes("image"), "provider_model_metadata");
  } catch (error) {
    if (request.signal.aborted) throw error;
    return reply(false, "vision_capability_unavailable");
  }
}

export async function POST(request: Request) {
  const timeoutHeader = request.headers.get(RESUME_IMPORT_TIMEOUT_HEADER);
  const timeout = ResumeImportTimeoutSecondsSchema.safeParse(timeoutHeader === null ? DEFAULT_VISION_TIMEOUT_SECONDS : Number(timeoutHeader));
  if (!timeout.success) return failure("vision_invalid_timeout", "图像识别等待时间应在 1～30 分钟之间。", 400);
  if (Number(request.headers.get("content-length")) > 6_100_000) return failure("vision_input_too_large", "页面图片过大，请压缩后重试。", 413);
  const raw = await request.text();
  if (raw.length > 6_100_000) return failure("vision_input_too_large", "页面图片过大，请压缩后重试。", 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return failure("vision_invalid_input", "图片请求格式无效。", 400); }
  const parsed = ResumeVisionRequestSchema.safeParse(body);
  if (!parsed.success) return failure("vision_invalid_input", "仅支持有页码的 PNG/JPEG 页面图像。", 400);
  const bytes = Buffer.from(parsed.data.image.split(",")[1], "base64");
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8) && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return failure("vision_invalid_image", "页面图像内容与格式不符。", 400);
  }
  const configuration = resolveEffectiveAiConfiguration(decodeAiSettingsFromHeader(request.headers.get("x-ai-config") ?? ""));
  if (!configuration.apiKey || !configuration.model) return failure("vision_not_configured", "请先在 AI 配置中保存可读取图片的模型和密钥。", 409);
  try {
    const result = await new OpenAiCompatibleProvider(undefined, configuration).invoke({
      systemPrompt: resumeVisionPrompt,
      userPrompt: `Transcribe career material page ${parsed.data.pageNumber}. Return the required JSON.`,
      images: [parsed.data.image], maxOutputChars: 24_000, stream: true,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeout.data * 1000)])
    });
    const output = ResumeVisionOutputSchema.safeParse(result.output);
    if (!output.success) return failure("vision_invalid_output", "AI 图像识别未返回有效文本，原文件未写入正式资料，请重试。", 502);
    verifiedVisionConfigurations.add(visionConfigurationKey(configuration));
    return NextResponse.json({ ok: true, text: output.data.text, provider: result.provider, model: result.model }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = aiProviderErrorCode(error, { requestSignal: request.signal });
    const message = code === "request_cancelled" ? "AI 图像识别已取消。"
      : ["provider_http_400", "provider_http_404", "provider_http_422"].includes(code)
        ? "当前模型或接口未接受图片请求，请切换支持图像输入的模型后重试，也可使用本地 OCR。"
        : code === "provider_http_401" || code === "provider_http_403"
          ? "图像识别请求未通过服务商鉴权或权限检查，请核对已保存的密钥及模型权限。"
          : code === "provider_http_429" ? "图像识别服务限流，请稍后重试。"
            : code === "provider_timeout" ? "AI 图像识别超时，请重试或使用本地 OCR。"
              : "AI 图像识别未完成，文件已保留在当前导入窗口，可重试或使用本地 OCR。";
    return failure(code, message, 502);
  }
}

function failure(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status, headers: { "Cache-Control": "no-store" } });
}
