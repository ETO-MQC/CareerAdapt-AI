import { describe, expect, it } from "vitest";
import { createLayoutDocument, LayoutDocumentSchema, type LayoutTextFragment } from "@/domain/resumeImport/layoutDocument";
import { buildLayoutGraph, LayoutGraphSchema } from "@/domain/resumeImport/layoutGraph";
import { LocalDeterministicSemanticResolver, mapSemanticItemToResumeItem, materializeSemanticTextGroup, ResumeSemanticTreeSchema } from "@/domain/resumeImport/resumeSemanticTree";

describe("LayoutDocument, Layout Graph and semantic tree", () => {
  it("validates font/source metadata and builds all required spatial relations", () => {
    const document = createLayoutDocument({ pageCount: 1, fragments: [
      fragment("heading", "项目经历", 20, 760, 180, 16, 700),
      fragment("title", "可信度分析系统", 20, 720, 180, 12, 700),
      fragment("role", "独立开发", 220, 720, 80, 12, 700),
      fragment("date", "2026.02-至今", 440, 720, 100, 12),
      fragment("marker", "•", 20, 690, 8, 11),
      fragment("body", "设计可信度评估框架", 35, 690, 240, 11),
      fragment("continuation", "并校验结构化输出", 35, 674, 200, 11)
    ] });
    const graph = buildLayoutGraph(document);
    expect(() => LayoutDocumentSchema.parse(document)).not.toThrow();
    expect(() => LayoutGraphSchema.parse(graph)).not.toThrow();
    expect(graph.edges.map((edge) => edge.relation)).toEqual(expect.arrayContaining([
      "same_row", "above", "below", "left", "right", "same_column", "nearby", "under_heading", "continuation_of", "bullet_content_of"
    ]));
  });

  it("creates block-id roles before mapping field text and consumes headings", () => {
    const document = createLayoutDocument({ pageCount: 1, fragments: [
      fragment("name", "示例用户", 20, 800, 100, 18, 700),
      fragment("heading", "项目经历", 20, 760, 180, 16, 700),
      fragment("title", "示例任务系统", 20, 720, 180, 12, 700),
      fragment("role", "全栈开发", 220, 720, 80, 12, 700),
      fragment("date", "2026.02-至今", 440, 720, 100, 12),
      fragment("marker", "•", 20, 690, 8, 11),
      fragment("body", "设计多轮指令框架", 35, 690, 240, 11)
    ] });
    const graph = buildLayoutGraph(document);
    const tree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument: document, layoutGraph: graph });
    expect(() => ResumeSemanticTreeSchema.parse(tree)).not.toThrow();
    expect(tree.basicsBlockIds).toContain("name");
    expect(tree.consumedHeadingBlockIds).toEqual(["heading"]);
    const semanticItem = tree.items[0];
    expect(semanticItem.titleBlockIds).toEqual(["title"]);
    expect(semanticItem.roleBlockIds).toEqual(["role"]);
    expect(semanticItem.dateBlockIds).toEqual(["date"]);
    const item = mapSemanticItemToResumeItem({ sectionType: "project", item: semanticItem, layoutDocument: document, layoutGraph: graph });
    expect(item).toMatchObject({ sectionType: "project", title: "示例任务系统", role: "全栈开发", startDate: "2026-02", current: true });
    expect("highlights" in item ? item.highlights : []).toEqual(["设计多轮指令框架"]);
  });

  it("assembles fragmented PDF rows and continuations into exact canonical text", () => {
    const document = createLayoutDocument({ pageCount: 1, fragments: [
      fragment("summary-heading", "个人总结", 20, 800, 100, 16, 700),
      fragment("summary-body", "专注于可信AI应用开发。", 20, 775, 250, 11),
      fragment("project-heading", "项目经历", 20, 735, 100, 16, 700),
      fragment("project-title", "示例学习助手", 20, 710, 150, 12, 700),
      fragment("project-role", "独立开发者", 220, 710, 80, 12),
      fragment("project-date", "2025.01-至今", 440, 710, 100, 12),
      fragment("bullet-1", "•", 20, 685, 8, 11),
      fragment("h1-cn", "设计", 35, 685, 24, 11),
      fragment("h1-ai", "AI", 61, 685, 14, 11),
      fragment("h1-cn-2", "助手的多轮指令框架，集成", 77, 685, 150, 11),
      fragment("h1-rag", "RAG", 229, 685, 24, 11),
      fragment("h1-cn-3", "检索。", 255, 685, 40, 11),
      fragment("h1-wrap", "支持Markdown、KaTeX与SQLite持久化。", 35, 669, 260, 11),
      fragment("skills-heading", "技能", 20, 625, 100, 16, 700),
      fragment("skill-marker", "•", 20, 600, 8, 11),
      fragment("skill-name", "AI应用与工程化：", 35, 600, 105, 11, 700),
      fragment("skill-desc", "熟悉RAG、提示词工程与评测。", 142, 600, 190, 11)
    ] });
    const graph = buildLayoutGraph(document);
    const tree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument: document, layoutGraph: graph });
    const summarySection = tree.sections.find((section) => section.sectionType === "summary")!;
    const projectSection = tree.sections.find((section) => section.sectionType === "project")!;
    const skillsSection = tree.sections.find((section) => section.sectionType === "skills")!;
    const summary = mapSemanticItemToResumeItem({ sectionType: "summary", item: tree.items.find((item) => item.id === summarySection.itemIds[0])!, layoutDocument: document, layoutGraph: graph });
    const projectSemantic = tree.items.find((item) => item.id === projectSection.itemIds[0])!;
    const project = mapSemanticItemToResumeItem({ sectionType: "project", item: projectSemantic, layoutDocument: document, layoutGraph: graph });
    const skill = mapSemanticItemToResumeItem({ sectionType: "skills", item: tree.items.find((item) => item.id === skillsSection.itemIds[0])!, layoutDocument: document, layoutGraph: graph });

    expect(summary).toMatchObject({ sectionType: "summary", text: "专注于可信AI应用开发。" });
    expect(tree.consumedHeadingBlockIds).toContain("summary-heading");
    expect(projectSemantic.highlightGroups).toHaveLength(1);
    expect(materializeSemanticTextGroup({ group: projectSemantic.highlightGroups[0], layoutDocument: document, layoutGraph: graph }))
      .toBe("设计AI助手的多轮指令框架，集成RAG检索。支持Markdown、KaTeX与SQLite持久化。");
    expect("highlights" in project ? project.highlights : []).toEqual([
      "设计AI助手的多轮指令框架，集成RAG检索。支持Markdown、KaTeX与SQLite持久化。"
    ]);
    expect(skill).toMatchObject({ sectionType: "skills", name: "AI应用与工程化", description: "熟悉RAG、提示词工程与评测。" });
    const actualHighlights = "highlights" in project ? project.highlights : [];
    const fragmentOnlyHighlightCount = actualHighlights.filter((highlight) => ["AI", "RAG", "Markdown", "KaTeX", "SQLite"].includes(highlight)).length;
    const exactHighlightMatchRate = Number(actualHighlights[0] === "设计AI助手的多轮指令框架，集成RAG检索。支持Markdown、KaTeX与SQLite持久化。");
    const exactCoreFieldMatchRate = Number(project.sectionType === "project" && project.title === "示例学习助手" && project.role === "独立开发者"
      && skill.sectionType === "skills" && skill.name === "AI应用与工程化" && skill.description === "熟悉RAG、提示词工程与评测。");
    expect({ fragmentOnlyHighlightCount, exactHighlightMatchRate, exactCoreFieldMatchRate }).toEqual({
      fragmentOnlyHighlightCount: 0,
      exactHighlightMatchRate: 1,
      exactCoreFieldMatchRate: 1
    });
  });

  it.each([
    ["CareerAdapt standard", standardTemplate()],
    ["three-column", columnTemplate(3)],
    ["two-column", columnTemplate(2)],
    ["composite sections", compositeTemplate()]
  ])("keeps structural validation for %s fixtures", (_name, fragments) => {
    const document = createLayoutDocument({ pageCount: 1, fragments });
    const graph = buildLayoutGraph(document);
    const tree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument: document, layoutGraph: graph });
    expect(LayoutDocumentSchema.safeParse(document).success).toBe(true);
    expect(LayoutGraphSchema.safeParse(graph).success).toBe(true);
    expect(ResumeSemanticTreeSchema.safeParse(tree).success).toBe(true);
    expect(tree.sections.length).toBeGreaterThan(0);
    if (_name === "three-column") expect(new Set(document.blocks.map((block) => block.columnId)).size).toBeGreaterThanOrEqual(3);
  });
});

function fragment(id: string, text: string, x: number, y: number, width: number, size: number, weight = 400): LayoutTextFragment {
  return { id, page: 1, text, bbox: { x, y, width, height: size }, fontSize: size, fontWeight: weight, fontFamily: "Fixture Sans", color: "#000000", sourceBlockRef: `source:${id}`, sourceEngine: "pdfjs" };
}

function standardTemplate(): LayoutTextFragment[] {
  return [fragment("s-name", "Candidate", 20, 800, 100, 18, 700), fragment("s-h", "教育经历", 20, 760, 180, 16, 700),
    fragment("s-school", "Example University", 20, 720, 180, 12, 700), fragment("s-major", "Computer Science", 220, 720, 130, 12), fragment("s-date", "2022-2026", 440, 720, 90, 12)];
}

function columnTemplate(columns: number): LayoutTextFragment[] {
  return [fragment(`c${columns}-h`, "技能", 20, 760, 520, 16, 700), ...Array.from({ length: columns }, (_, index) =>
    fragment(`c${columns}-${index}`, `Skill ${index + 1}`, 20 + index * 180, 720, 120, 12, 700))];
}

function compositeTemplate(): LayoutTextFragment[] {
  return [fragment("m-name", "Candidate", 20, 820, 120, 18, 700), fragment("m-h1", "实习经历", 20, 780, 520, 16, 700),
    fragment("m-org", "Example Corp", 20, 740, 150, 12, 700), fragment("m-role", "Intern", 200, 740, 80, 12), fragment("m-date", "2025.01-2025.06", 420, 740, 120, 12),
    fragment("m-h2", "项目与研究经历", 20, 680, 520, 16, 700), fragment("m-title", "Project", 20, 640, 150, 12, 700), fragment("m-prole", "Owner", 200, 640, 80, 12), fragment("m-pdate", "2026.01-至今", 420, 640, 120, 12)];
}
