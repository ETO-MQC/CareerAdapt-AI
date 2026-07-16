import { z } from "zod";
import {
  ExtractedSourceBlockSchema,
  type ExtractedSourceBlock
} from "@/domain/schemas";

const OpenDataLoaderSuccessSchema = z.object({
  ok: z.literal(true),
  engine: z.literal("opendataloader"),
  engineVersion: z.string().min(1),
  text: z.string(),
  blocks: z.array(ExtractedSourceBlockSchema),
  warnings: z.array(z.string()).default([])
}).strict();

export type OpenDataLoaderResult =
  | {
      ok: true;
      engineVersion: string;
      text: string;
      blocks: ExtractedSourceBlock[];
      warnings: string[];
    }
  | {
      ok: false;
      message: string;
    };

export async function runOpenDataLoaderAdapter(
  file: File,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<OpenDataLoaderResult> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: "OpenDataLoader 实验解析仅支持 PDF。" };
  }
  const body = new FormData();
  body.set("file", file, file.name);
  try {
    const response = await (options.fetchImpl ?? fetch)("/api/resume-import/opendataloader", {
      method: "POST",
      body,
      signal: options.signal
    });
    const payload = await response.json().catch(() => undefined);
    const parsed = OpenDataLoaderSuccessSchema.safeParse(payload);
    if (response.ok && parsed.success) {
      return {
        ok: true,
        engineVersion: parsed.data.engineVersion,
        text: parsed.data.text,
        blocks: parsed.data.blocks.map((block) => ({
          ...block,
          sourceEngine: "opendataloader" as const,
          sourceEngineVersion: parsed.data.engineVersion,
          sourceKind: "complex_digital_pdf" as const
        })),
        warnings: parsed.data.warnings
      };
    }
    return {
      ok: false,
      message: readMessage(payload) ?? "OpenDataLoader 实验解析失败。"
    };
  } catch {
    return { ok: false, message: "OpenDataLoader 实验服务未响应。" };
  }
}

function readMessage(value: unknown) {
  if (!value || typeof value !== "object" || !("message" in value)) return undefined;
  return typeof value.message === "string" ? value.message : undefined;
}
