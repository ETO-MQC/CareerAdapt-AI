import {
  AiCareerAdaptResumeV2MapperOutputSchema,
  CareerAdaptResumeJsonV2Schema,
  ResumeItemV2Schema,
  type AiCareerAdaptResumeV2MapperOutput,
  type AiResumeSourceRef,
  type CareerAdaptResumeJsonV2,
  type ResumeItemV2,
  type ResumeSectionTypeV2
} from "@/domain/schemas";
import { getResumeSectionDefinition } from "@/domain/resumeFields";

const OUTPUT_KEYS = new Set(["resume", "sourceRefs", "unclassifiedRefs", "mapperDiagnostics"]);
const RESUME_KEYS = new Set(["schemaVersion", "locale", "basics", "sections", "unclassifiedBlocks"]);
const BASIC_KEYS = new Set([
  "name", "photo", "headline", "targetRole", "summary", "phone", "email", "location",
  "homepage", "linkedin", "github", "portfolioLinks", "otherLinks", "links", "customFields"
]);
const SECTION_KEYS = new Set(["id", "sectionType", "title", "order", "visible", "items", "customFields"]);
const SOURCE_REF_KEYS = new Set(["path", "blockIds", "confidenceLevel", "confidenceReason", "needsConfirmation"]);
const WRAPPER_KEYS = ["resume", "draft", "result"] as const;
const SECTION_TYPES = new Set<Exclude<ResumeSectionTypeV2, "basics">>([
  "summary", "education", "work", "internship", "project", "research", "campus",
  "volunteer", "awards", "skills", "certificates", "languages", "publications",
  "patents", "portfolio", "other", "custom"
]);

const BASIC_FIELD_KEYS = [
  "name", "photo", "headline", "summary", "phone", "email", "location", "homepage",
  "linkedin", "github", "portfolioLinks", "otherLinks"
] as const;
const COMMON_EXPERIENCE_FIELDS = [
  "organization", "role", "department", "location", "startDate", "endDate", "current",
  "description", "highlights"
] as const;
const SECTION_ITEM_FIELDS = {
  summary: ["text"],
  education: [
    "school", "major", "degree", "department", "location", "startDate", "endDate",
    "current", "gpa", "gpaScale", "rankPosition", "rankTotal", "courses", "honors",
    "description", "highlights"
  ],
  work: COMMON_EXPERIENCE_FIELDS,
  internship: COMMON_EXPERIENCE_FIELDS,
  project: [
    "title", "role", "organization", "location", "startDate", "endDate", "current",
    "url", "tools", "background", "description", "highlights", "outcomes"
  ],
  research: [
    "title", "authorRole", "institution", "startDate", "endDate", "current", "methods",
    "samples", "publication", "publicationStatus", "url", "description", "highlights"
  ],
  campus: COMMON_EXPERIENCE_FIELDS,
  volunteer: COMMON_EXPERIENCE_FIELDS,
  awards: ["name", "issuer", "level", "awardedAt", "rank", "description"],
  skills: ["name", "category", "level", "description"],
  certificates: ["name", "issuer", "issuedAt", "expiresAt", "credentialId", "status", "description"],
  languages: ["language", "level", "testName", "score", "description"],
  publications: ["title", "authors", "authorRole", "publisher", "publishedAt", "status", "doi", "url", "description"],
  patents: ["title", "inventors", "patentNumber", "office", "filedAt", "grantedAt", "status", "url", "description"],
  portfolio: ["title", "type", "role", "url", "createdAt", "tools", "description", "highlights"],
  other: ["title", "description", "highlights"],
  custom: ["title", "description", "highlights"]
} as const satisfies Record<Exclude<ResumeSectionTypeV2, "basics">, readonly string[]>;

const ARRAY_FIELDS = new Set([
  "portfolioLinks", "otherLinks", "links", "courses", "honors", "highlights",
  "tools", "outcomes", "methods", "authors", "inventors"
]);
const NUMBER_FIELDS = new Set(["gpa", "gpaScale", "rankPosition", "rankTotal"]);
const DATE_FIELDS = new Set([
  "startDate", "endDate", "awardedAt", "issuedAt", "expiresAt", "publishedAt",
  "filedAt", "grantedAt", "createdAt"
]);
const CURRENT_WORD_PATTERN = /(?:至今|现在|目前|current|present|ongoing|now)/iu;
const INVALID_DATE_WORD_PATTERN = /^(?:至今|现在|目前|current|present|ongoing|now|实习期间|期间)$/iu;

export type ResumeMapperCoercionIssue = {
  path: PropertyKey[];
  code: "unrecognized_keys" | "ambiguous_wrapper" | "legacy_structured_draft";
  keys?: string[];
};

export class ResumeDocumentMapperCoercionError extends Error {
  constructor(readonly issues: ResumeMapperCoercionIssue[]) {
    super("resume_document_mapper_output_cannot_be_safely_coerced");
  }
}

type AuthoritativeSourceBlock = {
  id?: unknown;
  originalBlockId?: unknown;
  text?: unknown;
};

export type ResumeMapperBoundaryDiagnostics = {
  shapeRepairs: string[];
  evidenceRepairs: string[];
  rejectedFields: Array<{ path: string; reason: "ai_field_not_grounded" }>;
  localNormalizationMs: number;
  groundedFieldCount: number;
  repairedFieldCount: number;
  rejectedFieldCount: number;
};

type SourceEvidenceIndex = {
  textsById: ReadonlyMap<string, string[]>;
};

type ItemWithRef = {
  item: ResumeItemV2;
  ref?: AiResumeSourceRef;
};

type SectionWithRefs = {
  id?: string;
  sectionType: Exclude<ResumeSectionTypeV2, "basics">;
  title?: string;
  visible: boolean;
  order: number;
  items: ItemWithRef[];
};

export function normalizeResumeMapperBoundaryOutput(
  rawOutput: unknown,
  authoritativeSourceBlocks: readonly AuthoritativeSourceBlock[] = []
): AiCareerAdaptResumeV2MapperOutput {
  const startedAt = Date.now();
  const diagnostics: ResumeMapperBoundaryDiagnostics = {
    shapeRepairs: [],
    evidenceRepairs: [],
    rejectedFields: [],
    localNormalizationMs: 0,
    groundedFieldCount: 0,
    repairedFieldCount: 0,
    rejectedFieldCount: 0
  };
  const preNormalized = coerceRawCanonicalOutput(rawOutput, diagnostics);
  const parsed = AiCareerAdaptResumeV2MapperOutputSchema.omit({ mapperDiagnostics: true }).parse(preNormalized);
  const evidenceIndex = buildEvidenceIndex(authoritativeSourceBlocks);
  const sourceRefs = parsed.sourceRefs.map(normalizeSourceRefPath);
  const refLookup = new SourceRefLookup(sourceRefs, evidenceIndex);
  const unclassifiedRefs = [...parsed.unclassifiedRefs];
  const rejectedSourceIds = new Set<string>();

  const basics = normalizeBasics(parsed.resume.basics, refLookup, diagnostics, rejectedSourceIds);
  const mergedSections = mergeSections(
    parsed.resume.sections.map((section, sectionIndex): SectionWithRefs => {
      const sectionType = section.sectionType;
      const itemFields = SECTION_ITEM_FIELDS[sectionType];
      return {
        id: cleanString(section.id),
        sectionType,
        title: cleanString(section.title),
        visible: section.visible ?? true,
        order: section.order ?? sectionIndex,
        items: section.items.flatMap((rawItem, itemIndex) => {
          const itemPath = `/sections/${sectionIndex}/items/${itemIndex}`;
          const normalized = normalizeItem({
            rawItem: rawItem as Record<string, unknown>,
            sectionType,
            itemFields,
            itemPath,
            refLookup,
            diagnostics,
            rejectedSourceIds
          });
          return normalized ? [normalized] : [];
        })
      };
    })
  );

  const sections = mergedSections.map((section, sectionIndex) => ({
    id: section.id ?? `ai-section-${section.sectionType}-${sectionIndex + 1}`,
    sectionType: section.sectionType,
    title: section.title ?? getResumeSectionDefinition(section.sectionType).label,
    order: sectionIndex,
    visible: section.visible,
    items: section.items.map(({ item }, itemIndex) =>
      ResumeItemV2Schema.parse({
        ...item,
        id: cleanString(item.id) ?? `ai-${section.sectionType}-${sectionIndex + 1}-${itemIndex + 1}`
      })
    )
  }));

  const canonicalResume = CareerAdaptResumeJsonV2Schema.parse({
    schemaVersion: "careeradapt-resume-v2",
    locale: cleanString(parsed.resume.locale) ?? "zh-CN",
    basics,
    sections,
    unclassifiedBlocks: []
  });
  const finalSourceRefs = [
    ...sourceRefs.filter((ref) => ref.path.startsWith("/basics/") && hasCanonicalBasicPath(canonicalResume, ref.path)),
    ...mergedSections.flatMap((section, sectionIndex) =>
      section.items.flatMap(({ ref }, itemIndex) => ref
        ? [{
            ...ref,
            path: `/sections/${sectionIndex}/items/${itemIndex}`,
            blockIds: existingSourceIds(ref.blockIds, evidenceIndex)
          }]
        : [])
    )
  ].filter((ref) => ref.blockIds.length > 0);

  for (const blockId of rejectedSourceIds) {
    unclassifiedRefs.push({ blockIds: [blockId], reason: "AI 字段未通过来源核验，已隔离待核对。" });
  }
  diagnostics.localNormalizationMs = Math.max(0, Date.now() - startedAt);
  diagnostics.rejectedFieldCount = diagnostics.rejectedFields.length;
  diagnostics.repairedFieldCount = diagnostics.shapeRepairs.length + diagnostics.evidenceRepairs.length;
  const factualFieldCount = diagnostics.groundedFieldCount + diagnostics.rejectedFieldCount;
  const fabricatedSourceIdCount = refLookup.fabricatedSourceIdCount;
  if (
    (diagnostics.rejectedFieldCount >= 3 && diagnostics.rejectedFieldCount / Math.max(1, factualFieldCount) >= 0.5)
    || fabricatedSourceIdCount >= 3
  ) {
    throw new Error("resume_document_mapper_systematic_grounding_failure");
  }

  return AiCareerAdaptResumeV2MapperOutputSchema.parse({
    resume: canonicalResume,
    sourceRefs: dedupeSourceRefs(finalSourceRefs),
    unclassifiedRefs: dedupeUnclassifiedRefs(unclassifiedRefs),
    mapperDiagnostics: diagnostics
  });
}

export function coerceResumeDocumentMapperOutput(rawOutput: unknown): unknown {
  const normalized = normalizeResumeMapperBoundaryOutput(rawOutput);
  return { resume: normalized.resume, sourceRefs: normalized.sourceRefs, unclassifiedRefs: normalized.unclassifiedRefs };
}

function coerceRawCanonicalOutput(
  rawOutput: unknown,
  diagnostics: ResumeMapperBoundaryDiagnostics
): unknown {
  const output = unwrapOutput(rawOutput);
  if (!isRecord(output)) return output;
  if ("structuredDraft" in output) {
    throw new ResumeDocumentMapperCoercionError([{ path: [], code: "legacy_structured_draft" }]);
  }
  assertNoUnknownKeys(output, OUTPUT_KEYS, []);
  const resume = isRecord(output.resume) ? sanitizeRecord(output.resume) : {};
  assertNoUnknownKeys(resume, RESUME_KEYS, ["resume"]);
  coerceBasics(resume, diagnostics);
  coerceSections(resume, diagnostics);
  const sourceRefs = coerceSourceRefs(output, diagnostics);
  const unclassifiedRefs = coerceUnclassifiedRefs(output, sourceRefs, diagnostics);
  return { resume, sourceRefs, unclassifiedRefs };
}

function unwrapOutput(rawOutput: unknown): unknown {
  if (!isRecord(rawOutput)) return rawOutput;
  if ("resume" in rawOutput) return rawOutput;
  if (looksLikeCanonicalResume(rawOutput)) return { resume: rawOutput };
  const candidates = WRAPPER_KEYS.flatMap((key) => {
    const value = rawOutput[key];
    return isRecord(value) && ("resume" in value || looksLikeCanonicalResume(value))
      ? [{ key, value }]
      : [];
  });
  if (candidates.length > 1) {
    throw new ResumeDocumentMapperCoercionError([{
      path: [],
      code: "ambiguous_wrapper",
      keys: candidates.map((candidate) => candidate.key)
    }]);
  }
  return candidates.length === 1 ? unwrapOutput(candidates[0].value) : rawOutput;
}

function coerceBasics(resume: Record<string, unknown>, diagnostics: ResumeMapperBoundaryDiagnostics) {
  const basics = isRecord(resume.basics) ? sanitizeRecord(resume.basics) : {};
  applyAlias(basics, "objective", "headline", diagnostics, "basic_objective_to_headline");
  applyAlias(basics, "position", "headline", diagnostics, "basic_position_to_headline");
  if (!hasFactualData(basics.headline) && hasFactualData(basics.targetRole)) {
    basics.headline = basics.targetRole;
    addRepair(diagnostics.shapeRepairs, "target_role_to_headline");
  }
  const linkAliases = ["website", "url", "portfolio", "portfolioUrls", "socialLinks"];
  const links = [
    ...normalizeStringList(basics.links),
    ...linkAliases.flatMap((key) => {
      const values = normalizeStringList(basics[key]);
      if (key in basics) {
        delete basics[key];
        if (values.length) addRepair(diagnostics.shapeRepairs, "basic_link_alias_to_other_links");
      }
      return values;
    })
  ];
  if (links.length) basics.otherLinks = [...normalizeStringList(basics.otherLinks), ...links];
  delete basics.links;
  delete basics.targetRole;
  assertNoUnknownKeys(basics, BASIC_KEYS, ["resume", "basics"]);
  resume.basics = basics;
}

function coerceSections(resume: Record<string, unknown>, diagnostics: ResumeMapperBoundaryDiagnostics) {
  if (!Array.isArray(resume.sections)) {
    resume.sections = [];
    return;
  }
  resume.sections = resume.sections.flatMap((sectionValue, sectionIndex) => {
    if (!isRecord(sectionValue)) return [];
    const section = sanitizeRecord(sectionValue);
    applyAlias(section, "type", "sectionType", diagnostics, "section_type_alias");
    applyAlias(section, "sectionName", "title", diagnostics, "section_name_alias");
    applyAlias(section, "name", "title", diagnostics, "section_name_alias");
    delete section.category;
    delete section.included;
    assertNoUnknownKeys(section, SECTION_KEYS, ["resume", "sections", sectionIndex]);
    const sectionType = typeof section.sectionType === "string" && SECTION_TYPES.has(section.sectionType as Exclude<ResumeSectionTypeV2, "basics">)
      ? section.sectionType as Exclude<ResumeSectionTypeV2, "basics">
      : undefined;
    if (!sectionType) return [];
    section.items = Array.isArray(section.items)
      ? section.items.flatMap((item, itemIndex) =>
          isRecord(item) ? [coerceItem(item, sectionType, diagnostics, ["resume", "sections", sectionIndex, "items", itemIndex])] : []
        )
      : [];
    return [section];
  });
}

function coerceItem(
  value: Record<string, unknown>,
  sectionType: Exclude<ResumeSectionTypeV2, "basics">,
  diagnostics: ResumeMapperBoundaryDiagnostics,
  path: PropertyKey[]
) {
  const item = sanitizeRecord(value);
  item.sectionType = sectionType;
  delete item.mapping;
  delete item.included;
  if (sectionType !== "skills" && sectionType !== "portfolio" && "category" in item) {
    delete item.category;
    addRepair(diagnostics.shapeRepairs, "generic_item_category_omitted");
  }
  const alias = (from: string, to: string, repair: string) => applyAlias(item, from, to, diagnostics, repair);
  if (sectionType === "education") {
    alias("institution", "school", "education_institution_to_school");
    alias("university", "school", "education_university_to_school");
    alias("organization", "school", "education_organization_to_school");
    alias("fieldOfStudy", "major", "education_field_to_major");
    alias("qualification", "degree", "education_qualification_to_degree");
  } else if (["work", "internship", "campus", "volunteer"].includes(sectionType)) {
    alias("company", "organization", "experience_company_to_organization");
    alias("institution", "organization", "experience_institution_to_organization");
    alias("position", "role", "experience_position_to_role");
    alias("jobTitle", "role", "experience_job_title_to_role");
    alias("title", "role", "experience_title_to_role");
    alias("bullets", "highlights", "bullets_to_highlights");
    alias("responsibilities", "highlights", "responsibilities_to_highlights");
    alias("achievements", "highlights", "achievements_to_highlights");
  } else if (sectionType === "project") {
    alias("name", "title", "project_name_to_title");
    alias("projectName", "title", "project_name_to_title");
    alias("position", "role", "project_position_to_role");
    alias("company", "organization", "project_company_to_organization");
    alias("technologies", "tools", "project_technologies_to_tools");
    alias("techStack", "tools", "project_tech_stack_to_tools");
    alias("bullets", "highlights", "bullets_to_highlights");
    alias("achievements", "highlights", "achievements_to_highlights");
    alias("responsibilities", "highlights", "responsibilities_to_highlights");
    alias("results", "outcomes", "project_results_to_outcomes");
    alias("impact", "outcomes", "project_impact_to_outcomes");
    alias("content", "description", "content_to_description");
    alias("details", "description", "details_to_description");
  } else if (sectionType === "research") {
    alias("name", "title", "research_name_to_title");
    alias("role", "authorRole", "research_role_to_author_role");
    alias("organization", "institution", "research_organization_to_institution");
    alias("methodology", "methods", "research_methodology_to_methods");
    alias("bullets", "highlights", "bullets_to_highlights");
  } else if (sectionType === "skills") {
    alias("skill", "name", "skill_alias_to_name");
    alias("skillName", "name", "skill_alias_to_name");
    alias("title", "name", "skill_title_to_name");
    alias("text", "name", "skill_text_to_name");
    alias("group", "category", "skill_group_to_category");
  } else if (sectionType === "awards") {
    alias("title", "name", "award_title_to_name");
    alias("organization", "issuer", "award_organization_to_issuer");
    alias("date", "awardedAt", "award_date_to_awarded_at");
  } else if (sectionType === "certificates") {
    alias("title", "name", "certificate_title_to_name");
    alias("organization", "issuer", "certificate_organization_to_issuer");
    alias("date", "issuedAt", "certificate_date_to_issued_at");
    alias("expiryDate", "expiresAt", "certificate_expiry_to_expires_at");
  } else if (sectionType === "languages") {
    alias("name", "language", "language_name_to_language");
    alias("proficiency", "level", "language_proficiency_to_level");
  } else if (sectionType === "publications") {
    alias("name", "title", "publication_name_to_title");
    alias("journal", "publisher", "publication_journal_to_publisher");
    alias("date", "publishedAt", "publication_date_to_published_at");
  } else if (sectionType === "patents") {
    alias("name", "title", "patent_name_to_title");
    alias("number", "patentNumber", "patent_number_alias");
  } else if (sectionType === "portfolio") {
    alias("name", "title", "portfolio_name_to_title");
    alias("category", "type", "portfolio_category_to_type");
    alias("technologies", "tools", "portfolio_technologies_to_tools");
  } else {
    alias("text", "description", "text_to_description");
    alias("bullets", "highlights", "bullets_to_highlights");
  }
  const allowed = new Set(["id", "sectionType", "customFields", ...SECTION_ITEM_FIELDS[sectionType]]);
  assertNoUnknownKeys(item, allowed, path);
  return item;
}

function coerceSourceRefs(
  output: Record<string, unknown>,
  diagnostics: ResumeMapperBoundaryDiagnostics
) {
  const sourceRefs = Array.isArray(output.sourceRefs) ? output.sourceRefs : [];
  return sourceRefs.flatMap((sourceRef, index) => {
    if (!isRecord(sourceRef)) return [];
    const ref = sanitizeRecord(sourceRef);
    if ("sourceValues" in ref) {
      delete ref.sourceValues;
      addRepair(diagnostics.shapeRepairs, "source_values_omitted");
    }
    applyAlias(ref, "sourcePaths", "blockIds", diagnostics, "source_paths_to_block_ids");
    applyAlias(ref, "sourceBlockIds", "blockIds", diagnostics, "source_block_ids_to_block_ids");
    if (ref.path === "/basics/targetRole") {
      ref.path = "/basics/headline";
      addRepair(diagnostics.shapeRepairs, "target_role_source_ref_to_headline");
    }
    assertNoUnknownKeys(ref, SOURCE_REF_KEYS, ["sourceRefs", index]);
    return [ref];
  });
}

function coerceUnclassifiedRefs(
  output: Record<string, unknown>,
  sourceRefs: unknown[],
  diagnostics: ResumeMapperBoundaryDiagnostics
) {
  const explicitRefs = Array.isArray(output.unclassifiedRefs) ? output.unclassifiedRefs : [];
  const legacyBlocks = Array.isArray(output.unclassifiedBlocks) ? output.unclassifiedBlocks : [];
  const convertedLegacy = legacyBlocks.flatMap((block) => {
    if (!isRecord(block) || typeof block.sourcePath !== "string") return [];
    addRepair(diagnostics.shapeRepairs, "legacy_unclassified_block_to_ref");
    return [{ blockIds: [block.sourcePath], reason: typeof block.reason === "string" ? block.reason : "AI marked this source block as unclassified." }];
  });
  const refs = [...explicitRefs, ...convertedLegacy];
  return refs.flatMap((value) => {
    if (!isRecord(value)) return [];
    const blockIds = Array.isArray(value.blockIds)
      ? value.blockIds.filter((blockId): blockId is string => typeof blockId === "string" && blockId.trim().length > 0)
      : [];
    const reason = typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim()
      : "AI marked this source block as unclassified.";
    return blockIds.length ? [{ blockIds, reason }] : [];
  }).filter((ref) =>
    !sourceRefs.some((sourceRef) => {
      if (!isRecord(sourceRef) || !Array.isArray(sourceRef.blockIds)) return false;
      const blockIds = sourceRef.blockIds.filter((blockId): blockId is string => typeof blockId === "string");
      return ref.blockIds.every((blockId) => blockIds.includes(blockId));
    })
  );
}

function normalizeBasics(
  rawBasics: Record<string, unknown>,
  refLookup: SourceRefLookup,
  diagnostics: ResumeMapperBoundaryDiagnostics,
  rejectedSourceIds: Set<string>
) {
  const basics: Record<string, unknown> = { customFields: [] };
  for (const key of BASIC_FIELD_KEYS) {
    const raw = rawBasics[key];
    if (raw === undefined || raw === null) continue;
    if (ARRAY_FIELDS.has(key)) {
      const values = normalizeStringList(raw).flatMap((value, index) => {
        const path = `/basics/${key}/${index}`;
        const refs = refLookup.refsForField(path, `/basics/${key}`);
        return groundFactualValue(value, refs, refLookup, diagnostics, path, rejectedSourceIds)
          ? [value]
          : [];
      });
      if (values.length) basics[key] = values;
      continue;
    }
    const value = cleanString(raw);
    if (!value) continue;
    const path = `/basics/${key}`;
    if (groundFactualValue(value, refLookup.refsForField(path), refLookup, diagnostics, path, rejectedSourceIds)) {
      basics[key] = value;
    }
  }
  return basics;
}

function normalizeItem(input: {
  rawItem: Record<string, unknown>;
  sectionType: Exclude<ResumeSectionTypeV2, "basics">;
  itemFields: readonly string[];
  itemPath: string;
  refLookup: SourceRefLookup;
  diagnostics: ResumeMapperBoundaryDiagnostics;
  rejectedSourceIds: Set<string>;
}): ItemWithRef | undefined {
  const item: Record<string, unknown> = {
    id: cleanString(input.rawItem.id) ?? `ai-temp-${input.sectionType}-${input.itemPath.replace(/\W+/g, "-")}`,
    sectionType: input.sectionType,
    customFields: []
  };
  const itemRefs = input.refLookup.refsForField(input.itemPath);
  const keptRefs: AiResumeSourceRef[] = [...itemRefs];
  for (const field of input.itemFields) {
    const raw = input.rawItem[field];
    if (raw === undefined || raw === null) continue;
    const fieldPath = `${input.itemPath}/${field}`;
    const refs = input.refLookup.refsForField(fieldPath, input.itemPath);
    if (ARRAY_FIELDS.has(field)) {
      const values = normalizeStringList(raw).flatMap((value, index) => {
        const elementPath = `${fieldPath}/${index}`;
        const elementRefs = input.refLookup.refsForField(elementPath, fieldPath, input.itemPath);
        if (groundFactualValue(value, elementRefs, input.refLookup, input.diagnostics, elementPath, input.rejectedSourceIds)) {
          keptRefs.push(...elementRefs);
          return [value];
        }
        return [];
      });
      item[field] = values;
      continue;
    }
    if (NUMBER_FIELDS.has(field)) {
      const numberValue = typeof raw === "number" ? raw : Number(cleanString(raw));
      if (!Number.isFinite(numberValue)) continue;
      if (groundFactualValue(numberValue, refs, input.refLookup, input.diagnostics, fieldPath, input.rejectedSourceIds)) {
        item[field] = numberValue;
        keptRefs.push(...refs);
      }
      continue;
    }
    if (field === "current") {
      const current = normalizeBoolean(raw);
      if (!current) continue;
      if (groundCurrent(refs, input.refLookup, input.diagnostics, fieldPath, input.rejectedSourceIds)) {
        item.current = true;
        keptRefs.push(...refs);
      }
      continue;
    }
    const value = DATE_FIELDS.has(field) ? normalizeDateValue(raw) : cleanString(raw);
    if (!value) continue;
    if (DATE_FIELDS.has(field) && field === "endDate" && CURRENT_WORD_PATTERN.test(cleanString(raw) ?? "")) {
      item.current = true;
      continue;
    }
    if (groundFactualValue(value, refs, input.refLookup, input.diagnostics, fieldPath, input.rejectedSourceIds)) {
      item[field] = value;
      keptRefs.push(...refs);
    }
  }
  if (item.current === true) delete item.endDate;
  if (!("current" in item) && hasCurrentField(input.sectionType)) item.current = false;
  for (const field of input.itemFields) {
    if (ARRAY_FIELDS.has(field) && !Array.isArray(item[field])) item[field] = [];
  }
  if (!hasMeaningfulItemValue(item)) {
    rejectField(input.diagnostics, input.itemPath, itemRefs, input.refLookup, input.rejectedSourceIds);
    return undefined;
  }
  const parsed = ResumeItemV2Schema.safeParse(item);
  if (!parsed.success) {
    rejectField(input.diagnostics, input.itemPath, itemRefs, input.refLookup, input.rejectedSourceIds);
    return undefined;
  }
  return { item: parsed.data, ref: mergeRefs(input.itemPath, keptRefs) };
}

function mergeSections(sections: SectionWithRefs[]): SectionWithRefs[] {
  const merged = new Map<string, SectionWithRefs>();
  for (const section of [...sections].sort((left, right) => left.order - right.order)) {
    const key = `${section.sectionType}:${normalizeComparable(section.title ?? getResumeSectionDefinition(section.sectionType).label)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...section,
        title: section.title ?? getResumeSectionDefinition(section.sectionType).label,
        items: [...section.items]
      });
      continue;
    }
    existing.items.push(...section.items);
    existing.visible = existing.visible || section.visible;
  }
  return [...merged.values()].map((section, order) => ({ ...section, order }));
}

function groundFactualValue(
  value: string | number,
  refs: readonly AiResumeSourceRef[],
  lookup: SourceRefLookup,
  diagnostics: ResumeMapperBoundaryDiagnostics,
  path: string,
  rejectedSourceIds: Set<string>
) {
  if (!refs.length) {
    rejectField(diagnostics, path, refs, lookup, rejectedSourceIds);
    return false;
  }
  const texts = lookup.evidenceTexts(refs);
  const grounded = typeof value === "number"
    ? texts.some((text) => normalizeGroundingText(text).includes(normalizeGroundingText(String(value))))
    : texts.some((text) => isGroundedString(value, text));
  if (!grounded) {
    rejectField(diagnostics, path, refs, lookup, rejectedSourceIds);
    return false;
  }
  diagnostics.groundedFieldCount += 1;
  return true;
}

function groundCurrent(
  refs: readonly AiResumeSourceRef[],
  lookup: SourceRefLookup,
  diagnostics: ResumeMapperBoundaryDiagnostics,
  path: string,
  rejectedSourceIds: Set<string>
) {
  if (!refs.length || !lookup.evidenceTexts(refs).some((text) => CURRENT_WORD_PATTERN.test(text))) {
    rejectField(diagnostics, path, refs, lookup, rejectedSourceIds);
    return false;
  }
  diagnostics.groundedFieldCount += 1;
  return true;
}

function rejectField(
  diagnostics: ResumeMapperBoundaryDiagnostics,
  path: string,
  refs: readonly AiResumeSourceRef[],
  lookup: SourceRefLookup,
  rejectedSourceIds: Set<string>
) {
  diagnostics.rejectedFields.push({ path, reason: "ai_field_not_grounded" });
  for (const blockId of refs.flatMap((ref) => lookup.existingBlockIds(ref.blockIds))) {
    rejectedSourceIds.add(blockId);
  }
}

function isGroundedString(value: string, sourceText: string) {
  const fact = cleanString(value);
  if (!fact) return false;
  if (normalizeGroundingText(sourceText).includes(normalizeGroundingText(fact))) return true;
  return DATE_FIELDS.size > 0 && isDateLike(fact) && dateAppearsInSource(fact, sourceText);
}

function normalizeDateValue(value: unknown) {
  const raw = cleanString(value);
  if (!raw || INVALID_DATE_WORD_PATTERN.test(raw)) return undefined;
  const normalized = raw
    .replace(/[./年]/g, "-")
    .replace(/月$/u, "")
    .replace(/--+/g, "-")
    .replace(/-(\d)(?:$|-)/, "-0$1");
  const yearMonth = normalized.match(/^(\d{4})-(\d{1,2})$/);
  if (yearMonth) {
    const month = Number(yearMonth[2]);
    return month >= 1 && month <= 12 ? `${yearMonth[1]}-${String(month).padStart(2, "0")}` : undefined;
  }
  if (/^\d{4}$/.test(normalized)) return normalized;
  return undefined;
}

function dateAppearsInSource(value: string, sourceText: string) {
  const [year, month] = value.split("-");
  if (!sourceText.includes(year)) return false;
  if (!month) return true;
  return new RegExp(`(?:^|\\D)0?${Number(month)}(?:\\D|$)`, "u").test(sourceText);
}

function isDateLike(value: string) {
  return /^\d{4}(?:-\d{2})?$/.test(value);
}

function hasCanonicalBasicPath(resume: CareerAdaptResumeJsonV2, path: string) {
  const key = path.split("/").filter(Boolean)[1];
  if (!key) return false;
  const value = (resume.basics as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
}

function normalizeSourceRefPath(ref: AiResumeSourceRef): AiResumeSourceRef {
  return { ...ref, path: normalizePointer(ref.path) };
}

class SourceRefLookup {
  private readonly fabricatedSourceIds = new Set<string>();

  get fabricatedSourceIdCount() {
    return this.fabricatedSourceIds.size;
  }

  constructor(
    private readonly refs: readonly AiResumeSourceRef[],
    private readonly evidenceIndex: SourceEvidenceIndex
  ) {}

  refsForField(...paths: string[]) {
    const normalized = paths.map(normalizePointer);
    return this.refs.filter((ref) => normalized.includes(normalizePointer(ref.path)));
  }

  evidenceTexts(refs: readonly AiResumeSourceRef[]) {
    const texts = refs.flatMap((ref) =>
      this.existingBlockIds(ref.blockIds).flatMap((blockId) => this.evidenceIndex.textsById.get(blockId) ?? [])
    );
    return [...texts, texts.join(""), texts.join(" ")];
  }

  existingBlockIds(blockIds: readonly string[]) {
    const existing = blockIds.filter((blockId) => this.evidenceIndex.textsById.has(blockId));
    for (const blockId of blockIds) {
      if (!this.evidenceIndex.textsById.has(blockId)) this.fabricatedSourceIds.add(blockId);
    }
    return existing;
  }
}

function buildEvidenceIndex(blocks: readonly AuthoritativeSourceBlock[]): SourceEvidenceIndex {
  const textsById = new Map<string, string[]>();
  for (const block of blocks) {
    const ids = [
      typeof block.id === "string" ? block.id : undefined,
      typeof block.originalBlockId === "string" ? block.originalBlockId : undefined
    ].filter((id): id is string => Boolean(id));
    if (!ids.length || typeof block.text !== "string") continue;
    for (const id of ids) textsById.set(id, [...(textsById.get(id) ?? []), block.text]);
  }
  return { textsById };
}

function mergeRefs(path: string, refs: readonly AiResumeSourceRef[]): AiResumeSourceRef | undefined {
  const blockIds = [...new Set(refs.flatMap((ref) => ref.blockIds))];
  if (!blockIds.length) return undefined;
  const confidenceLevel = refs.some((ref) => ref.confidenceLevel === "low")
    ? "low"
    : refs.some((ref) => ref.confidenceLevel === "medium") ? "medium" : "high";
  return {
    path,
    blockIds,
    confidenceLevel,
    confidenceReason: "AI item-level source ref verified locally",
    needsConfirmation: refs.some((ref) => ref.needsConfirmation) || confidenceLevel !== "high"
  };
}

function dedupeSourceRefs(refs: readonly AiResumeSourceRef[]) {
  return [...new Map(refs.map((ref) => [
    `${normalizePointer(ref.path)}\u0000${[...new Set(ref.blockIds)].join(",")}`,
    { ...ref, path: normalizePointer(ref.path), blockIds: [...new Set(ref.blockIds)] }
  ])).values()];
}

function dedupeUnclassifiedRefs(refs: readonly { blockIds: string[]; reason: string }[]) {
  return [...new Map(refs.map((ref) => [
    `${[...new Set(ref.blockIds)].join(",")}\u0000${ref.reason}`,
    { blockIds: [...new Set(ref.blockIds)], reason: ref.reason }
  ])).values()];
}

function existingSourceIds(blockIds: readonly string[], evidenceIndex: SourceEvidenceIndex) {
  return blockIds.filter((blockId) => evidenceIndex.textsById.has(blockId));
}

function normalizePointer(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  const slash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return slash.replace(/\[(\d+)\]/g, "/$1").replace(/\/+/g, "/").replace(/\/$/g, "");
}

function assertNoUnknownKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: PropertyKey[]) {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key) && hasFactualData(record[key]));
  for (const key of Object.keys(record)) {
    if (!allowed.has(key) && !unknown.includes(key)) delete record[key];
  }
  if (unknown.length > 0) {
    throw new ResumeDocumentMapperCoercionError([{ path, code: "unrecognized_keys", keys: unknown }]);
  }
}

function applyAlias(
  record: Record<string, unknown>,
  alias: string,
  target: string,
  diagnostics: ResumeMapperBoundaryDiagnostics,
  repair: string
) {
  if (!(alias in record)) return;
  if (!(target in record) || !hasFactualData(record[target])) {
    record[target] = record[alias];
    addRepair(diagnostics.shapeRepairs, repair);
  }
  delete record[alias];
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const cleaned = sanitizeValue(item);
    return cleaned === undefined ? [] : [[key, cleaned]];
  }));
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() ? value.trim() : undefined;
  if (Array.isArray(value)) return value.map(sanitizeValue).filter((item) => item !== undefined);
  if (isRecord(value)) return sanitizeRecord(value);
  return value;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.flatMap((item) => cleanString(item) ? [cleanString(item)!] : []))];
  const text = cleanString(value);
  if (!text) return [];
  return ARRAY_SPLIT_ALLOWED(text) ? text.split(/[，,；;]/).map((item) => item.trim()).filter(Boolean) : [text];
}

function ARRAY_SPLIT_ALLOWED(value: string) {
  return value.length <= 160 && /[，,；;]/.test(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(?:true|1|是|在读|进行中|至今|现在|目前|present|current|ongoing)$/iu.test(value.trim());
  return false;
}

function hasCurrentField(sectionType: Exclude<ResumeSectionTypeV2, "basics">) {
  return ["education", "work", "internship", "project", "research", "campus", "volunteer"].includes(sectionType);
}

function hasMeaningfulItemValue(item: Record<string, unknown>) {
  return Object.entries(item).some(([key, value]) => {
    if (["id", "sectionType", "customFields", "current"].includes(key)) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    return false;
  });
}

function hasFactualData(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasFactualData);
  if (isRecord(value)) return Object.values(value).some(hasFactualData);
  return true;
}

function addRepair(target: string[], repair: string) {
  if (!target.includes(repair)) target.push(repair);
}

function normalizeComparable(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();
}

function normalizeGroundingText(value: string) {
  return normalizeComparable(value).replace(/[./年]/g, "-").replace(/月/g, "");
}

function looksLikeCanonicalResume(value: Record<string, unknown>) {
  return "basics" in value && "sections" in value
    && !("structuredDraft" in value)
    && Object.keys(value).every((key) => RESUME_KEYS.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
