import { z } from "zod";
import { SourceSpanSchema } from "./common";

export const RequirementRelationSchema = z.enum(["all_of", "any_of", "preferred_any_of", "evidence_bundle"]);
export const RequirementSectionV3Schema = z.enum(["responsibility", "required", "preferred", "verification", "role_profile", "unknown"]);
export const RequirementKindV3Schema = z.enum([
  "responsibility", "hard_constraint", "core_competency", "tool_or_technology", "experience_depth",
  "education", "language", "soft_skill", "domain_knowledge", "preferred", "risk_or_uncertain"
]);
export const RequirementPriorityV3Schema = z.enum(["must", "high", "medium", "nice_to_have", "uncertain"]);

export const JdSourceUnitDispositionSchema = z.enum([
  "heading", "wrapper", "metadata", "requirement", "requirement_detail",
  "verification_material", "hiring_signal", "excluded", "unclassified"
]);

export const JdSourceUnitSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourceSpan: SourceSpanSchema,
  lineNumber: z.number().int().min(1),
  indentation: z.number().int().min(0),
  punctuation: z.enum(["colon_lead", "semicolon_item", "sentence", "heading", "plain"]),
  disposition: JdSourceUnitDispositionSchema,
  parentUnitId: z.string().min(1).optional()
}).strict();

export const RequirementDetailSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["scenario", "required_field", "failure_pattern", "constraint", "example", "note"]),
  text: z.string().min(1),
  sourceSpan: SourceSpanSchema,
  sourceUnitId: z.string().min(1)
}).strict();

export const HiddenSignalSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  normalizedIntent: z.string().min(1),
  sourceSpan: SourceSpanSchema,
  confidence: z.number().min(0).max(1)
}).strict();

export const VerificationMaterialSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["usage_dashboard", "billing_history", "github", "badcase", "other"]),
  requiredComponents: z.array(z.string().min(1)).default([]),
  sourceUnitId: z.string().min(1).optional(),
  sourceSpan: SourceSpanSchema,
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean()
}).strict();

export const RequirementGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  relation: RequirementRelationSchema,
  minimumSatisfied: z.number().int().min(1).optional(),
  requirementIds: z.array(z.string().min(1)),
  sourceSpan: SourceSpanSchema
}).strict();

export const RequirementNodeV3Schema = z.object({
  id: z.string().min(1),
  section: RequirementSectionV3Schema,
  kind: RequirementKindV3Schema,
  statement: z.string().min(1),
  normalizedIntent: z.string().min(1),
  priority: RequirementPriorityV3Schema,
  hardConstraint: z.boolean(),
  exactKeywords: z.array(z.string().min(1)).default([]),
  semanticAliases: z.array(z.string().min(1)).default([]),
  parentGroupId: z.string().min(1).optional(),
  sourceUnitId: z.string().min(1).optional(),
  details: z.array(RequirementDetailSchema).default([]),
  sourceSpan: SourceSpanSchema,
  sourceSpans: z.array(SourceSpanSchema).min(1),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean()
}).strict();

export const JobRequirementGraphV3Schema = z.object({
  schemaVersion: z.literal("job-requirement-graph-v3"),
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
  sourceUnits: z.array(JdSourceUnitSchema).optional(),
  sourceCoverage: z.object({
    coveredSpans: z.array(SourceSpanSchema),
    unclassifiedSpans: z.array(SourceSpanSchema),
    totalMeaningfulUnits: z.number().int().min(0).default(0),
    assignedUnits: z.number().int().min(0).default(0),
    unassignedUnitIds: z.array(z.string()).default([]),
    metadataUnitIds: z.array(z.string()).default([]),
    excludedUnitIds: z.array(z.string()).default([]),
    requirementUnitIds: z.array(z.string()).default([]),
    detailUnitIds: z.array(z.string()).default([]),
    inventedReferenceCount: z.number().int().min(0).default(0),
    coverageRatio: z.number().min(0).max(1)
  }).strict(),
  analyzerVersion: z.string().min(1),
  graphHash: z.string().min(8),
  semanticEnrichmentHash: z.string().min(8).optional()
}).strict();

export type HiddenSignal = z.infer<typeof HiddenSignalSchema>;
export type VerificationMaterial = z.infer<typeof VerificationMaterialSchema>;
export type RequirementGroup = z.infer<typeof RequirementGroupSchema>;
export type RequirementNodeV3 = z.infer<typeof RequirementNodeV3Schema>;
export type JobRequirementGraphV3 = z.infer<typeof JobRequirementGraphV3Schema>;
export type JdSourceUnit = z.infer<typeof JdSourceUnitSchema>;
export type RequirementDetail = z.infer<typeof RequirementDetailSchema>;
