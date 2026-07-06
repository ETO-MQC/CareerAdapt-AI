import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema } from "./common";

export const ApplicationPreparationSchemaVersionSchema = z.literal("application-preparation-v1");

export const ApplicationMaterialStatusSchema = z.enum([
  "not_started",
  "generating",
  "draft",
  "completed",
  "stale",
  "blocked",
  "not_needed"
]);

export const MaterialGuardStatusSchema = z.enum([
  "unchecked",
  "allowed",
  "needs_edit",
  "blocked"
]);

export const MaterialLanguageSchema = z.enum(["zh", "en"]);

export const ApplicationMaterialTypeSchema = z.enum([
  "cover_letter",
  "application_email",
  "self_introduction",
  "interview_questions",
  "star_story"
]);

export const MaterialEvidenceSourceTypeSchema = z.enum([
  "career_fact",
  "resume_block",
  "job_requirement",
  "user_confirmed"
]);

export const MaterialEvidenceRefSchema = z.object({
  factId: z.string().min(1).optional(),
  contentItemId: z.string().min(1).optional(),
  requirementId: z.string().min(1).optional(),
  quote: z.string().min(1),
  sourceType: MaterialEvidenceSourceTypeSchema,
  label: z.string().min(1).max(120).optional()
});

export const ApplicationFactGapSchema = z.object({
  id: z.string().min(1),
  applicationId: z.string().min(1),
  requirementId: z.string().min(1).optional(),
  materialType: z.string().min(1),
  description: z.string().min(1),
  missingFactType: z.enum([
    "skill",
    "metric",
    "responsibility",
    "result",
    "motivation",
    "company_knowledge",
    "language",
    "other"
  ]),
  status: z.enum(["open", "resolved", "ignored"]),
  createdAt: IsoDateStringSchema,
  resolvedAt: IsoDateStringSchema.optional()
});

export const MaterialVersionSnapshotSchema = z.object({
  id: z.string().min(1),
  generationVersion: z.number().int().min(1),
  status: ApplicationMaterialStatusSchema,
  content: z.unknown(),
  guardStatus: MaterialGuardStatusSchema,
  guardReasons: z.array(z.string()).default([]),
  createdAt: IsoDateStringSchema,
  reason: z.enum(["generated", "user_edit", "restored", "regenerated"]).optional()
});

const BaseApplicationMaterialFields = {
  id: z.string().min(1),
  materialType: ApplicationMaterialTypeSchema,
  status: ApplicationMaterialStatusSchema,
  basedOnRevisionId: z.string().min(1),
  basedOnBranchRevision: z.number().int().min(0),
  basedOnPresentationRevision: z.number().int().min(0).optional(),
  basedOnRequirementsHash: z.string().min(8),
  basedOnExportRecordId: z.string().min(1).optional(),
  generatedContent: z.unknown(),
  currentContent: z.unknown(),
  evidenceRefs: z.array(MaterialEvidenceRefSchema).default([]),
  factGapIds: z.array(z.string().min(1)).default([]),
  guardStatus: MaterialGuardStatusSchema,
  guardReasons: z.array(z.string()).default([]),
  guardVersion: z.string().min(1).optional(),
  generationVersion: z.number().int().min(1),
  userEdited: z.boolean(),
  generatedAt: IsoDateStringSchema.optional(),
  updatedAt: IsoDateStringSchema,
  completedAt: IsoDateStringSchema.optional(),
  history: z.array(MaterialVersionSnapshotSchema).max(5).default([])
} as const;

export const BaseApplicationMaterialSchema = z.object(BaseApplicationMaterialFields);

export const CoverLetterContentSchema = z.object({
  salutation: z.string().min(1),
  opening: z.string().min(1),
  bodyParagraphs: z.array(z.string().min(1)).min(1).max(6),
  closing: z.string().min(1),
  signatureName: z.string().min(1)
});

export const CoverLetterMaterialSchema = z.object(BaseApplicationMaterialFields).extend({
  materialType: z.literal("cover_letter"),
  language: MaterialLanguageSchema,
  generatedContent: CoverLetterContentSchema,
  currentContent: CoverLetterContentSchema
});

export const ApplicationEmailContentSchema = z.object({
  subject: z.string().min(1).max(180),
  greeting: z.string().min(1),
  bodyParagraphs: z.array(z.string().min(1)).min(1).max(5),
  attachmentMentions: z.array(z.string().min(1)).default([]),
  closing: z.string().min(1),
  senderName: z.string().min(1)
});

export const ApplicationEmailMaterialSchema = z.object(BaseApplicationMaterialFields).extend({
  materialType: z.literal("application_email"),
  language: MaterialLanguageSchema,
  tone: z.enum(["brief", "formal"]),
  recipientEmail: z.string().max(320).optional(),
  generatedContent: ApplicationEmailContentSchema,
  currentContent: ApplicationEmailContentSchema
});

export const SelfIntroductionContentSchema = z.object({
  opening: z.string().min(1),
  education: z.string().optional(),
  relevantExperience: z.string().min(1),
  strengths: z.array(z.string().min(1)).default([]),
  roleFit: z.string().min(1),
  closing: z.string().min(1),
  estimatedSeconds: z.number().int().min(10).max(120)
});

export const SelfIntroductionMaterialSchema = z.object(BaseApplicationMaterialFields).extend({
  materialType: z.literal("self_introduction"),
  language: MaterialLanguageSchema,
  durationSeconds: z.union([z.literal(30), z.literal(60)]),
  generatedContent: SelfIntroductionContentSchema,
  currentContent: SelfIntroductionContentSchema
});

export const InterviewQuestionCategorySchema = z.enum([
  "requirement_based",
  "resume_based",
  "verification",
  "behavioral"
]);

export const InterviewQuestionItemSchema = z.object({
  id: z.string().min(1),
  category: InterviewQuestionCategorySchema,
  question: z.string().min(1),
  whyAsked: z.string().min(1),
  requirementIds: z.array(z.string().min(1)).default([]),
  contentItemIds: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(MaterialEvidenceRefSchema).default([]),
  answerOutline: z.array(z.string().min(1)).default([]),
  preparationStatus: z.enum(["not_started", "draft", "prepared", "needs_fact"]),
  userNotes: z.string().max(2000).optional()
});

export const InterviewQuestionSetContentSchema = z.object({
  questions: z.array(InterviewQuestionItemSchema).min(1)
});

export const InterviewQuestionSetMaterialSchema = z.object(BaseApplicationMaterialFields).extend({
  materialType: z.literal("interview_questions"),
  generatedContent: InterviewQuestionSetContentSchema,
  currentContent: InterviewQuestionSetContentSchema
});

export const StarStoryContentSchema = z.object({
  title: z.string().min(1),
  sourceContentItemIds: z.array(z.string().min(1)).min(1),
  requirementIds: z.array(z.string().min(1)).default([]),
  situation: z.string().min(1),
  task: z.string().min(1),
  action: z.string().min(1),
  result: z.string().min(1),
  missingParts: z.array(z.enum(["situation", "task", "action", "result"])).default([])
});

export const StarStoryMaterialSchema = z.object(BaseApplicationMaterialFields).extend({
  materialType: z.literal("star_story"),
  generatedContent: StarStoryContentSchema,
  currentContent: StarStoryContentSchema
});

export const ApplicationPreparationChecklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: ApplicationMaterialStatusSchema,
  level: z.enum(["ready", "needs_attention", "blocked"]),
  materialType: z.string().min(1).optional(),
  message: z.string().min(1)
});

export const ApplicationPreparationChecklistSchema = z.object({
  level: z.enum(["ready", "needs_attention", "blocked"]),
  items: z.array(ApplicationPreparationChecklistItemSchema).default([]),
  updatedAt: IsoDateStringSchema
});

export const ApplicationPreparationBasedOnSchema = z.object({
  branchId: z.string().min(1),
  revisionId: z.string().min(1),
  branchRevision: z.number().int().min(0),
  presentationRevision: z.number().int().min(0),
  requirementsHash: z.string().min(8),
  exportRecordId: z.string().min(1).optional()
});

export const ApplicationPreparationMaterialsSchema = z.object({
  coverLetters: z.object({
    zh: CoverLetterMaterialSchema.optional(),
    en: CoverLetterMaterialSchema.optional()
  }).default({}),
  applicationEmails: z.object({
    zh_brief: ApplicationEmailMaterialSchema.optional(),
    zh_formal: ApplicationEmailMaterialSchema.optional(),
    en_brief: ApplicationEmailMaterialSchema.optional(),
    en_formal: ApplicationEmailMaterialSchema.optional()
  }).default({}),
  selfIntroductions: z.object({
    zh30: SelfIntroductionMaterialSchema.optional(),
    zh60: SelfIntroductionMaterialSchema.optional(),
    en30: SelfIntroductionMaterialSchema.optional(),
    en60: SelfIntroductionMaterialSchema.optional()
  }).default({}),
  interviewQuestions: z.array(InterviewQuestionSetMaterialSchema).default([]),
  starStories: z.array(StarStoryMaterialSchema).default([])
});

export const ApplicationPreparationPackSchema = EntityBaseSchema.extend({
  schemaVersion: ApplicationPreparationSchemaVersionSchema,
  applicationId: z.string().min(1),
  profileId: z.string().min(1),
  jobId: z.string().min(1),
  basedOn: ApplicationPreparationBasedOnSchema,
  materials: ApplicationPreparationMaterialsSchema,
  factGaps: z.array(ApplicationFactGapSchema).default([]),
  checklist: ApplicationPreparationChecklistSchema,
  version: z.number().int().min(1)
});

export type ApplicationMaterialStatus = z.infer<typeof ApplicationMaterialStatusSchema>;
export type MaterialGuardStatus = z.infer<typeof MaterialGuardStatusSchema>;
export type MaterialLanguage = z.infer<typeof MaterialLanguageSchema>;
export type ApplicationMaterialType = z.infer<typeof ApplicationMaterialTypeSchema>;
export type MaterialEvidenceRef = z.infer<typeof MaterialEvidenceRefSchema>;
export type ApplicationFactGap = z.infer<typeof ApplicationFactGapSchema>;
export type MaterialVersionSnapshot = z.infer<typeof MaterialVersionSnapshotSchema>;
export type BaseApplicationMaterial = z.infer<typeof BaseApplicationMaterialSchema>;
export type CoverLetterContent = z.infer<typeof CoverLetterContentSchema>;
export type CoverLetterMaterial = z.infer<typeof CoverLetterMaterialSchema>;
export type ApplicationEmailContent = z.infer<typeof ApplicationEmailContentSchema>;
export type ApplicationEmailMaterial = z.infer<typeof ApplicationEmailMaterialSchema>;
export type SelfIntroductionContent = z.infer<typeof SelfIntroductionContentSchema>;
export type SelfIntroductionMaterial = z.infer<typeof SelfIntroductionMaterialSchema>;
export type InterviewQuestionCategory = z.infer<typeof InterviewQuestionCategorySchema>;
export type InterviewQuestionItem = z.infer<typeof InterviewQuestionItemSchema>;
export type InterviewQuestionSetContent = z.infer<typeof InterviewQuestionSetContentSchema>;
export type InterviewQuestionSetMaterial = z.infer<typeof InterviewQuestionSetMaterialSchema>;
export type StarStoryContent = z.infer<typeof StarStoryContentSchema>;
export type StarStoryMaterial = z.infer<typeof StarStoryMaterialSchema>;
export type ApplicationPreparationChecklistItem = z.infer<typeof ApplicationPreparationChecklistItemSchema>;
export type ApplicationPreparationChecklist = z.infer<typeof ApplicationPreparationChecklistSchema>;
export type ApplicationPreparationBasedOn = z.infer<typeof ApplicationPreparationBasedOnSchema>;
export type ApplicationPreparationMaterials = z.infer<typeof ApplicationPreparationMaterialsSchema>;
export type ApplicationPreparationPack = z.infer<typeof ApplicationPreparationPackSchema>;
