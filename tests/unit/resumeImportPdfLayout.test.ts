import { describe, expect, it } from "vitest";
import { reconstructPdfPageLayout, type PdfLayoutTextItem } from "@/domain/resumeImport/pdfLayout";

function item(text: string, x: number, y: number, width = text.length * 7, height = 10): PdfLayoutTextItem {
  return { text, x, y, width, height, fontSize: height };
}

describe("PDF coordinate reading-order reconstruction", () => {
  it("joins same-baseline fragments and keeps a right-aligned date with its title", () => {
    const result = reconstructPdfPageLayout({
      pageNumber: 1,
      pageWidth: 600,
      pageHeight: 840,
      sourceEngineVersion: "test",
      items: [
        item("教育背景", 40, 760, 60, 14),
        item("广东财经大学", 40, 720, 90),
        item("资产评估", 150, 720, 60),
        item("2024年9月—至今", 465, 720, 95),
        item("GPA：4.95/5.0，排名：1/42", 40, 690, 210)
      ]
    });

    expect(result.classification).toBe("digital_pdf");
    expect(result.blocks[0]).toMatchObject({ blockType: "heading", sourceEngine: "pdfjs" });
    expect(result.blocks[1].rawText).toContain("广东财经大学 资产评估 2024年9月—至今");
    expect(result.blocks[1].position).toEqual(expect.objectContaining({ x: 40 }));
  });

  it("orders independent columns top-to-bottom within each column", () => {
    const items: PdfLayoutTextItem[] = [item("个人简历", 40, 800, 500, 16)];
    for (let index = 0; index < 5; index += 1) {
      items.push(item(`左栏 ${index + 1}`, 40, 740 - index * 28, 120));
      items.push(item(`右栏 ${index + 1}`, 340, 730 - index * 28, 120));
    }
    const result = reconstructPdfPageLayout({
      pageNumber: 1,
      pageWidth: 600,
      pageHeight: 840,
      sourceEngineVersion: "test",
      items
    });

    expect(result.classification).toBe("complex_digital_pdf");
    expect(result.metrics.detectedColumnCount).toBe(2);
    expect(result.blocks.map((block) => block.rawText)).toEqual([
      "个人简历",
      "左栏 1",
      "左栏 2",
      "左栏 3",
      "左栏 4",
      "左栏 5",
      "右栏 1",
      "右栏 2",
      "右栏 3",
      "右栏 4",
      "右栏 5"
    ]);
  });

  it("routes pages without a usable text layer to OCR", () => {
    const result = reconstructPdfPageLayout({
      pageNumber: 2,
      pageWidth: 600,
      pageHeight: 840,
      sourceEngineVersion: "test",
      items: [item("?", 40, 700, 5)]
    });
    expect(result.classification).toBe("scanned_pdf");
    expect(result.warnings).toContain("pdf_text_layer_unusable:2");
  });
});
