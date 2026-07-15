import {
  CareerAdaptResumeJsonV2Schema,
  StructuredResumeDraftSchema,
  type CareerAdaptResumeJsonV2,
  type ResumeItemV2,
  type StructuredResumeDraft
} from "@/domain/schemas";
import { mapExternalResumeJson } from "./jsonMapper";

type AdapterResult =
  | { ok: true; value: CareerAdaptResumeJsonV2; sourceKind: "v2" | "v1" | "external" }
  | { ok: false; message: string; details?: unknown };

const sectionTypeByV1Category = {
  summary: "summary",
  education: "education",
  work: "work",
  project: "project",
  campus: "campus",
  award: "awards",
  skill: "skills",
  certificate: "certificates",
  language: "languages",
  custom: "custom"
} as const;

export function v1ToJsonV2(input: StructuredResumeDraft): CareerAdaptResumeJsonV2 {
  const draft = StructuredResumeDraftSchema.parse(input);
  const basics = {
    name: readValue(draft.basics.name),
    email: readValue(draft.basics.email),
    phone: readValue(draft.basics.phone),
    location: readValue(draft.basics.location),
    otherLinks: (draft.basics.links ?? []).map(readValue).filter((value): value is string => Boolean(value))
  };
  const sections = draft.sections.flatMap((section, sectionIndex) => {
    const sectionType = section.category ? sectionTypeByV1Category[section.category] : section.sectionType === "skills" ? "skills" : section.sectionType === "certificates" ? "certificates" : "custom";
    const items = section.items.flatMap((rawItem, itemIndex) => {
      const item = toV2Item(rawItem, sectionType, `v1-${sectionIndex + 1}-${itemIndex + 1}`);
      return item ? [item] : [];
    });
    if (items.length === 0) return [];
    return [{ id: `v1-section-${sectionIndex + 1}`, sectionType, title: section.title, order: sectionIndex, visible: section.included !== false, items }];
  });
  const summary = readValue(draft.basics.summary);
  if (summary) sections.unshift({ id: "v1-summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ id: "v1-summary-1", sectionType: "summary", text: summary, customFields: [] }] });
  return CareerAdaptResumeJsonV2Schema.parse({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics, sections: sections.map((section, order) => ({ ...section, order })), unclassifiedBlocks: [] });
}

export function adaptResumeJsonToV2(value: unknown): AdapterResult {
  const direct = CareerAdaptResumeJsonV2Schema.safeParse(value);
  if (direct.success) return { ok: true, value: direct.data, sourceKind: "v2" };
  const v1 = StructuredResumeDraftSchema.safeParse(value);
  if (v1.success) return { ok: true, value: v1ToJsonV2(v1.data), sourceKind: "v1" };
  const external = mapExternalResumeJson(value);
  if (!external.ok) return { ok: false, message: external.message, details: external.details };
  const converted = v1ToJsonV2(external.value.structuredDraft);
  return {
    ok: true,
    sourceKind: "external",
    value: CareerAdaptResumeJsonV2Schema.parse({
      ...converted,
      unclassifiedBlocks: external.value.unclassifiedBlocks.map((block, index) => ({ id: `unclassified-${index + 1}`, ...block }))
    })
  };
}

export function createResumeJsonV2Example(): CareerAdaptResumeJsonV2 {
  return CareerAdaptResumeJsonV2Schema.parse({
    schemaVersion: "careeradapt-resume-v2",
    locale: "zh-CN",
    basics: { name: "陈同学", email: "student@example.com", targetRole: "数据分析师", otherLinks: [] },
    sections: [
      { id: "education", sectionType: "education", title: "教育经历", order: 0, visible: true, items: [{ id: "edu-1", sectionType: "education", school: "示例大学", degree: "本科", major: "统计学", gpa: 3.8, gpaScale: 4, courses: ["统计建模"], highlights: [], customFields: [] }] },
      { id: "skills", sectionType: "skills", title: "技能", order: 1, visible: true, items: [{ id: "skill-1", sectionType: "skills", name: "SQL", level: "熟练", customFields: [] }] }
    ],
    unclassifiedBlocks: []
  });
}

function readValue(value: StructuredResumeDraft["basics"]["name"]): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.value;
}

function toV2Item(rawItem: StructuredResumeDraft["sections"][number]["items"][number], sectionType: keyof typeof v2Builders, id: string): ResumeItemV2 | undefined {
  const source = typeof rawItem === "string" ? { text: rawItem } : rawItem;
  return v2Builders[sectionType](source, id);
}

type V1Item = { text?: string; organization?: string; role?: string; location?: string; startDate?: string; endDate?: string; current?: boolean; highlights?: string[] };
const base = (item: V1Item, id: string) => ({ id, customFields: [], description: item.text, highlights: item.highlights ?? [] });
const requiredText = (item: V1Item) => item.organization || item.role || item.text;

const v2Builders = {
  summary: (item: V1Item, id: string) => requiredText(item) ? { id, sectionType: "summary" as const, text: requiredText(item)!, customFields: [] } : undefined,
  education: (item: V1Item, id: string) => ({ ...base(item, id), sectionType: "education" as const, school: item.organization, degree: item.role, location: item.location, startDate: item.startDate, endDate: item.endDate, current: item.current ?? false, courses: [], honors: [] }),
  work: (item: V1Item, id: string) => ({ ...base(item, id), sectionType: "work" as const, organization: item.organization, role: item.role, location: item.location, startDate: item.startDate, endDate: item.endDate, current: item.current ?? false }),
  project: (item: V1Item, id: string) => ({ ...base(item, id), sectionType: "project" as const, title: item.organization, role: item.role, startDate: item.startDate, endDate: item.endDate, tools: [], outcomes: [] }),
  campus: (item: V1Item, id: string) => ({ ...base(item, id), sectionType: "campus" as const, organization: item.organization, role: item.role, location: item.location, startDate: item.startDate, endDate: item.endDate, current: item.current ?? false }),
  awards: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "awards" as const, name: requiredText(item)!, description: item.text, customFields: [] }) : undefined,
  skills: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "skills" as const, name: requiredText(item)!, description: item.text, customFields: [] }) : undefined,
  certificates: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "certificates" as const, name: requiredText(item)!, description: item.text, customFields: [] }) : undefined,
  languages: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "languages" as const, language: requiredText(item)!, description: item.text, customFields: [] }) : undefined,
  custom: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "custom" as const, title: item.organization || item.role, description: item.text || requiredText(item), highlights: item.highlights ?? [], customFields: [] }) : undefined
} satisfies Record<string, (item: V1Item, id: string) => ResumeItemV2 | undefined>;
