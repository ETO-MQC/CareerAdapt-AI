import { describe, expect, it } from "vitest";
import {
  ResumePatchAcceptanceSchema,
  ResumePatchFinalizationSchema,
  ResumePatchOpSchema,
  ResumePatchReviewResultSchema,
  finalizationMatchesOps,
  isValidPatchAcceptance,
  type ResumePatchOp
} from "@/domain/jobAssets/resumePatch";
import {
  attachSpanToPatchEvidence,
  diagnoseEvidenceGrounding,
  diagnoseEvidenceLocation
} from "@/domain/jobAssets/evidenceDiagnostics";

const RAW_JD = "职责：\n负责后端服务开发。\n要求：\n3 年以上 Go 经验。";

function op(overrides: Partial<ResumePatchOp> = {}): ResumePatchOp {
  return ResumePatchOpSchema.parse({
    targetLocator: "resume:rev-1:experience:exp-2:summary",
    originalQuote: "负责后端开发",
    proposedText: "负责 Go 后端服务的设计与开发",
    rationale: "对齐岗位对 Go 后端经验的要求",
    addressesRequirementIds: ["req-go"],
    supportEvidence: [{
      sourceLocator: "resume:rev-1:experience:exp-2:summary",
      sourceQuote: "负责后端开发",
      evidenceQuality: "exact"
    }],
    ...overrides
  });
}

describe("V4-P1 stage 6: resume patch structure", () => {
  it("accepts a well-formed patch op with evidence and requirement references", () => {
    const parsed = op();
    expect(parsed.supportEvidence).toHaveLength(1);
    expect(parsed.addressesRequirementIds).toEqual(["req-go"]);
  });

  it("rejects a no-op change where proposed text equals the original quote", () => {
    const noop = ResumePatchOpSchema.safeParse({
      targetLocator: "resume:rev-1:x",
      originalQuote: "相同文本",
      proposedText: "相同文本",
      rationale: "无变化",
      supportEvidence: [{ sourceLocator: "l", sourceQuote: "q" }]
    });
    expect(noop.success).toBe(false);
  });

  it("requires at least one and at most five support evidence entries", () => {
    const noEvidence = ResumePatchOpSchema.safeParse({
      targetLocator: "resume:rev-1:x",
      proposedText: "新文本",
      rationale: "依据",
      supportEvidence: []
    });
    expect(noEvidence.success).toBe(false);

    const tooMuch = ResumePatchOpSchema.safeParse({
      targetLocator: "resume:rev-1:x",
      proposedText: "新文本",
      rationale: "依据",
      supportEvidence: Array.from({ length: 6 }, (_, index) => ({
        sourceLocator: `l${index}`,
        sourceQuote: `q${index}`
      }))
    });
    expect(tooMuch.success).toBe(false);
  });

  it("rejects ops with empty rationale or oversized fields", () => {
    expect(ResumePatchOpSchema.safeParse({
      targetLocator: "l", proposedText: "x", rationale: "", supportEvidence: [{ sourceLocator: "l", sourceQuote: "q" }]
    }).success).toBe(false);
    expect(ResumePatchOpSchema.safeParse({
      targetLocator: "l", proposedText: "x".repeat(2001), rationale: "r", supportEvidence: [{ sourceLocator: "l", sourceQuote: "q" }]
    }).success).toBe(false);
  });

  it("validates acceptance indices and finalization consistency against the op set", () => {
    const ops = [op(), op({ targetLocator: "resume:rev-1:skills" })];
    expect(isValidPatchAcceptance(ops, 1)).toBe(true);
    expect(isValidPatchAcceptance(ops, 2)).toBe(true);
    expect(isValidPatchAcceptance(ops, 3)).toBe(false);
    expect(isValidPatchAcceptance(ops, 0)).toBe(false);

    const finalization = ResumePatchFinalizationSchema.parse({
      markdown: "# 简历\n内容",
      appliedChangeIndices: [1],
      warnings: [],
      draftFingerprint: "a".repeat(64),
      finalizedAt: "2026-10-06T00:00:00.000Z"
    });
    expect(finalizationMatchesOps(ops, finalization)).toBe(true);
    expect(finalizationMatchesOps(ops, { ...finalization, appliedChangeIndices: [3] })).toBe(false);
  });

  it("keeps review verdicts consistent with issue severities", () => {
    const passing = ResumePatchReviewResultSchema.safeParse({
      verdict: "pass",
      summary: "通过",
      issues: []
    });
    expect(passing.success).toBe(true);

    const passWithBlocking = ResumePatchReviewResultSchema.safeParse({
      verdict: "pass",
      summary: "通过",
      issues: [{ category: "unsupported_fact", severity: "blocking", explanation: "无支撑事实" }]
    });
    expect(passWithBlocking.success).toBe(false);

    const blockWithoutBlocking = ResumePatchReviewResultSchema.safeParse({
      verdict: "block",
      summary: "阻断",
      issues: [{ category: "unclear_expression", severity: "warning", explanation: "表达不清" }]
    });
    expect(blockWithoutBlocking.success).toBe(false);

    const revise = ResumePatchReviewResultSchema.safeParse({
      verdict: "revise",
      summary: "需修改",
      issues: [{ category: "meaning_changed", severity: "blocking", changeIndex: 1, explanation: "含义改变" }]
    });
    expect(revise.success).toBe(true);
  });

  it("keeps acceptance records tied to valid change indices", () => {
    const acceptance = ResumePatchAcceptanceSchema.safeParse({ changeIndex: 0, op: op() });
    expect(acceptance.success).toBe(false);
  });
});

describe("V4-P1 stage 6: evidence location diagnostics", () => {
  it("locates exact quotes and reports the span", () => {
    const diagnostic = diagnoseEvidenceLocation(RAW_JD, "3 年以上 Go 经验");
    expect(diagnostic.status).toBe("located");
    if (diagnostic.status === "located") {
      expect(RAW_JD.slice(diagnostic.span.start, diagnostic.span.end)).toBe("3 年以上 Go 经验");
    }
  });

  it("locates quotes through whitespace differences without changing the original text", () => {
    const diagnostic = diagnoseEvidenceLocation(RAW_JD, "3年以上Go经验");
    expect(diagnostic.status).toBe("located");
  });

  it("classifies empty and unfindable quotes explicitly", () => {
    expect(diagnoseEvidenceLocation(RAW_JD, "   ")).toEqual({ status: "empty_quote" });
    expect(diagnoseEvidenceLocation(RAW_JD, "要求精通 Rust")).toEqual({
      status: "not_found",
      quote: "要求精通 Rust"
    });
  });

  it("summarizes grounding with allLocated only when every quote is found", () => {
    const summary = diagnoseEvidenceGrounding(RAW_JD, ["负责后端服务开发", "不存在的引用", "   "]);
    expect(summary.located).toHaveLength(1);
    expect(summary.notFound).toHaveLength(1);
    expect(summary.empty).toHaveLength(1);
    expect(summary.allLocated).toBe(false);
    expect(summary.algorithm).toBe("careeradapt-evidence-diagnostics-v1");

    const clean = diagnoseEvidenceGrounding(RAW_JD, ["负责后端服务开发", "3 年以上 Go 经验"]);
    expect(clean.allLocated).toBe(true);
  });

  it("attaches spans to patch evidence only when the quote is located", () => {
    const located = attachSpanToPatchEvidence(RAW_JD, { sourceQuote: "负责后端服务开发" });
    expect(located).toMatchObject({ sourceSpan: { text: "负责后端服务开发" } });

    expect(attachSpanToPatchEvidence(RAW_JD, { sourceQuote: "不存在" }))
      .toEqual({ status: "not_found", quote: "不存在" });
    expect(attachSpanToPatchEvidence(RAW_JD, { sourceQuote: "  " }))
      .toEqual({ status: "empty_quote" });
  });

  it("keeps locateSourceQuote behavior stable (sourceSpan invariants)", () => {
    const direct = diagnoseEvidenceLocation("ABCDEF", "CDE");
    if (direct.status !== "located") throw new Error("expected located");
    expect(direct.span).toEqual({ start: 2, end: 5, text: "CDE" });
  });
});
