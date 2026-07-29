import { describe, expect, it } from "vitest";
import {
  canonicalSectionTypeForProfileCategory,
  profileCategoryForCanonicalSection
} from "@/domain/profile/profileCategories";

describe("Profile UI category to canonical section mapping", () => {
  it.each([
    ["award", "awards"],
    ["skill", "skills"],
    ["certificate", "certificates"],
    ["language", "languages"],
    ["project", "project"]
  ] as const)("maps %s without changing canonical storage semantics", (category, sectionType) => {
    expect(canonicalSectionTypeForProfileCategory(category)).toBe(sectionType);
    expect(profileCategoryForCanonicalSection(sectionType)).toBe(category);
  });
});
