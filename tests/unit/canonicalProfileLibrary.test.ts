import { describe, expect, it } from "vitest";
import { canonicalProfileLibraryItems, canonicalProfileSectionCounts, profileSectionCatalog } from "@/domain/profile/canonicalLibrary";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { demoCareerProfile } from "@/data/demoProfile";

describe("canonical Profile library adapter", () => {
  it("uses the Resume Studio catalog without a second label or order source", () => {
    expect(profileSectionCatalog.map(({ id, label }) => ({ id, label }))).toEqual([
      ["basics", "基本信息"], ["summary", "自我评价"], ["education", "教育经历"],
      ["work", "工作经历"], ["internship", "实习经历"], ["project", "项目经历"],
      ["research", "科研经历"], ["campus", "校园经历"], ["volunteer", "志愿经历"],
      ["awards", "奖项荣誉"], ["skills", "专业技能"], ["certificates", "证书"],
      ["languages", "语言能力"], ["publications", "论文与出版物"], ["patents", "专利"],
      ["portfolio", "作品集"], ["other", "其他内容"], ["custom", "自定义栏目"]
    ].map(([id, label]) => ({ id, label })));
  });

  it("adapts a legacy Profile losslessly by sectionType", () => {
    const migrated = migrateCareerProfileToV2(demoCareerProfile);
    const items = canonicalProfileLibraryItems(demoCareerProfile);
    expect(items.map((item) => item.id)).toEqual(migrated.structuredFacts.map((entry) => entry.data.id));
    expect(items.every((item) => item.sectionType !== undefined)).toBe(true);
  });

  it("counts canonical items independently of display labels", () => {
    const profile = migrateCareerProfileToV2(demoCareerProfile);
    const counts = canonicalProfileSectionCounts(profile);
    for (const section of profileSectionCatalog) {
      expect(counts.get(section.id)).toBe(profile.structuredFacts.filter((entry) => entry.data.sectionType === section.id).length + (section.id === "basics" ? 1 : 0));
    }
  });
});
