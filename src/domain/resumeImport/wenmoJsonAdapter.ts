import {
  CareerAdaptResumeJsonV2Schema,
  type CareerAdaptResumeJsonV2,
  type ResumeItemV2,
  type ResumeJsonV2MappingTrace,
  type ResumeJsonV2Section
} from "@/domain/schemas";

export const WENMO_JSON_ADAPTER_VERSION = "resume-import.wenmo-json.v1";

type JsonRecord = Record<string, unknown>;

export type ExternalJsonValidationIssue = {
  code: "abnormal_phone_format" | "unsupported_visible_entry";
  sourcePath: string;
  value: string;
  needsConfirmation: true;
};

export type WenmoJsonAdapterResult = {
  canonicalResume: CareerAdaptResumeJsonV2;
  issues: ExternalJsonValidationIssue[];
  consumedSourcePaths: string[];
};

export function isWenmoResumeJson(value: unknown): boolean {
  const root = record(value);
  return Boolean(
    root
    && (typeof root.schemaVersion === "number" || typeof root.schemaVersion === "string")
    && record(root.personalInfo)
    && record(root.settings)
    && Array.isArray(root.sections)
    && root.sections.every((section) => Array.isArray(record(section)?.entries))
  );
}

export function adaptWenmoResumeJson(value: unknown): WenmoJsonAdapterResult {
  if (!isWenmoResumeJson(value)) throw new Error("JSON is not a supported Wenmo resume document");
  const root = record(value)!;
  const personalInfo = record(root.personalInfo)!;
  const consumed = new Set<string>(["schemaVersion", "settings"]);
  const issues: ExternalJsonValidationIssue[] = [];
  const basics: CareerAdaptResumeJsonV2["basics"] = { portfolioLinks: [], otherLinks: [], customFields: [] };

  const assignBasic = (target: "name" | "targetRole" | "phone" | "email" | "location", key: string) => {
    const sourcePath = `personalInfo.${key}`;
    const source = key === "name" ? personalInfo[key] : record(personalInfo[key])?.value;
    const visible = key === "name" || record(personalInfo[key])?.visible !== false;
    consumed.add(sourcePath);
    if (!visible) return;
    const cleaned = cleanExternalResumeText(source);
    if (cleaned) basics[target] = cleaned;
  };
  assignBasic("name", "name");
  assignBasic("targetRole", "objective");
  assignBasic("phone", "phone");
  assignBasic("email", "email");
  assignBasic("location", "address");

  for (const key of ["github", "website", "linkedin"] as const) {
    const field = record(personalInfo[key]);
    const path = `personalInfo.${key}`;
    consumed.add(path);
    if (!field || field.visible === false) continue;
    const link = cleanExternalResumeText(field.value);
    if (!link) continue;
    if (key === "github") basics.github = link;
    else if (key === "website") basics.homepage = link;
    else basics.linkedin = link;
  }

  const summary = personalInfo.selfEvaluationVisible === false ? "" : cleanExternalResumeText(personalInfo.selfEvaluation);
  consumed.add("personalInfo.selfEvaluation");
  consumed.add("personalInfo.selfEvaluationVisible");
  if (summary) basics.summary = summary;
  if (basics.phone && !isConventionalPhone(basics.phone)) {
    issues.push({ code: "abnormal_phone_format", sourcePath: "personalInfo.phone.value", value: basics.phone, needsConfirmation: true });
  }

  const sections: ResumeJsonV2Section[] = [];
  if (summary) {
    sections.push({
      id: "wenmo-section-summary",
      sectionType: "summary",
      title: "个人总结",
      order: sections.length,
      visible: true,
      items: [{ id: "wenmo-summary", sectionType: "summary", text: summary, customFields: [] }],
      mappingTrace: [trace("personalInfo.selfEvaluation", summary, "summary.text")]
    });
  }

  for (const [sectionIndex, rawSection] of (root.sections as unknown[]).entries()) {
    const section = record(rawSection)!;
    const sectionPath = `sections[${sectionIndex}]`;
    consumed.add(sectionPath);
    if (section.visible === false) continue;
    const title = cleanExternalResumeText(section.title) || `栏目 ${sectionIndex + 1}`;
    const sectionType = classifySection(section.type, title);
    const items: ResumeItemV2[] = [];
    const traces: ResumeJsonV2MappingTrace[] = [];
    for (const [entryIndex, rawEntry] of (section.entries as unknown[]).entries()) {
      const entry = record(rawEntry);
      if (!entry || entry.visible === false) continue;
      const path = `${sectionPath}.entries[${entryIndex}]`;
      const item = mapEntry(entry, sectionType, path, issues);
      if (!item) continue;
      items.push(item);
      traces.push(...entryTraces(entry, sectionType, path));
    }
    if (!items.length) continue;
    sections.push({
      id: sourceId(section.id, `wenmo-section-${sectionIndex + 1}`),
      sectionType,
      title,
      order: sections.length,
      visible: true,
      items,
      mappingTrace: traces.length ? traces : undefined
    });
  }

  return {
    canonicalResume: CareerAdaptResumeJsonV2Schema.parse({
      schemaVersion: "careeradapt-resume-v2",
      locale: "zh-CN",
      basics,
      sections: sections.map((section, order) => ({ ...section, order })),
      unclassifiedBlocks: []
    }),
    issues,
    consumedSourcePaths: [...consumed]
  };
}

function mapEntry(
  entry: JsonRecord,
  sectionType: ResumeJsonV2Section["sectionType"],
  path: string,
  issues: ExternalJsonValidationIssue[]
): ResumeItemV2 | undefined {
  const id = sourceId(entry.id, `${path}-item`);
  const title = cleanExternalResumeText(entry.title);
  const subtitle = cleanExternalResumeText(entry.subtitle);
  const department = cleanExternalResumeText(entry.department);
  const extra = cleanExternalResumeText(entry.extra);
  const description = cleanExternalResumeText(entry.description);
  const highlights = visibleBullets(entry.bullets);
  const date = splitDateRange(cleanExternalResumeText(entry.date));
  const customFields: [] = [];

  if (sectionType === "summary") {
    const text = description || highlights.join(" ") || title;
    return text ? { id, sectionType, text, customFields } : undefined;
  }
  if (sectionType === "education") {
    if (!title && !subtitle && !extra && !highlights.length) return undefined;
    return { id, sectionType, school: title || undefined, major: subtitle || undefined, degree: extra || undefined,
      department: department || undefined, ...date, courses: [], honors: [], highlights, customFields };
  }
  if (["work", "internship", "campus", "volunteer"].includes(sectionType)) {
    if (!title && !subtitle && !highlights.length) return undefined;
    return { id, sectionType: sectionType as "work" | "internship" | "campus" | "volunteer",
      organization: title || undefined, role: subtitle || undefined, department: department || undefined,
      description: description || undefined, ...date, highlights, customFields };
  }
  if (sectionType === "project") {
    if (!title && !subtitle && !highlights.length) return undefined;
    return { id, sectionType, title: title || undefined, role: subtitle || undefined,
      organization: department || undefined, description: description || undefined, ...date,
      tools: [], highlights, outcomes: [], customFields };
  }
  if (sectionType === "research") {
    if (!title && !subtitle && !highlights.length) return undefined;
    return { id, sectionType, title: title || undefined, authorRole: subtitle || undefined,
      institution: department || undefined, description: description || undefined, ...date,
      methods: [], highlights, customFields };
  }
  if (sectionType === "skills") {
    const name = title || subtitle;
    if (!name) return undefined;
    return { id, sectionType, name, description: description || highlights.join("；") || undefined, customFields };
  }
  if (sectionType === "certificates") {
    const name = title || subtitle;
    if (!name) return undefined;
    return { id, sectionType, name, description: description || highlights.join("；") || undefined, customFields };
  }

  const fallback = [title, subtitle, description, ...highlights].filter(Boolean).join("\n");
  if (!fallback) return undefined;
  issues.push({ code: "unsupported_visible_entry", sourcePath: path, value: fallback, needsConfirmation: true });
  return { id, sectionType: "other", title: title || undefined, description: fallback, highlights: [], customFields };
}

function classifySection(rawType: unknown, title: string): ResumeJsonV2Section["sectionType"] {
  const type = cleanExternalResumeText(rawType).toLowerCase();
  const heading = title.normalize("NFKC");
  if (type === "education" || /教育|学历/.test(heading)) return "education";
  if (/项目/.test(heading)) return "project";
  if (/研究|科研/.test(heading)) return "research";
  if (/实习/.test(heading)) return "internship";
  if (type === "experience" || /工作|经历/.test(heading)) return "work";
  if (type === "skill" || /技能/.test(heading)) return "skills";
  if (/证书|认证/.test(heading)) return "certificates";
  return "other";
}

function entryTraces(entry: JsonRecord, sectionType: ResumeJsonV2Section["sectionType"], path: string): ResumeJsonV2MappingTrace[] {
  const fieldsByType: Partial<Record<ResumeJsonV2Section["sectionType"], Array<[string, string]>>> = {
    education: [["title", "education.school"], ["subtitle", "education.major"], ["extra", "education.degree"], ["date", "education.startDate"]],
    internship: [["title", "internship.organization"], ["subtitle", "internship.role"], ["date", "internship.startDate"], ["bullets", "internship.highlights"]],
    project: [["title", "project.title"], ["subtitle", "project.role"], ["date", "project.startDate"], ["bullets", "project.highlights"]],
    research: [["title", "research.title"], ["subtitle", "research.authorRole"], ["date", "research.startDate"], ["bullets", "research.highlights"]],
    skills: [["title", "skills.name"], ["description", "skills.description"]],
    certificates: [["title", "certificates.name"], ["description", "certificates.description"]]
  };
  return (fieldsByType[sectionType] ?? []).flatMap(([key, target]) => {
    const value = key === "bullets" ? visibleBullets(entry.bullets).join("\n") : cleanExternalResumeText(entry[key]);
    return value ? [trace(`${path}.${key}`, value, target)] : [];
  });
}

function trace(sourcePath: string, sourceQuote: string, targetFieldId: string): ResumeJsonV2MappingTrace {
  return { sourceBlockIds: [sourcePath], sourceQuote, targetFieldId, confidence: 1, needsConfirmation: false, mappingReason: WENMO_JSON_ADAPTER_VERSION } as ResumeJsonV2MappingTrace;
}

function visibleBullets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const bullet = record(raw);
    if (!bullet || bullet.visible === false) return [];
    const text = cleanExternalResumeText(bullet.text).replace(/^[\s•·●▪◦■□◆◇▶►*-]+/u, "").trim();
    return text ? [text] : [];
  });
}

export function cleanExternalResumeText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return decodeHtmlEntities(String(value))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n+ */g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
    const raw = entity.slice(radix === 16 ? 2 : 1);
    const codePoint = Number.parseInt(raw, radix);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
  });
}

function splitDateRange(value: string): { startDate?: string; endDate?: string; current: boolean } {
  if (!value) return { current: false };
  const range = value.match(/((?:19|20)\d{2}(?:[./年-]\d{1,2})?)\s*(?:-|–|—|至|到)\s*((?:(?:19|20)\d{2}(?:[./年-]\d{1,2})?)|至今|现在|present|current)/iu);
  const tokens = range ? [range[1], range[2]] : [value];
  const startDate = normalizeDate(tokens[0]);
  const current = /^(?:至今|现在|present|current)$/i.test(tokens[1] ?? "");
  const endDate = current ? undefined : normalizeDate(tokens[1]);
  return { startDate, endDate, current };
}

export function normalizeExternalResumeDate(value: unknown): string | undefined {
  return normalizeDate(cleanExternalResumeText(value));
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/(?<!\d)((?:19|20)\d{2})(?:[./年-](\d{1,2}))?/);
  if (!match) return undefined;
  return match[2] ? `${match[1]}-${match[2].padStart(2, "0")}` : match[1];
}

function isConventionalPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^1[3-9]\d{9}$/.test(digits) || /^\d{7,11}$/.test(digits);
}

function sourceId(value: unknown, fallback: string): string {
  const source = cleanExternalResumeText(value) || fallback;
  return source.replace(/[^\p{Letter}\p{Number}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 96) || fallback;
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined;
}
