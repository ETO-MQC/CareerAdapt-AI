import { describe, expect, it } from "vitest";
import { createLayoutDocument, LayoutDocumentSchema, type LayoutTextFragment } from "@/domain/resumeImport/layoutDocument";
import { buildLayoutGraph, LayoutGraphSchema } from "@/domain/resumeImport/layoutGraph";
import { auditResumeTextFidelity, auditSemanticTextAssembly, LocalDeterministicSemanticResolver, mapSemanticItemToResumeItem, materializeSemanticTextGroup, ResumeSemanticTreeSchema } from "@/domain/resumeImport/resumeSemanticTree";
import { createImportedResumeDraftFromPdf } from "@/domain/resumeImport/parser";
import { auditResumeImportInvariants } from "@/domain/resumeImport/invariants";
import type { NormalizedSourceBlock } from "@/domain/schemas";

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

  it("keeps adjacent bullet fragments exclusive and removes skill display residue", () => {
    const document = createLayoutDocument({ pageCount: 1, fragments: [
      fragment("project-heading-x", "项目经历", 20, 800, 100, 16, 700),
      fragment("project-title-x", "示例学习助手", 20, 775, 120, 12, 700),
      fragment("project-role-x", "独立开发", 220, 775, 80, 12),
      fragment("project-date-x", "2026.03-至今", 440, 775, 100, 12),
      fragment("m1", "•", 20, 750, 8, 11), fragment("a1", "修正模型幻觉与拒答边界", 35, 750, 170, 11),
      fragment("a1-wrap", "并建立稳定评估工作流", 35, 734, 160, 11),
      fragment("m2", "•", 20, 714, 8, 11), fragment("a2-cn", "搭建本地", 35, 714, 55, 11), fragment("a2-rag", "RAG", 92, 714, 24, 11), fragment("a2-tail", "流程", 118, 714, 28, 11),
      fragment("m3", "•", 20, 694, 8, 11), fragment("a3-cn", "支持", 35, 694, 28, 11), fragment("a3-md", "Markdown、KaTeX", 65, 694, 100, 11), fragment("a3-tail", "公式", 167, 694, 28, 11),
      fragment("m4", "•", 20, 674, 8, 11), fragment("a4", "使用Mermaid输出架构图", 35, 674, 155, 11),
      fragment("skills-heading-x", "技能", 20, 630, 100, 16, 700),
      fragment("sm1", "•", 20, 605, 8, 11), fragment("sn1", "AI应用与工程化：", 35, 605, 110, 11, 700), fragment("sd1", "熟悉RAG与评测", 147, 605, 100, 11), fragment("residue", "、", 35, 589, 8, 11)
    ] });
    const graph = buildLayoutGraph(document);
    const tree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument: document, layoutGraph: graph });
    const projectSection = tree.sections.find((section) => section.sectionType === "project")!;
    const projectSemantic = tree.items.find((item) => item.id === projectSection.itemIds[0])!;
    const project = mapSemanticItemToResumeItem({ sectionType: "project", item: projectSemantic, layoutDocument: document, layoutGraph: graph });
    const skillSection = tree.sections.find((section) => section.sectionType === "skills")!;
    const skillSemantic = tree.items.find((item) => item.id === skillSection.itemIds[0])!;
    const skill = mapSemanticItemToResumeItem({ sectionType: "skills", item: skillSemantic, layoutDocument: document, layoutGraph: graph });

    expect(projectSemantic.highlightGroups).toEqual(projectSemantic.highlightGroups.map(() => expect.objectContaining({
      markerBlockIds: expect.any(Array), sourceOrderStart: expect.any(Number), sourceOrderEnd: expect.any(Number)
    })));
    expect("highlights" in project ? project.highlights : []).toEqual([
      "修正模型幻觉与拒答边界并建立稳定评估工作流", "搭建本地RAG流程", "支持Markdown、KaTeX公式", "使用Mermaid输出架构图"
    ]);
    expect(skill).toMatchObject({ sectionType: "skills", name: "AI应用与工程化", description: "熟悉RAG与评测" });
    expect(auditSemanticTextAssembly({ tree, layoutDocument: document, layoutGraph: graph })).toEqual({
      exactDuplicateHighlightCount: 0, crossGroupSharedBlockCount: 0, fragmentOnlyHighlightCount: 0, adjacentHighlightContainmentCount: 0
    });
  });

  it("carries abnormal PDF phone and semantic review through the production draft path", () => {
    const document = createLayoutDocument({ pageCount: 1, fragments: [
      fragment("prod-name", "示例用户", 20, 820, 80, 18, 700),
      fragment("prod-phone", "13800138000", 420, 820, 100, 11),
      fragment("prod-heading", "项目经历", 20, 780, 100, 16, 700),
      fragment("prod-title", "示例任务系统", 20, 755, 120, 12, 700),
      fragment("prod-role", "全栈开发", 220, 755, 80, 12),
      fragment("prod-date", "2026.02-至今", 440, 755, 100, 12),
      fragment("prod-marker", "•", 20, 730, 8, 11),
      fragment("prod-body", "协助部署示例自动化框架自动化框架", 35, 730, 190, 11)
    ] });
    const graph = buildLayoutGraph(document);
    const semanticTree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument: document, layoutGraph: graph });
    const sourceBlocks: NormalizedSourceBlock[] = document.blocks.map((block) => ({
      id: block.sourceBlockRefs[0], page: block.page, text: block.text, rawText: block.text, normalizedText: block.text,
      normalizationActions: [], blockType: "paragraph", sourceEngine: "pdfjs", sourceEngineVersion: "test",
      extractionConfidence: 1, sourceKind: "digital_pdf", order: block.order, position: block.bbox, fontSize: block.font.size
    }));
    const pageText = document.blocks.map((block) => block.text).join("\n");
    const draft = createImportedResumeDraftFromPdf({
      importId: "production-semantic-test", source: { fileName: "sanitized.pdf", fileHash: "fixture-hash-00000001", pageCount: 1 },
      pages: [{ pageNumber: 1, extractedPageText: pageText, cleanedPageText: pageText, charStart: 0, charEnd: pageText.length }],
      sourceBlocks, layoutArtifacts: [{ layoutDocument: document, layoutGraph: graph, semanticTree }], now: "2026-07-18T00:00:00.000Z"
    });

    expect(draft.schemaVersion).toBe("resume-import-v2");
    if (draft.schemaVersion !== "resume-import-v2") throw new Error("expected resume-import-v2 draft");
    expect(draft.basics.phone).toMatchObject({ value: "13800138000", confidence: "low", sourceStatus: "ambiguous" });
    expect(draft.fieldCandidates).toEqual(expect.arrayContaining([expect.objectContaining({ value: "13800138000", reviewStatus: "needs_review" })]));
    expect(auditResumeImportInvariants(draft).semanticStructureReviewCount).toBe(0);
    const project = draft.sections.find((section) => section.sectionType === "project")?.items[0]?.structuredItem;
    expect(project && "highlights" in project ? project.highlights : []).toEqual(["协助部署示例自动化框架自动化框架"]);
  });

  it("keeps incomplete semantic headers ambiguous without lowering the global threshold", () => {
    const document = createLayoutDocument({ pageCount: 1, fragments: [
      fragment("incomplete-heading", "项目经历", 20, 800, 100, 16, 700),
      fragment("incomplete-title", "缺少角色的项目", 20, 775, 150, 12, 700),
      fragment("incomplete-date", "2026.01-至今", 440, 775, 100, 12),
      fragment("incomplete-marker", "•", 20, 750, 8, 11),
      fragment("incomplete-body", "实现可信评测流程", 35, 750, 150, 11)
    ] });
    const graph = buildLayoutGraph(document);
    const semanticTree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument: document, layoutGraph: graph });
    const sourceBlocks: NormalizedSourceBlock[] = document.blocks.map((block) => ({
      id: block.sourceBlockRefs[0], page: block.page, text: block.text, rawText: block.text, normalizedText: block.text,
      normalizationActions: [], blockType: "paragraph", sourceEngine: "pdfjs", sourceEngineVersion: "test",
      extractionConfidence: 1, sourceKind: "digital_pdf", order: block.order, position: block.bbox, fontSize: block.font.size
    }));
    const pageText = document.blocks.map((block) => block.text).join("\n");
    const draft = createImportedResumeDraftFromPdf({
      importId: "incomplete-semantic-test", source: { fileName: "incomplete.pdf", fileHash: "fixture-hash-incomplete", pageCount: 1 },
      pages: [{ pageNumber: 1, extractedPageText: pageText, cleanedPageText: pageText, charStart: 0, charEnd: pageText.length }],
      sourceBlocks, layoutArtifacts: [{ layoutDocument: document, layoutGraph: graph, semanticTree }], now: "2026-07-18T00:00:00.000Z"
    });

    expect(auditResumeImportInvariants(draft).semanticStructureReviewCount).toBe(1);
  });

  it("starts a new highlight for independent and inline bullet markers", () => {
    const document = createLayoutDocument({ pageCount: 1, fragments: [
      fragment("inline-heading", "项目经历", 20, 800, 100, 16, 700),
      fragment("inline-title", "Boundary Lab", 20, 775, 120, 12, 700),
      fragment("inline-role", "独立开发", 220, 775, 80, 12),
      fragment("inline-date", "2026.01-至今", 440, 775, 100, 12),
      fragment("standalone-marker", "•", 20, 750, 8, 11),
      fragment("standalone-body", "第一条成果", 35, 750, 100, 11),
      fragment("inline-marker-1", "• 第二条成果", 20, 730, 120, 11),
      fragment("inline-marker-2", "• 第三条成果", 20, 710, 120, 11)
    ] });
    const graph = buildLayoutGraph(document);
    const tree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument: document, layoutGraph: graph });
    const section = tree.sections.find((entry) => entry.sectionType === "project")!;
    const item = mapSemanticItemToResumeItem({ sectionType: "project", item: tree.items.find((entry) => entry.id === section.itemIds[0])!, layoutDocument: document, layoutGraph: graph });

    expect("highlights" in item ? item.highlights : []).toEqual(["第一条成果", "第二条成果", "第三条成果"]);
  });

  it.each(["AI应用与工程化：精通RAG与评测", "AI应用与工程化:精通RAG与评测"])("splits a same-block skill name and description: %s", (skillText) => {
    const document = createLayoutDocument({ pageCount: 1, fragments: [
      fragment("same-skill-heading", "技能", 20, 800, 100, 16, 700),
      fragment("same-skill-marker", "•", 20, 775, 8, 11),
      fragment("same-skill-content", skillText, 35, 775, 240, 11)
    ] });
    const graph = buildLayoutGraph(document);
    const tree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument: document, layoutGraph: graph });
    const section = tree.sections.find((entry) => entry.sectionType === "skills")!;
    const item = mapSemanticItemToResumeItem({ sectionType: "skills", item: tree.items.find((entry) => entry.id === section.itemIds[0])!, layoutDocument: document, layoutGraph: graph });

    expect(item).toMatchObject({ sectionType: "skills", name: "AI应用与工程化", description: "精通RAG与评测" });
  });

  it("keeps the description when an inline bullet contains the skill name, colon, and first line", () => {
    const document = createLayoutDocument({ pageCount: 1, fragments: [
      fragment("inline-skill-heading", "技能", 20, 800, 100, 16, 700),
      fragment("inline-skill-first", "• 全栈开发与自动化：后端开发（Python / FastAPI）；前端开发（React / Next.js / TypeScript）；熟练利用", 20, 775, 500, 11),
      fragment("inline-skill-wrap", "Playwright实现AI辅助下的端到端自动化测试。、", 35, 759, 280, 11, 700)
    ] });
    const graph = buildLayoutGraph(document);
    const tree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument: document, layoutGraph: graph });
    const section = tree.sections.find((entry) => entry.sectionType === "skills")!;
    const item = mapSemanticItemToResumeItem({ sectionType: "skills", item: tree.items.find((entry) => entry.id === section.itemIds[0])!, layoutDocument: document, layoutGraph: graph });
    expect(item).toMatchObject({ sectionType: "skills", name: "全栈开发与自动化",
      description: "后端开发（Python / FastAPI）；前端开发（React / Next.js / TypeScript）；熟练利用Playwright实现AI辅助下的端到端自动化测试。" });
  });

  it("keeps visual continuation lines, bold skill fragments, and intentional English spaces", () => {
    const document = createLayoutDocument({ pageCount: 1, fragments: [
      fragment("role-name", "开发工程师", 20, 830, 90, 12),
      fragment("project-heading-fidelity", "项目经历", 20, 800, 100, 16, 700),
      fragment("project-title-fidelity", "示例学习助手", 20, 775, 140, 12, 700),
      fragment("project-role-fidelity", "独立开发者", 220, 775, 80, 12),
      fragment("project-date-fidelity", "2026.03-至今", 440, 775, 100, 12),
      fragment("fidelity-marker", "•", 20, 750, 8, 11),
      fragment("fidelity-first", "发现模型在 RAG 检索结果不足时倾向于捏造依据，增加拒答边界条", 35, 750, 430, 11),
      fragment("fidelity-wrap", "件并验证 Prompt Engineering 多轮 指令", 52, 734, 250, 11),
      fragment("skills-heading-fidelity", "技能", 20, 700, 100, 16, 700),
      fragment("skill-marker-fidelity", "•", 20, 675, 8, 11),
      fragment("skill-name-fidelity", "全栈开发与自动化：", 35, 675, 120, 11, 700),
      fragment("skill-desc-fidelity", "后端开发（Python / FastAPI）；前端开发（React / Next.js / TypeScript）；熟练利用", 157, 675, 380, 11),
      fragment("skill-wrap-fidelity", "Playwright 实现 AI 辅助下的端到端自动化测试。、", 35, 659, 300, 11, 700)
    ] });
    const graph = buildLayoutGraph(document);
    const tree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument: document, layoutGraph: graph });
    const projectSection = tree.sections.find((section) => section.sectionType === "project")!;
    const skillSection = tree.sections.find((section) => section.sectionType === "skills")!;
    const project = mapSemanticItemToResumeItem({ sectionType: "project", item: tree.items.find((item) => item.id === projectSection.itemIds[0])!, layoutDocument: document, layoutGraph: graph });
    const skill = mapSemanticItemToResumeItem({ sectionType: "skills", item: tree.items.find((item) => item.id === skillSection.itemIds[0])!, layoutDocument: document, layoutGraph: graph });

    expect("highlights" in project ? project.highlights : []).toEqual([
      "发现模型在RAG检索结果不足时倾向于捏造依据，增加拒答边界条件并验证Prompt Engineering多轮指令"
    ]);
    expect(skill).toMatchObject({
      sectionType: "skills",
      name: "全栈开发与自动化",
      description: "后端开发（Python / FastAPI）；前端开发（React / Next.js / TypeScript）；熟练利用Playwright实现AI辅助下的端到端自动化测试。"
    });
    expect(auditResumeTextFidelity({ tree, layoutDocument: document, layoutGraph: graph, sourceTargetRole: "开发工程师", materializedTargetRole: "开发工程师" }))
      .toEqual({ sourceLocatedCoreFieldLossCount: 0, truncatedSemanticGroupCount: 0, danglingFragmentCount: 0, accidentalCjkWhitespaceCount: 0,
        markerLeakageCount: 0, duplicatedSourceSpanCount: 0, unconsumedSourceSpanCount: 0, targetRoleLossCount: 0 });
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
