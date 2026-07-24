import { z } from "zod";

export const AgentPageContextSchema = z.object({
  pathname: z.string().startsWith("/").optional(),
  route: z.string().startsWith("/").optional(),
  title: z.string().max(160).optional(),
  activeProfileId: z.string().min(1).optional(),
  activeResumeId: z.string().min(1).optional(),
  activeJobId: z.string().min(1).optional(),
  profileId: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(),
  revisionId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  selectedSectionId: z.string().min(1).optional(),
  selectedItemId: z.string().min(1).optional(),
  selectedFieldPath: z.string().min(1).optional(),
  selectedText: z.string().max(8000).optional(),
  templateId: z.string().min(1).optional(),
  dirty: z.boolean().optional(),
  selectedArtifactId: z.string().min(1).optional(),
  query: z.record(z.string(), z.string()).default({})
}).strict().refine((value) => Boolean(value.route ?? value.pathname), {
  message: "Agent page context requires route or pathname."
});

export type AgentPageContext = z.infer<typeof AgentPageContextSchema>;

export function serializeAgentPageContext(value: AgentPageContext) {
  const parsed = AgentPageContextSchema.parse(value);
  return {
    ...parsed,
    route: parsed.route ?? parsed.pathname,
    pathname: parsed.pathname ?? parsed.route
  };
}
