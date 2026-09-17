import { describe, expect, it } from "vitest";
import { createImportedResumeDraftFromPdf } from "@/domain/resumeImport/parser";
import { buildResumeImportConfirmation } from "@/domain/resumeImport/confirm";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import type { PdfPageText } from "@/domain/schemas";

const TEST_TIME = "2026-09-16T00:00:00.000Z";

describe("resume render compatibility fallback", () => {
  it("does not discard the whole structured collection when one legacy item cannot be rehydrated", () => {
    const confirmed = buildResumeImportConfirmation({
      draft: confirmedDraft(),
      operationId: "resume-render-fallback-confirm",
      now: TEST_TIME
    });
    const changedBranch = {
      ...confirmed.branch,
      contentItems: confirmed.branch.contentItems.map((item, index) => index === 1
        ? { ...item, text: "无法恢复的教育内容", originalText: "无法恢复的教育内容" }
        : item)
    };

    const model = mapBranchToResumeRenderModel({
      branch: changedBranch,
      profile: confirmed.profile,
      coveragePolicy: "warn"
    });

    expect(model.sections.flatMap((section) => section.blocks)).toHaveLength(changedBranch.contentItems.length);
    expect(model.schemaVersion === "resume-render-v2" ? model.structuredSections.flatMap((section) => section.items) : []).toHaveLength(changedBranch.contentItems.length);
    expect(model.schemaVersion === "resume-render-v2" ? model.compatibilityWarnings.join("\n") : "").toContain("结构化字段未能重建");
  });
});

function confirmedDraft() {
  const sessionId = "resume-render-fallback-session";
  const text = [
    "明启辰",
    "明启辰@example.com 190376585896",
    "个人总结",
    "生成式 AI 应用开发与模型质量评估。",
    "教育背景",
    "郑州大学 | 计算机科学与技术 | 本科 | 2024.09-2028.06",
    "实习经历",
    "AI公司 | AI评估实践 | 2024.09-2026.02",
    "• 设计结构化评估流程",
    "项目与研究经历",
    "SmartFocus | 全栈开发 | 2026.02-至今",
    "• 开发任务规划系统",
    "技能与证书",
    "• TypeScript 与 RAG 应用开发"
  ].join("\n");
  const pages: PdfPageText[] = [{
    id: `${sessionId}-page-1`,
    sessionId,
    pageNumber: 1,
    extractedPageText: text,
    cleanedPageText: text,
    charStart: 0,
    charEnd: text.length,
    textItemCount: text.length,
    warnings: [],
    rawTextHash: "resume-render-fallback-raw",
    cleanedTextHash: "resume-render-fallback-clean",
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME
  }];
  const draft = createImportedResumeDraftFromPdf({
    importId: "resume-render-fallback-import",
    source: {
      sourceSessionId: sessionId,
      fileName: "resume-render-fallback.pdf",
      fileHash: "resume-render-fallback-file-hash",
      pageCount: 1
    },
    pages,
    now: TEST_TIME
  });
  if (draft.schemaVersion !== "resume-import-v2") throw new Error("expected_resume_import_v2_draft");
  return {
    ...draft,
    fieldCandidates: draft.fieldCandidates.map((candidate) => ({
      ...candidate,
      needsConfirmation: false,
      userConfirmed: true
    }))
  };
}
