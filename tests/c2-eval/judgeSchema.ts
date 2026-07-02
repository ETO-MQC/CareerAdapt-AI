import { z } from "zod";

/**
 * C2 AI Judge 输入。
 * systemDisposition 来自 Fact Guard 真实执行结果，不由 Judge 生成。
 */
export const C2JudgeInputSchema = z.object({
  /** 原始文本 */
  originalText: z.string().min(1),
  /** 建议修改后的文本 */
  checkedText: z.string().min(1),
  /** 来自人工定义的验收案例 */
  expectedDisposition: z.enum(["pass", "block"]),
  /** 来自 Fact Guard 真实执行结果（pass=规则通过, block=规则阻断） */
  systemDisposition: z.enum(["pass", "block"]),
  /** 已确认证据引用 */
  usedEvidenceRefs: z.array(z.object({
    refKey: z.string().min(1),
    factText: z.string().min(1)
  })),
  /** Fact Guard 的 findings */
  guardFindings: z.array(z.object({
    type: z.string(),
    text: z.string(),
    severity: z.string(),
    allowed: z.boolean(),
    message: z.string()
  }))
});

export type C2JudgeInput = z.infer<typeof C2JudgeInputSchema>;

/**
 * C2 AI Judge 输出。
 *
 * Judge 独立评估建议安全性，给出 recommendedDisposition。
 * agreesWithSystemDisposition = (recommendedDisposition === systemDisposition)。
 */
export const C2JudgeOutputSchema = z.object({
  /** Judge 独立评估：该建议是否安全可放行 */
  suggestionSafe: z.boolean(),
  /** Judge 推荐的处置 */
  recommendedDisposition: z.enum(["pass", "block"]),
  /** Judge 是否同意 Fact Guard 的系统处置 */
  agreesWithSystemDisposition: z.boolean(),
  /** Fact Guard 的 findings 是否完整覆盖了所有风险点 */
  findingsComplete: z.boolean(),
  /** 建议内容是否全部基于已确认证据 */
  evidenceGrounded: z.boolean(),
  /** 建议是否仅作用于草稿，未触及正式母档案 */
  scopeIsolationSafe: z.boolean(),
  /** 总体通过：agreesWithSystemDisposition && evidenceGrounded && scopeIsolationSafe */
  passed: z.boolean(),
  /** 发现的问题 */
  issues: z.array(z.string()).default([])
});

export type C2JudgeOutput = z.infer<typeof C2JudgeOutputSchema>;
