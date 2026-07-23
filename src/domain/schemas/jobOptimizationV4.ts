import { z } from "zod";
import { SourceSpanSchema } from "./common";
import {
  HiddenSignalSchema,
  JobRequirementGraphV3Schema,
  RequirementGroupSchema,
  RequirementKindV3Schema,
  RequirementNodeV3Schema,
  RequirementPriorityV3Schema,
  RequirementSectionV3Schema,
  VerificationMaterialSchema
} from "./jobOptimizationV3";

export const JdSemanticDispositionSchema = z.enum([
  "heading",
  "context",
  "group_wrapper",
  "requirement",
  "requirement_detail",
  "verification_material",
  "hiring_signal",
  "metadata",
  "excluded",
  "unclassified"
]);

export const JdSemanticGroupRelationSchema = z.enum([
  "all_of",
  "any_of",
  "preferred_any_of",
  "examples",
  "evidence_bundle",
  "topic_list"
]);

export const JdSemanticLexicalSchema = z.object({
  indentation: z.number().int().min(0),
  numberingLevel: z.number().int().min(1).optional(),
  numberingToken: z.string().min(1).optional(),
  bulletKind: z.string().min(1).optional(),
  punctuation: z.enum(["heading", "colon_lead", "sentence", "semicolon_item", "plain"]),
  blankLinesBefore: z.number().int().min(0),
  blankLinesAfter: z.number().int().min(0)
}).strict();

export const JdSemanticClassificationSchema = z.object({
  disposition: JdSemanticDispositionSchema,
  section: RequirementSectionV3Schema,
  parentUnitId: z.string().min(1).optional(),
  groupRelation: JdSemanticGroupRelationSchema.optional()
}).strict();

export const JdSemanticFinalSchema = JdSemanticClassificationSchema.extend({
  kind: RequirementKindV3Schema.optional(),
  priority: RequirementPriorityV3Schema.optional(),
  hardConstraint: z.boolean().optional(),
  normalizedIntent: z.string().min(1).optional(),
  exactKeywords: z.array(z.string().min(1)).optional(),
  semanticAliases: z.array(z.string().min(1)).optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).optional()
}).strict();

export const JdSemanticUnitSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourceSpan: SourceSpanSchema,
  lineNumber: z.number().int().min(1),
  lexical: JdSemanticLexicalSchema,
  provisional: JdSemanticClassificationSchema,
  final: JdSemanticFinalSchema.optional()
}).strict();

export const JdSemanticAssignmentSchema = z.object({
  sourceUnitId: z.string().min(1),
  verdict: z.enum(["accept", "override"]),
  disposition: JdSemanticDispositionSchema.optional(),
  section: RequirementSectionV3Schema.optional(),
  parentUnitId: z.string().min(1).nullable().optional(),
  groupRelation: JdSemanticGroupRelationSchema.optional(),
  kind: RequirementKindV3Schema.optional(),
  priority: RequirementPriorityV3Schema.optional(),
  hardConstraint: z.boolean().optional(),
  normalizedIntent: z.string().min(1).optional(),
  exactKeywords: z.array(z.string().min(1)).optional(),
  semanticAliases: z.array(z.string().min(1)).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().min(1).optional()
}).strict().superRefine((assignment, context) => {
  const overrideKeys = Object.keys(assignment).filter((key) => !["sourceUnitId", "verdict"].includes(key));
  if (assignment.verdict === "accept" && overrideKeys.length) {
    context.addIssue({ code: "custom", message: "accept assignment cannot override semantic fields" });
  }
});

export const JobGraphIssueV4Schema = z.object({
  code: z.enum([
    "source_inconsistency",
    "missing_assignment",
    "duplicate_assignment",
    "invented_source_id",
    "invalid_parent",
    "parent_cycle",
    "invalid_detail_parent",
    "source_round_trip_failed",
    "low_confidence_unit"
  ]),
  message: z.string().min(1),
  sourceUnitIds: z.array(z.string().min(1)).default([]),
  severity: z.enum(["warning", "error"]).default("warning")
}).strict();

export const ContextGroupV4Schema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  relation: z.enum(["all_of", "examples", "topic_list"]),
  sourceUnitId: z.string().min(1),
  sourceSpan: SourceSpanSchema,
  details: z.array(z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    sourceUnitId: z.string().min(1),
    sourceSpan: SourceSpanSchema
  }).strict()).default([])
}).strict();

export const JobRequirementGraphV4Schema = z.object({
  schemaVersion: z.literal("job-requirement-graph-v4"),
  roleProfile: z.object({
    title: z.string().min(1).optional(),
    level: z.string().min(1).optional(),
    mission: z.string().min(1).optional(),
    domain: z.string().min(1).optional(),
    hiringSignals: z.array(HiddenSignalSchema).default([])
  }).strict(),
  groups: z.array(RequirementGroupSchema),
  requirements: z.array(RequirementNodeV3Schema),
  verificationMaterials: z.array(VerificationMaterialSchema),
  contextGroups: z.array(ContextGroupV4Schema).default([]),
  semanticUnits: z.array(JdSemanticUnitSchema),
  issues: z.array(JobGraphIssueV4Schema).default([]),
  needsReview: z.boolean(),
  sourceCoverage: z.object({
    coveredSpans: z.array(SourceSpanSchema),
    unclassifiedSpans: z.array(SourceSpanSchema),
    totalMeaningfulUnits: z.number().int().min(0),
    assignedUnits: z.number().int().min(0),
    unassignedUnitIds: z.array(z.string()),
    metadataUnitIds: z.array(z.string()),
    excludedUnitIds: z.array(z.string()),
    requirementUnitIds: z.array(z.string()),
    detailUnitIds: z.array(z.string()),
    inventedReferenceCount: z.number().int().min(0),
    coverageRatio: z.number().min(0).max(1)
  }).strict(),
  analyzerVersion: z.string().min(1),
  graphHash: z.string().min(8),
  semanticEnrichmentHash: z.string().min(8).optional()
}).strict();

export const JobRequirementGraphSchema = z.union([
  JobRequirementGraphV3Schema,
  JobRequirementGraphV4Schema
]);

export type JdSemanticDisposition = z.infer<typeof JdSemanticDispositionSchema>;
export type JdSemanticGroupRelation = z.infer<typeof JdSemanticGroupRelationSchema>;
export type JdSemanticUnit = z.infer<typeof JdSemanticUnitSchema>;
export type JdSemanticAssignment = z.infer<typeof JdSemanticAssignmentSchema>;
export type JobGraphIssueV4 = z.infer<typeof JobGraphIssueV4Schema>;
export type ContextGroupV4 = z.infer<typeof ContextGroupV4Schema>;
export type JobRequirementGraphV4 = z.infer<typeof JobRequirementGraphV4Schema>;
