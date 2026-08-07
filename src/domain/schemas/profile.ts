import { z } from "zod";
import { EntityBaseSchema, FactStatementSchema, IsoDateStringSchema } from "./common";
import { ResumeBasicsV2Schema, ResumeItemV2Schema } from "./resumeV2";
import { ResumeJsonV2MappingTraceSchema } from "./resumeJsonV2";
import { ProfileIntakeProvenanceSchema } from "@/domain/profileIntake/ProfileIntakeProvenance";

const PersistedResumeSourceRangeSchema = z.object({
  blockId: z.string().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0)
}).strict().refine((range) => range.end > range.start, {
  message: "source range end must be greater than start"
});

export const ExperienceTypeSchema = z.enum([
  "education",
  "internship",
  "project",
  "competition",
  "campus",
  "volunteer",
  "work",
  "other"
]);

export const EvidenceTypeSchema = z.enum(["file", "link", "text", "system"]);

export const PrivacyLevelSchema = z.enum(["private", "workspace", "public"]);

export const BasicInfoSchema = z.object({
  name: z.string().min(1),
  headline: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  location: z.string().optional(),
  summary: z.string().optional(),
  links: z.array(z.string()).default([])
});

export const CareerPreferenceSchema = z.object({
  targetRoles: z.array(z.string()).default([]),
  targetCities: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([])
});

export const ResumeDraftSchema = EntityBaseSchema.extend({
  targetRole: z.string().optional(),
  text: z.string().min(1),
  factIds: z.array(z.string()).default([])
});

export const ExperienceSchema = EntityBaseSchema.extend({
  type: ExperienceTypeSchema,
  organization: z.string().min(1),
  role: z.string().min(1),
  location: z.string().optional(),
  degree: z.string().optional(),
  major: z.string().optional(),
  courses: z.array(z.string()).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  facts: z.array(FactStatementSchema).min(1),
  resumeDrafts: z.array(ResumeDraftSchema).default([]),
  tags: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([])
});

export const EvidenceSchema = EntityBaseSchema.extend({
  type: EvidenceTypeSchema,
  title: z.string().min(1),
  filePath: z.string().optional(),
  url: z.string().optional(),
  extractedText: z.string().optional(),
  privacyLevel: PrivacyLevelSchema,
  verifiedAt: IsoDateStringSchema.optional()
});

export const SkillSchema = EntityBaseSchema.extend({
  name: z.string().min(1),
  level: z.enum(["basic", "familiar", "proficient"]).optional(),
  evidenceIds: z.array(z.string()).default([]),
  fact: FactStatementSchema.optional(),
  lastUsedAt: z.string().optional()
});

export const CertificateSchema = EntityBaseSchema.extend({
  name: z.string().min(1),
  issuer: z.string().optional(),
  issuedAt: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
  fact: FactStatementSchema.optional()
});

export const ProfileStructuredFactSchema = z.object({
  data: ResumeItemV2Schema,
  factIds: z.array(z.string().min(1)).default([]),
  sourceBlockIds: z.array(z.string().min(1)).default([]),
  sourceRanges: z.array(PersistedResumeSourceRangeSchema).default([]),
  sourceExcerpt: z.string().min(1).optional(),
  mappingTrace: z.array(ResumeJsonV2MappingTraceSchema).default([]),
  provenance: z.array(ProfileIntakeProvenanceSchema).optional()
}).strict();

export const VersionCreatedReasonSchema = z.enum([
  "initial",
  "manual_snapshot",
  "resume_import",
  "agent_created",
  "conflict_fork"
]);

export const CareerPersonSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  currentProfileId: z.string().min(1),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  archivedAt: IsoDateStringSchema.optional(),
  /** Recycle Bin lifecycle marker. Kept separate from archivedAt for compatibility. */
  trashedAt: IsoDateStringSchema.optional()
}).strict();

export const CareerProfileSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("career-profile-v2").optional(),
  name: z.string().min(1),
  basics: BasicInfoSchema,
  preference: CareerPreferenceSchema,
  version: z.number().int().min(1),
  experiences: z.array(ExperienceSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  certificates: z.array(CertificateSchema).default([]),
  evidences: z.array(EvidenceSchema).default([]),
  unclassifiedBlocks: z.array(z.string()).default([]),
  structuredFacts: z.array(ProfileStructuredFactSchema).optional(),
  structuredBasics: ResumeBasicsV2Schema.optional(),
  /** Stable person identity. `version` remains the internal write revision. */
  personId: z.string().min(1).optional(),
  profileVersionNumber: z.number().int().min(1).optional(),
  profileVersionLabel: z.string().min(1).max(80).optional(),
  parentProfileId: z.string().min(1).optional(),
  isCurrent: z.boolean().optional(),
  versionCreatedReason: VersionCreatedReasonSchema.optional(),
  archivedAt: IsoDateStringSchema.optional(),
  /** Recycle Bin lifecycle marker. Kept separate from archivedAt for compatibility. */
  trashedAt: IsoDateStringSchema.optional()
});

export const ActiveCareerContextSchema = z.object({
  schemaVersion: z.literal("active-career-v1"),
  personId: z.string().min(1),
  profileId: z.string().min(1),
  profileVersionNumber: z.number().int().min(1),
  profileRevision: z.number().int().min(0),
  selectedAt: IsoDateStringSchema
}).strict();

export const ActiveProfileContextSchema = z.object({
  schemaVersion: z.literal("active-profile-v1"),
  profileId: z.string().min(1)
});

export type ExperienceType = z.infer<typeof ExperienceTypeSchema>;
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
export type PrivacyLevel = z.infer<typeof PrivacyLevelSchema>;
export type VersionCreatedReason = z.infer<typeof VersionCreatedReasonSchema>;
export type CareerPerson = z.infer<typeof CareerPersonSchema>;
export type BasicInfo = z.infer<typeof BasicInfoSchema>;
export type CareerPreference = z.infer<typeof CareerPreferenceSchema>;
export type ResumeDraft = z.infer<typeof ResumeDraftSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Certificate = z.infer<typeof CertificateSchema>;
export type ProfileStructuredFact = z.infer<typeof ProfileStructuredFactSchema>;
export type CareerProfile = z.infer<typeof CareerProfileSchema>;
export type CareerProfileV1 = Omit<CareerProfile, "schemaVersion" | "structuredFacts" | "structuredBasics"> & { schemaVersion?: undefined };
export type CareerProfileV2 = CareerProfile & { schemaVersion: "career-profile-v2"; structuredFacts: NonNullable<CareerProfile["structuredFacts"]>; structuredBasics: NonNullable<CareerProfile["structuredBasics"]> };
export type StoredCareerProfile = CareerProfileV1 | CareerProfileV2;
export type ActiveProfileContext = z.infer<typeof ActiveProfileContextSchema>;
export type ActiveCareerContext = z.infer<typeof ActiveCareerContextSchema>;
