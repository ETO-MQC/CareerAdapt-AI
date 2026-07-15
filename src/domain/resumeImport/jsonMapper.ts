import { StructuredResumeDraftSchema, type ExtractedSourceBlock, type ImportedResumeMappingTrace, type MappingDecision, type ResumeJsonMapperOutput, type StructuredResumeDraft } from "@/domain/schemas";
import { findResumeFieldsByAlias, resumeFieldCatalog, type CanonicalFieldId, type ResumeSectionTypeV2 } from "@/domain/resumeFields";

type JsonRecord = Record<string, unknown>;

// ─── 统一清洗函数 ────────────────────────────────────────────

/** 将 null/undefined/空字符串/纯空格 → undefined；非空字符串 trim 后保留 */
function cleanStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 清洗 highlights 数组：过滤空条目，返回 undefined 如果结果为空 */
function cleanHighlights(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item) => {
    const cleaned = cleanStringValue(item);
    return cleaned ? [cleaned] : [];
  });
  return items.length > 0 ? items : undefined;
}

/** 判断清洗后的 item 是否有有效内容（至少有 text/organization/role/highlights 之一） */
function hasValidContent(mapped: JsonRecord): boolean {
  return Boolean(mapped.text || mapped.organization || mapped.role || (Array.isArray(mapped.highlights) && mapped.highlights.length > 0));
}

// ─── 别名定义 ────────────────────────────────────────────────

const BASIC_ALIASES = {
  name: ["name", "fullName", "username", "personalInfo.name", "basic.name", "basics.name", "profile.name"],
  email: ["email", "personalInfo.email", "basic.email", "basics.email", "profile.email", "contact.email"],
  phone: ["phone", "mobile", "telephone", "personalInfo.phone", "basic.phone", "basics.phone", "profile.phone", "contact.phone"],
  location: ["location", "city", "address", "personalInfo.location", "basic.location", "basics.location", "profile.location"],
  summary: ["summary", "selfEvaluation", "objective", "about", "personalInfo.summary", "basic.summary", "basics.summary", "profile.summary"]
} as const;

const SECTION_ALIASES = [
  { category: "education", title: "教育经历", sectionType: "experience", aliases: ["education", "educations", "educationExperience", "academicBackground"] },
  { category: "work", title: "工作 / 实习经历", sectionType: "experience", aliases: ["work", "works", "experience", "experiences", "employment", "workExperience", "workExperiences", "internships"] },
  { category: "project", title: "项目经历", sectionType: "experience", aliases: ["project", "projects", "projectExperience"] },
  { category: "campus", title: "校园经历", sectionType: "experience", aliases: ["campus", "campusExperience", "activities", "leadership", "volunteer"] },
  { category: "award", title: "奖项", sectionType: "certificates", aliases: ["award", "awards", "honors", "honours", "achievements"] },
  { category: "skill", title: "技能", sectionType: "skills", aliases: ["skill", "skills", "abilities", "technicalSkills", "competencies"] },
  { category: "certificate", title: "证书", sectionType: "certificates", aliases: ["certificate", "certificates", "certifications", "licenses"] },
  { category: "language", title: "语言", sectionType: "certificates", aliases: ["language", "languages", "languageSkills"] },
  { category: "custom", title: "其他内容", sectionType: "unknown", aliases: ["other", "others", "additional", "additionalInformation", "customSections"] }
] as const;

const ITEM_KEYS = {
  organization: ["organization", "company", "school", "institution", "projectName", "name", "title"],
  role: ["role", "position", "jobTitle", "degree"],
  location: ["location", "city"],
  startDate: ["startDate", "start", "from"],
  endDate: ["endDate", "end", "to"],
  current: ["current", "present", "isCurrent"],
  text: ["text", "description", "summary", "content"],
  highlights: ["highlights", "bullets", "details", "responsibilities", "achievements"]
} as const;

// ─── 常量 ────────────────────────────────────────────────────

export const RESUME_JSON_MAX_CHARS = 200_000;

export type JsonSyntaxErrorDetail = { message: string; position?: number; line?: number; column?: number };

// ─── JSON 语法解析 ───────────────────────────────────────────

export function parseResumeJsonText(text: string): { ok: true; value: unknown } | { ok: false; error: JsonSyntaxErrorDetail } {
  if (!text.trim()) return { ok: false, error: { message: "请先粘贴 JSON 内容。" } };
  if (text.length > RESUME_JSON_MAX_CHARS) return { ok: false, error: { message: `JSON 内容超过 ${RESUME_JSON_MAX_CHARS.toLocaleString("zh-CN")} 个字符，请拆分后重试。` } };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON 格式不合法";
    const match = message.match(/position\s+(\d+)/i);
    const position = match ? Number(match[1]) : undefined;
    if (position === undefined) return { ok: false, error: { message: "JSON 格式不合法，请修正后重试。" } };
    const before = text.slice(0, position);
    const line = before.split("\n").length;
    const column = position - before.lastIndexOf("\n");
    return { ok: false, error: { message: `JSON 格式不合法（约第 ${line} 行、第 ${column} 列），请修正后重试。`, position, line, column } };
  }
}

// ─── 映射结果类型 ────────────────────────────────────────────

export type JsonMapResult =
  | { ok: true; value: ResumeJsonMapperOutput }
  | { ok: false; errorCode: "schema_validation_failed" | "empty_input" | "unknown_error"; message: string; details?: unknown };

// ─── 核心映射函数 ────────────────────────────────────────────

export function mapExternalResumeJson(value: unknown): JsonMapResult {
  try {
    const root = asRecord(value);
    if (!root) {
      return {
        ok: false,
        errorCode: "empty_input",
        message: "外部 JSON 顶层必须是对象。"
      };
    }
    const usedPaths = new Set<string>();
    const basics: JsonRecord = {};
    const preservedUnclassified: ResumeJsonMapperOutput["unclassifiedBlocks"] = [];

    for (const [target, aliases] of Object.entries(BASIC_ALIASES)) {
      const found = findFirst(root, aliases);
      if (!found || !isScalar(found.value)) continue;
      const cleaned = cleanStringValue(found.value);
      if (!cleaned) continue;
      usedPaths.add(found.path);
      basics[target] = {
        value: cleaned,
        mapping: trace([found.path], [found.value], found.path === target ? "high" : "medium", `由常见字段别名 ${found.path} 映射。`, found.path !== target)
      };
    }

    // 处理 structured-resume-draft-v1 格式
    const sectionsArray = Array.isArray(root?.sections) ? root.sections as unknown[] : [];
    const isStructuredDraft = root?.schemaVersion === "structured-resume-draft-v1" && sectionsArray.length > 0;

    if (isStructuredDraft) usedPaths.add("schemaVersion");

    const sections = SECTION_ALIASES.flatMap((definition) => {
      if (isStructuredDraft) {
        return mapStructuredDraftSections(definition, sectionsArray, usedPaths, preservedUnclassified);
      }
      return mapExternalFormatSections(definition, root, usedPaths, preservedUnclassified);
    });

    const leaves = flattenLeaves(value);
    const unclassifiedBlocks = [
      ...preservedUnclassified,
      ...leaves
      .filter((leaf) => leaf.path !== "schemaVersion" && !isUsedPath(leaf.path, usedPaths))
      .map((leaf) => ({ sourcePath: leaf.path, sourceValue: leaf.value, reason: "未匹配到当前简历字段，已完整保留。" }))
    ];

    // 用 safeParse 验证，不直接抛 ZodError
    const parsed = StructuredResumeDraftSchema.safeParse({ schemaVersion: "structured-resume-draft-v1", basics, sections });
    if (!parsed.success) {
      return {
        ok: false,
        errorCode: "schema_validation_failed",
        message: "映射结果不符合标准格式，部分字段可能需要手动调整。",
        details: parsed.error.issues
      };
    }

    return { ok: true, value: { structuredDraft: parsed.data, unclassifiedBlocks, mappingDecisions: buildMappingDecisions(parsed.data, unclassifiedBlocks) } };
  } catch (error) {
    return {
      ok: false,
      errorCode: "unknown_error",
      message: "JSON 映射过程中发生未知错误。",
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildMappingDecisions(draft: StructuredResumeDraft, unclassifiedBlocks: ResumeJsonMapperOutput["unclassifiedBlocks"]): MappingDecision[] {
  const decisions: MappingDecision[] = [];
  const basicsTargets: Record<string, CanonicalFieldId> = {
    name: "basics.name", email: "basics.email", phone: "basics.phone", location: "basics.location", summary: "summary.text"
  };
  for (const [key, value] of Object.entries(draft.basics)) {
    const mapped = value && !Array.isArray(value) && typeof value === "object" && "mapping" in value ? value : undefined;
    const targetFieldId = basicsTargets[key];
    if (mapped && targetFieldId) decisions.push(...decisionsFromTrace(mapped.mapping as ImportedResumeMappingTrace, targetFieldId));
  }
  for (const section of draft.sections) {
    const sectionType = v2SectionType(section.category);
    for (const item of section.items) {
      if (typeof item === "string" || !item.mapping) continue;
      const fallback = resumeFieldCatalog.find((field) => field.sectionType === sectionType)?.id;
      item.mapping.sourcePaths.forEach((path, index) => {
        const alias = path.replace(/\[\d+\]/g, "").split(".").at(-1) ?? "";
        const targetFieldId = findResumeFieldsByAlias(alias, sectionType)[0]?.id ?? fallback;
        if (!targetFieldId) return;
        decisions.push(decisionFromSource(item.mapping!, targetFieldId, path, item.mapping!.sourceValues[index]));
      });
    }
  }
  for (const block of unclassifiedBlocks) {
    decisions.push({ kind: "unclassified", reason: block.reason, sourceBlockIds: [block.sourcePath], sourceQuote: sourceQuote(block.sourceValue) });
  }
  return decisions;
}

function decisionsFromTrace(trace: ImportedResumeMappingTrace, targetFieldId: CanonicalFieldId): MappingDecision[] {
  return trace.sourcePaths.map((path, index) => decisionFromSource(trace, targetFieldId, path, trace.sourceValues[index]));
}

function decisionFromSource(trace: ImportedResumeMappingTrace, targetFieldId: CanonicalFieldId, path: string, value: unknown): MappingDecision {
  return {
    kind: "canonical_field",
    targetFieldId,
    sourceBlockIds: [path],
    sourceQuote: sourceQuote(value),
    confidence: trace.confidenceLevel === "high" ? 0.95 : trace.confidenceLevel === "medium" ? 0.75 : 0.5,
    needsConfirmation: trace.needsConfirmation,
    mappingReason: trace.confidenceReason
  };
}

function sourceQuote(value: unknown) {
  if (typeof value === "string") return value || JSON.stringify(value);
  const serialized = JSON.stringify(value);
  return serialized && serialized.length > 0 ? serialized : String(value);
}

function v2SectionType(category: StructuredResumeDraft["sections"][number]["category"]): ResumeSectionTypeV2 {
  const types: Record<NonNullable<typeof category>, ResumeSectionTypeV2> = {
    summary: "summary", education: "education", work: "work", project: "project", campus: "campus", award: "awards",
    skill: "skills", certificate: "certificates", language: "languages", custom: "custom"
  };
  return category ? types[category] : "custom";
}

// ─── structured-resume-draft-v1 格式映射 ─────────────────────

function mapStructuredDraftSections(
  definition: typeof SECTION_ALIASES[number],
  sectionsArray: unknown[],
  usedPaths: Set<string>,
  unclassifiedBlocks: ResumeJsonMapperOutput["unclassifiedBlocks"]
) {
  const matched = sectionsArray
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const record = asRecord(item);
      if (!record) return false;
      return typeof record.category === "string"
        ? record.category === definition.category
        : record.sectionType === definition.sectionType;
    });

  if (matched.length === 0) return [];

  return matched.flatMap(({ item, index }) => {
    const sectionPath = `sections[${index}]`;
    const record = asRecord(item);
    if (!record) return [];

    usedPaths.add(`${sectionPath}.title`);
    usedPaths.add(`${sectionPath}.category`);
    usedPaths.add(`${sectionPath}.sectionType`);
    if (record.included !== undefined) usedPaths.add(`${sectionPath}.included`);

    const rawItems = Array.isArray(record.items) ? record.items : [];
    const items: JsonRecord[] = [];
    for (let itemIndex = 0; itemIndex < rawItems.length; itemIndex++) {
      const rawItem = rawItems[itemIndex];
      const itemPath = `${sectionPath}.items[${itemIndex}]`;

      if (isScalar(rawItem)) {
        const cleaned = cleanStringValue(rawItem);
        if (cleaned) {
          usedPaths.add(itemPath);
          items.push({ text: cleaned, mapping: trace([itemPath], [rawItem], "high", "数组条目可直接映射。", false) });
        } else {
          usedPaths.add(itemPath);
          unclassifiedBlocks.push({ sourcePath: itemPath, sourceValue: rawItem, reason: "清洗后无有效内容，已完整保留供人工核对。" });
        }
        continue;
      }

      const itemRecord = asRecord(rawItem);
      if (!itemRecord) {
        usedPaths.add(itemPath);
        unclassifiedBlocks.push({ sourcePath: itemPath, sourceValue: rawItem, reason: "无法解析的条目，已完整保留。" });
        continue;
      }

      const mapped: JsonRecord = {};
      const sourcePaths: string[] = [];
      const sourceValues: unknown[] = [];

      // text 字段 —— 用 cleanStringValue 过滤空字符串
      const cleanedText = cleanStringValue(itemRecord.text);
      if (cleanedText !== undefined) {
        const textPath = `${itemPath}.text`;
        usedPaths.add(textPath);
        sourcePaths.push(textPath);
        sourceValues.push(itemRecord.text);
        mapped.text = cleanedText;
      }

      // organization/role/location/startDate/endDate
      for (const field of ["organization", "role", "location", "startDate", "endDate"] as const) {
        const cleaned = cleanStringValue(itemRecord[field]);
        if (cleaned !== undefined) {
          const fieldPath = `${itemPath}.${field}`;
          usedPaths.add(fieldPath);
          sourcePaths.push(fieldPath);
          sourceValues.push(itemRecord[field]);
          mapped[field] = cleaned;
        }
      }

      // current
      if (itemRecord.current !== undefined) {
        const fieldPath = `${itemPath}.current`;
        usedPaths.add(fieldPath);
        sourcePaths.push(fieldPath);
        sourceValues.push(itemRecord.current);
        mapped.current = Boolean(itemRecord.current);
      }

      // highlights —— 用 cleanHighlights 过滤空条目
      const cleanedHighlights = cleanHighlights(itemRecord.highlights);
      if (cleanedHighlights !== undefined) {
        const fieldPath = `${itemPath}.highlights`;
        usedPaths.add(fieldPath);
        sourcePaths.push(fieldPath);
        sourceValues.push(itemRecord.highlights);
        mapped.highlights = cleanedHighlights;
      }

      // included
      if (itemRecord.included !== undefined) {
        usedPaths.add(`${itemPath}.included`);
        mapped.included = Boolean(itemRecord.included);
      }

      // 清洗后无有效内容 → 放入 unclassifiedBlocks
      if (!hasValidContent(mapped)) {
        usedPaths.add(itemPath);
        unclassifiedBlocks.push({ sourcePath: itemPath, sourceValue: itemRecord, reason: "清洗后无有效内容，保留原对象供人工核对。" });
        continue;
      }

      mapped.mapping = trace(sourcePaths, sourceValues, sourcePaths.length >= 2 ? "high" : "medium", "由条目中的常见字段别名组合。", sourcePaths.length < 2);
      items.push(mapped);
    }

    const title = isScalar(record.title) ? String(record.title) : definition.title;
    return [{
      title,
      category: definition.category,
      sectionType: definition.sectionType,
      included: record.included !== false,
      items,
      mapping: trace([sectionPath], [record], "high", `由 sections 数组中 category="${definition.category}" 匹配。`, false)
    }];
  });
}

// ─── 外部格式映射 ────────────────────────────────────────────

function mapExternalFormatSections(
  definition: typeof SECTION_ALIASES[number],
  root: JsonRecord | undefined,
  usedPaths: Set<string>,
  unclassifiedBlocks: ResumeJsonMapperOutput["unclassifiedBlocks"]
) {
  const found = findFirst(root, definition.aliases);
  if (!found) return [];
  const values = Array.isArray(found.value) ? found.value : [found.value];
  const items = values.flatMap((item, index) => {
    const itemPath = Array.isArray(found.value) ? `${found.path}[${index}]` : found.path;
    if (isScalar(item)) {
      const cleaned = cleanStringValue(item);
      if (!cleaned) {
        usedPaths.add(itemPath);
        unclassifiedBlocks.push({ sourcePath: itemPath, sourceValue: item, reason: "清洗后无有效内容，已完整保留供人工核对。" });
        return [];
      }
      usedPaths.add(itemPath);
      return [{ text: cleaned, mapping: trace([itemPath], [item], "high", "数组条目可直接映射。", false) }];
    }
    const record = asRecord(item);
    if (!record) {
      usedPaths.add(itemPath);
      unclassifiedBlocks.push({ sourcePath: itemPath, sourceValue: item, reason: "无法解析的条目，已完整保留。" });
      return [];
    }
    const mapped: JsonRecord = {};
    const sourcePaths: string[] = [];
    const sourceValues: unknown[] = [];
    for (const [target, keys] of Object.entries(ITEM_KEYS)) {
      const key = keys.find((candidate) => record[candidate] !== undefined);
      if (!key) continue;
      const sourceValue = record[key];
      const sourcePath = `${itemPath}.${key}`;
      usedPaths.add(sourcePath);
      sourcePaths.push(sourcePath);
      sourceValues.push(sourceValue);
      if (target === "highlights") {
        const cleaned = cleanHighlights(sourceValue);
        if (cleaned) mapped[target] = cleaned;
      } else if (target === "current") {
        mapped[target] = Boolean(sourceValue);
      } else if (isScalar(sourceValue)) {
        const cleaned = cleanStringValue(sourceValue);
        if (cleaned) mapped[target] = cleaned;
      }
    }
    if (sourcePaths.length === 0 || !hasValidContent(mapped)) {
      usedPaths.add(itemPath);
      unclassifiedBlocks.push({ sourcePath: itemPath, sourceValue: record, reason: "清洗后无有效内容，保留原对象供人工核对。" });
      return [];
    }
    mapped.mapping = trace(sourcePaths, sourceValues, sourcePaths.length >= 2 ? "high" : "medium", "由条目中的常见字段别名组合。", sourcePaths.length < 2);
    return [mapped];
  });
  if (items.length === 0) return [];
  return [{
    title: definition.title,
    category: definition.category,
    sectionType: definition.sectionType,
    included: true,
    items,
    mapping: trace([found.path], [found.value], "high", `由栏目别名 ${found.path} 映射。`, false)
  }];
}

// ─── 工具函数 ────────────────────────────────────────────────

export function createJsonSourceBlocks(value: unknown): ExtractedSourceBlock[] {
  return flattenLeaves(value).map((leaf, order) => {
    const rawText = typeof leaf.value === "string" && leaf.value.length > 0 ? leaf.value : JSON.stringify(leaf.value);
    return {
      id: leaf.path,
      sourcePath: leaf.path,
      text: rawText,
      rawText,
      blockType: "text_block",
      sourceEngine: "json_mapper",
      sourceEngineVersion: "resume-import.json-mapper.v2",
      extractionConfidence: 1,
      order
    };
  });
}

function trace(sourcePaths: string[], sourceValues: unknown[], confidenceLevel: ImportedResumeMappingTrace["confidenceLevel"], confidenceReason: string, needsConfirmation: boolean): ImportedResumeMappingTrace {
  return { sourcePaths, sourceValues, confidenceLevel, confidenceReason, needsConfirmation };
}

function findFirst(root: JsonRecord | undefined, aliases: readonly string[]) {
  if (!root) return undefined;
  for (const path of aliases) {
    const value = readPath(root, path);
    if (value !== undefined && value !== null && value !== "") return { path, value };
  }
  return undefined;
}

function readPath(root: JsonRecord, path: string) {
  return path.split(".").reduce<unknown>((current, key) => asRecord(current)?.[key], root);
}

function flattenLeaves(value: unknown, path = ""): Array<{ path: string; value: unknown }> {
  if (Array.isArray(value)) return value.flatMap((item, index) => flattenLeaves(item, `${path}[${index}]`));
  const record = asRecord(value);
  if (record) return Object.entries(record).flatMap(([key, item]) => flattenLeaves(item, path ? `${path}.${key}` : key));
  return path ? [{ path, value }] : [];
}

function isUsedPath(path: string, usedPaths: Set<string>) {
  if (usedPaths.has(path)) return true;
  return [...usedPaths].some((used) => path.startsWith(`${used}.`) || path.startsWith(`${used}[`));
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
