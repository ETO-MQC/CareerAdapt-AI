import { z } from "zod";

export const AgentArtifactKindSchema = z.enum([
  "resume_import_review",
  "job_semantic_review",
  "job_fit_overview",
  "clarification_questions",
  "tailoring_diff",
  "pdf_preview"
]);

export const AgentArtifactRefSchema = z.object({
  id: z.string().min(1),
  kind: AgentArtifactKindSchema,
  title: z.string().min(1).max(160),
  entityType: z.enum(["resume_import_draft", "resume_branch", "job", "tailoring_session", "export"]),
  entityId: z.string().min(1),
  route: z.string().startsWith("/").optional(),
  status: z.enum(["active", "collapsed", "resolved"]).default("active"),
  summary: z.string().max(600).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export type AgentArtifactRef = z.infer<typeof AgentArtifactRefSchema>;
