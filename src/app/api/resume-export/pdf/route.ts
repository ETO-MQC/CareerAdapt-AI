import { NextRequest, NextResponse } from "next/server";
import { ResumePdfExportRequestSchema } from "@/domain/schemas";
import { contentDispositionAttachment, PDF_MIME_TYPE, assertSafePdfFileName } from "@/services/export/filename";
import { ResumePdfGenerationError, generateResumePdf } from "@/services/export/pdfGenerator";
import { isPaginationPlanBlocked } from "@/services/export/pagination";
import { verifyExportSnapshotHash } from "@/services/export/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", 400);
  }

  const parsed = ResumePdfExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_export_request", 400);
  }

  const exportRequest = parsed.data;
  const snapshot = exportRequest.snapshot;
  if (!verifyExportSnapshotHash(snapshot)) {
    return errorResponse("snapshot_hash_mismatch", 409, exportRequest.exportId, snapshot);
  }
  if (isPaginationPlanBlocked(snapshot.paginationPlan)) {
    return errorResponse("snapshot_overflow", 409, exportRequest.exportId, snapshot);
  }

  try {
    assertSafePdfFileName(snapshot.filename);
    const result = await generateResumePdf(snapshot);
    const pdfBody = result.pdf.buffer.slice(
      result.pdf.byteOffset,
      result.pdf.byteOffset + result.pdf.byteLength
    ) as ArrayBuffer;
    return new Response(pdfBody, {
      headers: {
        "Content-Type": PDF_MIME_TYPE,
        "Content-Disposition": contentDispositionAttachment(snapshot.filename),
        "Cache-Control": "no-store",
        "X-CareerAdapt-Export-Id": exportRequest.exportId,
        "X-CareerAdapt-Snapshot-Hash": snapshot.snapshotHash,
        "X-CareerAdapt-Overflow-Status": result.overflowStatus
      }
    });
  } catch (error) {
    const code = error instanceof ResumePdfGenerationError ? error.code : "pdf_generation_failed";
    return errorResponse(code, code === "export_snapshot_overflow" ? 409 : 500, exportRequest.exportId, snapshot);
  }
}

function errorResponse(
  code: string,
  status: number,
  exportId?: string,
  snapshot?: { branchId: string; branchRevision: number; templateId: string; renderModel: { safety: { visibleItemCount: number } } }
) {
  if (exportId && snapshot) {
    console.warn("resume_pdf_export_failed", {
      exportId,
      branchId: snapshot.branchId,
      branchRevision: snapshot.branchRevision,
      templateId: snapshot.templateId,
      visibleItemCount: snapshot.renderModel.safety.visibleItemCount,
      code
    });
  }
  return NextResponse.json({ code }, { status });
}
