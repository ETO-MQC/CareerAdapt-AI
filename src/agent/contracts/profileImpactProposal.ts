import { z } from "zod";
import { ResumeTailoringDiffSchema } from "@/domain/schemas";

export const ProfileImpactProposalSchema = z.object({
  id: z.string().min(1), sessionId: z.string().min(1), personId: z.string().min(1), profileId: z.string().min(1),
  profileRevision: z.number().int().min(1), evidenceFingerprint: z.string().min(1), jobId: z.string().min(1),
  jobFingerprint: z.string().min(1), branchId: z.string().min(1), branchRevision: z.number().int().min(0),
  revisionId: z.string().min(1), itemId: z.string().min(1), sectionType: z.string().min(1),
  title: z.string().min(1), body: z.string().min(1), requirement: z.string().min(1),
  addDecision: z.enum(["pending", "accept", "edit", "reject"]).default("pending"),
  editableDescription: z.string().min(1).optional(), editedItemText: z.string().min(1).optional(),
  diffs: z.array(ResumeTailoringDiffSchema).default([]),
  generationStatus: z.enum(["not_started", "ready", "empty"]).default("not_started"),
  generationDiagnostics: z.array(z.string()).default([]),
  reviews: z.array(z.object({ diffId: z.string().min(1), decision: z.enum(["accept", "edit", "reject"]),
    editedValue: z.union([z.string(), z.array(z.string())]).optional() }).strict()).default([]),
  status: z.enum(["pending", "applied", "ignored"]), resultRevisionId: z.string().optional()
}).strict();
export type ProfileImpactProposal = z.infer<typeof ProfileImpactProposalSchema>;
