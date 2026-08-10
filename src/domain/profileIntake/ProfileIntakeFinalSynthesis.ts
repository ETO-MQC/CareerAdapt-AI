import { z } from "zod";
import { ResumeItemV2Schema, ResumeSectionTypeV2Schema, type ResumeItemV2 } from "@/domain/schemas/resumeV2";
import { assessCareerAssetCompleteness, careerReadinessForAsset, type CareerAssetDimension } from "./ProfileIntakeCompleteness";
import type { ImportedResumeDraft, ImportedResumeItem } from "@/domain/schemas/resumeImport";
import type { ProfileIntakeSourceTurn } from "./ProfileIntakeSourceTurn";
import { ProfileIntakeProvenanceSchema } from "./ProfileIntakeProvenance";
import { dedupeCareerWriting } from "./CareerWritingQuality";

export const ProfileIntakeFinalSynthesisAssetSchema = z.object({
  candidateId: z.string().min(1),
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics"]),
  structuredItem: ResumeItemV2Schema,
  sourceCandidateIds: z.array(z.string().min(1)).min(1),
  sourceTurnIds: z.array(z.string().min(1)).min(1),
  highlights: z.array(z.string().min(1)).max(4).default([]),
  careerReadySummary: z.string().min(1).max(1_600).optional(),
  careerReadyHighlights: z.array(z.string().min(1).max(800)).max(4).default([]),
  missingDimensions: z.array(z.string().min(1)).max(24).default([]),
  conflictFields: z.array(z.string().min(1)).max(24).default([]),
  conflicts: z.array(z.string().min(1)).max(24).optional(),
  provenance: z.array(ProfileIntakeProvenanceSchema).default([])
  , qualityGate: z.object({
    identityClear: z.boolean(),
    responsibilityClear: z.boolean(),
    evidenceCoverage: z.number().min(0).max(1),
    careerReadiness: z.number().min(0).max(1),
    duplication: z.number().min(0).max(1),
    unsupportedClaimCount: z.number().int().min(0),
    blockingIssues: z.array(z.enum(["unsupported_hard_fact", "identity_conflict", "major_contradiction"]))
  }).default({
    identityClear: false,
    responsibilityClear: false,
    evidenceCoverage: 0,
    careerReadiness: 0,
    duplication: 0,
    unsupportedClaimCount: 0,
    blockingIssues: []
  })
}).strict();

export const ProfileIntakeFinalSynthesisSchema = z.object({
  version: z.literal("profile-intake-final-synthesis-v1"),
  createdAt: z.string().datetime({ offset: true }),
  sourceTurnIds: z.array(z.string().min(1)).min(1),
  assets: z.array(ProfileIntakeFinalSynthesisAssetSchema).max(40),
  missingDimensions: z.record(z.string(), z.array(z.string().min(1))).default({}),
  conflictCount: z.number().int().min(0).default(0)
}).strict();

export type ProfileIntakeFinalSynthesisAsset = z.infer<typeof ProfileIntakeFinalSynthesisAssetSchema>;
export type ProfileIntakeFinalSynthesis = z.infer<typeof ProfileIntakeFinalSynthesisSchema>;

type DraftItemWithSection = ImportedResumeItem & {
  sectionType: ProfileIntakeFinalSynthesisAsset["sectionType"];
  detectedTitle: string;
};

/**
 * Consolidates every normalized item in the local draft.  The algorithm is
 * intentionally deterministic: it merges only compatible identity keys,
 * preserves explicit fields from the latest correction, and derives highlights
 * from text already present in the draft.
 */
export function synthesizeProfileIntakeDraft(input: {
  draft: ImportedResumeDraft;
  sourceTurns: ProfileIntakeSourceTurn[];
  now?: string;
}): { draft: ImportedResumeDraft; synthesis: ProfileIntakeFinalSynthesis } {
  const now = input.now ?? new Date().toISOString();
  const sourceTurns = input.sourceTurns.filter((turn) => turn.processingStatus !== "superseded");
  const sourceTurnIds = sourceTurns.map((turn) => turn.turnId);
  const items = input.draft.sections.flatMap((section) => section.items
    // A deterministic normalization warning is review metadata, not a reason
    // to drop a source-grounded provisional item from the one final review.
    .filter((item) => item.structuredItem && item.userConfirmed !== false)
    .map((item) => ({ ...item, sectionType: item.structuredItem!.sectionType, detectedTitle: section.detectedTitle })));
  const groups = new Map<string, DraftItemWithSection[]>();
  for (const item of items) {
    const key = synthesisIdentityKey(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const assets = [...groups.values()].map((group) => buildAsset(group)).slice(0, 40);
  const sourceItemIds = new Set(assets.flatMap((asset) => asset.sourceCandidateIds));
  const sections = input.draft.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => sourceItemIds.has(item.id)
      ? { ...item, included: false, userConfirmed: undefined }
      : item)
  }));
  const synthesizedSections = assets.map((asset, index) => ({
    id: `final-synthesis-${asset.candidateId}`,
    sectionType: asset.sectionType,
    category: categoryForSection(asset.sectionType),
    detectedTitle: sectionTitle(asset.structuredItem),
    included: false,
    order: sections.length + index,
    confidence: "high" as const,
    items: [synthesizedItem(asset, groupForAsset(asset, groups))]
  }));
  const missingDimensions = Object.fromEntries(assets
    .filter((asset) => asset.missingDimensions.length)
    .map((asset) => [asset.candidateId, asset.missingDimensions]));
  const synthesis = ProfileIntakeFinalSynthesisSchema.parse({
    version: "profile-intake-final-synthesis-v1",
    createdAt: now,
    sourceTurnIds: sourceTurnIds.length ? sourceTurnIds : [input.draft.intakeSession?.lastSourceTurnId ?? input.draft.importId],
    assets,
    missingDimensions,
    conflictCount: assets.filter((asset) => asset.conflictFields.length > 0).length
  });
  const nextDraft = {
    ...input.draft,
    sections: [...sections, ...synthesizedSections],
    intakeSession: input.draft.intakeSession
      ? {
          ...input.draft.intakeSession,
          phase: "ready_for_review" as const,
          finalSynthesisRevision: input.draft.revision + 1,
          finalSynthesis: synthesis,
          finalReviewCount: input.draft.intakeSession.finalReviewCount + 1,
          autosavedAt: now,
          resumeToken: `${input.draft.importId}:${input.draft.revision + 1}:final-synthesis`
        }
      : undefined,
    status: "reviewing" as const,
    updatedAt: now
  };
  return { draft: nextDraft as ImportedResumeDraft, synthesis };
}

function buildAsset(group: DraftItemWithSection[]): ProfileIntakeFinalSynthesisAsset {
  const ordered = [...group].sort((left, right) => Number(Boolean(left.userEdited)) - Number(Boolean(right.userEdited)));
  const latest = ordered.at(-1)!;
  const structuredItem = mergeStructuredItems(ordered.map((item) => item.structuredItem!).filter(Boolean));
  const allEvidence = ordered.flatMap((item) => item.conversationEvidence ?? []);
  const sourceTurnIds = [...new Set(allEvidence.map((evidence) => evidence.turnId).filter(Boolean))];
  const sourceCandidateIds = [...new Set(group.map((item) => item.id))];
  const assessment = assessCareerAssetCompleteness(structuredItem);
  const highlights = careerHighlights(ordered, structuredItem);
  const conflictFields = conflictingFields(ordered);
  const careerReadyHighlights = ensureCareerReadyHighlights(highlights, structuredItem);
  const qualityGate = assessFinalAssetQuality(structuredItem, assessment.present, careerReadyHighlights, conflictFields);
  return ProfileIntakeFinalSynthesisAssetSchema.parse({
    candidateId: `synth-${latest.id}`,
    sectionType: structuredItem.sectionType,
    structuredItem,
    sourceCandidateIds,
    sourceTurnIds: sourceTurnIds.length ? sourceTurnIds : [latest.conversationEvidence?.at(-1)?.turnId ?? latest.id],
    highlights,
    careerReadySummary: careerReadyText(structuredItem),
    careerReadyHighlights,
    missingDimensions: assessment.missing.slice(0, 24),
    conflictFields,
    conflicts: conflictFields,
    provenance: [
      ...group.flatMap((item) => item.provenance ?? []),
      ...group.flatMap((item) => item.conversationEvidence?.map((evidence) => ({
        kind: "source_turn" as const,
        sourceCandidateId: item.id,
        sourceTurnId: evidence.turnId,
        fieldNames: evidence.supportedFields,
        supersededFieldEvidence: [],
        confirmedAt: evidence.capturedAt
      })) ?? [])
    ],
    qualityGate
  });
}

function assessFinalAssetQuality(
  item: ResumeItemV2,
  present: CareerAssetDimension[],
  highlights: string[],
  conflictFields: string[]
) {
  const identityClear = present.includes("identity");
  const responsibilityClear = item.sectionType === "education"
    || item.sectionType === "awards"
    || item.sectionType === "certificates"
    || item.sectionType === "skills"
    || item.sectionType === "languages"
    || item.sectionType === "publications"
    || item.sectionType === "patents"
    || present.includes("role")
    || present.includes("action");
  const usefulDimensions: CareerAssetDimension[] = ["identity", "role", "action", "tools_methods", "method", "result", "applied_evidence", "time"];
  const evidenceCoverage = usefulDimensions.filter((dimension) => present.includes(dimension)).length / usefulDimensions.length;
  const normalized = highlights.map((highlight) => highlight.toLocaleLowerCase().replace(/\s+/gu, ""));
  const unique = new Set(normalized);
  const duplication = normalized.length ? 1 - unique.size / normalized.length : 0;
  const blockingIssues: Array<"identity_conflict" | "major_contradiction"> = [];
  const identityFields = new Set(["title", "name", "organization", "institution", "school"]);
  if (conflictFields.some((field) => identityFields.has(field))) blockingIssues.push("identity_conflict");
  if (conflictFields.some((field) => !identityFields.has(field))) blockingIssues.push("major_contradiction");
  return {
    identityClear,
    responsibilityClear,
    evidenceCoverage: Number(evidenceCoverage.toFixed(2)),
    careerReadiness: careerReadinessForAsset(item, present),
    duplication: Number(duplication.toFixed(2)),
    unsupportedClaimCount: 0,
    blockingIssues
  };
}

function synthesizedItem(asset: ProfileIntakeFinalSynthesisAsset, group: DraftItemWithSection[]): ImportedResumeItem {
  const first = group[0];
  return {
    ...first,
    id: asset.candidateId,
    rawText: group.map((item) => item.rawText).filter(Boolean).join("\n"),
    normalizedText: careerReadyText(asset.structuredItem),
    included: false,
    userConfirmed: undefined,
    sourceStatus: "user_confirmed_modified",
    userEdited: group.some((item) => item.userEdited),
    itemLabel: sectionTitle(asset.structuredItem),
    structuredItem: asset.structuredItem,
    sourceBlockIds: [...new Set(group.flatMap((item) => item.sourceBlockIds))],
    pageRefs: group.flatMap((item) => item.pageRefs),
    sourceQuote: group.map((item) => item.sourceQuote ?? item.rawText).join("\n"),
    conversationEvidence: group.flatMap((item) => item.conversationEvidence ?? []),
    careerNormalization: {
      version: "profile-intake-normalization-v1",
      mode: "deterministic",
      needsNormalization: false,
      fieldEvidence: group.flatMap((item) => item.careerNormalization?.fieldEvidence ?? [])
    },
    provenance: asset.provenance,
    structuredMappingTrace: group.flatMap((item) => item.structuredMappingTrace),
    mapping: first.mapping
  };
}

function groupForAsset(asset: ProfileIntakeFinalSynthesisAsset, groups: Map<string, DraftItemWithSection[]>) {
  return [...groups.values()].find((group) => group.some((item) => item.id === asset.sourceCandidateIds[0])) ?? [];
}

function synthesisIdentityKey(item: DraftItemWithSection) {
  const value = item.structuredItem!;
  const record = value as unknown as Record<string, unknown>;
  const identity = value.sectionType === "education"
    ? value.school ?? value.major
    : value.sectionType === "skills"
      ? value.name
      : value.sectionType === "languages"
        ? value.language
        : value.sectionType === "awards" || value.sectionType === "certificates"
          ? value.name
          : value.sectionType === "summary"
            ? value.text
            : value.sectionType === "research" || value.sectionType === "publications" || value.sectionType === "patents" || value.sectionType === "portfolio" || value.sectionType === "project" || value.sectionType === "other" || value.sectionType === "custom"
              ? value.title
              : record.organization;
  const identityKey = String(identity ?? "").trim();
  return `${value.sectionType}:${(identityKey || item.id).toLocaleLowerCase()}`;
}

function mergeStructuredItems(items: ResumeItemV2[]): ResumeItemV2 {
  const base = items[0];
  const merged: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const item of items.slice(1)) {
    for (const [key, value] of Object.entries(item as unknown as Record<string, unknown>)) {
      if (key === "id" || key === "sectionType" || key === "customFields") continue;
      if (Array.isArray(value)) {
        merged[key] = [...new Set([
          ...(Array.isArray(merged[key]) ? merged[key] as unknown[] : []),
          ...value
        ])];
      } else if (value !== undefined && value !== "") {
        merged[key] = value;
      }
    }
  }
  return ResumeItemV2Schema.parse(merged);
}

function careerHighlights(items: DraftItemWithSection[], item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  const direct = [
    ...(Array.isArray(record.highlights) ? record.highlights : []),
    ...(Array.isArray(record.outcomes) ? record.outcomes : [])
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const descriptions = items.flatMap((candidate) => {
    const value = candidate.structuredItem as unknown as Record<string, unknown>;
    return typeof value.description === "string" ? value.description.split(/[\n。；;]+/u) : [];
  });
  return [...new Set([...direct, ...descriptions].map((value) => value.trim()).filter(Boolean))].slice(0, 4);
}

function ensureCareerReadyHighlights(highlights: string[], item: ResumeItemV2) {
  const summary = careerReadyText(item).trim();
  return dedupeCareerWriting(highlights.filter((highlight) => highlight.trim() !== summary), summary).slice(0, 4);
}

function conflictingFields(items: DraftItemWithSection[]) {
  const fields = new Set<string>();
  const first = items[0]?.structuredItem as unknown as Record<string, unknown> | undefined;
  if (!first) return [];
  for (const key of Object.keys(first)) {
    const values = new Set(items.map((item) => JSON.stringify((item.structuredItem as unknown as Record<string, unknown>)[key])).filter((value) => value !== undefined));
    if (values.size > 1) fields.add(key);
  }
  return [...fields].filter((field) => field !== "id" && field !== "customFields");
}

function sectionTitle(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  const identity = item.sectionType === "education"
    ? item.school ?? item.major
    : ["work", "internship", "campus", "volunteer"].includes(item.sectionType)
      ? record.organization
      : record.title ?? record.name;
  return typeof identity === "string" && identity.trim()
    ? identity
    : `待补充${sectionLabel(item.sectionType)}名称`;
}

function sectionLabel(sectionType: ResumeItemV2["sectionType"]) {
  const labels: Partial<Record<ResumeItemV2["sectionType"], string>> = {
    education: "教育经历",
    work: "工作经历",
    internship: "实习经历",
    project: "项目",
    research: "研究",
    campus: "校园经历",
    volunteer: "志愿经历",
    awards: "奖项",
    skills: "技能",
    certificates: "证书",
    languages: "语言",
    publications: "出版物",
    patents: "专利",
    portfolio: "作品",
    other: "经历",
    custom: "经历",
    summary: "简介"
  };
  return labels[sectionType] ?? "经历";
}

function categoryForSection(sectionType: ProfileIntakeFinalSynthesisAsset["sectionType"]) {
  const categories: Record<string, string> = {
    summary: "summary", education: "education", work: "work", internship: "work", project: "project",
    research: "custom", campus: "campus", volunteer: "custom", awards: "award", skills: "skill",
    certificates: "certificate", languages: "language", publications: "custom", patents: "custom",
    portfolio: "custom", other: "custom", custom: "custom"
  };
  return categories[sectionType];
}

export function finalSynthesisAssetById(synthesis: ProfileIntakeFinalSynthesis | undefined, id: string) {
  return synthesis?.assets.find((asset) => asset.candidateId === id);
}

export type ProfileIntakeFinalSynthesisDimension = CareerAssetDimension;

function careerReadyText(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  if (item.sectionType === "summary") return item.text;
  const identity = item.sectionType === "education"
    ? [item.school, item.degree, item.major]
    : [record.title ?? record.name ?? record.organization ?? record.role];
  const dates = "startDate" in item
    ? [item.startDate, item.current ? "至今" : item.endDate].filter(Boolean)
    : item.sectionType === "awards" ? [item.awardedAt] : [];
  const body = [
    ...(Array.isArray(record.highlights) ? record.highlights : []),
    ...(Array.isArray(record.outcomes) ? record.outcomes : []),
    typeof record.description === "string" ? record.description : undefined
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return [...identity, dates.join(" — "), ...body].filter(Boolean).join("｜") || "待整理经历";
}
