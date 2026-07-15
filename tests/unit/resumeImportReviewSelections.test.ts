import { describe, expect, it } from "vitest";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import { applyImportBulkSelection } from "@/domain/resumeImport/reviewSelections";
import type { ImportedResumeDraft, ImportedResumeMappingTrace } from "@/domain/schemas";

const NOW = "2026-07-14T00:00:00.000Z";

describe("resume import bulk review selections", () => {
  it("selects safe imported items without committing formal data", () => {
    const draft = reviewDraft();
    const selected = applyImportBulkSelection({ draft, mode: "use_imported" });

    expect(selected.sections[0].items[0].included).toBe(true);
    expect(draft.sections[0].items[0].included).toBe(false);
  });

  it("keeps existing data by excluding every item in the selected section", () => {
    const draft = reviewDraft();
    draft.sections[0].items.forEach((item) => { item.included = true; });
    const selected = applyImportBulkSelection({ draft, mode: "keep_existing", sectionId: draft.sections[0].id });

    expect(selected.sections[0].items.every((item) => !item.included)).toBe(true);
  });

  it("does not silently select low-confidence, unconfirmed, or split-source mappings", () => {
    const draft = reviewDraft();
    const [safe, risky] = draft.sections[0].items;
    safe.mapping = mapping("external.shared", "安全内容", "high", false);
    risky.mapping = mapping("external.shared", "待确认内容", "low", true);
    const selected = applyImportBulkSelection({ draft, mode: "use_imported" });

    expect(selected.sections[0].items.map((item) => item.included)).toEqual([false, false]);
  });

  it("resets selections to the review baseline", () => {
    const baseline = reviewDraft();
    const changed: ImportedResumeDraft = {
      ...baseline,
      sections: baseline.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, included: true })) }))
    };
    const reset = applyImportBulkSelection({ draft: changed, baseline, mode: "reset" });

    expect(reset.sections[0].items.map((item) => item.included)).toEqual([false, false]);
  });
});

function reviewDraft() {
  const draft = createImportedResumeDraftFromStructuredJson({
    importId: "bulk-review",
    source: { fileName: "bulk.json", mimeType: "application/json", fileHash: "bulk-review-hash-123456", pageCount: 1, extractedAt: NOW },
    structuredDraft: {
      basics: {},
      sections: [{ title: "项目经历", category: "project", sectionType: "experience", items: ["安全内容", "待确认内容"] }]
    },
    now: NOW
  });
  draft.sections[0].items.forEach((item) => { item.included = false; });
  return draft;
}

function mapping(path: string, sourceValue: string, confidenceLevel: "high" | "medium" | "low", needsConfirmation: boolean): ImportedResumeMappingTrace {
  return { sourcePaths: [path], sourceValues: [sourceValue], confidenceLevel, confidenceReason: "test mapping", needsConfirmation };
}
