import { nanoid } from "nanoid";
import {
  BranchContentItemSchema,
  CareerProfileSchema,
  ResumeContentItemV2Schema,
  ResumeBranchSchema,
  type BranchContentItem,
  type BranchFactRef,
  type CareerProfile,
  type FactCategory,
  type FactProvenance,
  type FactStatement,
  type ImportedResumeDraft,
  type ImportedResumeItem,
  type ImportedResumeSection,
  type ImportMergeDecision,
  type ResumeBranch,
  type ResumeContentItemV2,
  type ResumeItemV2,
  type ResumeRevision
} from "@/domain/schemas";
import { auditResumeImportInvariants, resumeImportInvariantIssueCount } from "./invariants";
import { createResumeRevision } from "@/domain/branch/revision";
import { computeGeneralBranchSyncStatus } from "@/domain/branch/validation";
import { locatePdfSourceQuote } from "@/domain/pdfImport/sourceMapping";
import { categorySourceSectionId, resumeCategoryRank } from "@/domain/resumeFields/catalog";
import { validateFieldCandidates } from "./fieldCandidates";
import { validateMappingDecisions } from "./mappingValidation";

export type ResumeImportConfirmationBuildResult = {
  profile: CareerProfile;
  branch: ResumeBranch;
  firstRevision: ResumeRevision;
  importedFactCount: number;
};

type FactMapping = {
  itemId: string;
  factRefs: BranchFactRef[];
};

export function buildResumeImportConfirmation(input: {
  draft: ImportedResumeDraft;
  existingProfile?: CareerProfile;
  mergeDecisions?: ImportMergeDecision[];
  newProfileName?: string;
  operationId: string;
  now?: string;
}): ResumeImportConfirmationBuildResult {
  validateImportedResumeSources(input.draft);
  const now = input.now ?? new Date().toISOString();
  const { profile, factMappings } = mergeImportedProfile({
    draft: input.draft,
    existingProfile: input.existingProfile,
    mergeDecisions: input.mergeDecisions ?? [],
    newProfileName: input.newProfileName,
    now
  });
  const { contentItems, structuredContentItems } = buildBranchContentItems({
    draft: input.draft,
    factMappings,
    now
  });

  if (contentItems.length === 0) {
    throw new Error("resume_import_no_confirmed_content");
  }

  const branchBase = ResumeBranchSchema.parse({
    id: `branch-general-${input.draft.importId}-${nanoid(6)}`,
    schemaVersion: "resume-branch-v2",
    branchPurpose: "general",
    profileId: profile.id,
    name: "通用简历",
    sourceProfileVersion: profile.version,
    sourceImportId: input.draft.importId,
    sourceDraftRevision: input.draft.revision,
    matcherVersion: input.draft.parserVersion,
    sourceMatchSetHash: input.draft.source.fileHash,
    requirementMatchIds: [],
    revision: 0,
    lifecycleStatus: "active",
    migrationStatus: "verified",
    syncStatusCache: {
      status: "in_sync",
      sourceProfileVersion: profile.version,
      currentProfileVersion: profile.version,
      invalidFactRefs: [],
      checkedAt: now,
      message: "General branch is in sync with its source profile."
    },
    resumeBasics: {
      name: profile.basics.name,
      targetRole: input.draft.basics.targetRole?.value ?? "",
      email: profile.basics.email ?? "",
      phone: profile.basics.phone ?? "",
      location: profile.basics.location ?? "",
      summary: profile.basics.summary ?? "",
      links: profile.basics.links
    },
    contentItems,
    structuredContentItems,
    createdAt: now,
    updatedAt: now
  });
  const branchWithSync = ResumeBranchSchema.parse({
    ...branchBase,
    syncStatusCache: computeGeneralBranchSyncStatus({
      branch: branchBase,
      profile,
      now
    })
  });
  const firstRevision = createResumeRevision({
    branch: branchWithSync,
    source: "import_confirmed",
    operationId: input.operationId,
    now
  });
  const branch = ResumeBranchSchema.parse({
    ...branchWithSync,
    currentRevisionId: firstRevision.id
  });

  return {
    profile,
    branch,
    firstRevision,
    importedFactCount: factMappings.length
  };
}

export function buildResumeImportProfileOnly(input: {
  draft: ImportedResumeDraft;
  newProfileName: string;
  now?: string;
}) {
  validateImportedResumeSources(input.draft);
  const now = input.now ?? new Date().toISOString();
  return mergeImportedProfile({
    draft: input.draft,
    mergeDecisions: [],
    newProfileName: input.newProfileName,
    now
  }).profile;
}

function validateImportedResumeSources(draft: ImportedResumeDraft) {
  const invariantReport = auditResumeImportInvariants(draft);
  if (resumeImportInvariantIssueCount(invariantReport) > 0) {
    throw new Error(`resume_import_invariant_failed:${JSON.stringify(invariantReport)}`);
  }
  if (draft.schemaVersion === "resume-import-v2") {
    const mappingIssues = validateMappingDecisions(draft.mappingDecisions, draft.sourceBlocks);
    if (mappingIssues.length > 0) throw new Error(`resume_import_mapping_source_invalid:${mappingIssues[0].code}`);
    const candidateIssues = validateFieldCandidates(draft.fieldCandidates, draft.sourceBlocks);
    if (candidateIssues.length > 0) throw new Error(`resume_import_field_candidate_invalid:${candidateIssues[0].code}`);
    if (draft.fieldCandidates.some((candidate) => candidate.reviewStatus === "needs_review" && !candidate.userConfirmed)) {
      throw new Error("resume_import_field_candidate_unconfirmed");
    }
  }
  if (draft.sourceBlocks.length === 0) return;
  const blockIds = new Set(draft.sourceBlocks.map((block) => block.id));
  const sourcePaths = new Set(draft.sourceBlocks.flatMap((block) => block.sourcePath ? [block.sourcePath] : []));
  const fields = [draft.basics.name, draft.basics.email, draft.basics.phone, draft.basics.location, draft.basics.summary, ...draft.basics.links].filter(Boolean);
  for (const field of fields) {
    if (!field) continue;
    const located = field.sourceBlockIds.some((id) => blockIds.has(id)) || field.mapping?.sourcePaths.some((path) => sourcePaths.has(path));
    if (!located && !field.userEdited) throw new Error("resume_import_field_source_missing");
  }
  for (const section of draft.sections.filter((item) => item.included)) {
    for (const item of section.items.filter((candidate) => candidate.included)) {
      const located = item.sourceBlockIds.some((id) => blockIds.has(id)) || item.mapping?.sourcePaths.some((path) => blockIds.has(path) || sourcePaths.has(path));
      if (!located && !item.userEdited) throw new Error("resume_import_item_source_missing");
    }
  }
}

function mergeImportedProfile(input: {
  draft: ImportedResumeDraft;
  existingProfile?: CareerProfile;
  mergeDecisions: ImportMergeDecision[];
  newProfileName?: string;
  now: string;
}): { profile: CareerProfile; factMappings: FactMapping[] } {
  const existing = input.existingProfile;
  const profileId = existing?.id ?? `profile-${nanoid(10)}`;
  const basics = mergeBasics(input.draft, existing, input.mergeDecisions, input.newProfileName);
  const baseProfile: CareerProfile = existing
    ? {
        ...existing,
        basics,
        name: basics.name,
        version: existing.version + 1,
        updatedAt: input.now
      }
    : CareerProfileSchema.parse({
        id: profileId,
        name: basics.name,
        basics,
        preference: {
          targetRoles: input.draft.basics.targetRole ? [input.draft.basics.targetRole.value] : [],
          targetCities: [],
          industries: []
        },
        version: 1,
        experiences: [],
        skills: [],
        certificates: [],
        evidences: [],
        unclassifiedBlocks: [],
        createdAt: input.now,
        updatedAt: input.now
      });

  const factMappings: FactMapping[] = [];
  const existingFactKeys = new Set(collectFactKeys(baseProfile));
  const experiences = [...baseProfile.experiences];
  const skills = [...baseProfile.skills];
  const certificates = [...baseProfile.certificates];
  const unclassifiedBlocks = [
    ...baseProfile.unclassifiedBlocks,
    ...input.draft.unclassifiedBlocks.map((block) => "sourcePath" in block
      ? `${block.sourcePath}: ${stringifySourceValue(block.sourceValue)}`
      : `${block.sourceBlockId}[${block.sourceRange.start}:${block.sourceRange.end}]: ${block.text}`)
  ];
  const structuredFacts = [...(baseProfile.structuredFacts ?? [])];

  for (const section of input.draft.sections.filter((item) => item.included)) {
    for (const item of section.items.filter(canImportItem)) {
      const factKey = normalizeFactKey(item.normalizedText);
      if (existingFactKeys.has(factKey)) {
        const existingRefs = findExistingFactRefs(baseProfile, item.normalizedText);
        if (existingRefs.length > 0) {
          factMappings.push({ itemId: item.id, factRefs: existingRefs });
          appendStructuredFact(structuredFacts, input.draft, item, existingRefs);
          continue;
        }
      }
      existingFactKeys.add(factKey);

      if (sectionCategory(section) === "skill") {
        const refs = splitSkillText(item.normalizedText).map((skillName) => {
          const skillId = `skill-${nanoid(10)}`;
          const fact = createImportedFact({
            draft: input.draft,
            item,
            statement: skillName,
            category: "skill",
            now: input.now
          });
          skills.push({
            id: skillId,
            name: skillName,
            evidenceIds: [],
            fact,
            createdAt: input.now,
            updatedAt: input.now
          });
          return {
            type: "skill_fact" as const,
            skillId,
            factId: fact.id
          };
        });
        factMappings.push({ itemId: item.id, factRefs: refs });
        appendStructuredFact(structuredFacts, input.draft, item, refs);
        continue;
      }

      if (sectionCategory(section) === "language") {
        const skillId = `skill-${nanoid(10)}`;
        const fact = createImportedFact({ draft: input.draft, item, statement: item.normalizedText, category: "language", now: input.now });
        skills.push({
          id: skillId,
          name: item.structuredItem?.sectionType === "languages" ? item.structuredItem.language : firstLine(item.normalizedText),
          evidenceIds: [], fact, createdAt: input.now, updatedAt: input.now
        });
        const refs = [{ type: "skill_fact" as const, skillId, factId: fact.id }];
        factMappings.push({ itemId: item.id, factRefs: refs });
        appendStructuredFact(structuredFacts, input.draft, item, refs);
        continue;
      }

      if (sectionCategory(section) === "certificate") {
        const certificateId = `cert-${nanoid(10)}`;
        const fact = createImportedFact({
          draft: input.draft,
          item,
          statement: item.normalizedText,
          category: "certificate",
          now: input.now
        });
        certificates.push({
          id: certificateId,
          name: firstLine(item.normalizedText),
          evidenceIds: [],
          fact,
          createdAt: input.now,
          updatedAt: input.now
        });
        factMappings.push({
          itemId: item.id,
          factRefs: [{ type: "certificate_fact", certificateId, factId: fact.id }]
        });
        appendStructuredFact(structuredFacts, input.draft, item, [{ type: "certificate_fact", certificateId, factId: fact.id }]);
        continue;
      }

      const experienceId = `exp-${nanoid(10)}`;
      const structured = item.structuredItem;
      const fact = createImportedFact({
        draft: input.draft,
        item,
        statement: structured ? structuredBodyText(structured) || projectStructuredItemForLegacy(structured) : item.normalizedText,
        category: section.sectionType === "summary" ? "other" : importedSectionFactCategory(section),
        now: input.now
      });
      experiences.push({
        id: experienceId,
        type: section.sectionType === "summary" ? "other" : importedExperienceType(section),
        organization: structuredOrganization(structured) ?? inferOrganization(section, item),
        role: structuredRole(structured) ?? inferRole(section, item),
        location: structured && "location" in structured ? structured.location : undefined,
        degree: structured?.sectionType === "education" ? structured.degree : undefined,
        major: structured?.sectionType === "education" ? structured.major : undefined,
        courses: structured?.sectionType === "education" ? structured.courses : undefined,
        startDate: structured && "startDate" in structured ? structured.startDate : undefined,
        endDate: structured && "endDate" in structured ? structured.endDate : undefined,
        facts: [fact],
        resumeDrafts: [{
          id: `draft-${nanoid(10)}`,
          text: structured ? projectStructuredItemForLegacy(structured) : item.normalizedText,
          factIds: [fact.id],
          createdAt: input.now,
          updatedAt: input.now
        }],
        tags: [section.detectedTitle].filter(Boolean),
        evidenceIds: [],
        createdAt: input.now,
        updatedAt: input.now
      });
      factMappings.push({
        itemId: item.id,
        factRefs: [{ type: "experience_fact", experienceId, factId: fact.id }]
      });
      appendStructuredFact(structuredFacts, input.draft, item, [{ type: "experience_fact", experienceId, factId: fact.id }]);

      if (section.sectionType === "unknown") {
        unclassifiedBlocks.push(item.normalizedText);
      }
    }
  }

  return {
    profile: CareerProfileSchema.parse({
      ...baseProfile,
      schemaVersion: "career-profile-v2",
      experiences,
      skills,
      certificates,
      unclassifiedBlocks,
      structuredBasics: {
        name: basics.name,
        headline: input.draft.basics.targetRole?.value ?? basics.headline,
        targetRole: input.draft.basics.targetRole?.value,
        summary: basics.summary,
        phone: basics.phone,
        email: basics.email,
        location: basics.location,
        otherLinks: basics.links,
        customFields: []
      },
      structuredFacts,
      updatedAt: input.now
    }),
    factMappings
  };
}

function buildBranchContentItems(input: {
  draft: ImportedResumeDraft;
  factMappings: FactMapping[];
  now: string;
}): { contentItems: BranchContentItem[]; structuredContentItems: ResumeContentItemV2[] } {
  const factRefsByItem = new Map(input.factMappings.map((mapping) => [mapping.itemId, mapping.factRefs]));
  let order = 0;
  const pairs = input.draft.sections
    .filter((section) => section.included)
    .flatMap((section) => section.items.map((item) => ({ section, item })))
    .filter(({ item }) => canImportItem(item))
    .sort((a, b) => resumeCategoryRank(sectionCategory(a.section)) - resumeCategoryRank(sectionCategory(b.section)) || a.item.order - b.item.order)
    .map(({ section, item }) => {
      const factRefs = factRefsByItem.get(item.id) ?? [];
      if (factRefs.length === 0) {
        return undefined;
      }
      const text = item.structuredItem ? projectStructuredItemForLegacy(item.structuredItem) : item.normalizedText;
      const legacy = BranchContentItemSchema.parse({
        id: `branch-item-import-${item.id}`,
        itemType: importedSectionItemType(section),
        source: "resume_import",
        sourceSectionId: categorySourceSectionId(sectionCategory(section)),
        text,
        originalText: item.rawText,
        order: order++,
        visible: true,
        requirementIds: [],
        sourceSuggestionIds: [],
        factRefs,
        guardMode: "rule_verified",
        guardStatus: "pass",
        guardRiskLevel: "low",
        guardFindings: [],
        guardedAt: input.now,
        guardVersion: input.draft.parserVersion
      });
      const structured = ResumeContentItemV2Schema.parse({
        id: legacy.id,
        schemaVersion: "resume-content-item-v2",
        data: item.structuredItem ?? legacyFallbackStructuredItem(legacy, section),
        factRefs,
        source: legacy.source,
        order: legacy.order,
        visible: legacy.visible,
        guardMode: legacy.guardMode,
        guardStatus: legacy.guardStatus,
        guardFindings: legacy.guardFindings,
        legacyTextProjection: legacy.text,
        sourceBlockIds: item.sourceBlockIds,
        sourceRanges: item.sourceRanges ?? [],
        sourceExcerpt: item.rawText,
        mappingTrace: itemMappingTrace(input.draft, item)
      });
      return { legacy, structured };
    })
    .filter((item): item is { legacy: BranchContentItem; structured: ResumeContentItemV2 } => Boolean(item));
  return {
    contentItems: pairs.map((item) => item.legacy),
    structuredContentItems: pairs.map((item) => item.structured)
  };
}

function mergeBasics(
  draft: ImportedResumeDraft,
  existingProfile: CareerProfile | undefined,
  decisions: ImportMergeDecision[],
  newProfileName?: string
): CareerProfile["basics"] {
  const existing = existingProfile?.basics;
  const decide = (target: ImportMergeDecision["target"], importedValue: string | undefined) =>
    decisions.find((decision) => decision.target === target && decision.importedValue === importedValue)?.action;
  const choose = (target: ImportMergeDecision["target"], existingValue: string | undefined, importedValue: string | undefined) => {
    if (!importedValue) {
      return existingValue;
    }
    if (!existingValue) {
      return importedValue;
    }
    return decide(target, importedValue) === "use_imported" ? importedValue : existingValue;
  };
  const links = uniqueStrings([
    ...(existing?.links ?? []),
    ...draft.basics.links
      .filter((link) => decide("link", link.value) !== "keep_existing")
      .map((link) => link.value)
  ]);

  return {
    name: existing ? choose("name", existing.name, draft.basics.name?.value) ?? existing.name : newProfileName?.trim() || draft.basics.name?.value || "未命名",
    phone: choose("phone", existing?.phone, draft.basics.phone?.value),
    email: choose("email", existing?.email, draft.basics.email?.value),
    location: choose("location", existing?.location, draft.basics.location?.value),
    summary: choose("summary", existing?.summary, draft.basics.summary?.value),
    links
  };
}

function createImportedFact(input: {
  draft: ImportedResumeDraft;
  item: ImportedResumeItem;
  statement: string;
  category: FactCategory;
  now: string;
}): FactStatement {
  const pageRef = input.item.pageRefs[0] ?? {
    pageNumber: 1,
    quote: input.item.rawText || input.item.normalizedText
  };
  const sourceType = input.item.sourceStatus === "user_confirmed_modified"
    ? "user_input"
    : input.draft.source.mimeType === "application/pdf" ? "pdf_import" : "imported_text";
  const pageSources = input.draft.pages.map((page) => ({
    pageNumber: page.pageNumber,
    cleanedPageText: page.normalizedText,
    charStart: page.charStart ?? 0,
    charEnd: page.charEnd ?? page.normalizedText.length
  }));
  const location = sourceType === "pdf_import" ? locatePdfSourceQuote(pageRef.quote, pageSources) : undefined;
  if (sourceType === "pdf_import" && location?.status !== "located") {
    throw new Error("resume_import_source_quote_unlocated");
  }
  const locatedLocation = location?.status === "located" ? location : undefined;
  const provenance: FactProvenance = {
    sourceType,
    sourceId: input.draft.importId,
    sourceText: sourceType === "pdf_import" ? pageRef.quote : input.item.normalizedText,
    confidence: input.item.confidence === "high" ? 0.9 : input.item.confidence === "medium" ? 0.72 : 0.55,
    confirmedByUser: true,
    riskLevel: sourceType === "pdf_import" ? "low" : "medium",
    createdAt: input.now,
    sourceSessionId: input.draft.source.sourceSessionId,
    fileName: input.draft.source.fileName,
    pageNumber: sourceType === "pdf_import" ? locatedLocation?.locator.pageNumber : undefined,
    pageRange: sourceType === "pdf_import" && locatedLocation ? { startPage: locatedLocation.locator.pageNumber, endPage: locatedLocation.locator.pageNumber } : undefined,
    sourceQuote: pageRef.quote,
    sourceLocatorStatus: sourceType === "pdf_import" ? "located" : undefined,
    sourceLocator: sourceType === "pdf_import" ? locatedLocation?.locator : undefined
  };

  return {
    id: `fact-import-${nanoid(10)}`,
    statement: input.statement,
    category: input.category,
    provenance: [provenance],
    confirmedByUser: true,
    riskLevel: provenance.riskLevel,
    createdAt: input.now,
    updatedAt: input.now
  };
}

function canImportItem(item: ImportedResumeItem) {
  return item.included && (item.sourceStatus === "located" || item.sourceStatus === "user_confirmed_modified");
}

function importedSectionItemType(section: ImportedResumeSection): BranchContentItem["itemType"] {
  const category = sectionCategory(section);
  if (category === "summary") {
    return "summary";
  }
  if (category === "skill") {
    return "skill";
  }
  if (category === "certificate") {
    return "certificate";
  }
  if (category === "award" || category === "language" || category === "custom") {
    return "custom";
  }
  return "experience";
}

function importedSectionFactCategory(section: ImportedResumeSection): FactCategory {
  const category = sectionCategory(section);
  if (category === "skill") {
    return "skill";
  }
  if (category === "certificate") {
    return "certificate";
  }
  if (category === "education") {
    return "education";
  }
  if (category === "award") return "achievement";
  return category === "custom" || category === "language" || category === "summary" ? "other" : "experience";
}

function importedExperienceType(section: ImportedResumeSection): CareerProfile["experiences"][number]["type"] {
  const category = sectionCategory(section);
  if (category === "education") {
    return "education";
  }
  if (/实习|intern/i.test(section.detectedTitle)) {
    return "internship";
  }
  if (category === "project") {
    return "project";
  }
  if (category === "campus") {
    return "campus";
  }
  if (category === "award") return "competition";
  if (category === "work") {
    return "work";
  }
  return "other";
}

function sectionCategory(section: ImportedResumeSection) {
  if (section.category) return section.category;
  if (section.sectionType === "summary") return "summary" as const;
  if (section.sectionType === "skills") return "skill" as const;
  if (section.sectionType === "certificates") return "certificate" as const;
  if (section.sectionType === "internship" || /实习|intern/i.test(section.detectedTitle)) return "internship" as const;
  if (/教育|education/i.test(section.detectedTitle)) return "education" as const;
  if (/项目|project/i.test(section.detectedTitle)) return "project" as const;
  if (/校园|社团|campus/i.test(section.detectedTitle)) return "campus" as const;
  return section.sectionType === "unknown" ? "custom" as const : "work" as const;
}

function appendStructuredFact(
  target: NonNullable<CareerProfile["structuredFacts"]>,
  draft: ImportedResumeDraft,
  item: ImportedResumeItem,
  refs: BranchFactRef[]
) {
  if (!item.structuredItem || target.some((entry) => entry.data.id === item.structuredItem?.id)) return;
  target.push({
    data: item.structuredItem,
    factIds: refs.map((ref) => "factId" in ref ? ref.factId : ref.linkedFactId),
    sourceBlockIds: item.sourceBlockIds,
    sourceRanges: item.sourceRanges ?? [],
    sourceExcerpt: item.rawText,
    mappingTrace: itemMappingTrace(draft, item)
  });
}

function itemMappingTrace(draft: ImportedResumeDraft, item: ImportedResumeItem) {
  if (draft.schemaVersion !== "resume-import-v2") return item.structuredMappingTrace;
  const candidates = draft.fieldCandidates
    .filter((candidate) =>
      candidate.itemId === item.id
      && candidate.reviewStatus !== "rejected"
      && candidate.reviewStatus !== "needs_review"
      && !candidate.needsConfirmation
    )
    .map((candidate) => ({
      sourceBlockIds: candidate.sourceBlockIds,
      sourceQuote: candidate.sourceQuote,
      targetFieldId: candidate.targetFieldId,
      confidence: candidate.confidence,
      needsConfirmation: false,
      mappingReason: candidate.mappingReason
    }));
  return [...item.structuredMappingTrace, ...candidates];
}

function structuredBodyText(item: ResumeItemV2) {
  if (item.sectionType === "summary") return item.text;
  if ("highlights" in item && item.highlights.length > 0) return item.highlights.join("\n");
  if ("description" in item && item.description) return item.description;
  return "";
}

function projectStructuredItemForLegacy(item: ResumeItemV2) {
  if (item.sectionType === "summary") return item.text;
  const header = item.sectionType === "education"
    ? [item.school, item.degree, item.major]
    : item.sectionType === "project"
      ? [item.title, item.role]
      : ["organization" in item ? item.organization : undefined, "role" in item ? item.role : undefined];
  const location = "location" in item ? item.location : undefined;
  const dateRange = "startDate" in item
    ? [item.startDate, "current" in item && item.current ? "至今" : item.endDate].filter(Boolean).join(" - ")
    : item.sectionType === "awards" ? item.awardedAt : undefined;
  const named = item.sectionType === "awards" || item.sectionType === "certificates" || item.sectionType === "skills"
    ? item.name
    : item.sectionType === "languages" ? item.language : undefined;
  const body = structuredBodyText(item);
  return [
    [...header, named, location].filter(Boolean).join(" | "),
    dateRange,
    body
  ].filter(Boolean).join("\n");
}

function structuredOrganization(item: ResumeItemV2 | undefined) {
  if (!item) return undefined;
  if (item.sectionType === "education") return item.school;
  if (item.sectionType === "project") return item.title;
  if ("organization" in item) return item.organization;
  if (item.sectionType === "awards" || item.sectionType === "certificates" || item.sectionType === "skills") return item.name;
  if (item.sectionType === "languages") return item.language;
  return undefined;
}

function structuredRole(item: ResumeItemV2 | undefined) {
  if (!item) return undefined;
  if (item.sectionType === "education") return item.degree ?? item.major;
  if (item.sectionType === "project") return item.role;
  if ("role" in item) return item.role;
  return undefined;
}

function legacyFallbackStructuredItem(item: BranchContentItem, section: ImportedResumeSection): ResumeItemV2 {
  const base = { id: item.id, description: item.text, highlights: [], customFields: [] };
  const category = sectionCategory(section);
  if (category === "summary") return { id: item.id, sectionType: "summary", text: item.text, customFields: [] };
  if (category === "education") return { ...base, sectionType: "education", courses: [], honors: [], current: false };
  if (category === "project") return { ...base, sectionType: "project", tools: [], outcomes: [], current: false };
  if (category === "campus") return { ...base, sectionType: "campus", current: false };
  if (category === "internship") return { ...base, sectionType: "internship", current: false };
  if (category === "skill") return { id: item.id, sectionType: "skills", name: firstLine(item.text), description: item.text, customFields: [] };
  if (category === "certificate") return { id: item.id, sectionType: "certificates", name: firstLine(item.text), description: item.text, customFields: [] };
  if (category === "award") return { id: item.id, sectionType: "awards", name: firstLine(item.text), description: item.text, customFields: [] };
  if (category === "language") return { id: item.id, sectionType: "languages", language: firstLine(item.text), description: item.text, customFields: [] };
  if (category === "work") return { ...base, sectionType: "work", current: false };
  return { ...base, sectionType: "other" };
}

function stringifySourceValue(value: unknown) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function inferOrganization(section: ImportedResumeSection, item: ImportedResumeItem) {
  const line = firstLine(item.normalizedText);
  const parts = line.split(/\s{2,}|[|｜]/).map((part) => part.trim()).filter(Boolean);
  return parts[0] || section.detectedTitle || "导入简历";
}

function inferRole(section: ImportedResumeSection, item: ImportedResumeItem) {
  const line = firstLine(item.normalizedText);
  const parts = line.split(/\s{2,}|[|｜]/).map((part) => part.trim()).filter(Boolean);
  return parts[1] || section.detectedTitle || line.slice(0, 60) || "导入条目";
}

function splitSkillText(text: string) {
  const parts = text
    .split(/[，,、;；\n]/)
    .map((part) => part.trim().replace(/^[-*•·●▪]\s*/, ""))
    .filter((part) => part.length > 0 && part.length <= 80);
  return parts.length > 0 ? uniqueStrings(parts) : [firstLine(text)];
}

function firstLine(text: string) {
  return text.split(/\n+/).map((line) => line.trim()).find(Boolean) ?? text.trim();
}

function normalizeFactKey(statement: string) {
  return statement.replace(/\s+/g, "").toLowerCase();
}

function collectFactKeys(profile: CareerProfile) {
  return [
    ...profile.experiences.flatMap((experience) => experience.facts.map((fact) => normalizeFactKey(fact.statement))),
    ...profile.skills.flatMap((skill) => skill.fact ? [normalizeFactKey(skill.fact.statement)] : []),
    ...profile.certificates.flatMap((certificate) => certificate.fact ? [normalizeFactKey(certificate.fact.statement)] : [])
  ];
}

function findExistingFactRefs(profile: CareerProfile, statement: string): BranchFactRef[] {
  const key = normalizeFactKey(statement);
  for (const experience of profile.experiences) {
    const fact = experience.facts.find((candidate) => normalizeFactKey(candidate.statement) === key);
    if (fact) return [{ type: "experience_fact", experienceId: experience.id, factId: fact.id }];
  }
  for (const skill of profile.skills) {
    if (skill.fact && normalizeFactKey(skill.fact.statement) === key) return [{ type: "skill_fact", skillId: skill.id, factId: skill.fact.id }];
  }
  for (const certificate of profile.certificates) {
    if (certificate.fact && normalizeFactKey(certificate.fact.statement) === key) return [{ type: "certificate_fact", certificateId: certificate.id, factId: certificate.fact.id }];
  }
  return [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
