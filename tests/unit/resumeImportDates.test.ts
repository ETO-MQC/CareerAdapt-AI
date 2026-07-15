import { describe, expect, it } from "vitest";
import { alignResumeDateRange, extractResumeDatesFromBlock, parseResumeDateToken } from "@/domain/resumeImport/dates";

describe("resume import date normalization", () => {
  it("preserves month precision for Chinese and English dates", () => {
    expect(parseResumeDateToken({ rawText: "2024年9月", sourceBlockId: "b1" })).toMatchObject({ value: "2024-09", precision: "month", rawText: "2024年9月" });
    expect(parseResumeDateToken({ rawText: "Sep 2024", sourceBlockId: "b1" })).toMatchObject({ value: "2024-09", precision: "month", rawText: "Sep 2024" });
    expect(parseResumeDateToken({ rawText: "2024", sourceBlockId: "b1" })).toMatchObject({ value: "2024", precision: "year" });
  });

  it("extracts and aligns a range without inventing a date for present", () => {
    const block = { id: "b2", normalizedText: "广东财经大学 2024年9月—至今", extractionConfidence: 0.96 };
    const dates = extractResumeDatesFromBlock(block);
    expect(dates).toHaveLength(2);
    const range = alignResumeDateRange(block);
    expect(range.startDate).toEqual(expect.objectContaining({ value: "2024-09", precision: "month", current: false }));
    expect(range.endDate).toEqual(expect.objectContaining({ current: true }));
    expect(range.endDate).not.toHaveProperty("value");
    expect(range.endDate).not.toHaveProperty("precision");
  });

  it("rejects impossible dates rather than repairing them", () => {
    expect(parseResumeDateToken({ rawText: "2024年13月", sourceBlockId: "b3" })).toBeUndefined();
    expect(parseResumeDateToken({ rawText: "2024-02-30", sourceBlockId: "b3" })).toBeUndefined();
  });
});
