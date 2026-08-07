import { z } from "zod";

const CountMapSchema = z.record(z.string(), z.number().int().min(0));
const ResumeSummarySchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  name: z.string().min(1),
  purpose: z.enum(["general", "job_specific"]),
  revision: z.number().int().min(0),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export const QuickActionContextSnapshotSchema = z.object({
  activePerson: z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    currentProfileId: z.string().min(1)
  }).strict().optional(),
  activeProfile: z.object({
    id: z.string().min(1),
    personId: z.string().min(1),
    displayName: z.string().min(1),
    profileVersionNumber: z.number().int().min(1),
    profileVersionLabel: z.string().min(1).optional(),
    profileRevision: z.number().int().min(0),
    createdAt: z.string().datetime({ offset: true }),
    itemCount: z.number().int().min(0),
    basicFieldCount: z.number().int().min(0).default(0),
    careerItemCount: z.number().int().min(0).default(0),
    confirmedFactCount: z.number().int().min(0).default(0),
    resumeCount: z.number().int().min(0).default(0),
    profileCountsBySection: CountMapSchema
  }).strict().optional(),
  profileVersionNumber: z.number().int().min(1).optional(),
  profileRevision: z.number().int().min(0).optional(),
  profileCountsBySection: CountMapSchema,
  profileItemCount: z.number().int().min(0).default(0),
  basicFieldCount: z.number().int().min(0).default(0),
  careerItemCount: z.number().int().min(0).default(0),
  confirmedFactCount: z.number().int().min(0).default(0),
  resumeCount: z.number().int().min(0).default(0),
  targetPersonId: z.string().min(1).optional(),
  targetProfileId: z.string().min(1).optional(),
  excludedOtherPersonResumeCount: z.number().int().min(0).default(0),
  activeProfileResumeSummaries: z.array(ResumeSummarySchema).default([]),
  samePersonOtherVersionResumeSummaries: z.array(ResumeSummarySchema).default([]),
  resumeSummaries: z.array(ResumeSummarySchema).default([]),
  jobSummaries: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    company: z.string().min(1),
    updatedAt: z.string().datetime({ offset: true })
  }).strict()),
  activeTaskSummary: z.object({
    sessionId: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(["idle", "running", "waiting_for_confirmation", "waiting_for_user", "completed", "failed", "paused"]),
    pinnedPersonId: z.string().min(1).optional(),
    pinnedProfileId: z.string().min(1).optional()
  }).strict().optional()
}).strict();

export type QuickActionContextSnapshot = z.infer<typeof QuickActionContextSnapshotSchema>;
