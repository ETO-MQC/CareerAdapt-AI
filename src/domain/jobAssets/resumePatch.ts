import { z } from "zod";
import { IsoDateStringSchema, SourceSpanSchema } from "@/domain/schemas/common";

/**
 * V4-P1 阶段 6a：简历 patch 结构。
 *
 * Adapted from MyCareer (https://github.com/low-hands/MyCareer),
 * MIT License, Copyright (c) 2026 Rui Guo —
 * agent/workflows/resume_tailoring/contracts.py 的
 * TailoringSupportEvidence / ResumeTailoringChange / AcceptedTailoringChange /
 * FinalizedResumeDocument / ResumeReviewIssue / ResumeReviewResult。
 *
 * 边界（v4-plan.md §11 V4-P1）：
 * - 只定义结构与不变量，不实现"应用到简历"的执行路径——改写用户可见内容
 *   仍由现有 Job Optimization / 分支确认流程负责，本模块的结果不落库；
 * - 证据引用保留 CareerAdapt 的 SourceSpan（原文定位），与
 *   `locateSourceQuote` 的既有行为兼容；
 * - 任何 patch op 必须携带至少一条支撑证据，且不得是无变化的 no-op。
 */

export const RESUME_PATCH_ALGORITHM = "careeradapt-resume-patch-v1";

export const ResumePatchEvidenceQualitySchema = z.enum(["exact", "normalized", "ocr_unverified"]);

/** patch 证据：定位串 + 原文引用 + 可选 SourceSpan（由证据定位诊断回填）。 */
export const ResumePatchSupportEvidenceSchema = z.object({
  sourceLocator: z.string().min(1).max(300),
  sourceQuote: z.string().min(1).max(500),
  evidenceQuality: ResumePatchEvidenceQualitySchema.default("exact"),
  page: z.number().int().min(1).optional(),
  /** 原文原子区间；与 sourceQuote 指向同一段原文。 */
  sourceSpan: SourceSpanSchema.optional()
}).strict();

export type ResumePatchSupportEvidence = z.infer<typeof ResumePatchSupportEvidenceSchema>;

/** 单条改写提议：目标位置 + 原文引用 + 拟替换文本 + 依据。 */
export const ResumePatchOpSchema = z.object({
  targetLocator: z.string().min(1).max(300),
  originalQuote: z.string().min(1).max(500).optional(),
  proposedText: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(1500),
  addressesRequirementIds: z.array(z.string().min(1)).max(5).default([]),
  supportEvidence: z.array(ResumePatchSupportEvidenceSchema).min(1).max(5)
}).strict().superRefine((op, context) => {
  if (op.originalQuote !== undefined && op.originalQuote === op.proposedText) {
    context.addIssue({
      code: "custom",
      path: ["proposedText"],
      message: "resume patch op must change the text (no-op rejected)"
    });
  }
});

export type ResumePatchOp = z.infer<typeof ResumePatchOpSchema>;

/** 用户接受的提议：按下标引用 op，接受记录本身不可再改内容。 */
export const ResumePatchAcceptanceSchema = z.object({
  changeIndex: z.number().int().min(1),
  op: ResumePatchOpSchema
}).strict();

export type ResumePatchAcceptance = z.infer<typeof ResumePatchAcceptanceSchema>;

/** 定稿产物：整份 markdown + 应用的 op 下标 + 审阅警告。 */
export const ResumePatchFinalizationSchema = z.object({
  markdown: z.string().min(1).max(500_000),
  appliedChangeIndices: z.array(z.number().int().min(1)).min(1).max(30),
  warnings: z.array(z.string().min(1)).max(10).default([]),
  draftFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  finalizedAt: IsoDateStringSchema
}).strict();

export type ResumePatchFinalization = z.infer<typeof ResumePatchFinalizationSchema>;

export const ResumePatchReviewCategorySchema = z.enum([
  "unsupported_fact",
  "meaning_changed",
  "jd_misalignment",
  "important_detail_lost",
  "keyword_stuffing",
  "unclear_expression",
  "change_set_mismatch"
]);

export const ResumePatchReviewIssueSchema = z.object({
  category: ResumePatchReviewCategorySchema,
  severity: z.enum(["blocking", "warning"]),
  changeIndex: z.number().int().min(1).optional(),
  sourceQuote: z.string().min(1).max(500).optional(),
  explanation: z.string().min(1).max(1500),
  revisionInstruction: z.string().min(1).max(1000).optional()
}).strict();

export type ResumePatchReviewIssue = z.infer<typeof ResumePatchReviewIssueSchema>;

export const ResumePatchReviewResultSchema = z.object({
  verdict: z.enum(["pass", "revise", "block"]),
  summary: z.string().min(1).max(2000),
  issues: z.array(ResumePatchReviewIssueSchema).max(30).default([])
}).strict().superRefine((result, context) => {
  const hasBlocking = result.issues.some((issue) => issue.severity === "blocking");
  if (result.verdict === "pass" && hasBlocking) {
    context.addIssue({
      code: "custom",
      path: ["verdict"],
      message: "pass verdict cannot contain blocking issues"
    });
  }
  if ((result.verdict === "revise" || result.verdict === "block") && !hasBlocking) {
    context.addIssue({
      code: "custom",
      path: ["verdict"],
      message: "revise and block verdicts require a blocking issue"
    });
  }
});

export type ResumePatchReviewResult = z.infer<typeof ResumePatchReviewResultSchema>;

/** 接受下标是否落在 op 集合范围内（1-based）。 */
export function isValidPatchAcceptance(ops: readonly ResumePatchOp[], changeIndex: number): boolean {
  return changeIndex >= 1 && changeIndex <= ops.length;
}

/** 定稿与接受集合的一致性：appliedChangeIndices 必须都能引用到 ops。 */
export function finalizationMatchesOps(
  ops: readonly ResumePatchOp[],
  finalization: ResumePatchFinalization
): boolean {
  return finalization.appliedChangeIndices.every((index) => isValidPatchAcceptance(ops, index));
}
