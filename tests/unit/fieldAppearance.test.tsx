import { toggleFieldMark, isFieldMarkActive } from "@/domain/resumePresentation/fieldFormatting";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FieldAppearanceSchema } from "@/domain/schemas/fieldAppearance";
import { ResumePresentationConfigSchema } from "@/domain/schemas";
import { FormattedText } from "@/components/resume/templates/shared/FormattedText";
import { presentationConfigFromExportSnapshot, presentationSnapshotFromConfig } from "@/services/export/snapshot";

const appearance = { itemId: "item-1", field: "highlights", text: "原文内容", occurrence: 0, ranges: [{ from: 0, to: 2, bold: true, italic: true, underline: true }] };
function config(fieldAppearances?: unknown[]) {
  return ResumePresentationConfigSchema.parse({ schemaVersion: "resume-presentation-v1", branchId: "branch-1", templateId: "classic-technical", contentRevision: { branchRevision: 1, currentRevisionId: "rev-1" }, presentationRevision: 1, updatedAt: "2026-10-25T00:00:00.000Z", ...(fieldAppearances ? { fieldAppearances } : {}) });
}

describe("anchored field appearance", () => {
  it("toggles selected ranges without losing other marks or source offsets", () => {
    const all = toggleFieldMark([], 6, 0, 6, "bold");
    const split = toggleFieldMark(all, 6, 2, 4, "bold");
    expect(split).toEqual([{ from: 0, to: 2, bold: true }, { from: 4, to: 6, bold: true }]);
    expect(isFieldMarkActive(split, 0, 6, "bold")).toBe(false);
    const italic = toggleFieldMark(split, 6, 1, 5, "italic");
    expect(isFieldMarkActive(italic, 1, 5, "italic")).toBe(true);
    expect(isFieldMarkActive(italic, 0, 2, "bold")).toBe(true);
    expect(toggleFieldMark(toggleFieldMark([], 4, 0, 4, "underline"), 4, 0, 4, "underline")).toEqual([]);
  });
  it("validates format ranges and rejects HTML-like extra properties", () => {
    expect(FieldAppearanceSchema.parse(appearance)).toEqual(appearance);
    for (const ranges of [[{ from: -1, to: 2 }], [{ from: 2, to: 2 }], [{ from: 0, to: 10 }]]) expect(FieldAppearanceSchema.safeParse({ ...appearance, ranges }).success).toBe(false);
    expect(FieldAppearanceSchema.safeParse({ ...appearance, html: "<b>new fact</b>" }).success).toBe(false);
  });
  it("formats only the anchored item, field and original text", () => {
    const context = { presentationConfig: config([appearance]) };
    const rendered = renderToStaticMarkup(<FormattedText text="原文内容" itemId="item-1" fields={["highlights"]} context={context}/>);
    expect(rendered).toContain("font-weight:700"); expect(rendered).toContain("font-style:italic"); expect(rendered).toContain("text-decoration:underline");
    expect(rendered.replace(/<[^>]+>/g, "")).toBe("原文内容");
    for (const props of [{ text: "新的原文", itemId: "item-1", fields: ["highlights"] }, { text: "原文内容", itemId: "another-item", fields: ["highlights"] }, { text: "原文内容", itemId: "item-1", fields: ["description"] }]) {
      expect(renderToStaticMarkup(<FormattedText {...props} context={context}/>)).not.toContain("data-field-format");
    }
  });
  it("supports presentation hiding and React text escaping without changing source", () => {
    expect(renderToStaticMarkup(<FormattedText text="原文内容" itemId="item-1" fields={["highlights"]} context={{ presentationConfig: config([{ ...appearance, hidden: true }]) }}/>)).toBe("");
    const text = "<img src=x onerror=alert(1)>";
    const rendered = renderToStaticMarkup(<FormattedText text={text} itemId="item-1" fields={["highlights"]} context={{ presentationConfig: config([{ ...appearance, text, ranges: [{ from: 0, to: text.length, bold: true }] }]) }}/>);
    expect(rendered).toContain("&lt;img"); expect(rendered).not.toContain("<img");
    expect(appearance.text).toBe("原文内容");
  });
  it("round-trips appearances in the formal export snapshot and keeps old snapshots unchanged", () => {
    const current = config([appearance]);
    const presentation = presentationSnapshotFromConfig(current);
    const restored = presentationConfigFromExportSnapshot({ presentation, templateId: current.templateId, branchId: "branch-1", branchRevision: 1, currentRevisionId: "rev-1" } as never);
    expect(restored.fieldAppearances).toEqual([appearance]);
    expect(presentationSnapshotFromConfig(config())).not.toHaveProperty("fieldAppearances");
  });
});
