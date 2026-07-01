import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema, SourceSpanSchema } from "./common";

export const JobSourceSchema = z.enum(["demo", "manual", "imported_text", "url"]);

export const JobRequirementCategorySchema = z.enum([
  "responsibility",
  "must_have",
  "core_skill",
  "soft_skill",
  "nice_to_have",
  "risk_or_uncertain"
]);

export const PrioritySchema = z.enum(["high", "medium", "low", "must", "important", "nice_to_have", "uncertain"]);

export const MatchStatusSchema = z.enum([
  "strong_match",
  "weak_match",
  "transferable",
  "no_evidence",
  "risk"
]);

export const JobRequirementSchema = EntityBaseSchema.extend({
  category: JobRequirementCategorySchema,
  description: z.string().min(1),
  priority: PrioritySchema,
  hardConstraint: z.boolean(),
  sourceSpan: SourceSpanSchema,
  keywords: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1)
});

export const JobDescriptionSchema = EntityBaseSchema.extend({
  title: z.string().min(1),
  company: z.string().min(1),
  industry: z.string().optional(),
  location: z.string().optional(),
  workType: z.string().optional(),
  rawText: z.string().min(1),
  source: JobSourceSchema,
  parsedAt: IsoDateStringSchema.optional(),
  requirements: z.array(JobRequirementSchema).default([])
});

export const RequirementMatchSchema = EntityBaseSchema.extend({
  requirementId: z.string().min(1),
  experienceIds: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  status: MatchStatusSchema,
  score: z.number().min(0).max(1).optional(),
  explanation: z.string().min(1)
});

export type JobSource = z.infer<typeof JobSourceSchema>;
export type JobRequirementCategory = z.infer<typeof JobRequirementCategorySchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type MatchStatus = z.infer<typeof MatchStatusSchema>;
export type JobRequirement = z.infer<typeof JobRequirementSchema>;
export type JobDescription = z.infer<typeof JobDescriptionSchema>;
export type RequirementMatch = z.infer<typeof RequirementMatchSchema>;
