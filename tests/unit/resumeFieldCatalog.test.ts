import { describe, expect, it } from "vitest";
import { RESUME_SECTION_TYPES_V2, findResumeFieldsByAlias, resumeFieldCatalog, resumeSectionCatalog } from "@/domain/resumeFields";

describe("resume field catalog v2", () => {
  it("defines every canonical section exactly once with stable ordering", () => {
    expect(resumeSectionCatalog.map((section) => section.id)).toEqual(RESUME_SECTION_TYPES_V2);
    expect(new Set(resumeSectionCatalog.map((section) => section.id)).size).toBe(resumeSectionCatalog.length);
    expect(new Set(resumeSectionCatalog.map((section) => section.displayOrder)).size).toBe(resumeSectionCatalog.length);
  });

  it("gives every canonical field one id and one section-local order", () => {
    expect(new Set(resumeFieldCatalog.map((field) => field.id)).size).toBe(resumeFieldCatalog.length);
    for (const section of resumeSectionCatalog.filter((entry) => entry.id !== "custom")) {
      const fields = resumeFieldCatalog.filter((field) => field.sectionType === section.id);
      expect(fields.length, section.id).toBeGreaterThan(0);
      expect(new Set(fields.map((field) => field.displayOrder)).size, section.id).toBe(fields.length);
      expect(fields.every((field) => field.id.startsWith(`${section.id}.`) && field.importable && field.aiMappable && field.uiControl)).toBe(true);
    }
  });

  it("keeps aliases unambiguous within a section and lookup section-aware", () => {
    for (const section of resumeSectionCatalog) {
      const aliases = new Map<string, string>();
      for (const field of resumeFieldCatalog.filter((entry) => entry.sectionType === section.id)) {
        for (const alias of [field.id.split(".").at(-1) ?? "", ...field.aliases]) {
          const normalized = alias.toLocaleLowerCase();
          expect(aliases.get(normalized), `${section.id}.${alias}`).toBeUndefined();
          aliases.set(normalized, field.id);
        }
      }
    }
    expect(findResumeFieldsByAlias("role", "research").map((field) => field.id)).toEqual(["research.authorRole"]);
    expect(findResumeFieldsByAlias("role", "work").map((field) => field.id)).toEqual(["work.role"]);
  });
});
