import { describe, expect, it } from "vitest";
import { createDeterministicFieldCandidates } from "@/domain/resumeImport/fieldCandidates";
import { createImportedResumeDraftFromPdf } from "@/domain/resumeImport/parser";
import { alignResumeDateRange, parseResumeDateToken } from "@/domain/resumeImport/dates";
import type { NormalizedSourceBlock, PdfPageText } from "@/domain/schemas";

const TEST_TIME = "2026-07-16T00:00:00.000Z";

function block(id: string, text: string, order: number, blockType: NormalizedSourceBlock["blockType"] = "paragraph"): NormalizedSourceBlock {
  return {
    id,
    text,
    rawText: text,
    normalizedText: text,
    normalizationActions: [],
    blockType,
    order,
    extractionConfidence: 0.98
  };
}

describe("P3.6 golden sample - phone detection", () => {
  it("detects correct mobile number 13800138000", () => {
    const blocks = [block("b1", "13800138000", 0)];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phones).toHaveLength(1);
    expect(phones[0].value).toBe("13800138000");
  });

  it("does not detect email local part 1281594372 as phone", () => {
    const blocks = [block("b1", "demo.user@example.com", 0)];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phones).toHaveLength(0);
    const emails = candidates.filter((c) => c.targetFieldId === "basics.email");
    expect(emails).toHaveLength(1);
    expect(emails[0].value).toBe("demo.user@example.com");
  });

  it("does not detect date range 2024-09 - 2028-06 as phone", () => {
    const blocks = [block("b1", "2024-09 - 2028-06", 0)];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phones).toHaveLength(0);
  });

  it("does not detect standalone QQ number 1281594372 as phone", () => {
    const blocks = [block("b1", "QQ: 1281594372", 0)];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phones).toHaveLength(0);
  });

  it("does not detect GPA as phone", () => {
    const blocks = [
      block("b0", "教育经历", 0, "heading"),
      block("b1", "GPA：4.95/5.0", 1)
    ];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phones).toHaveLength(0);
  });

  it("email, URL, and phone character spans do not overlap", () => {
    const blocks = [block("b1", "13800138000 demo.user@example.com https://github.com/example-user", 0)];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    const emails = candidates.filter((c) => c.targetFieldId === "basics.email");
    const urls = candidates.filter((c) => c.targetFieldId === "basics.otherLinks");
    expect(phones).toHaveLength(1);
    expect(phones[0].value).toBe("13800138000");
    expect(emails).toHaveLength(1);
    expect(emails[0].value).toBe("demo.user@example.com");
    expect(urls).toHaveLength(1);
  });

  it("does not detect percentage as phone", () => {
    const blocks = [block("b1", "Top 5% of class", 0)];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phones).toHaveLength(0);
  });
});

describe("P3.6 golden sample - name detection", () => {
  it("accepts a top-positioned single Latin letter M as a name candidate", () => {
    const pageTexts = createGoldenPageTexts();
    const draft = createImportedResumeDraftFromPdf({
      importId: "golden-name-test",
      source: {
        fileName: "golden-resume.pdf",
        fileHash: "hash-golden-12345678901234",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: pageTexts,
      now: TEST_TIME
    });
    expect(draft.basics.name?.value).toBe("M");
  });

  it("Chinese name is detected correctly", () => {
    const pageText = [
      "张三丰",
      "13800138000",
      "zhangsan@example.com"
    ].join("\n");
    const draft = createImportedResumeDraftFromPdf({
      importId: "chinese-name-test",
      source: {
        fileName: "chinese-name.pdf",
        fileHash: "hash-chinese-name-1234567890",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: [createPage(1, pageText)],
      now: TEST_TIME
    });
    expect(draft.basics.name?.value).toBe("张三丰");
  });

  it("English full name is detected correctly", () => {
    const pageText = [
      "Alex Chen",
      "13800138000",
      "alex@example.com"
    ].join("\n");
    const draft = createImportedResumeDraftFromPdf({
      importId: "english-name-test",
      source: {
        fileName: "english-name.pdf",
        fileHash: "hash-english-name-12345678901",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: [createPage(1, pageText)],
      now: TEST_TIME
    });
    expect(draft.basics.name?.value).toBe("Alex Chen");
  });

  it("section heading is not detected as name", () => {
    const pageText = [
      "教育经历",
      "示例大学",
      "13800138000"
    ].join("\n");
    const draft = createImportedResumeDraftFromPdf({
      importId: "heading-name-test",
      source: {
        fileName: "heading-name.pdf",
        fileHash: "hash-heading-name-12345678901",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: [createPage(1, pageText)],
      now: TEST_TIME
    });
    expect(draft.basics.name?.value).not.toBe("教育经历");
  });
});

describe("P3.6 golden sample - section segmentation", () => {
  it("splits education, work, project, awards, skills, languages into independent sections", () => {
    const pageText = [
      "M",
      "未指定岗位 / 通用简历",
      "某地（远程）",
      "13800138000",
      "demo.user@example.com",
      "https://github.com/example-user",
      "",
      "教育经历",
      "示例大学 计算机相关专业 2024-09 - 2028-06",
      "",
      "工作与实习经历",
      "AI辅助文档与指令评估实践 2024-09 - 至今",
      "",
      "项目成果",
      "示例任务系统智能专注助手 2026-02 - 至今",
      "",
      "奖项",
      "示例编程竞赛一等奖 2025-03",
      "",
      "技能",
      "Python, JavaScript, TypeScript",
      "",
      "语言",
      "英语 CET-6"
    ].join("\n");

    const draft = createImportedResumeDraftFromPdf({
      importId: "golden-sections-test",
      source: {
        fileName: "golden-resume.pdf",
        fileHash: "hash-golden-sections-1234567890",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: [createPage(1, pageText)],
      now: TEST_TIME
    });

    const sectionTitles = draft.sections.map((s) => s.detectedTitle);

    expect(sectionTitles).toContain("教育经历");
    expect(sectionTitles).toContain("工作与实习经历");
    expect(sectionTitles).toContain("项目成果");
    expect(sectionTitles).toContain("奖项");
    expect(sectionTitles).toContain("技能");
    expect(sectionTitles).toContain("语言");

    const eduSection = draft.sections.find((s) => s.category === "education");
    const workSection = draft.sections.find((s) => s.category === "work");
    const projectSection = draft.sections.find((s) => s.category === "project");
    const awardSection = draft.sections.find((s) => s.category === "award");
    const skillSection = draft.sections.find((s) => s.category === "skill");
    const langSection = draft.sections.find((s) => s.category === "language");

    expect(eduSection).toBeDefined();
    expect(workSection).toBeDefined();
    expect(projectSection).toBeDefined();
    expect(awardSection).toBeDefined();
    expect(skillSection).toBeDefined();
    expect(langSection).toBeDefined();

    expect(eduSection!.items.length).toBeGreaterThanOrEqual(1);
    expect(workSection!.items.length).toBeGreaterThanOrEqual(1);
    expect(projectSection!.items.length).toBeGreaterThanOrEqual(1);
  });

  it("education does not swallow work and project sections", () => {
    const pageText = [
      "教育经历",
      "示例大学 2024-09 - 2028-06",
      "工作与实习经历",
      "某公司 实习生 2024-09 - 至今",
      "项目成果",
      "示例任务系统 2026-02 - 至今"
    ].join("\n");

    const draft = createImportedResumeDraftFromPdf({
      importId: "edu-no-swallow-test",
      source: {
        fileName: "edu-no-swallow.pdf",
        fileHash: "hash-edu-no-swallow-12345678901",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: [createPage(1, pageText)],
      now: TEST_TIME
    });

    const eduSection = draft.sections.find((s) => s.category === "education");
    const workSection = draft.sections.find((s) => s.category === "work");
    const projectSection = draft.sections.find((s) => s.category === "project");

    expect(eduSection).toBeDefined();
    expect(workSection).toBeDefined();
    expect(projectSection).toBeDefined();

    expect(eduSection!.items).toHaveLength(1);
    expect(workSection!.items).toHaveLength(1);
    expect(projectSection!.items).toHaveLength(1);
  });
});

describe("P3.6 golden sample - date binding", () => {
  it("date range 2024-09 - 2028-06 binds correctly with start and end", () => {
    const blocks = [
      block("b0", "教育经历", 0, "heading"),
      block("b1", "示例大学 计算机相关专业 2024-09 - 2028-06", 1)
    ];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const start = candidates.find((c) => c.targetFieldId === "education.startDate");
    const end = candidates.find((c) => c.targetFieldId === "education.endDate");
    const current = candidates.find((c) => c.targetFieldId === "education.current");

    expect(start).toBeDefined();
    expect(start!.dateValue?.rawText).toMatch(/2024/);

    expect(end).toBeDefined();
    expect(end!.dateValue?.rawText).toMatch(/2028/);

    expect(current).toBeUndefined();
  });

  it("至今 produces current=true only with explicit marker", () => {
    const blocks = [
      block("b0", "工作与实习经历", 0, "heading"),
      block("b1", "AI辅助文档与指令评估实践 2024-09 - 至今", 1)
    ];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const start = candidates.find((c) => c.targetFieldId === "work.startDate");
    const current = candidates.find((c) => c.targetFieldId === "work.current");
    const end = candidates.find((c) => c.targetFieldId === "work.endDate");

    expect(start).toBeDefined();
    expect(start!.dateValue?.rawText).toMatch(/2024/);

    expect(current).toBeDefined();
    expect(current!.value).toBe(true);

    expect(end).toBeUndefined();
  });

  it("single date without 至今 does not produce current=true", () => {
    const blocks = [
      block("b0", "教育经历", 0, "heading"),
      block("b1", "示例大学 2025-04", 1)
    ];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const current = candidates.find((c) => c.targetFieldId === "education.current");
    expect(current).toBeUndefined();
  });

  it("date does not become a phone candidate", () => {
    const blocks = [
      block("b0", "教育经历", 0, "heading"),
      block("b1", "示例大学 2024-09 - 2028-06", 1)
    ];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phones).toHaveLength(0);
  });

  it("parseResumeDateToken handles YYYY-MM format", () => {
    const result = parseResumeDateToken({ rawText: "2024-09", sourceBlockId: "b1" });
    expect(result).toBeDefined();
    expect(result!.value).toBe("2024-09");
    expect(result!.precision).toBe("month");
    expect(result!.current).toBe(false);
  });

  it("alignResumeDateRange produces correct start and end for range", () => {
    const range = alignResumeDateRange({
      id: "b1",
      normalizedText: "2024-09 - 2028-06",
      extractionConfidence: 0.98
    });
    expect(range.startDate).toBeDefined();
    expect(range.startDate!.rawText).toMatch(/2024/);
    expect(range.endDate).toBeDefined();
    expect(range.endDate!.rawText).toMatch(/2028/);
    expect(range.endDate!.current).toBe(false);
  });
});

describe("P3.6 golden sample - integration", () => {
  it("golden sample produces correct basics", () => {
    const pageTexts = createGoldenPageTexts();
    const draft = createImportedResumeDraftFromPdf({
      importId: "golden-integration",
      source: {
        fileName: "golden-resume.pdf",
        fileHash: "hash-golden-integration-1234567890",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: pageTexts,
      now: TEST_TIME
    });

    expect(draft.basics.name?.value).toBe("M");
    expect(draft.basics.email?.value).toBe("demo.user@example.com");
    expect(draft.basics.phone?.value).toBe("13800138000");
    expect(draft.basics.location?.value).toContain("某地");
    expect(draft.basics.links.some((l) => l.value.includes("github.com/example-user"))).toBe(true);
  });

  it("golden sample field candidates have no false phone matches", () => {
    const pageTexts = createGoldenPageTexts();
    const draft = createImportedResumeDraftFromPdf({
      importId: "golden-no-false-phone",
      source: {
        fileName: "golden-resume.pdf",
        fileHash: "hash-golden-no-false-phone-1234567",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: pageTexts,
      now: TEST_TIME
    });

    if (draft.schemaVersion !== "resume-import-v2") throw new Error("expected v2");
    const phoneCandidates = draft.fieldCandidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phoneCandidates).toHaveLength(1);
    expect(phoneCandidates[0].value).toBe("13800138000");

    const falsePhones = phoneCandidates.filter((c) =>
      c.value === "1281594372" ||
      (typeof c.value === "string" && c.value.includes("2024"))
    );
    expect(falsePhones).toHaveLength(0);
  });

  it("golden sample has independent sections for education, work, project, awards, skills, languages", () => {
    const pageTexts = createGoldenPageTexts();
    const draft = createImportedResumeDraftFromPdf({
      importId: "golden-sections",
      source: {
        fileName: "golden-resume.pdf",
        fileHash: "hash-golden-sections-12345678901",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: pageTexts,
      now: TEST_TIME
    });

    const categories = draft.sections.map((s) => s.category).filter(Boolean);
    expect(categories).toContain("education");
    expect(categories).toContain("work");
    expect(categories).toContain("project");
    expect(categories).toContain("award");
    expect(categories).toContain("skill");
    expect(categories).toContain("language");
  });

  it("golden sample dates bind to correct sections", () => {
    const pageTexts = createGoldenPageTexts();
    const draft = createImportedResumeDraftFromPdf({
      importId: "golden-dates",
      source: {
        fileName: "golden-resume.pdf",
        fileHash: "hash-golden-dates-123456789012",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: pageTexts,
      now: TEST_TIME
    });

    if (draft.schemaVersion !== "resume-import-v2") throw new Error("expected v2");
    const eduStart = draft.fieldCandidates.find((c) => c.targetFieldId === "education.startDate");
    const eduEnd = draft.fieldCandidates.find((c) => c.targetFieldId === "education.endDate");
    const workCurrent = draft.fieldCandidates.find((c) => c.targetFieldId === "work.current");
    const projectCurrent = draft.fieldCandidates.find((c) => c.targetFieldId === "project.current");

    if (eduStart) expect(eduStart.dateValue?.rawText).toMatch(/2024/);
    if (eduEnd) expect(eduEnd.dateValue?.rawText).toMatch(/2028/);
    if (workCurrent) expect(workCurrent.value).toBe(true);
    if (projectCurrent) expect(projectCurrent.value).toBe(true);
  });
});

function createGoldenPageTexts(): PdfPageText[] {
  const pageText = [
    "M",
    "未指定岗位 / 通用简历",
    "某地（远程）",
    "13800138000",
    "demo.user@example.com",
    "https://github.com/example-user",
    "",
    "教育经历",
    "示例大学 计算机相关专业 2024-09 - 2028-06",
    "",
    "工作与实习经历",
    "AI辅助文档与指令评估实践 2024-09 - 至今",
    "",
    "项目成果",
    "示例任务系统智能专注助手 2026-02 - 至今",
    "",
    "奖项",
    "示例编程竞赛一等奖 2025-03",
    "",
    "技能",
    "Python, JavaScript, TypeScript, React, Node.js",
    "",
    "语言",
    "英语 CET-6"
  ].join("\n");

  return [createPage(1, pageText)];
}

function createPage(pageNumber: number, text: string): PdfPageText {
  return {
    id: `pdf-page-golden-${pageNumber}`,
    sessionId: "pdf-session-golden",
    pageNumber,
    extractedPageText: text,
    cleanedPageText: text,
    charStart: 0,
    charEnd: text.length,
    textItemCount: text.split("\n").length,
    warnings: [],
    rawTextHash: `raw-golden-${pageNumber}`,
    cleanedTextHash: `clean-golden-${pageNumber}`,
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME
  };
}
