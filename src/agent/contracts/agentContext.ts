import { z } from "zod";

export const AgentPageContextSchema = z.object({
  pathname: z.string().startsWith("/"),
  title: z.string().max(160).optional(),
  activeProfileId: z.string().min(1).optional(),
  activeResumeId: z.string().min(1).optional(),
  activeJobId: z.string().min(1).optional(),
  selectedArtifactId: z.string().min(1).optional(),
  query: z.record(z.string(), z.string()).default({})
}).strict();

export type AgentPageContext = z.infer<typeof AgentPageContextSchema>;

export function serializeAgentPageContext(value: AgentPageContext) {
  return AgentPageContextSchema.parse(value);
}
