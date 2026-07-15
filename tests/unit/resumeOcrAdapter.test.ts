import { describe, expect, it, vi } from "vitest";
import { createLocalPaddleOcrAdapter } from "@/domain/resumeImport/ocrAdapter";

const health = {
  ok: true,
  engine: "paddleocr-vl-local",
  configured: true,
  modelAvailable: true,
  runtimeAvailable: true,
  device: "gpu:0",
  message: "ready"
};

describe("local PaddleOCR-VL adapter", () => {
  it("validates the sidecar response and reports progress without persisting automatically", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        engine: "paddleocr-vl-local",
        engineVersion: "3.6.0",
        modelName: "PaddleOCR-VL-1.6",
        elapsedMs: 1250,
        pageCount: 1,
        text: "教育背景\nGPA：3.95/5.0",
        blocks: [{
          id: "ocr:1:block:0",
          page: 1,
          text: "GPA：3.95/5.0",
          rawText: "GPA：3.95/5.0",
          blockType: "paragraph",
          position: { x: 20, y: 80, width: 180, height: 20 },
          order: 0,
          confidence: 0.96
        }],
        warnings: []
      }));
    const adapter = createLocalPaddleOcrAdapter({ fetchImpl: fetchImpl as typeof fetch });
    const stages: string[] = [];
    const result = await adapter.recognize(new File(["image"], "resume.png", { type: "image/png" }), {
      onProgress: (progress) => stages.push(progress.stage)
    });

    expect(result).toMatchObject({ ok: true, engine: "paddleocr-vl-local", pageCount: 1 });
    expect(result.ok ? result.blocks[0].text : "").toBe("GPA：3.95/5.0");
    expect(stages).toEqual(["checking_engine", "uploading", "normalizing", "completed"]);
  });

  it("rejects malformed output instead of treating it as recognized text", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(health)).mockResolvedValueOnce(jsonResponse({ ok: true, text: "invented" }));
    const adapter = createLocalPaddleOcrAdapter({ fetchImpl: fetchImpl as typeof fetch });
    const result = await adapter.recognize(new File(["image"], "resume.jpg", { type: "image/jpeg" }));
    expect(result).toMatchObject({ ok: false, code: "invalid_response" });
  });

  it("honors cancellation before contacting the local service", async () => {
    const fetchImpl = vi.fn();
    const adapter = createLocalPaddleOcrAdapter({ fetchImpl: fetchImpl as typeof fetch });
    const controller = new AbortController();
    controller.abort();
    const result = await adapter.recognize(new File(["image"], "resume.png", { type: "image/png" }), { signal: controller.signal });
    expect(result).toMatchObject({ ok: false, code: "cancelled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
