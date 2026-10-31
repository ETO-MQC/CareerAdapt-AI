import { z } from "zod";
import type { CareerProfile, JobDescription, ResumeBranch, ResumeRevision, ApplicationRecord, ActiveCareerContext } from "../../src/domain/schemas";

export const DomainReadSchema = z.object({
  kind: z.enum(["profile", "facts", "jobs", "branches", "revisions", "applications", "context"]),
  profileId: z.string().min(1),
  branchId: z.string().min(1).optional()
}).strict();
export const DomainActionSchema = z.object({
  kind: z.enum(["profileIntake", "profileReconciliation", "resumeImport", "jobParsing", "branchCreation", "tailoring", "resumeConfirmation", "revisionCreation", "export"]),
  profileId: z.string().min(1), operationId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  proposalId: z.string().min(1)
}).strict();
export type ReadResult = CareerProfile | CareerProfile["experiences"] | JobDescription[] | ResumeBranch[] | ResumeRevision[] | ApplicationRecord[] | ActiveCareerContext | undefined;
export interface CareerDomainClient {
  read(request: z.infer<typeof DomainReadSchema>): Promise<ReadResult>;
  act(request: z.infer<typeof DomainActionSchema>): Promise<{ operationId: string; revision: number }>;
}
/** Validation spike only; deliberately no permissive dispatcher to arbitrary Repository methods. */
export function rejectUnimplementedAction(request: unknown): never {
  DomainActionSchema.parse(request);
  throw new Error("domain_action_not_implemented: canonical Repository adapter required");
}
