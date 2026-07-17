import { describe, expect, it } from "vitest";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import { buildResumeImportConfirmation } from "@/domain/resumeImport/confirm";
import { defaultResumeRenderSectionOrder, resumeContentCategoryOrder, resumeFieldCategories } from "@/domain/resumeFields/catalog";

describe("canonical resume section order", () => {
  it("keeps navigation order and places skills after awards", () => {
    expect(resumeFieldCategories.map((category) => category.id)).toEqual([
      "basic", "summary", "education", "work", "project", "campus", "award", "skill", "certificate", "language", "custom"
    ]);
    expect(resumeContentCategoryOrder.indexOf("skill")).toBeGreaterThan(resumeContentCategoryOrder.indexOf("award"));
    expect(defaultResumeRenderSectionOrder).toEqual(["summary", "experience", "skills", "certificates"]);
  });

  it("sorts imported branch items by the same canonical category catalog", () => {
    const now = "2026-07-14T00:00:00.000Z";
    const draft = createImportedResumeDraftFromStructuredJson({
      importId: "section-order",
      source: { fileName: "order.json", mimeType: "application/json", fileHash: "section-order-hash-123456", pageCount: 1, extractedAt: now },
      structuredDraft: {
        basics: { name: "顺序测试" },
        sections: [
          { title: "技能", category: "skill", sectionType: "skills", items: ["TypeScript"] },
          { title: "奖项", category: "award", sectionType: "awards", items: ["一等奖"] },
          { title: "项目", category: "project", sectionType: "project", items: ["项目成果"] },
          { title: "工作", category: "work", sectionType: "work", items: ["工作成果"] }
        ]
      },
      now
    });
    const result = buildResumeImportConfirmation({ draft, operationId: "confirm-order", now });

    expect(result.branch.contentItems.map((item) => item.sourceSectionId)).toEqual(["work", "project", "awards", "skills"]);
  });
});
