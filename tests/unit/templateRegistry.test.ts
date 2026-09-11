import { describe, expect, it } from "vitest";
import {
  filterResumeTemplates,
  getResumeTemplate,
  resumeTemplates,
  resolveTemplateSwitchStyle,
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
  "supportsTwoPages",
  "supportsSectionPageBreaks",
  "supportsContinuationHeader"
];

describe("P4.8b template registry", () => {
  it("registers the preserved four templates plus exactly two new templates", () => {
    expect(resumeTemplates).toHaveLength(6);
    expect(new Set(resumeTemplates.map((template) => template.id)).size).toBe(6);
    expect(resumeTemplates.map((template) => template.id)).toEqual([
      "classic-technical",
      "modern-operations",
      "ats-minimal",
      "business-consulting",
      "campus-clean",
      "professional-classic"
    ]);
    expect(new Set(resumeTemplates.map((template) => template.id)).size).toBe(resumeTemplates.length);
  });

  it("keeps old template ids compatible and validates the two new template ids", () => {
    expect(TemplateIdSchema.safeParse("classic-technical").success).toBe(true);
    expect(TemplateIdSchema.safeParse("modern-operations").success).toBe(true);
    expect(TemplateIdSchema.safeParse("ats-minimal").success).toBe(true);
    expect(TemplateIdSchema.safeParse("business-consulting").success).toBe(true);
    expect(TemplateIdSchema.safeParse("campus-clean").success).toBe(true);
    expect(TemplateIdSchema.safeParse("professional-classic").success).toBe(true);
    expect(TemplateIdSchema.safeParse("unknown-template").success).toBe(false);
  });

  it("keeps TemplateIdSchema and the sole registry catalog bidirectionally consistent", () => {
    const registryIds = resumeTemplates.map((template) => template.id);
    const schemaIds = [...TemplateIdSchema.options];
    expect(schemaIds).toEqual(registryIds);
    for (const id of registryIds) {
      expect(TemplateIdSchema.safeParse(id).success).toBe(true);
      expect(getResumeTemplate(id).id).toBe(id);
    }
  });

  it("requires renderer, thumbnail renderer, metadata, capabilities and default styles", () => {
    for (const template of resumeTemplates) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.shortName).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(["ats", "technical", "business", "modern", "campus"]).toContain(template.category);
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
      expect(template.capabilities.supportsTwoPages).toBe(true);
      expect(template.capabilities.supportsSectionPageBreaks).toBe(true);
      expect(template.capabilities.supportsContinuationHeader).toBe(false);

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
      "business",
      "campus"
    ]);
    expect(filterResumeTemplates("all")).toHaveLength(6);
    expect(filterResumeTemplates("ats").map((template) => template.id)).toEqual(["classic-technical", "ats-minimal", "campus-clean", "professional-classic"]);
    expect(filterResumeTemplates("single-column").map((template) => template.id)).toEqual(["classic-technical", "ats-minimal", "campus-clean", "professional-classic"]);
    expect(filterResumeTemplates("two-column").map((template) => template.id)).toEqual(["modern-operations", "business-consulting"]);
    expect(filterResumeTemplates("technical").map((template) => template.id)).toEqual(["classic-technical", "ats-minimal"]);
    expect(filterResumeTemplates("business").map((template) => template.id)).toEqual(["business-consulting", "professional-classic"]);
    expect(filterResumeTemplates("campus").map((template) => template.id)).toEqual(["campus-clean"]);
  });

  it("resolves target defaults while preserving explicit presentation overrides", () => {
    const source = getResumeTemplate("classic-technical");
    const target = getResumeTemplate("campus-clean");
    const next = resolveTemplateSwitchStyle(source, target, {
      ...source.defaultPresentationStyle,
      theme: { ...source.defaultPresentationStyle.theme, accentColor: "rose" },
      sectionStyleOverrides: { summary: { showTitle: false } }
    });

    expect(next.theme.primaryColor).toBe(target.defaultPresentationStyle.theme.primaryColor);
    expect(next.theme.accentColor).toBe("rose");
    expect(next.sectionStyleOverrides).toEqual({ summary: { showTitle: false } });
  });
});
