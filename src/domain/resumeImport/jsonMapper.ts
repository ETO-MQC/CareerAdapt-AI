import { StructuredResumeDraftSchema, type ExtractedSourceBlock, type ImportedResumeMappingTrace, type ResumeJsonMapperOutput } from "@/domain/schemas";

type JsonRecord = Record<string, unknown>;

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

export const RESUME_JSON_MAX_CHARS = 200_000;

export type JsonSyntaxErrorDetail = { message: string; position?: number; line?: number; column?: number };

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

export function mapExternalResumeJson(value: unknown): ResumeJsonMapperOutput {
  const root = asRecord(value);
  const usedPaths = new Set<string>();
  const basics: JsonRecord = {};

  for (const [target, aliases] of Object.entries(BASIC_ALIASES)) {
    const found = findFirst(root, aliases);
    if (!found || !isScalar(found.value)) continue;
    usedPaths.add(found.path);
    basics[target] = {
      value: String(found.value),
      mapping: trace([found.path], [found.value], found.path === target ? "high" : "medium", `由常见字段别名 ${found.path} 映射。`, found.path !== target)
    };
  }

  const sections = SECTION_ALIASES.flatMap((definition) => {
    const found = findFirst(root, definition.aliases);
    if (!found) return [];
    const values = Array.isArray(found.value) ? found.value : [found.value];
    const items = values.flatMap((item, index) => {
      const itemPath = Array.isArray(found.value) ? `${found.path}[${index}]` : found.path;
      if (isScalar(item)) {
        usedPaths.add(itemPath);
        return [{ text: String(item), mapping: trace([itemPath], [item], "high", "数组条目可直接映射。", false) }];
      }
      const record = asRecord(item);
      if (!record) return [];
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
        if (target === "highlights") mapped[target] = toStringArray(sourceValue);
        else if (target === "current") mapped[target] = Boolean(sourceValue);
        else if (isScalar(sourceValue)) mapped[target] = String(sourceValue);
      }
      if (sourcePaths.length === 0) {
        const text = JSON.stringify(record);
        usedPaths.add(itemPath);
        return [{ text, mapping: trace([itemPath], [record], "low", "未识别条目结构，保留原对象供人工核对。", true) }];
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
  });

  const leaves = flattenLeaves(value);
  const unclassifiedBlocks = leaves
    .filter((leaf) => leaf.path !== "schemaVersion" && !isUsedPath(leaf.path, usedPaths))
    .map((leaf) => ({ sourcePath: leaf.path, sourceValue: leaf.value, reason: "未匹配到当前简历字段，已完整保留。" }));

  return {
    structuredDraft: StructuredResumeDraftSchema.parse({ schemaVersion: "structured-resume-draft-v1", basics, sections }),
    unclassifiedBlocks
  };
}

export function createJsonSourceBlocks(value: unknown): ExtractedSourceBlock[] {
  return flattenLeaves(value).map((leaf, order) => {
    const rawText = typeof leaf.value === "string" ? leaf.value : JSON.stringify(leaf.value);
    return {
      id: `json-block-${order}`,
      sourcePath: leaf.path,
      text: rawText,
      rawText,
      blockType: "text_block",
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

function toStringArray(value: unknown) {
  if (Array.isArray(value)) return value.flatMap((item) => isScalar(item) ? [String(item)] : []);
  return isScalar(value) ? [String(value)] : [];
}
