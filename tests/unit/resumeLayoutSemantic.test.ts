import { describe, expect, it } from "vitest";
import { createLayoutDocument, LayoutDocumentSchema, type LayoutTextFragment } from "@/domain/resumeImport/layoutDocument";
import { buildLayoutGraph, LayoutGraphSchema } from "@/domain/resumeImport/layoutGraph";
import { LocalDeterministicSemanticResolver, mapSemanticItemToResumeItem, ResumeSemanticTreeSchema } from "@/domain/resumeImport/resumeSemanticTree";

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
    const item = mapSemanticItemToResumeItem({ sectionType: "project", item: semanticItem, layoutDocument: document });
    expect(item).toMatchObject({ sectionType: "project", title: "示例任务系统", role: "全栈开发", startDate: "2026-02", current: true });
    expect("highlights" in item ? item.highlights : []).toEqual(["设计多轮指令框架"]);
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
