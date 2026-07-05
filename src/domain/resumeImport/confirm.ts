import { nanoid } from "nanoid";
import {
  BranchContentItemSchema,
  CareerProfileSchema,
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
  type ResumeRevision
} from "@/domain/schemas";
import { createResumeRevision } from "@/domain/branch/revision";
import { computeGeneralBranchSyncStatus } from "@/domain/branch/validation";
import { locatePdfSourceQuote } from "@/domain/pdfImport/sourceMapping";

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
  operationId: string;
  now?: string;
}): ResumeImportConfirmationBuildResult {
  const now = input.now ?? new Date().toISOString();
  const { profile, factMappings } = mergeImportedProfile({
    draft: input.draft,
    existingProfile: input.existingProfile,
    mergeDecisions: input.mergeDecisions ?? [],
    now
  });
  const contentItems = buildBranchContentItems({
    draft: input.draft,
    factMappings,
    now
  });

  if (contentItems.length === 0) {
    throw new Error("resume_import_no_confirmed_content");
  }

  const branchBase = ResumeBranchSchema.parse({
    id: `branch-general-${input.draft.importId}-${nanoid(6)}`,
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
    contentItems,
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

function mergeImportedProfile(input: {
  draft: ImportedResumeDraft;
  existingProfile?: CareerProfile;
  mergeDecisions: ImportMergeDecision[];
  now: string;
}): { profile: CareerProfile; factMappings: FactMapping[] } {
  const existing = input.existingProfile;
  const profileId = existing?.id ?? `profile-${nanoid(10)}`;
  const basics = mergeBasics(input.draft, existing, input.mergeDecisions);
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
  const unclassifiedBlocks = [...baseProfile.unclassifiedBlocks];

  for (const section of input.draft.sections.filter((item) => item.included)) {
    for (const item of section.items.filter(canImportItem)) {
      const factKey = normalizeFactKey(item.normalizedText);
      if (existingFactKeys.has(factKey)) {
        continue;
      }
      existingFactKeys.add(factKey);

      if (section.sectionType === "skills") {
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
        continue;
      }

      if (section.sectionType === "certificates") {
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
        continue;
      }

      const experienceId = `exp-${nanoid(10)}`;
      const fact = createImportedFact({
        draft: input.draft,
        item,
        statement: item.normalizedText,
        category: section.sectionType === "summary" ? "other" : importedSectionFactCategory(section),
        now: input.now
      });
      experiences.push({
        id: experienceId,
        type: section.sectionType === "summary" ? "other" : importedExperienceType(section),
        organization: inferOrganization(section, item),
        role: inferRole(section, item),
        facts: [fact],
        resumeDrafts: [{
          id: `draft-${nanoid(10)}`,
          text: item.normalizedText,
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

      if (section.sectionType === "unknown") {
        unclassifiedBlocks.push(item.normalizedText);
      }
    }
  }

  return {
    profile: CareerProfileSchema.parse({
      ...baseProfile,
      experiences,
      skills,
      certificates,
      unclassifiedBlocks,
      updatedAt: input.now
    }),
    factMappings
  };
}

function buildBranchContentItems(input: {
  draft: ImportedResumeDraft;
  factMappings: FactMapping[];
  now: string;
}): BranchContentItem[] {
  const factRefsByItem = new Map(input.factMappings.map((mapping) => [mapping.itemId, mapping.factRefs]));
  let order = 0;
  return input.draft.sections
    .filter((section) => section.included)
    .flatMap((section) => section.items.map((item) => ({ section, item })))
    .filter(({ item }) => canImportItem(item))
    .map(({ section, item }) => {
      const factRefs = factRefsByItem.get(item.id) ?? [];
      if (factRefs.length === 0) {
        return undefined;
      }
      return BranchContentItemSchema.parse({
        id: `branch-item-import-${item.id}`,
        itemType: importedSectionItemType(section),
        source: "resume_import",
        sourceSectionId: section.id,
        text: item.normalizedText,
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
    })
    .filter((item): item is BranchContentItem => Boolean(item));
}

function mergeBasics(
  draft: ImportedResumeDraft,
  existingProfile: CareerProfile | undefined,
  decisions: ImportMergeDecision[]
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
    name: choose("name", existing?.name, draft.basics.name?.value) ?? "未命名",
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
  const sourceType = input.item.sourceStatus === "user_confirmed_modified" ? "user_input" : "pdf_import";
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
  if (section.sectionType === "summary") {
    return "summary";
  }
  if (section.sectionType === "skills") {
    return "skill";
  }
  if (section.sectionType === "certificates") {
    return "certificate";
  }
  if (section.sectionType === "unknown") {
    return "custom";
  }
  return "experience";
}

function importedSectionFactCategory(section: ImportedResumeSection): FactCategory {
  if (section.sectionType === "skills") {
    return "skill";
  }
  if (section.sectionType === "certificates") {
    return "certificate";
  }
  if (/教育|education/i.test(section.detectedTitle)) {
    return "education";
  }
  return section.sectionType === "unknown" ? "other" : "experience";
}

function importedExperienceType(section: ImportedResumeSection): CareerProfile["experiences"][number]["type"] {
  if (/教育|education/i.test(section.detectedTitle)) {
    return "education";
  }
  if (/实习|intern/i.test(section.detectedTitle)) {
    return "internship";
  }
  if (/项目|project/i.test(section.detectedTitle)) {
    return "project";
  }
  if (/校园|社团|campus/i.test(section.detectedTitle)) {
    return "campus";
  }
  if (/工作|work|experience/i.test(section.detectedTitle)) {
    return "work";
  }
  return "other";
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
