import { describe, expect, it } from "vitest";
import { parseResumeDateToken } from "@/domain/resumeImport/dates";
import { createImportedResumeDraftFromText } from "@/domain/resumeImport/parser";
import { matchResumeSectionHeading } from "@/domain/resumeImport/sectionHeading";
import type { NormalizedSourceBlock, PdfPageText } from "@/domain/schemas";

const NOW = "2026-07-16T08:00:00.000Z";

describe("P3.6e grouped resume structure", () => {
  it("classifies the outer 经历 heading as presentation-only", () => {
    expect(matchResumeSectionHeading("经历")).toEqual({
      kind: "presentation_group",
      groupId: "experience-group",
      label: "经历"
    });
    expect(matchResumeSectionHeading("教育经历")).toMatchObject({
      kind: "canonical_section",
      sectionType: "education"
    });
  });

  it.each([
    ["2024.09", "2024-09", "month"],
    ["2028.06.27", "2028-06", "day"],
    ["2024.09.16", "2024-09", "day"],
    ["2024-09-20", "2024-09", "day"],
    ["2024/09/20", "2024-09", "day"],
    ["2024年9月20日", "2024-09", "day"]
  ])("preserves source precision but canonicalizes %s to month", (rawText, value, sourcePrecision) => {
    expect(parseResumeDateToken({ rawText, sourceBlockId: "date-source" })).toMatchObject({
      rawText,
      value,
      sourcePrecision,
      businessPrecision: "month",
      current: false
    });
  });

  it("does not infer current from a single start date", () => {
    expect(parseResumeDateToken({ rawText: "2025-04", sourceBlockId: "date-source" })).toMatchObject({
      value: "2025-04",
      current: false
    });
  });

  it("builds canonical section → item → field mappings without leaking presentation headings", () => {
    const blocks = groupedResumeBlocks();
    const pages = pageRecords(blocks);
    const draft = createImportedResumeDraftFromText({
      importId: "p36e-unit",
      source: {
        fileName: "grouped-resume.pdf",
        mimeType: "application/pdf",
        fileHash: "p36e-grouped-resume-hash",
        pageCount: 2,
        extractedAt: NOW
      },
      pages,
      sourceKind: "text_pdf",
      sourceBlocks: blocks,
      now: NOW
    });

    expect(draft.basics.name?.value).toBe("M");
    expect(draft.basics.location?.value).toBe("测试市（远程）");
    expect(draft.basics.name?.sourceBlockIds).not.toEqual(draft.basics.location?.sourceBlockIds);

    const byCategory = new Map(draft.sections.map((section) => [section.category, section]));
    expect(draft.sections.some((section) => section.detectedTitle === "经历")).toBe(false);
    expect(draft.sections.some((section) => section.sectionType === "unknown")).toBe(false);
    expect(byCategory.get("summary")?.items).toHaveLength(1);
    expect(byCategory.get("education")?.items).toHaveLength(1);
    expect(byCategory.get("work")?.items).toHaveLength(2);
    expect(byCategory.get("project")?.items).toHaveLength(4);
    expect(byCategory.get("award")?.items).toHaveLength(2);
    expect(byCategory.get("skill")?.items).toHaveLength(6);
    expect(byCategory.get("language")?.items).toHaveLength(1);

    const education = byCategory.get("education")?.items[0] as unknown as {
      structuredItem?: Record<string, unknown>;
    };
    expect(education.structuredItem).toMatchObject({
      sectionType: "education",
      school: "示例大学",
      degree: "本科",
      major: "计算机相关专业",
      location: "测试市",
      startDate: "2024-09",
      endDate: "2028-06",
      current: false
    });

    const projects = byCategory.get("project")?.items as unknown as Array<{
      id: string;
      structuredItem?: Record<string, unknown>;
      sourceBlockIds: string[];
      sourceRanges?: unknown[];
    }>;
    expect(projects.map((item) => item.structuredItem)).toEqual([
      expect.objectContaining({ title: "项目甲", role: "全栈开发", location: "测试市", startDate: "2026-02", current: true }),
      expect.objectContaining({ title: "项目乙", role: "独立开发者", location: "测试市", startDate: "2026-03", current: true }),
      expect.objectContaining({ title: "项目丙", role: "后端开发", location: "测试市", startDate: "2026-04", current: true }),
      expect.objectContaining({ title: "项目丁（预研中）", role: "预研负责人", location: "测试市", startDate: "2026-02", current: true })
    ]);
    expect(projects.every((item) => item.id && item.sourceBlockIds.length > 0 && item.sourceRanges?.length)).toBe(true);

    const candidateItems = draft.schemaVersion === "resume-import-v2"
      ? draft.fieldCandidates.filter((candidate) => candidate.targetFieldId.endsWith("Date") || candidate.targetFieldId.endsWith(".current"))
      : [];
    expect(candidateItems.every((candidate) => {
      const contextual = candidate as unknown as { sectionId?: string; itemId?: string; itemLabel?: string };
      return contextual.sectionId && contextual.itemId && contextual.itemLabel;
    })).toBe(true);

    const unclassifiedText = draft.unclassifiedBlocks.map((block) => JSON.stringify(block)).join("\n");
    for (const mappedText of ["13900000000", "candidate@example.com", "https://example.com/candidate", "测试市（远程）", "\"M\"", "经历"]) {
      expect(unclassifiedText).not.toContain(mappedText);
    }
  });
});

function groupedResumeBlocks(): NormalizedSourceBlock[] {
  const lines: Array<[number, string, "heading" | "paragraph" | "contact", number, number]> = [
    [1, "测试市（远程）", "paragraph", 9, 500],
    [1, "M 13900000000", "heading", 15, 40],
    [1, "未指定岗位 / 通用简历 candidate@example.com", "contact", 10, 40],
    [1, "https://example.com/candidate", "contact", 9, 420],
    [1, "自我评价", "heading", 11, 40],
    [1, "专注结构化输出验证与质量评估。", "paragraph", 9, 40],
    [1, "经历", "heading", 11, 40],
    [1, "教育经历", "heading", 10, 40],
    [1, "示例大学 / 本科 测试市 2024.09 - 2028.06.27 专业：计算机相关专业专业", "paragraph", 9, 52],
    [1, "工作与实习经历", "heading", 10, 40],
    [1, "实践甲 / 质量审核 测试市 2024.09.16 - 至今 负责规则设计", "paragraph", 9, 52],
    [1, "形成稳定评估流程", "paragraph", 9, 52],
    [1, "实践乙 / 输出管控 | 测试市 2025-04 - 至今 负责结果复核", "paragraph", 9, 52],
    [1, "沉淀复用标准", "paragraph", 9, 52],
    [1, "项目成果", "heading", 10, 40],
    [1, "项目甲 | 全栈开发 测试市 2026.02.16 - 至今 完成任务系统", "paragraph", 9, 52],
    [1, "项目乙 | 独立开发者 测试市 2026.03.16 - 至今 完成学习助手", "paragraph", 9, 52],
    [1, "项目丙 | 后端开发 测试市 2026.04.16 - 至今 完成分析系统", "paragraph", 9, 52],
    [1, "项目丁（预研中） / 预研负责人 测试市 2026.02.16 - 至今 完成预研", "paragraph", 9, 52],
    [1, "奖项", "heading", 10, 40],
    [1, "示例竞赛 省级三等奖 · 2025-03", "paragraph", 9, 52],
    [1, "示例大学 三等奖学金 · 2025-09", "paragraph", 9, 52],
    [2, "技能", "heading", 11, 40],
    [2, "生成式AI使用 / 复杂指令设计 / 多轮对话规划 模型输出评估 / 逻辑缺陷识别 / AI质量管控", "paragraph", 9, 40],
    [2, "Prompt工程 / RAG / AI Agent任务规划 需求拆解 / 结构化表达 / 技术文档写作", "paragraph", 9, 40],
    [2, "Python基础 / FastAPI / Playwright（AI辅助开发） React / Next.js / TypeScript（AI辅助开发）", "paragraph", 9, 40],
    [2, "经历", "heading", 11, 40],
    [2, "语言", "heading", 10, 40],
    [2, "中文母语，英语四级备考中", "paragraph", 9, 52]
  ];
  return lines.map(([page, normalizedText, blockType, fontSize, x], order) => ({
    id: `p36e:${page}:${order}`,
    page,
    text: normalizedText,
    rawText: normalizedText,
    normalizedText,
    normalizationActions: [],
    blockType,
    position: { x, y: 800 - order * 20, width: normalizedText.length * 8, height: fontSize },
    sourceEngine: "pdfjs",
    sourceEngineVersion: "test",
    extractionConfidence: 0.98,
    sourceKind: "digital_pdf",
    fontSize,
    order
  }));
}

function pageRecords(blocks: NormalizedSourceBlock[]): PdfPageText[] {
  return [1, 2].map((pageNumber) => {
    const text = blocks.filter((block) => block.page === pageNumber).map((block) => block.normalizedText).join("\n");
    return {
      id: `p36e-page-${pageNumber}`,
      sessionId: "p36e-session",
      pageNumber,
      extractedPageText: text,
      cleanedPageText: text,
      charStart: 0,
      charEnd: text.length,
      textItemCount: text.split("\n").length,
      warnings: [],
      rawTextHash: `p36e-raw-${pageNumber}`,
      cleanedTextHash: `p36e-clean-${pageNumber}`,
      createdAt: NOW,
      updatedAt: NOW
    };
  });
}
