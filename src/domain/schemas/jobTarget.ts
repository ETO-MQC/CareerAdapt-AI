import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema } from "./common";
import { JobRequirementSchema } from "./job";
import { JobRequirementGraphV3Schema } from "./jobOptimizationV3";
import { JobRequirementGraphV4Schema } from "./jobOptimizationV4";

export const JobTargetSourceTypeSchema = z.enum([
  "saved_job",
  "pasted_jd",
  "manual_target",
  "external_application"
]);

export const JobTargetPersistenceSchema = z.enum(["ask", "save", "session_only"]);

/**
 * A target is the durable context used to reproduce a tailored resume. It is
 * deliberately separate from JobDescription: a pasted target may be durable
 * without becoming a row in the user's Job list.
 */
export const JobTargetSnapshotSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("job-target-snapshot-v1"),
  version: z.number().int().min(1).default(1),
  sourceType: JobTargetSourceTypeSchema,
  rawText: z.string().min(1).max(24_000),
  rawTextHash: z.string().min(8),
  title: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  normalizedRequirements: z.array(JobRequirementSchema).default([]),
  requirementGraph: z.union([JobRequirementGraphV3Schema, JobRequirementGraphV4Schema]).optional(),
  targetSignals: z.array(z.string().min(1)).default([]),
  sourceUrl: z.string().url().optional(),
  capturedAt: IsoDateStringSchema,
  sourceJobId: z.string().min(1).optional(),
  sourceJobRevision: z.string().min(1).optional()
}).strict();

export type JobTargetSourceType = z.infer<typeof JobTargetSourceTypeSchema>;
export type JobTargetPersistence = z.infer<typeof JobTargetPersistenceSchema>;
export type JobTargetSnapshot = z.infer<typeof JobTargetSnapshotSchema>;
