import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DocumentEngineHealthReportSchema } from "@/domain/schemas";
import { inspectDocumentEngineHealth } from "@/services/documentRecognition/serverHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  modelDirectory: z.string().max(1024).optional(),
  checkOpenDataLoader: z.boolean().optional()
}).strict();

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => undefined);
  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: "文档引擎检查参数无效。" }, { status: 400 });
  }
  const report = await inspectDocumentEngineHealth(parsed.data);
  return NextResponse.json(DocumentEngineHealthReportSchema.parse(report));
}
