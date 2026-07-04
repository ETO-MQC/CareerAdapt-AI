import { describe, expect, it } from "vitest";
import {
  filterResumeTemplates,
  getResumeTemplate,
  resumeTemplates,
  templateFilterOptions,
  type TemplateCapabilities
} from "@/components/resume/templates/templateRegistry";
import { ResumePresentationConfigSchema, TemplateIdSchema, type TemplateId } from "@/domain/schemas";

const CAPABILITY_KEYS: Array<keyof TemplateCapabilities> = [
  "supportsAccentColor",
  "supportsDensity",
  "supportsBodyScale",
  "supportsHeadingScale",
  "supportsLineHeight",
  "supportsSectionGap",
  "supportsItemGap",
  "supportsSectionTitleVisibility",
  "supportsTwoPages"
];

describe("V2 G2 template registry", () => {
  it("registers exactly four unique templates in one registry", () => {
    expect(resumeTemplates).toHaveLength(4);
    expect(new Set(resumeTemplates.map((template) => template.id)).size).toBe(4);
    expect(resumeTemplates.map((template) => template.id)).toEqual([
      "classic-technical",
      "modern-operations",
      "ats-minimal",
      "business-consulting"
    ]);
  });

  it("keeps old template ids compatible and validates new template ids", () => {
    expect(TemplateIdSchema.safeParse("classic-technical").success).toBe(true);
    expect(TemplateIdSchema.safeParse("modern-operations").success).toBe(true);
    expect(TemplateIdSchema.safeParse("ats-minimal").success).toBe(true);
    expect(TemplateIdSchema.safeParse("business-consulting").success).toBe(true);
    expect(TemplateIdSchema.safeParse("unknown-template").success).toBe(false);
  });

  it("requires renderer, thumbnail renderer, metadata, capabilities and default styles", () => {
    for (const template of resumeTemplates) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.shortName).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(["ats", "technical", "business", "modern"]).toContain(template.category);
      expect(["single-column", "two-column"]).toContain(template.layout);
      expect(["high", "medium", "visual"]).toContain(template.atsLevel);
      expect(template.suitableRoles.length).toBeGreaterThan(0);
      expect(template.tags.length).toBeGreaterThan(0);
      expect(typeof template.render).toBe("function");
      expect(typeof template.renderThumbnail).toBe("function");
      expect(template.version).toBeGreaterThan(0);
      expect(["active", "experimental"]).toContain(template.status);

      for (const key of CAPABILITY_KEYS) {
        expect(typeof template.capabilities[key]).toBe("boolean");
      }

      expect(() => ResumePresentationConfigSchema.parse({
        schemaVersion: "resume-presentation-v1",
        branchId: "branch",
        templateId: template.id,
        contentRevision: {
          branchRevision: 0,
          currentRevisionId: "revision"
        },
        sectionOrder: ["summary", "skills", "experience", "certificates"],
        itemOrderBySection: {},
        hiddenItemIds: [],
        ...template.defaultPresentationStyle,
        presentationRevision: 0,
        updatedAt: "2026-07-04T00:00:00.000Z"
      })).not.toThrow();
    }
  });

  it("does not describe ATS labels as external certification or guaranteed pass", () => {
    for (const template of resumeTemplates) {
      const text = `${template.name} ${template.description} ${template.tags.join(" ")}`;
      expect(text).not.toMatch(/认证|保证通过|保过|外部认证/);
    }
  });

  it("safely falls back for unknown runtime template ids", () => {
    expect(getResumeTemplate("unknown-template" as TemplateId).id).toBe("classic-technical");
  });

  it("filters templates by the first-stage filter set", () => {
    expect(templateFilterOptions.map((option) => option.key)).toEqual([
      "all",
      "ats",
      "single-column",
      "two-column",
      "technical",
      "business"
    ]);
    expect(filterResumeTemplates("all")).toHaveLength(4);
    expect(filterResumeTemplates("ats").map((template) => template.id)).toEqual(["classic-technical", "ats-minimal"]);
    expect(filterResumeTemplates("single-column").map((template) => template.id)).toEqual(["classic-technical", "ats-minimal"]);
    expect(filterResumeTemplates("two-column").map((template) => template.id)).toEqual(["modern-operations", "business-consulting"]);
    expect(filterResumeTemplates("technical").map((template) => template.id)).toEqual(["classic-technical", "ats-minimal"]);
    expect(filterResumeTemplates("business").map((template) => template.id)).toEqual(["business-consulting"]);
  });
});
