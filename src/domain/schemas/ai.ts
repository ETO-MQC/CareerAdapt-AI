import { z } from "zod";
import { EntityBaseSchema, FactStatementSchema, RiskLevelSchema } from "./common";

export const AiTaskSchema = z.enum([
  "health-check",
  "profile-builder",
  "jd-analyzer",
  "evidence-matcher",
  "resume-tailor",
  "fact-guard"
]);

export const AiSuggestionTypeSchema = z.enum([
  "rewrite",
  "supplement",
  "trim",
  "reorder",
  "risk",
  "follow_up"
]);

export const AiSuggestionStatusSchema = z.enum([
  "draft",
  "accepted",
  "partially_accepted",
  "rejected",
  "edited"
]);

export const AiSuggestionSchema = EntityBaseSchema.extend({
  targetPath: z.string().min(1),
  type: AiSuggestionTypeSchema,
  original: z.string().min(1),
  suggested: z.string().min(1),
  reason: z.string().min(1),
  jobRequirementIds: z.array(z.string()).default([]),
  factIds: z.array(z.string()).default([]),
  newFacts: z.array(FactStatementSchema).default([]),
  risk: RiskLevelSchema,
  status: AiSuggestionStatusSchema,
  promptVersion: z.string().min(1)
});

export const AiLogStatusSchema = z.enum(["success", "validation_failed", "provider_failed"]);

export const AiLogSchema = EntityBaseSchema.extend({
  task: AiTaskSchema,
  provider: z.string().min(1),
  promptVersion: z.string().min(1),
  inputSummary: z.string(),
  outputSummary: z.string().optional(),
  status: AiLogStatusSchema,
  error: z.string().optional()
});

export const AiHealthCheckSchema = z.object({
  status: z.literal("ok"),
  provider: z.string().min(1),
  checkedAt: z.string().datetime({ offset: true })
});

export type AiTask = z.infer<typeof AiTaskSchema>;
export type AiSuggestionType = z.infer<typeof AiSuggestionTypeSchema>;
export type AiSuggestionStatus = z.infer<typeof AiSuggestionStatusSchema>;
export type AiSuggestion = z.infer<typeof AiSuggestionSchema>;
export type AiLogStatus = z.infer<typeof AiLogStatusSchema>;
export type AiLog = z.infer<typeof AiLogSchema>;
export type AiHealthCheck = z.infer<typeof AiHealthCheckSchema>;
