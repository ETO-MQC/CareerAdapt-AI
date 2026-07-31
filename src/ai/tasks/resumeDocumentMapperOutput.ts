const OUTPUT_KEYS = new Set(["structuredDraft", "unclassifiedBlocks", "mappingDecisions"]);
const DRAFT_KEYS = new Set(["schemaVersion", "basics", "sections"]);
const BASIC_KEYS = new Set(["name", "email", "phone", "location", "summary", "links"]);
const SECTION_KEYS = new Set(["title", "sectionType", "category", "included", "items", "mapping"]);
const ITEM_KEYS = new Set([
  "text", "organization", "role", "location", "startDate", "endDate",
  "current", "highlights", "included", "mapping"
]);
const MAPPING_KEYS = new Set([
  "sourcePaths", "sourceValues", "confidenceLevel", "confidenceReason", "needsConfirmation"
]);
const WRAPPER_KEYS = ["resume", "draft", "result"] as const;
const BASIC_ALIAS_KEYS = new Set([
  "github", "linkedin", "homepage", "website", "url", "portfolioLinks", "otherLinks",
  "targetRole"
]);
const ITEM_ALIAS_KEYS = new Set([
  "company", "institution", "school", "position", "jobTitle", "description", "content",
  "bullets", "responsibilities", "achievements", "category", "skill", "skillName",
  "degree", "major", "projectName", "name", "title"
]);
const SECTION_TYPES = new Set([
  "summary", "education", "work", "internship", "project", "research", "campus",
  "volunteer", "awards", "skills", "certificates", "languages", "publications",
  "patents", "portfolio", "other", "custom", "experience", "unknown"
]);

export type ResumeMapperCoercionIssue = {
  path: PropertyKey[];
  code: "unrecognized_keys" | "ambiguous_wrapper" | "alias_conflict";
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

export function normalizeResumeMapperBoundaryOutput(
  rawOutput: unknown,
  authoritativeSourceBlocks: readonly AuthoritativeSourceBlock[] = []
): unknown {
  const startedAt = Date.now();
  const preCoercionRepairs = collectPreCoercionShapeRepairs(rawOutput);
  const output = unwrapOutput(rawOutput);
  if (!isRecord(output)) return output;

  const normalized = omitNullObjectValues(output);
  assertNoUnknownKeys(normalized, OUTPUT_KEYS, []);
  const draft = normalized.structuredDraft;
  const preRejectedFields = isRecord(draft)
    ? quarantineUnknownModelFields(normalized, draft)
    : [];
  if (isRecord(draft)) {
    preserveTargetRoleAsUnclassified(normalized, draft);
    normalized.structuredDraft = coerceDraft(draft, ["structuredDraft"]);
  }
  const diagnostics: ResumeMapperBoundaryDiagnostics = {
    shapeRepairs: preCoercionRepairs,
    evidenceRepairs: [],
    rejectedFields: preRejectedFields,
    localNormalizationMs: 0,
    groundedFieldCount: 0,
    repairedFieldCount: 0,
    rejectedFieldCount: 0
  };
  normalizeBoundaryShape(normalized, diagnostics);
  if (authoritativeSourceBlocks.length > 0) {
    groundBoundaryFields(normalized, authoritativeSourceBlocks, diagnostics);
  }
  diagnostics.localNormalizationMs = Math.max(0, Date.now() - startedAt);
  diagnostics.repairedFieldCount =
    diagnostics.shapeRepairs.length + diagnostics.evidenceRepairs.length;
  diagnostics.rejectedFieldCount = diagnostics.rejectedFields.length;
  normalized.mapperDiagnostics = diagnostics;
  return normalized;
}

export function coerceResumeDocumentMapperOutput(rawOutput: unknown): unknown {
  const normalized = normalizeResumeMapperBoundaryOutput(rawOutput);
  if (isRecord(normalized)) delete normalized.mapperDiagnostics;
  return normalized;
}

function unwrapOutput(rawOutput: unknown): unknown {
  if (!isRecord(rawOutput)) return rawOutput;
  if ("structuredDraft" in rawOutput) return rawOutput;
  if (looksLikeDraft(rawOutput)) return { structuredDraft: rawOutput };

  const candidates = WRAPPER_KEYS.flatMap((key) => {
    const value = rawOutput[key];
    return isRecord(value) && ("structuredDraft" in value || looksLikeDraft(value))
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
  if (candidates.length === 1) return unwrapOutput(candidates[0].value);
  return rawOutput;
}

function coerceDraft(value: Record<string, unknown>, path: PropertyKey[]) {
  const draft = omitNullObjectValues(value);
  for (const key of ["parserVersion", "reviewStatus", "userConfirmed", "mappingDecisions"]) {
    delete draft[key];
  }
  assertNoUnknownKeys(draft, DRAFT_KEYS, path);
  if (isRecord(draft.basics)) {
    const basics = omitNullObjectValues(draft.basics);
    const linkAliases = [
      "github", "linkedin", "homepage", "website", "url", "portfolioLinks", "otherLinks"
    ];
    const aliasedLinks = linkAliases.flatMap((alias) => {
      const candidate = basics[alias];
      delete basics[alias];
      return Array.isArray(candidate) ? candidate : candidate === undefined ? [] : [candidate];
    });
    if (aliasedLinks.length > 0) {
      const existing = Array.isArray(basics.links)
        ? basics.links
        : basics.links === undefined ? [] : [basics.links];
      basics.links = [...existing, ...aliasedLinks];
    }
    delete basics.targetRole;
    assertNoUnknownKeys(basics, BASIC_KEYS, [...path, "basics"]);
    for (const [key, basic] of Object.entries(basics)) {
      if (isRecord(basic)) basics[key] = coerceMappedValue(basic, [...path, "basics", key]);
    }
    draft.basics = basics;
  }
  if (Array.isArray(draft.sections)) {
    draft.sections = draft.sections.map((section, index) =>
      isRecord(section) ? coerceSection(section, [...path, "sections", index]) : section
    );
  }
  return draft;
}

function coerceSection(value: Record<string, unknown>, path: PropertyKey[]) {
  const section = omitNullObjectValues(value);
  applyAlias(section, "sectionName", "title", path);
  if ("type" in section && typeof section.type === "string" && SECTION_TYPES.has(section.type)) {
    applyAlias(section, "type", "sectionType", path);
  }
  delete section.category;
  delete section.included;
  assertNoUnknownKeys(section, SECTION_KEYS, path);
  if (isRecord(section.mapping)) section.mapping = coerceMapping(section.mapping, [...path, "mapping"]);
  if (Array.isArray(section.items)) {
    section.items = section.items.map((item, index) =>
      isRecord(item) ? coerceItem(item, [...path, "items", index]) : item
    );
  }
  return section;
}

function coerceItem(value: Record<string, unknown>, path: PropertyKey[]) {
  const item = omitNullObjectValues(value);
  for (const alias of ["company", "institution", "school"]) {
    projectItemAlias(item, alias, "organization", path);
  }
  for (const alias of ["position", "jobTitle", "degree"]) {
    projectItemAlias(item, alias, "role", path);
  }
  for (const alias of [
    "description", "content", "category", "skill", "skillName", "major",
    "projectName", "name", "title"
  ]) {
    projectItemAlias(item, alias, "text", path);
  }
  for (const alias of ["bullets", "responsibilities", "achievements"]) {
    applyAlias(item, alias, "highlights", path);
  }
  if (typeof item.highlights === "string" && item.highlights.trim()) {
    item.highlights = [item.highlights];
  }
  delete item.included;
  assertNoUnknownKeys(item, ITEM_KEYS, path);
  if (isRecord(item.mapping)) item.mapping = coerceMapping(item.mapping, [...path, "mapping"]);
  return item;
}

function projectItemAlias(
  item: Record<string, unknown>,
  alias: string,
  target: string,
  path: PropertyKey[]
) {
  if (!(alias in item)) return;
  if (target in item && hasFactualData(item[alias])) {
    if (normalizeComparableValue(item[target]) === normalizeComparableValue(item[alias])) {
      delete item[alias];
      return;
    }
    const highlights = Array.isArray(item.highlights) ? item.highlights : [];
    item.highlights = [item[alias], ...highlights];
    delete item[alias];
    return;
  }
  applyAlias(item, alias, target, path);
}

function normalizeComparableValue(value: unknown) {
  return typeof value === "string" ? normalizeText(value) : JSON.stringify(value);
}

function coerceMappedValue(value: Record<string, unknown>, path: PropertyKey[]) {
  const mapped = omitNullObjectValues(value);
  assertNoUnknownKeys(mapped, new Set(["value", "mapping"]), path);
  if (isRecord(mapped.mapping)) mapped.mapping = coerceMapping(mapped.mapping, [...path, "mapping"]);
  return mapped;
}

function coerceMapping(value: Record<string, unknown>, path: PropertyKey[]) {
  const mapping = omitNullObjectValues(value);
  if ("confidence" in mapping) applyAlias(mapping, "confidence", "confidenceLevel", path);
  if ("confidenceScore" in mapping) {
    applyAlias(mapping, "confidenceScore", "confidenceLevel", path);
  }
  if ("sourceIds" in mapping) applyAlias(mapping, "sourceIds", "sourcePaths", path);
  if ("sourceBlockIds" in mapping) {
    applyAlias(mapping, "sourceBlockIds", "sourcePaths", path);
  }
  if ("quotes" in mapping) applyAlias(mapping, "quotes", "sourceValues", path);
  if ("sourceQuotes" in mapping) applyAlias(mapping, "sourceQuotes", "sourceValues", path);
  if ("reason" in mapping) applyAlias(mapping, "reason", "confidenceReason", path);
  if ("requiresConfirmation" in mapping) {
    applyAlias(mapping, "requiresConfirmation", "needsConfirmation", path);
  }
  if (typeof mapping.confidenceLevel === "number") {
    mapping.confidenceLevel = mapping.confidenceLevel >= 0.85
      ? "high"
      : mapping.confidenceLevel >= 0.6 ? "medium" : "low";
  }
  if (mapping.confidenceLevel === "medium" || mapping.confidenceLevel === "low") {
    mapping.needsConfirmation = true;
  }
  for (const key of Object.keys(mapping)) {
    if (!MAPPING_KEYS.has(key)) delete mapping[key];
  }
  return mapping;
}

function applyAlias(
  record: Record<string, unknown>,
  alias: string,
  target: string,
  path: PropertyKey[]
) {
  if (!(alias in record)) return;
  if (target in record && hasFactualData(record[alias])) {
    throw new ResumeDocumentMapperCoercionError([{
      path: [...path, alias],
      code: "alias_conflict",
      keys: [alias, target]
    }]);
  }
  if (!(target in record)) record[target] = record[alias];
  delete record[alias];
}

function assertNoUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: PropertyKey[]
) {
  const factualUnknownKeys = Object.keys(record).filter(
    (key) => !allowed.has(key) && hasFactualData(record[key])
  );
  for (const key of Object.keys(record)) {
    if (!allowed.has(key) && !factualUnknownKeys.includes(key)) delete record[key];
  }
  if (factualUnknownKeys.length > 0) {
    throw new ResumeDocumentMapperCoercionError([{
      path,
      code: "unrecognized_keys",
      keys: factualUnknownKeys
    }]);
  }
}

function hasFactualData(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasFactualData);
  if (isRecord(value)) return Object.values(value).some(hasFactualData);
  return true;
}

function omitNullObjectValues(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));
}

const OPTIONAL_BASIC_KEYS = ["name", "email", "phone", "location", "summary"] as const;
const OPTIONAL_ITEM_KEYS = [
  "text", "organization", "role", "location", "startDate", "endDate"
] as const;
const CATEGORY_BY_SECTION_TYPE: Record<string, string | undefined> = {
  summary: "summary",
  education: "education",
  work: "work",
  internship: "work",
  experience: "work",
  project: "project",
  research: "project",
  campus: "campus",
  volunteer: "campus",
  awards: "award",
  skills: "skill",
  certificates: "certificate",
  languages: "language",
  publications: "custom",
  patents: "custom",
  portfolio: "custom",
  other: "custom",
  custom: "custom",
  unknown: "custom"
};

function normalizeBoundaryShape(
  output: Record<string, unknown>,
  diagnostics: ResumeMapperBoundaryDiagnostics
) {
  const draft = isRecord(output.structuredDraft) ? output.structuredDraft : undefined;
  if (!draft) return;
  const basics = isRecord(draft.basics) ? draft.basics : undefined;
  if (basics) {
    for (const key of OPTIONAL_BASIC_KEYS) {
      const value = basics[key];
      if (key in basics && (isBlank(value) || (isRecord(value) && isBlank(value.value)))) {
        delete basics[key];
        addRepair(diagnostics.shapeRepairs, `blank_${toSnakeCase(key)}_omitted`);
      }
    }
    if ("links" in basics) {
      const original = basics.links;
      const values = Array.isArray(original) ? original : [original];
      if (!Array.isArray(original) && !isBlank(original)) {
        addRepair(diagnostics.shapeRepairs, "links_wrapped");
      }
      const links = values.filter((value) =>
        !isBlank(value) && !(isRecord(value) && isBlank(value.value))
      );
      if (links.length > 0) basics.links = links;
      else delete basics.links;
    }
  }
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  for (const value of sections) {
    if (!isRecord(value)) continue;
    const sectionType = typeof value.sectionType === "string" ? value.sectionType : "unknown";
    value.category = CATEGORY_BY_SECTION_TYPE[sectionType] ?? "custom";
    addRepair(diagnostics.shapeRepairs, "category_derived");
    if (isBlank(value.title)) value.title = "其他内容";
    const items = Array.isArray(value.items) ? value.items : [];
    value.items = items.flatMap((item) => {
      if (!isRecord(item)) return isBlank(item) ? [] : [item];
      for (const key of OPTIONAL_ITEM_KEYS) {
        if (key in item && isBlank(item[key])) {
          delete item[key];
          addRepair(diagnostics.shapeRepairs, `blank_${toSnakeCase(key)}_omitted`);
        }
      }
      if ("highlights" in item) {
        const highlights = Array.isArray(item.highlights)
          ? item.highlights.filter((entry) => typeof entry === "string" && entry.trim())
          : [];
        if (highlights.length > 0) item.highlights = highlights;
        else delete item.highlights;
      }
      return hasItemContent(item)
        ? [item]
        : [];
    });
  }
}

function collectPreCoercionShapeRepairs(rawOutput: unknown) {
  const repairs: string[] = [];
  const output = unwrapOutput(rawOutput);
  if (!isRecord(output)) return repairs;
  const draft = isRecord(output.structuredDraft) ? output.structuredDraft : undefined;
  const basics = isRecord(draft?.basics) ? draft.basics : undefined;
  if (basics) {
    const links = basics.links;
    if (links !== undefined && links !== null && !Array.isArray(links) && !isBlank(links)) {
      addRepair(repairs, "links_wrapped");
    }
    if ("targetRole" in basics) addRepair(repairs, "target_role_preserved_as_unclassified");
    if (["github", "linkedin", "homepage", "website", "url", "portfolioLinks", "otherLinks"]
      .some((alias) => alias in basics)) {
      addRepair(repairs, "link_alias_projected");
    }
  }
  const sections = Array.isArray(draft?.sections) ? draft.sections : [];
  for (const section of sections) {
    if (!isRecord(section) || !Array.isArray(section.items)) continue;
    for (const item of section.items) {
      if (!isRecord(item)) continue;
      for (const key of OPTIONAL_ITEM_KEYS) {
        if (key in item && isBlank(item[key])) {
          addRepair(repairs, `blank_${toSnakeCase(key)}_omitted`);
        }
      }
      if ("category" in item) addRepair(repairs, "item_category_projected_to_text");
    }
  }
  return repairs;
}

function preserveTargetRoleAsUnclassified(
  output: Record<string, unknown>,
  draft: Record<string, unknown>
) {
  const basics = isRecord(draft.basics) ? draft.basics : undefined;
  const targetRole = basics?.targetRole;
  if (targetRole === undefined || targetRole === null) return;
  const mapping = isRecord(targetRole) && isRecord(targetRole.mapping)
    ? targetRole.mapping
    : undefined;
  const sourcePaths = Array.isArray(mapping?.sourcePaths)
    ? mapping.sourcePaths.filter((value): value is string => typeof value === "string")
    : [];
  const sourceValues = Array.isArray(mapping?.sourceValues) ? mapping.sourceValues : [];
  const unclassified = Array.isArray(output.unclassifiedBlocks)
    ? output.unclassifiedBlocks
    : [];
  for (const [index, sourcePath] of sourcePaths.entries()) {
    if (unclassified.some((value) => isRecord(value) && value.sourcePath === sourcePath)) continue;
    unclassified.push({
      sourcePath,
      sourceValue: sourceValues[index] ?? sourceValues[0] ?? "",
      reason: "ai_boundary_unsupported_basic_alias:structuredDraft.basics.targetRole"
    });
  }
  output.unclassifiedBlocks = unclassified;
}

function quarantineUnknownModelFields(
  output: Record<string, unknown>,
  draft: Record<string, unknown>
): Array<{ path: string; reason: "ai_field_not_grounded" }> {
  const rejected: Array<{ path: string; reason: "ai_field_not_grounded" }> = [];
  const basics = isRecord(draft.basics) ? draft.basics : undefined;
  if (basics) {
    quarantineRecordUnknowns(
      output,
      basics,
      new Set([...BASIC_KEYS, ...BASIC_ALIAS_KEYS]),
      "structuredDraft.basics",
      undefined,
      rejected
    );
  }
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  for (const [sectionIndex, section] of sections.entries()) {
    if (!isRecord(section)) continue;
    const sectionPath = `structuredDraft.sections[${sectionIndex}]`;
    quarantineRecordUnknowns(
      output,
      section,
      new Set([...SECTION_KEYS, "sectionName", "type"]),
      sectionPath,
      section.mapping,
      rejected
    );
    const items = Array.isArray(section.items) ? section.items : [];
    for (const [itemIndex, item] of items.entries()) {
      if (!isRecord(item)) continue;
      quarantineRecordUnknowns(
        output,
        item,
        new Set([...ITEM_KEYS, ...ITEM_ALIAS_KEYS]),
        `${sectionPath}.items[${itemIndex}]`,
        item.mapping ?? section.mapping,
        rejected
      );
    }
  }
  return rejected;
}

function quarantineRecordUnknowns(
  output: Record<string, unknown>,
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  parentPath: string,
  mappingValue: unknown,
  rejected: Array<{ path: string; reason: "ai_field_not_grounded" }>
) {
  for (const key of Object.keys(record)) {
    if (allowed.has(key) || !hasFactualData(record[key])) continue;
    const path = `${parentPath}.${key}`;
    rejected.push({ path, reason: "ai_field_not_grounded" });
    preserveMappingAsUnclassified(output, mappingValue, path);
    delete record[key];
  }
}

function preserveMappingAsUnclassified(
  output: Record<string, unknown>,
  mappingValue: unknown,
  path: string
) {
  const mapping = isRecord(mappingValue) ? mappingValue : undefined;
  const sourcePaths = Array.isArray(mapping?.sourcePaths)
    ? mapping.sourcePaths.filter((value): value is string => typeof value === "string")
    : [];
  const sourceValues = Array.isArray(mapping?.sourceValues) ? mapping.sourceValues : [];
  const unclassified = Array.isArray(output.unclassifiedBlocks)
    ? output.unclassifiedBlocks
    : [];
  for (const [index, sourcePath] of sourcePaths.entries()) {
    if (unclassified.some((value) =>
      isRecord(value)
      && value.sourcePath === sourcePath
      && value.reason === `ai_field_not_grounded:${path}`
    )) continue;
    unclassified.push({
      sourcePath,
      sourceValue: sourceValues[index] ?? sourceValues[0] ?? "",
      reason: `ai_field_not_grounded:${path}`
    });
  }
  output.unclassifiedBlocks = unclassified;
}

function groundBoundaryFields(
  output: Record<string, unknown>,
  authoritativeSourceBlocks: readonly AuthoritativeSourceBlock[],
  diagnostics: ResumeMapperBoundaryDiagnostics
) {
  const sourceTextsById = new Map<string, string[]>();
  for (const block of authoritativeSourceBlocks) {
    const blockId = typeof block.originalBlockId === "string" ? block.originalBlockId : block.id;
    if (typeof blockId !== "string" || typeof block.text !== "string") continue;
    sourceTextsById.set(blockId, [...(sourceTextsById.get(blockId) ?? []), block.text]);
  }
  const draft = isRecord(output.structuredDraft) ? output.structuredDraft : undefined;
  if (!draft) return;
  let factualFieldCount = 0;
  let fabricatedSourceIdCount = 0;
  const basics = isRecord(draft.basics) ? draft.basics : {};
  for (const key of [...OPTIONAL_BASIC_KEYS, "links"] as const) {
    const values = key === "links" && Array.isArray(basics[key])
      ? basics[key] as unknown[]
      : key in basics ? [basics[key]] : [];
    const kept = values.flatMap((value, index) => {
      factualFieldCount += 1;
      const path = `structuredDraft.basics.${key}${key === "links" ? `[${index}]` : ""}`;
      const mapped = isRecord(value) ? value : undefined;
      const fact = mapped?.value;
      const result = groundFact(fact, mapped?.mapping, sourceTextsById);
      fabricatedSourceIdCount += result.fabricatedSourceIdCount;
      if (!result.grounded) {
        rejectField(output, diagnostics, path, result.authorizedSourceIds, sourceTextsById);
        return [];
      }
      diagnostics.groundedFieldCount += 1;
      if (result.completed) {
        mapped!.mapping = result.mapping;
        addRepair(diagnostics.evidenceRepairs, "evidence_quote_completed");
      }
      return [value];
    });
    if (key === "links") {
      if (kept.length) basics.links = kept;
      else delete basics.links;
    } else if (values.length && kept.length === 0) {
      delete basics[key];
    }
  }
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  for (const [sectionIndex, sectionValue] of sections.entries()) {
    if (!isRecord(sectionValue) || !Array.isArray(sectionValue.items)) continue;
    sectionValue.items = sectionValue.items.flatMap((itemValue, itemIndex) => {
      if (!isRecord(itemValue)) {
        factualFieldCount += 1;
        rejectField(
          output,
          diagnostics,
          `structuredDraft.sections[${sectionIndex}].items[${itemIndex}]`,
          [],
          sourceTextsById
        );
        return [];
      }
      let mapping = itemValue.mapping;
      const fieldNames = [...OPTIONAL_ITEM_KEYS, "highlights"] as const;
      for (const field of fieldNames) {
        const facts = field === "highlights" && Array.isArray(itemValue[field])
          ? itemValue[field] as unknown[]
          : field in itemValue ? [itemValue[field]] : [];
        const kept: unknown[] = [];
        for (const [factIndex, fact] of facts.entries()) {
          factualFieldCount += 1;
          const path = `structuredDraft.sections[${sectionIndex}].items[${itemIndex}].${field}`
            + (field === "highlights" ? `[${factIndex}]` : "");
          const result = groundFact(fact, mapping, sourceTextsById);
          fabricatedSourceIdCount += result.fabricatedSourceIdCount;
          if (!result.grounded) {
            rejectField(output, diagnostics, path, result.authorizedSourceIds, sourceTextsById);
            continue;
          }
          diagnostics.groundedFieldCount += 1;
          kept.push(fact);
          if (result.completed) {
            itemValue.mapping = result.mapping;
            mapping = result.mapping;
            addRepair(diagnostics.evidenceRepairs, "evidence_quote_completed");
          }
        }
        if (field === "highlights") {
          if (kept.length) itemValue.highlights = kept;
          else delete itemValue.highlights;
        } else if (facts.length && kept.length === 0) {
          delete itemValue[field];
        }
      }
      if (itemValue.current === true) {
        factualFieldCount += 1;
        const authorized = authorizedEvidence(itemValue.mapping, sourceTextsById);
        if (!authorized.texts.some((text) =>
          /(?:至今|现在|目前|current|present|ongoing|now)/iu.test(text)
        )) {
          delete itemValue.current;
          rejectField(
            output,
            diagnostics,
            `structuredDraft.sections[${sectionIndex}].items[${itemIndex}].current`,
            authorized.sourceIds,
            sourceTextsById
          );
        } else {
          diagnostics.groundedFieldCount += 1;
        }
      }
      return hasItemContent(itemValue) ? [itemValue] : [];
    });
  }
  const rejected = diagnostics.rejectedFieldCount || diagnostics.rejectedFields.length;
  if (
    (rejected >= 3 && rejected / Math.max(1, factualFieldCount) >= 0.5)
    || fabricatedSourceIdCount >= 3
  ) {
    throw new Error("resume_document_mapper_systematic_grounding_failure");
  }
}

function groundFact(
  fact: unknown,
  mappingValue: unknown,
  sourceTextsById: ReadonlyMap<string, string[]>
) {
  const mapping = isRecord(mappingValue) ? mappingValue : undefined;
  const authorized = authorizedEvidence(mapping, sourceTextsById);
  const normalizedFact = typeof fact === "string" ? normalizeText(fact) : "";
  const rawSourceValues = Array.isArray(mapping?.sourceValues)
    ? mapping.sourceValues.filter((value): value is string => typeof value === "string")
    : [];
  const sourceValues = rawSourceValues.filter((quote) =>
    authorized.evidenceTexts.some((text) => normalizeText(text).includes(normalizeText(quote)))
  );
  const sanitizedMapping = mapping ? {
    ...mapping,
    sourcePaths: authorized.sourceIds,
    sourceValues
  } : undefined;
  const sanitized = Boolean(
    mapping
    && (
      rawSourceValues.length !== sourceValues.length
      || (Array.isArray(mapping.sourcePaths)
        && mapping.sourcePaths.length !== authorized.sourceIds.length)
    )
  );
  const groundedByQuote = Boolean(
    normalizedFact
    && sourceValues.some((quote) => normalizeText(quote).includes(normalizedFact))
  );
  if (groundedByQuote) {
    return { grounded: true, completed: sanitized, mapping: sanitizedMapping, ...authorized };
  }
  const groundedByAuthorizedBlock = Boolean(
    normalizedFact
    && authorized.evidenceTexts.some((text) => normalizeText(text).includes(normalizedFact))
  );
  if (!groundedByAuthorizedBlock || !sanitizedMapping) {
    return { grounded: false, completed: false, mapping: sanitizedMapping, ...authorized };
  }
  return {
    grounded: true,
    completed: true,
    mapping: {
      ...sanitizedMapping,
      sourceValues: [...sourceValues, fact],
      needsConfirmation: true
    },
    ...authorized
  };
}

function authorizedEvidence(
  mappingValue: unknown,
  sourceTextsById: ReadonlyMap<string, string[]>
) {
  const mapping = isRecord(mappingValue) ? mappingValue : undefined;
  const citedIds = Array.isArray(mapping?.sourcePaths)
    ? mapping.sourcePaths.filter((value): value is string => typeof value === "string")
    : [];
  const sourceIds = citedIds.filter((id) => sourceTextsById.has(id));
  const texts = sourceIds.flatMap((id) => sourceTextsById.get(id) ?? []);
  return {
    authorizedSourceIds: sourceIds,
    sourceIds,
    texts,
    evidenceTexts: [
      ...texts,
      texts.join(""),
      texts.join(" ")
    ],
    fabricatedSourceIdCount: citedIds.length - sourceIds.length
  };
}

function rejectField(
  output: Record<string, unknown>,
  diagnostics: ResumeMapperBoundaryDiagnostics,
  path: string,
  authorizedSourceIds: readonly string[],
  sourceTextsById: ReadonlyMap<string, string[]>
) {
  diagnostics.rejectedFields.push({ path, reason: "ai_field_not_grounded" });
  diagnostics.rejectedFieldCount = diagnostics.rejectedFields.length;
  const unclassified = Array.isArray(output.unclassifiedBlocks)
    ? output.unclassifiedBlocks
    : [];
  for (const sourcePath of authorizedSourceIds) {
    if (unclassified.some((value) => isRecord(value) && value.sourcePath === sourcePath)) continue;
    unclassified.push({
      sourcePath,
      sourceValue: sourceTextsById.get(sourcePath)?.join("\n") ?? "",
      reason: `ai_field_not_grounded:${path}`
    });
  }
  output.unclassifiedBlocks = unclassified;
}

function hasItemContent(item: Record<string, unknown>) {
  return Boolean(
    (typeof item.text === "string" && item.text.trim())
    || (typeof item.organization === "string" && item.organization.trim())
    || (typeof item.role === "string" && item.role.trim())
    || (Array.isArray(item.highlights) && item.highlights.length)
  );
}

function isBlank(value: unknown) {
  return value === null || value === undefined
    || (typeof value === "string" && value.trim().length === 0);
}

function addRepair(target: string[], repair: string) {
  if (!target.includes(repair)) target.push(repair);
}

function toSnakeCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function normalizeText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function looksLikeDraft(value: Record<string, unknown>) {
  return "basics" in value && "sections" in value
    && Object.keys(value).every((key) => DRAFT_KEYS.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
