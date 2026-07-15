import { Blob as NodeBlob } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extractTextFromDocxBuffer } from "@/domain/resumeImport/docx";
import { analyzeImportQuality, normalizeExtractedSourceBlocks } from "@/domain/resumeImport/normalizer";

const fixture = (name: string) => resolve(process.cwd(), "tests", "fixtures", "resume-import", name);
const BrowserBlob = globalThis.Blob;

beforeAll(() => vi.stubGlobal("Blob", NodeBlob));
afterAll(() => vi.stubGlobal("Blob", BrowserBlob));

async function extract(name: string) {
  const bytes = await readFile(fixture(name));
  return extractTextFromDocxBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

describe("P3.6a DOCX sample matrix", () => {
  it("preserves headings and ordinary paragraphs in document order", async () => {
    const result = await extract("ordinary.docx");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks.map(({ blockType, text }) => ({ blockType, text }))).toEqual([
      { blockType: "heading", text: "Experience" },
      { blockType: "paragraph", text: "Built a verified analytics dashboard." }
    ]);
  });

  it("preserves table cells instead of flattening the table", async () => {
    const result = await extract("table.docx");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toMatchObject([
      { blockType: "table_cell", text: "Skill" },
      { blockType: "table_cell", text: "Python" }
    ]);
  });

  it("flags PDF-to-Word single-character paragraphs as fragmented", async () => {
    const result = await extract("fragmented-pdf-conversion.docx");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const normalized = normalizeExtractedSourceBlocks(result.blocks);
    const quality = analyzeImportQuality({ sourceType: "docx", blocks: normalized });
    expect(quality.lineFragmentationScore).toBeGreaterThan(0.5);
    expect(quality.readingOrderConfidence).not.toBe("high");
  });
});
