import { z } from "zod";
import { EntityBaseSchema, FactStatementSchema, IsoDateStringSchema } from "./common";

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

export const CareerProfileSchema = EntityBaseSchema.extend({
  name: z.string().min(1),
  basics: BasicInfoSchema,
  preference: CareerPreferenceSchema,
  version: z.number().int().min(1),
  experiences: z.array(ExperienceSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  certificates: z.array(CertificateSchema).default([]),
  evidences: z.array(EvidenceSchema).default([]),
  unclassifiedBlocks: z.array(z.string()).default([])
});

export type ExperienceType = z.infer<typeof ExperienceTypeSchema>;
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
export type PrivacyLevel = z.infer<typeof PrivacyLevelSchema>;
export type BasicInfo = z.infer<typeof BasicInfoSchema>;
export type CareerPreference = z.infer<typeof CareerPreferenceSchema>;
export type ResumeDraft = z.infer<typeof ResumeDraftSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Certificate = z.infer<typeof CertificateSchema>;
export type CareerProfile = z.infer<typeof CareerProfileSchema>;
