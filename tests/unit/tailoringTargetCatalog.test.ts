import { describe, expect, it } from "vitest";
import { RESUME_SECTION_TYPES_V2 } from "@/domain/resumeFields/types";
import {
  isCreatableResumeField,
  isRewritableResumeField,
  resumeRewritableFieldCatalog,
  resumeRewritableFields,
  resumeRewritableSectionTypes
} from "@/domain/resumeFields/fieldCatalog";
import { isSubmissionSafeTailoringPath } from "@/domain/jobOptimization/tailoringDiff";
import { ResumeFieldPathSchema } from "@/domain/schemas";

const ITEM_SECTION_TYPES = RESUME_SECTION_TYPES_V2.filter((sectionType) => sectionType !== "basics");

describe("tailoring rewrite target catalog", () => {
  it("covers every addressable resume section with at least one rewrite field", () => {
    expect([...resumeRewritableSectionTypes].sort()).toEqual([...ITEM_SECTION_TYPES].sort());
  });

  it.each(ITEM_SECTION_TYPES)("section %s resolves at least one rewrite target", (sectionType) => {
    expect(resumeRewritableFields(sectionType).length).toBeGreaterThan(0);
  });

  it("never exposes identity or fact fields to rewriting", () => {
    const forbidden = ["school", "major", "degree", "organization", "role", "startDate", "endDate", "gpa", "credentialId", "issuer", "phone", "email"];
    for (const definition of resumeRewritableFieldCatalog) {
      expect(forbidden).not.toContain(definition.field);
    }
  });

  it("keeps summary on text and exposes description/highlights elsewhere", () => {
    expect(resumeRewritableFields("summary").map((field) => field.field)).toEqual(["text"]);
    expect(resumeRewritableFields("work").map((field) => field.field)).toEqual(["description", "highlights"]);
    expect(resumeRewritableFields("project").map((field) => field.field)).toEqual(["description", "highlights"]);
    expect(resumeRewritableFields("skills").map((field) => field.field)).toEqual(["description"]);
  });

  it("treats skill identity as creatable-only, never rewritable", () => {
    expect(isRewritableResumeField("skills", "name")).toBe(false);
    expect(isCreatableResumeField("skills", "name")).toBe(true);
  });
});

describe("target path safety by section and operation", () => {
  it.each(ITEM_SECTION_TYPES)("rejects identity rewrites in section %s", (sectionType) => {
    for (const identityField of ["school", "organization", "startDate", "credentialId", "major"]) {
      expect(ResumeFieldPathSchema.safeParse(identityField).success).toBe(false);
    }
    for (const allowedField of resumeRewritableFields(sectionType).map((field) => field.field)) {
      if (allowedField === "name") continue;
      expect(ResumeFieldPathSchema.safeParse(allowedField).success).toBe(true);
    }
  });

  it("allows expression rewrites but not presentation changes in submission-safe mode", () => {
    expect(isSubmissionSafeTailoringPath("work", "description", "replace")).toBe(true);
    expect(isSubmissionSafeTailoringPath("work", "highlights", "append")).toBe(true);
    expect(isSubmissionSafeTailoringPath("work", "visible", "replace")).toBe(false);
    expect(isSubmissionSafeTailoringPath("work", "order", "reorder")).toBe(false);
  });

  it("keeps previously supported sections working", () => {
    for (const sectionType of ["summary", "skills", "project", "work", "internship"] as const) {
      expect(resumeRewritableFields(sectionType).length).toBeGreaterThan(0);
    }
  });
});
