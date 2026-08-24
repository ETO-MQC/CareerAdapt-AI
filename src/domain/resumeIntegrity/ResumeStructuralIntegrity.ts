import {
  ResumeItemV2Schema,
  type ResumeItemV2
} from "@/domain/schemas";
import {
  canonicalTechnicalTerm,
  findTechnicalTerms,
  technicalTermCategory
} from "@/domain/resumeComposition/ResumeSkillTaxonomy";
import {
  detectLegacyStructuredLabels,
  parseStructuredExperienceText
} from "@/domain/resumeFields/catalog";

export const RESUME_STRUCTURAL_INTEGRITY_STATUSES = [
  "healthy",
  "legacy_flat_projection",
  "degraded_structured_item",
  "unrecoverable"
] as const;

export type ResumeStructuralIntegrityStatus = typeof RESUME_STRUCTURAL_INTEGRITY_STATUSES[number];
export type ResumeStructuralIntegrityOrigin = "legacy_projection" | "structured";

export type ResumeStructuralShape = {
  sectionType: ResumeItemV2["sectionType"];
  hasTitle: boolean;
  hasOrganization: boolean;
  hasRole: boolean;
  hasDates: boolean;
  toolCount: number;
  highlightCount: number;
  outcomeCount: number;
  descriptionLength: number;
};

export type ResumeStructuralIntegrityReport = {
  status: ResumeStructuralIntegrityStatus;
  origin: ResumeStructuralIntegrityOrigin;
  shape: ResumeStructuralShape;
  detectedLabels: string[];
  reasonCodes: string[];
};

export type ResumeStructuralRehydrationResult = {
  item: ResumeItemV2;
  report: ResumeStructuralIntegrityReport;
  changed: boolean;
};

export class ResumeStructuralIntegrityError extends Error {
  readonly report: ResumeStructuralIntegrityReport;

  constructor(report: ResumeStructuralIntegrityReport) {
    super(`resume_structural_integrity_${report.status}:${report.shape.sectionType}:${report.reasonCodes.join(",") || "none"}`);
    this.name = "ResumeStructuralIntegrityError";
    this.report = report;
  }
}

export function inspectResumeItemStructuralIntegrity(
  item: ResumeItemV2,
  input: {
    origin?: ResumeStructuralIntegrityOrigin;
    legacyTextProjection?: string;
  } = {}
): ResumeStructuralIntegrityReport {
  const origin = input.origin ?? "structured";
  const legacyText = input.legacyTextProjection?.trim() || undefined;
  const detectedLabels = supportsLegacyStructuredRehydration(item.sectionType)
    ? detectLegacyStructuredLabels(legacyText ?? textValue(item))
    : [];
  const shape = resumeStructuralShape(item);
  const reasonCodes: string[] = [];
  if (detectedLabels.length) reasonCodes.push("legacy_labels_present");

  const missingIdentity = missingPrimaryIdentity(item);
  if (missingIdentity) reasonCodes.push(missingIdentity);

  const skillNarrative = item.sectionType === "skills" && !isSkillCapabilityLabel(item.name);
  if (skillNarrative) reasonCodes.push("skill_name_contains_evidence");

  const recoverable = canDeterministicallyRecover(item, legacyText, detectedLabels, missingIdentity, skillNarrative);
  const degraded = reasonCodes.length > 0;
  const status = !degraded
    ? "healthy"
    : recoverable
      ? origin === "legacy_projection" ? "legacy_flat_projection" : "degraded_structured_item"
      : "unrecoverable";

  return {
    status,
    origin,
    shape,
    detectedLabels,
    reasonCodes
  };
}

export function rehydrateLegacyStructuredResumeItem(
  item: ResumeItemV2,
  legacyTextProjection?: string,
  input: { origin?: ResumeStructuralIntegrityOrigin } = {}
): ResumeStructuralRehydrationResult {
  const origin = input.origin ?? "structured";
  const initial = inspectResumeItemStructuralIntegrity(item, { origin, legacyTextProjection });
  if (initial.status === "healthy") return { item, report: initial, changed: false };
  if (initial.status === "unrecoverable") throw new ResumeStructuralIntegrityError(initial);

  const sourceText = legacyTextProjection?.trim() || textValue(item);
  const next = item.sectionType === "skills"
    ? rehydrateSkill(item)
    : rehydrateExperience(item, sourceText, initial.detectedLabels.length > 0);
  const parsed = ResumeItemV2Schema.parse(next);
  const finalReport = inspectResumeItemStructuralIntegrity(parsed, { origin });
  if (finalReport.status !== "healthy") throw new ResumeStructuralIntegrityError(finalReport);
  return {
    item: parsed,
    report: finalReport,
    changed: JSON.stringify(parsed) !== JSON.stringify(item)
  };
}

export function resumeStructuralShape(item: ResumeItemV2): ResumeStructuralShape {
  const record = item as unknown as Record<string, unknown>;
  const text = typeof record.description === "string"
    ? record.description
    : item.sectionType === "summary" ? item.text : "";
  const tools = stringList(record.tools);
  const highlights = stringList(record.highlights);
  const outcomes = stringList(record.outcomes);
  const hasTitle = "title" in record
    ? Boolean(textValue(record.title))
    : item.sectionType === "summary" || item.sectionType === "skills"
      ? true
      : false;
  const hasOrganization = item.sectionType === "education"
    ? Boolean(textValue(record.school))
    : Boolean(textValue(record.organization) || textValue(record.institution));
  const hasRole = Boolean(textValue(record.role) || textValue(record.authorRole));
  const hasDates = Boolean(textValue(record.startDate) || textValue(record.endDate) || textValue(record.expectedEndDate));
  return {
    sectionType: item.sectionType,
    hasTitle,
    hasOrganization,
    hasRole,
    hasDates,
    toolCount: tools.length,
    highlightCount: highlights.length,
    outcomeCount: outcomes.length,
    descriptionLength: text.length
  };
}

export function isSkillCapabilityLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || /[\r\n。！？!?；;：:，,。]/u.test(trimmed)) return false;
  if (/^(?:项目名称|组织|公司|单位|职位|角色|说明|亮点|成果|技术栈|技术工具)\s*[：:]/u.test(trimmed)) return false;
  if (canonicalTechnicalTerm(trimmed)) return true;
  if (/(?:基于|负责|完成|实现|使用|熟悉|具备|参与|通过|能够|支持|搭建|开发|设计|管理|经验)/u.test(trimmed)) return false;
  return trimmed.length <= 32;
}

export function canonicalSkillIdentity(value: string) {
  const canonical = canonicalTechnicalTerm(value);
  if (canonical) return canonical;
  return isSkillCapabilityLabel(value) ? value.trim().toLocaleLowerCase() : undefined;
}

export function resumeItemBodyProjection(item: ResumeItemV2) {
  if (item.sectionType === "summary") return item.text;
  if (item.sectionType === "skills") return item.description?.trim() || item.name;
  const record = item as unknown as Record<string, unknown>;
  const parts = [
    textValue(record.background),
    textValue(record.description),
    ...stringList(record.highlights),
    ...stringList(record.outcomes)
  ].map((value) => value.trim()).filter(Boolean);
  return uniqueSentences(parts).join("\n");
}

function rehydrateSkill(item: Extract<ResumeItemV2, { sectionType: "skills" }>): ResumeItemV2 {
  const source = [item.name, item.description ?? ""].filter(Boolean).join("\n");
  const name = legacySkillIdentity(source);
  if (!name) throw new ResumeStructuralIntegrityError(inspectResumeItemStructuralIntegrity(item, {
    origin: "structured",
    legacyTextProjection: source
  }));
  const evidence = uniqueSentences([
    item.name === name ? "" : item.name,
    item.description ?? ""
  ]).join("\n");
  return {
    ...item,
    name,
    category: item.category ?? technicalTermCategory(name),
    description: evidence || undefined
  };
}

function legacySkillIdentity(source: string) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const labeled = /^(?:技能名称|技能)\s*[：:]\s*(.*)$/u.exec(first)?.[1]?.trim();
  const candidate = labeled ?? first;
  const firstSegment = candidate.split(/[\/|｜、,，;；]/u).map((value) => value.trim()).find(Boolean) ?? candidate;
  const canonical = canonicalTechnicalTerm(firstSegment);
  if (canonical) return canonical;
  const candidateTerms = findTechnicalTerms(firstSegment);
  if (candidateTerms.length === 1 && isSkillCapabilityLabel(firstSegment)) return candidateTerms[0];
  if (!labeled && lines.length === 1 && isSkillCapabilityLabel(first)) return first;
  const terms = [...new Set(findTechnicalTerms(source))];
  return terms.length === 1 ? terms[0] : undefined;
}

function rehydrateExperience(item: ResumeItemV2, sourceText: string, hasLabels: boolean): ResumeItemV2 {
  const parsed = parseStructuredExperienceText(sourceText);
  const record = item as unknown as Record<string, unknown>;
  const highlights = uniqueList([
    ...stringList(record.highlights),
    ...parsed.highlights
  ]);
  const outcomes = uniqueList([
    ...stringList(record.outcomes),
    ...(parsed.outcomes ?? [])
  ]);
  const description = withoutDuplicateSentences(
    hasLabels ? parsed.description : mergeText(textValue(record.description), parsed.description),
    [...highlights, ...outcomes]
  );

  if (item.sectionType === "education") {
    return {
      ...item,
      school: chooseText(item.school, parsed.organization),
      degree: chooseText(item.degree, parsed.degree, parsed.role),
      major: chooseText(item.major, parsed.major),
      department: chooseText(item.department, parsed.department),
      location: chooseText(item.location, parsed.location),
      startDate: chooseText(item.startDate, parsed.startDate),
      endDate: item.current ? undefined : chooseText(item.endDate, parsed.endDate),
      expectedEndDate: chooseText(item.expectedEndDate, parsed.expectedEndDate),
      current: item.current || parsed.current,
      courses: uniqueList([...(item.courses ?? []), ...splitList(parsed.courses)]),
      description: description || undefined,
      highlights
    };
  }
  if (item.sectionType === "project") {
    return {
      ...item,
      title: chooseText(item.title, parsed.title, parsed.organization),
      role: chooseText(item.role, parsed.role),
      organization: chooseText(item.organization, parsed.organization),
      location: chooseText(item.location, parsed.location),
      startDate: chooseText(item.startDate, parsed.startDate),
      endDate: item.current ? undefined : chooseText(item.endDate, parsed.endDate),
      current: item.current || parsed.current,
      url: chooseText(item.url, parsed.url),
      tools: uniqueList([...(item.tools ?? []), ...(parsed.tools ?? [])]),
      background: chooseText(item.background, parsed.background),
      description: description || undefined,
      highlights,
      outcomes
    };
  }
  if (isExperienceItem(item)) {
    return {
      ...item,
      organization: chooseText(item.organization, parsed.organization),
      role: chooseText(item.role, parsed.role),
      department: chooseText(item.department, parsed.department),
      location: chooseText(item.location, parsed.location),
      startDate: chooseText(item.startDate, parsed.startDate),
      endDate: item.current ? undefined : chooseText(item.endDate, parsed.endDate),
      current: item.current || parsed.current,
      description: description || undefined,
      highlights
    };
  }
  if (item.sectionType === "other") {
    return {
      ...item,
      title: chooseText(item.title, parsed.title, parsed.organization),
      description: description || item.description,
      highlights
    };
  }
  if (item.sectionType === "custom") {
    return {
      ...item,
      title: chooseText(item.title, parsed.title, parsed.organization),
      description: description || textValue(record.description) || undefined,
      highlights
    };
  }
  throw new ResumeStructuralIntegrityError(inspectResumeItemStructuralIntegrity(item, {
    origin: "structured",
    legacyTextProjection: sourceText
  }));
}

function canDeterministicallyRecover(
  item: ResumeItemV2,
  sourceText: string | undefined,
  labels: string[],
  missingIdentity: string | undefined,
  skillNarrative: boolean
) {
  if (item.sectionType === "skills") {
    return skillNarrative && Boolean(legacySkillIdentity([item.name, item.description ?? "", sourceText ?? ""].join("\n")));
  }
  if (!missingIdentity && labels.length > 0) return Boolean(sourceText);
  if (missingIdentity) return Boolean(sourceText && hasDeterministicExperienceShape(sourceText, item.sectionType));
  return Boolean(sourceText);
}

function supportsLegacyStructuredRehydration(sectionType: ResumeItemV2["sectionType"]) {
  return ["education", "work", "internship", "campus", "volunteer", "project"].includes(sectionType);
}

function hasDeterministicExperienceShape(sourceText: string, sectionType: ResumeItemV2["sectionType"]) {
  if (detectLegacyStructuredLabels(sourceText).length > 0) return true;
  if (sectionType === "education" && /\|/u.test(sourceText) && /(?:高中|中专|专科|本科|学士|硕士|博士|研究生|MBA|EMBA)/iu.test(sourceText)) return true;
  return /(?:19|20)\d{2}/u.test(sourceText) && /\n|\s{2,}|\s\/\s|\s\|\s/u.test(sourceText);
}

function missingPrimaryIdentity(item: ResumeItemV2) {
  if (item.sectionType === "education" && !item.school?.trim()) return "missing_school";
  if (["work", "internship", "campus", "volunteer"].includes(item.sectionType) && !textValue((item as unknown as Record<string, unknown>).organization)) return "missing_organization";
  if (item.sectionType === "project" && !item.title?.trim()) return "missing_project_title";
  if (["research", "portfolio", "publications", "patents"].includes(item.sectionType) && !textValue((item as unknown as Record<string, unknown>).title)) return "missing_title";
  return undefined;
}

function isExperienceItem(item: ResumeItemV2): item is Extract<ResumeItemV2, { sectionType: "work" | "internship" | "campus" | "volunteer" }> {
  return ["work", "internship", "campus", "volunteer"].includes(item.sectionType);
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean) : [];
}

function chooseText(...values: Array<string | undefined>) {
  return values.find((value) => Boolean(value?.trim()))?.trim() || undefined;
}

function mergeText(...values: string[]) {
  return uniqueSentences(values).join("\n");
}

function withoutDuplicateSentences(description: string, canonicalLists: string[]) {
  const occupied = new Set(canonicalLists.map(normalizeSentence));
  return splitNarrativeSentences(description)
    .filter((value) => !occupied.has(normalizeSentence(value)))
    .filter((value, index, values) => values.findIndex((candidate) => normalizeSentence(candidate) === normalizeSentence(value)) === index)
    .join("\n");
}

function splitNarrativeSentences(value: string) {
  return value
    .split(/\r?\n/u)
    .flatMap((line) => line.match(/[^。！？!?]+[。！？!?]?/gu) ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitList(value: string) {
  return value.split(/[、,，;；\n]/u).map((entry) => entry.trim()).filter(Boolean);
}

function uniqueList(values: string[]) {
  return [...new Map(values.map((value) => [normalizeSentence(value), value.trim()])).values()].filter(Boolean);
}

function uniqueSentences(values: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values.flatMap((entry) => entry.split(/[\n。！？!?]+/u))) {
    const trimmed = value.trim();
    const normalized = normalizeSentence(trimmed);
    if (!trimmed || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

function normalizeSentence(value: string) {
  return value.trim().replace(/[。！？!?；;，,、\s]+$/gu, "").replace(/[\s\u3000]+/gu, "").toLocaleLowerCase();
}
