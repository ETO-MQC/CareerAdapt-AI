import { z } from "zod";
import { MatchLevelSchema, MatchRiskSchema } from "@/domain/schemas";

/**
 * AI Judge 输入：只包含岗位要求、已确认事实和匹配结果。
 * 不包含生成过程或内部状态。
 */
export const C1JudgeInputSchema = z.object({
  requirement: z.object({
    description: z.string().min(1),
    hardConstraint: z.boolean(),
    keywords: z.array(z.string()).default([])
  }),
  confirmedFacts: z.array(z.object({
    refKey: z.string().min(1),
    factText: z.string().min(1)
  })),
  matchResult: z.object({
    matchLevel: MatchLevelSchema,
    riskLevel: z.enum(["low", "medium", "high"]),
    risks: z.array(MatchRiskSchema).default([]),
    evidenceRefKeys: z.array(z.string()).default([]),
    explanation: z.string().min(1)
  })
});

export type C1JudgeInput = z.infer<typeof C1JudgeInputSchema>;

/**
 * AI Judge 输出 Schema。
 */
export const C1JudgeOutputSchema = z.object({
  passed: z.boolean(),
  evidenceGrounding: z.number().min(0).max(5),
  matchLevelReasonableness: z.number().min(0).max(5),
  riskAssessment: z.number().min(0).max(5),
  explanationQuality: z.number().min(0).max(5),
  hallucinationSafety: z.number().min(0).max(5),
  criticalFailures: z.array(z.string()).default([]),
  issues: z.array(z.string()).default([]),
  recommendedMatchLevel: MatchLevelSchema.optional(),
  recommendedRiskLevel: z.enum(["low", "medium", "high"]).optional()
});

export type C1JudgeOutput = z.infer<typeof C1JudgeOutputSchema>;
