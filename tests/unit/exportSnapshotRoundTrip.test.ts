import { describe, expect, it } from "vitest";
import {
  ExportSnapshotPresentationSchema,
  ExportRecordPresentationSnapshotSchema,
  ResumePresentationConfigSchema
} from "@/domain/schemas";
import {
  presentationConfigFromExportSnapshot,
  presentationSnapshotFromConfig
} from "@/services/export/snapshot";

const LAYOUT_VARIANTS = [
  { highlightListStyle: "numbered" as const, itemHeaderMiddleAlignment: "fixed-column" as const },
  { highlightListStyle: "none" as const, itemHeaderMiddleAlignment: "flow" as const },
  { highlightListStyle: "bullet" as const, itemHeaderMiddleAlignment: "balanced" as const }
];

function baseConfig(overrides: Record<string, unknown> = {}) {
  return ResumePresentationConfigSchema.parse({
    schemaVersion: "resume-presentation-v1",
    branchId: "branch-1",
    templateId: "campus-clean",
    contentRevision: { branchRevision: 3, currentRevisionId: "rev-3" },
    presentationRevision: 7,
    updatedAt: "2026-10-04T00:00:00.000Z",
    ...overrides
  });
}

describe("export snapshot layout round-trip", () => {
  it.each(LAYOUT_VARIANTS)("keeps $highlightListStyle / $itemHeaderMiddleAlignment through the round trip", (variant) => {
    const config = baseConfig(variant);
    const snapshotPresentation = presentationSnapshotFromConfig(config);
    const restored = presentationConfigFromExportSnapshot({
      presentation: snapshotPresentation,
      templateId: config.templateId,
      renderModel: { branchId: "branch-1" },
      filename: "resume.pdf"
    } as never);

    expect(restored.highlightListStyle).toBe(variant.highlightListStyle);
    expect(restored.itemHeaderMiddleAlignment).toBe(variant.itemHeaderMiddleAlignment);
  });

  it("preserves section order and item order through the round trip", () => {
    const config = baseConfig({
      sectionOrder: ["skills", "summary", "experience", "certificates"],
      itemOrderBySection: { experience: ["w-2", "w-1"], certificates: ["c-1"] }
    });
    const snapshotPresentation = presentationSnapshotFromConfig(config);
    const restored = presentationConfigFromExportSnapshot({
      presentation: snapshotPresentation,
      templateId: config.templateId,
      renderModel: { branchId: "branch-1" },
      filename: "resume.pdf"
    } as never);

    expect(restored.sectionOrder).toEqual(["skills", "summary", "experience", "certificates"]);
    expect(restored.itemOrderBySection).toEqual({ experience: ["w-2", "w-1"], certificates: ["c-1"] });
  });
});

describe("legacy export snapshots stay readable", () => {
  const config = ResumePresentationConfigSchema.parse({
    schemaVersion: "resume-presentation-v1",
    branchId: "branch-1",
    templateId: "campus-clean",
    contentRevision: { branchRevision: 3, currentRevisionId: "rev-3" },
    presentationRevision: 7,
    updatedAt: "2026-10-04T00:00:00.000Z",
    sectionOrder: ["summary", "experience", "skills", "certificates"],
    itemOrderBySection: { experience: ["w-1"] }
  });
  // A stored snapshot written before the layout fields existed.
  const legacyWithoutLayout = (() => {
    const full = presentationSnapshotFromConfig(config);
    return {
      templateId: full.templateId,
      sectionOrder: full.sectionOrder,
      itemOrderBySection: full.itemOrderBySection,
      hiddenItemIds: full.hiddenItemIds,
      typography: full.typography,
      spacing: full.spacing,
      theme: full.theme,
      pagination: full.pagination,
      sectionStyleOverrides: full.sectionStyleOverrides
    };
  })();

  it("reads a stored export snapshot that predates the layout fields", () => {
    const parsed = ExportSnapshotPresentationSchema.parse(legacyWithoutLayout);
    expect(parsed.highlightListStyle).toBe("bullet");
    expect(parsed.itemHeaderMiddleAlignment).toBe("balanced");
  });

  it("reads a persisted ExportRecord snapshot that predates the layout fields", () => {
    const parsed = ExportRecordPresentationSnapshotSchema.parse(legacyWithoutLayout);
    expect(parsed.highlightListStyle).toBeUndefined();
    expect(parsed.itemHeaderMiddleAlignment).toBeUndefined();
    expect(parsed.sectionOrder).toEqual(["summary", "experience", "skills", "certificates"]);
  });

  it("falls back to defaults when restoring a legacy snapshot into a config", () => {
    const restored = presentationConfigFromExportSnapshot({
      presentation: ExportSnapshotPresentationSchema.parse(legacyWithoutLayout),
      templateId: config.templateId,
      renderModel: { branchId: "branch-1" },
      filename: "resume.pdf"
    } as never);

    expect(restored.highlightListStyle).toBe("bullet");
    expect(restored.itemHeaderMiddleAlignment).toBe("balanced");
    expect(restored.sectionOrder).toEqual(["summary", "experience", "skills", "certificates"]);
  });

  it("keeps the layout fields once they are present in an ExportRecord snapshot", () => {
    const parsed = ExportRecordPresentationSnapshotSchema.parse({
      ...legacyWithoutLayout,
      highlightListStyle: "numbered",
      itemHeaderMiddleAlignment: "fixed-column"
    });
    expect(parsed.highlightListStyle).toBe("numbered");
    expect(parsed.itemHeaderMiddleAlignment).toBe("fixed-column");
  });
});
