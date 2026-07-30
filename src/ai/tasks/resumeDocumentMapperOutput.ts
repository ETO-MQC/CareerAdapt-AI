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

export function coerceResumeDocumentMapperOutput(rawOutput: unknown): unknown {
  const output = unwrapOutput(rawOutput);
  if (!isRecord(output)) return output;

  const normalized = omitNullObjectValues(output);
  assertNoUnknownKeys(normalized, OUTPUT_KEYS, []);
  const draft = normalized.structuredDraft;
  if (isRecord(draft)) {
    normalized.structuredDraft = coerceDraft(draft, ["structuredDraft"]);
  }
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
  assertNoUnknownKeys(draft, DRAFT_KEYS, path);
  if (isRecord(draft.basics)) {
    const basics = omitNullObjectValues(draft.basics);
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
    applyAlias(item, alias, "organization", path);
  }
  for (const alias of ["position", "jobTitle"]) applyAlias(item, alias, "role", path);
  for (const alias of ["description", "content"]) applyAlias(item, alias, "text", path);
  for (const alias of ["bullets", "responsibilities", "achievements"]) {
    applyAlias(item, alias, "highlights", path);
  }
  if (typeof item.highlights === "string" && item.highlights.trim()) {
    item.highlights = [item.highlights];
  }
  assertNoUnknownKeys(item, ITEM_KEYS, path);
  if (isRecord(item.mapping)) item.mapping = coerceMapping(item.mapping, [...path, "mapping"]);
  return item;
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
  if (typeof mapping.confidenceLevel === "number") {
    mapping.confidenceLevel = mapping.confidenceLevel >= 0.85
      ? "high"
      : mapping.confidenceLevel >= 0.6 ? "medium" : "low";
  }
  if (mapping.confidenceLevel === "medium" || mapping.confidenceLevel === "low") {
    mapping.needsConfirmation = true;
  }
  assertNoUnknownKeys(mapping, MAPPING_KEYS, path);
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

function looksLikeDraft(value: Record<string, unknown>) {
  return "basics" in value && "sections" in value
    && Object.keys(value).every((key) => DRAFT_KEYS.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
