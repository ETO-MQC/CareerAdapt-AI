import type { ExperienceType } from "@/domain/schemas/profile";
import type { ResumeItemV2 } from "@/domain/schemas";

export type ResumeFieldCategoryId =
  | "basic"
  | "summary"
  | "education"
  | "work"
  | "internship"
  | "project"
  | "campus"
  | "award"
  | "certificate"
  | "skill"
  | "language"
  | "custom";

export const resumeFieldCategories: ReadonlyArray<{
  id: ResumeFieldCategoryId;
  label: string;
  description: string;
  repeatable: boolean;
}> = [
  { id: "basic", label: "个人信息", description: "姓名、联系方式和所在地", repeatable: false },
  { id: "summary", label: "自我评价", description: "个人优势和职业概述", repeatable: false },
  { id: "education", label: "教育经历", description: "学校、学历、专业和课程", repeatable: true },
  { id: "work", label: "工作经历", description: "全职和岗位经历", repeatable: true },
  { id: "internship", label: "实习经历", description: "实习和见习经历", repeatable: true },
  { id: "project", label: "项目成果", description: "项目职责、行动和成果", repeatable: true },
  { id: "campus", label: "校园经历", description: "社团、志愿和校内职责", repeatable: true },
  { id: "award", label: "奖项", description: "竞赛、荣誉和奖项", repeatable: true },
  { id: "skill", label: "个人技能", description: "工具、技术和方法", repeatable: true },
  { id: "certificate", label: "证书", description: "证书、执照和认证", repeatable: true },
  { id: "language", label: "语言", description: "语言能力和等级", repeatable: true },
  { id: "custom", label: "其他内容", description: "补充或待分类内容", repeatable: true }
] as const;

export const resumeContentCategoryOrder = resumeFieldCategories
  .map((category) => category.id)
  .filter((category): category is Exclude<ResumeFieldCategoryId, "basic"> => category !== "basic");

export const defaultResumeRenderSectionOrder = ["summary", "experience", "skills", "certificates"] as const;

export function resumeCategoryRank(category: ResumeFieldCategoryId) {
  const rank = resumeFieldCategories.findIndex((entry) => entry.id === category);
  return rank < 0 ? resumeFieldCategories.length : rank;
}

export function categorySourceSectionId(category: Exclude<ResumeFieldCategoryId, "basic">) {
  const sectionIds: Record<Exclude<ResumeFieldCategoryId, "basic">, string> = {
    summary: "summary",
    education: "education",
    work: "work",
    internship: "internship",
    project: "project",
    campus: "campus",
    award: "awards",
    skill: "skills",
    certificate: "certificates",
    language: "languages",
    custom: "custom"
  };
  return sectionIds[category];
}

export type StructuredExperienceFields = {
  /** Project-only fields retained for compatibility with the shared projection. */
  title?: string;
  organization: string;
  role: string;
  department?: string;
  location: string;
  url?: string;
  tools?: string[];
  background?: string;
  degree: string;
  major: string;
  courses: string;
  startDate: string;
  endDate: string;
  expectedEndDate?: string;
  current: boolean;
  description: string;
  highlights: string[];
  outcomes?: string[];
};

export const emptyStructuredExperienceFields: StructuredExperienceFields = {
  title: "",
  organization: "",
  role: "",
  department: "",
  location: "",
  url: "",
  tools: [],
  background: "",
  degree: "",
  major: "",
  courses: "",
  startDate: "",
  endDate: "",
  expectedEndDate: "",
  current: false,
  description: "",
  highlights: [],
  outcomes: []
};

export function canonicalToStructuredExperienceFields(item: ResumeItemV2): StructuredExperienceFields {
  if (item.sectionType === "education") {
    return {
      organization: item.school ?? "",
      role: item.degree ?? "",
      department: item.department ?? "",
      location: item.location ?? "",
      degree: item.degree ?? "",
      major: item.major ?? "",
      courses: (item.courses ?? []).join("、"),
      startDate: item.startDate ?? "",
      endDate: item.endDate ?? "",
      expectedEndDate: item.expectedEndDate ?? item.endDate ?? "",
      current: item.current ?? false,
      description: item.description ?? "",
      highlights: item.highlights ?? []
    };
  }
  if (item.sectionType === "project") {
    return {
      title: item.title ?? "",
      organization: item.organization ?? "",
      role: item.role ?? "",
      location: item.location ?? "",
      url: item.url ?? "",
      tools: item.tools ?? [],
      background: item.background ?? "",
      degree: "",
      major: "",
      courses: "",
      startDate: item.startDate ?? "",
      endDate: item.endDate ?? "",
      expectedEndDate: "",
      current: item.current ?? false,
      description: item.description ?? "",
      highlights: item.highlights ?? [],
      outcomes: item.outcomes ?? []
    };
  }
  const record = item as unknown as Record<string, unknown>;
  return {
    title: text(record.title),
    organization: text(record.organization),
    role: text(record.role),
    department: text(record.department),
    location: text(record.location),
    url: text(record.url),
    tools: Array.isArray(record.tools)
      ? record.tools.filter((value): value is string => typeof value === "string")
      : [],
    background: text(record.background),
    degree: "",
    major: "",
    courses: "",
    startDate: text(record.startDate),
    endDate: text(record.endDate),
    expectedEndDate: text(record.expectedEndDate),
    current: record.current === true,
    description: text(record.description),
    highlights: Array.isArray(record.highlights)
      ? record.highlights.filter((value): value is string => typeof value === "string")
      : [],
    outcomes: Array.isArray(record.outcomes)
      ? record.outcomes.filter((value): value is string => typeof value === "string")
      : []
  };
}

export function patchCanonicalExperienceFields(
  item: ResumeItemV2,
  fields: StructuredExperienceFields
): ResumeItemV2 {
  const description = fields.description.trim() || undefined;
  const highlights = fields.highlights.map((value) => value.trim()).filter(Boolean);
  const outcomes = (fields.outcomes ?? []).map((value) => value.trim()).filter(Boolean);
  if (item.sectionType === "education") {
    return {
      ...item,
      school: fields.organization.trim() || undefined,
      degree: fields.degree.trim() || fields.role.trim() || undefined,
      major: fields.major.trim() || undefined,
      department: fields.department?.trim() || undefined,
      location: fields.location.trim() || undefined,
      startDate: fields.startDate || undefined,
      endDate: fields.current ? undefined : fields.endDate || undefined,
      expectedEndDate: fields.current ? fields.expectedEndDate || fields.endDate || undefined : undefined,
      current: fields.current,
      courses: fields.courses.split(/[、,，;；]/).map((value) => value.trim()).filter(Boolean),
      description,
      highlights
    };
  }
  if (item.sectionType === "project") {
    return {
      ...item,
      title: (fields.title ?? fields.organization).trim() || undefined,
      role: fields.role.trim() || undefined,
      organization: fields.organization.trim() || undefined,
      location: fields.location.trim() || undefined,
      startDate: fields.startDate || undefined,
      endDate: fields.current ? undefined : fields.endDate || undefined,
      current: fields.current,
      url: validResumeUrl(fields.url ?? ""),
      tools: (fields.tools ?? []).map((value) => value.trim()).filter(Boolean),
      background: (fields.background ?? "").trim() || undefined,
      description,
      highlights,
      outcomes
    };
  }
  return {
    ...item,
    organization: fields.organization.trim() || undefined,
    role: fields.role.trim() || undefined,
    department: fields.department?.trim() || undefined,
    location: fields.location.trim() || undefined,
    startDate: fields.startDate || undefined,
    endDate: fields.current ? undefined : fields.endDate || undefined,
    current: fields.current,
    description,
    highlights
  } as ResumeItemV2;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function defaultExperienceType(category: ResumeFieldCategoryId): ExperienceType {
  const defaults: Partial<Record<ResumeFieldCategoryId, ExperienceType>> = {
    education: "education",
    work: "work",
    internship: "internship",
    project: "project",
    campus: "campus",
    award: "competition",
    custom: "other"
  };
  return defaults[category] ?? "other";
}

export function experienceFieldLabels(category: ResumeFieldCategoryId) {
  if (category === "education") {
    return {
      organization: "学校名称",
      role: "学历",
      location: "学校所在地",
      startDate: "就读开始时间",
      endDate: "就读结束时间",
      description: "教育经历说明"
    };
  }
  if (category === "project") {
    return {
      organization: "项目名称",
      role: "职责 / 角色",
      location: "项目地点",
      startDate: "开始日期",
      endDate: "结束日期",
      description: "经历内容与成果"
    };
  }
  if (category === "campus") {
    return {
      organization: "组织 / 活动名称",
      role: "职务 / 角色",
      location: "活动地点",
      startDate: "开始日期",
      endDate: "结束日期",
      description: "经历与成果"
    };
  }
  if (category === "internship") {
    return {
      organization: "实习单位",
      role: "实习岗位",
      location: "实习地点",
      startDate: "开始日期",
      endDate: "结束日期",
      description: "经历内容与成果"
    };
  }
  return {
    organization: "公司 / 组织",
    role: "职位 / 角色",
    location: "工作地点",
    startDate: "开始日期",
    endDate: "结束日期",
    description: "经历内容与成果"
  };
}

export type StructuredProjectFields = {
  title: string;
  role: string;
  organization: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  url: string;
  tools: string[];
  background: string;
  description: string;
  highlights: string[];
  outcomes: string[];
};

export const emptyStructuredProjectFields: StructuredProjectFields = {
  title: "",
  role: "",
  organization: "",
  location: "",
  startDate: "",
  endDate: "",
  current: false,
  url: "",
  tools: [],
  background: "",
  description: "",
  highlights: [],
  outcomes: []
};

export function canonicalToStructuredProjectFields(item: ResumeItemV2): StructuredProjectFields {
  if (item.sectionType !== "project") return emptyStructuredProjectFields;
  return {
    title: item.title ?? "",
    role: item.role ?? "",
    organization: item.organization ?? "",
    location: item.location ?? "",
    startDate: item.startDate ?? "",
    endDate: item.endDate ?? "",
    current: item.current ?? false,
    url: item.url ?? "",
    tools: item.tools ?? [],
    background: item.background ?? "",
    description: item.description ?? "",
    highlights: item.highlights ?? [],
    outcomes: item.outcomes ?? []
  };
}

export function patchCanonicalProjectFields(item: ResumeItemV2, fields: StructuredProjectFields): ResumeItemV2 {
  if (item.sectionType !== "project") return item;
  return {
    ...item,
    title: fields.title.trim() || undefined,
    role: fields.role.trim() || undefined,
    organization: fields.organization.trim() || undefined,
    location: fields.location.trim() || undefined,
    startDate: fields.startDate || undefined,
    endDate: fields.current ? undefined : fields.endDate || undefined,
    current: fields.current,
    url: validResumeUrl(fields.url),
    tools: fields.tools.map((value) => value.trim()).filter(Boolean),
    background: fields.background.trim() || undefined,
    description: fields.description.trim() || undefined,
    highlights: fields.highlights.map((value) => value.trim()).filter(Boolean),
    outcomes: fields.outcomes.map((value) => value.trim()).filter(Boolean)
  };
}

function validResumeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export function parseStructuredExperienceText(text: string): StructuredExperienceFields {
  const labeled = parseLegacyLabeledStructuredExperienceText(text);
  if (labeled) return labeled;

  const compactEducation = parseCompactEducationText(text);
  if (compactEducation) return compactEducation;

  const [rawHeader = "", ...rawLines] = text.split("\n");
  let header = rawHeader.trim();
  const current = /(?:至今|现在|present|current)/i.test(header);
  const dates = header.match(/(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?/g) ?? [];
  header = header
    .replace(/(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?/g, "")
    .replace(/(?:至今|现在|present|current)/gi, "")
    .replace(/\s+-\s*$/, "")
    .trim();
  const segments = header.split(/\s{2,}/).map((value) => value.trim()).filter(Boolean);
  const identity = segments[0] ?? "";
  const separator = [" / ", " ｜ ", " | ", "，", ","].find((value) => identity.includes(value));
  const identityParts = separator ? identity.split(separator).map((value) => value.trim()) : [identity];
  const degreeLine = rawLines.find((line) => /^学历[：:]/.test(line.trim()));
  const majorLine = rawLines.find((line) => /^专业[：:]/.test(line.trim()));
  const coursesLine = rawLines.find((line) => /^主修课程[：:]/.test(line.trim()));
  const contentLines = rawLines.filter((line) => !/^(学历|专业|主修课程|项目背景|技术栈)[：:]/.test(line.trim()));
  let outcomeMode = false;
  const descriptionLines: string[] = [];
  const highlights: string[] = [];
  const outcomes: string[] = [];
  for (const line of contentLines) {
    const trimmed = line.trim();
    if (/^成果与结果[：:]?$/u.test(trimmed)) {
      outcomeMode = true;
      continue;
    }
    const bullet = stripStructuredBullet(trimmed);
    if (bullet) {
      (outcomeMode ? outcomes : highlights).push(bullet);
    } else if (trimmed) {
      descriptionLines.push(trimmed);
    }
  }
  const backgroundLine = rawLines.find((line) => /^项目背景[：:]/.test(line.trim()));
  const toolsLine = rawLines.find((line) => /^技术栈[：:]/.test(line.trim()));
  const description = descriptionLines.join("\n").trim();
  return {
    title: identityParts[0] ?? "",
    organization: identityParts[0] ?? "",
    role: identityParts.slice(1).join(separator ?? " / "),
    location: segments.slice(1).join(" "),
    degree: degreeLine?.replace(/^学历[：:]\s*/, "").trim() ?? "",
    major: majorLine?.replace(/^专业[：:]\s*/, "").trim() ?? "",
    courses: coursesLine?.replace(/^主修课程[：:]\s*/, "").trim() ?? "",
    startDate: normalizeStructuredDate(dates[0] ?? ""),
    endDate: current ? "" : normalizeStructuredDate(dates[1] ?? ""),
    expectedEndDate: current ? normalizeStructuredDate(dates[1] ?? "") : "",
    current,
    description,
    highlights,
    outcomes,
    background: backgroundLine?.replace(/^项目背景[：:]\s*/, "").trim() ?? "",
    tools: toolsLine?.replace(/^技术栈[：:]\s*/, "").split(/[、,，;；]/).map((value) => value.trim()).filter(Boolean) ?? []
  };
}

export const LEGACY_RESUME_STRUCTURED_LABELS = [
  "项目名称",
  "组织",
  "公司",
  "单位",
  "学校",
  "学校名称",
  "职位",
  "职位名称",
  "职位/角色",
  "职责 / 角色",
  "角色",
  "部门",
  "地点",
  "所在地",
  "学校所在地",
  "项目地点",
  "开始日期",
  "结束日期",
  "至今",
  "学历",
  "学位",
  "学位/学历",
  "专业",
  "主修课程",
  "预计结束日期",
  "在读",
  "进行中",
  "荣誉",
  "技能名称",
  "类别",
  "熟练度",
  "项目链接",
  "工具",
  "技术工具",
  "技术栈",
  "项目背景",
  "说明",
  "亮点",
  "成果",
  "成果与结果"
] as const;

export type LegacyResumeStructuredLabel = typeof LEGACY_RESUME_STRUCTURED_LABELS[number];

export function detectLegacyStructuredLabels(text: string): LegacyResumeStructuredLabel[] {
  const found = new Set<LegacyResumeStructuredLabel>();
  for (const line of text.split("\n")) {
    const match = /^\s*(项目名称|组织|公司|单位|学校名称|学校|职位名称|职位\/角色|职责\s*\/\s*角色|职位|角色|部门|地点|所在地|学校所在地|项目地点|开始日期|结束日期|至今|学历|学位\/学历|学位|专业|主修课程|预计结束日期|在读|进行中|荣誉|技能名称|类别|熟练度|项目链接|工具|技术工具|技术栈|项目背景|说明|亮点|成果与结果|成果)\s*[：:]/u.exec(line);
    if (match) found.add(normalizeLegacyStructuredLabel(match[1]));
  }
  return [...found];
}

function parseLegacyLabeledStructuredExperienceText(text: string): StructuredExperienceFields | undefined {
  const labels = detectLegacyStructuredLabels(text);
  if (!labels.length) return undefined;

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const firstLineLabel = legacyLabelFromLine(lines[0] ?? "");
  const rawHeader = firstLineLabel ? "" : lines[0] ?? "";
  const rawLines = firstLineLabel ? lines : lines.slice(1);
  const header = parseStructuredHeader(rawHeader);
  const values = new Map<LegacyResumeStructuredLabel, string>();
  const highlights: string[] = [];
  const outcomes: string[] = [];
  const descriptionLines: string[] = [];
  let contentMode: "description" | "highlight" | "outcome" | undefined;

  for (const line of rawLines) {
    const labeled = /^\s*(项目名称|组织|公司|单位|学校名称|学校|职位名称|职位\/角色|职责\s*\/\s*角色|职位|角色|部门|地点|所在地|学校所在地|项目地点|开始日期|结束日期|至今|学历|学位\/学历|学位|专业|主修课程|预计结束日期|在读|进行中|荣誉|技能名称|类别|熟练度|项目链接|工具|技术工具|技术栈|项目背景|说明|亮点|成果与结果|成果)\s*[：:]\s*(.*)$/u.exec(line);
    if (labeled) {
      const label = normalizeLegacyStructuredLabel(labeled[1]);
      const value = labeled[2].trim();
      values.set(label, value);
      if (label === "说明") {
        contentMode = "description";
        if (value) descriptionLines.push(value);
      } else if (label === "亮点") {
        contentMode = "highlight";
        highlights.push(...splitStructuredList(value));
      } else if (label === "成果" || label === "成果与结果") {
        contentMode = "outcome";
        outcomes.push(...splitStructuredList(value));
      } else {
        contentMode = label === "至今" ? "description" : undefined;
      }
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed || isStructuredDateOnlyLine(trimmed)) continue;
    const bullet = stripStructuredBullet(trimmed);
    if (bullet) {
      if (contentMode === "outcome") outcomes.push(bullet);
      else if (contentMode === "highlight") highlights.push(bullet);
      else highlights.push(bullet);
    } else if (contentMode === "description" || !contentMode) {
      descriptionLines.push(trimmed);
    }
  }

  const startDate = valueDate(values.get("开始日期")) || header.startDate;
  const labeledEnd = values.get("结束日期") ?? values.get("预计结束日期") ?? values.get("至今");
  const current = header.current || Boolean(values.has("至今") || values.has("在读") || values.has("进行中")) || /(?:至今|现在|present|current)/iu.test(labeledEnd ?? "");
  const endDates = extractStructuredDates(labeledEnd ?? "");
  const endDate = current ? "" : valueDate(labeledEnd) || header.endDate || endDates[1] || "";
  const expectedEndDate = current ? valueDate(labeledEnd) || endDates[1] || "" : "";
  const organization = firstNonEmpty(values.get("组织"), values.get("公司"), values.get("单位"), values.get("学校名称"), values.get("学校"), header.organization);
  const title = values.get("项目名称") || header.title || organization;
  const degree = firstNonEmpty(values.get("学历"), values.get("学位/学历"), values.get("学位"), header.degree, header.role);
  const role = firstNonEmpty(values.get("职位"), values.get("职位名称"), values.get("职位/角色"), values.get("职责 / 角色"), values.get("角色"), header.role);
  const description = descriptionLines.join("\n").trim();
  const background = values.get("项目背景") ?? "";
  const tools = splitStructuredList(values.get("技术工具") ?? values.get("技术栈") ?? values.get("工具") ?? "");

  return {
    title,
    organization,
    role,
    department: values.get("部门") ?? "",
    location: firstNonEmpty(values.get("地点"), values.get("所在地"), values.get("学校所在地"), values.get("项目地点"), header.location),
    degree,
    major: values.get("专业") ?? "",
    courses: values.get("主修课程") ?? "",
    startDate,
    endDate,
    expectedEndDate,
    current,
    description,
    highlights: uniqueStructuredList(highlights),
    outcomes: uniqueStructuredList(outcomes),
    url: values.get("项目链接") ?? "",
    background,
    tools: uniqueStructuredList(tools)
  };
}

function parseCompactEducationText(text: string): StructuredExperienceFields | undefined {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const rawHeader = lines[0]?.trim() ?? "";
  const headerWithoutDates = rawHeader
    .replace(/(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?/g, "")
    .replace(/(?:至今|现在|present|current)/giu, "")
    .trim();
  const parts = headerWithoutDates.split(/\s*[|｜]\s*/u).map((value) => value.trim()).filter(Boolean);
  if (parts.length < 3 || !/(?:高中|中专|专科|本科|学士|硕士|博士|研究生|MBA|EMBA)/iu.test(parts[1] ?? "")) return undefined;
  const dates = extractStructuredDates(text);
  if (!dates.length) return undefined;
  const current = /(?:至今|现在|present|current)/iu.test(text);
  const description = lines.slice(1).filter((line) => line.trim() && !isStructuredDateOnlyLine(line.trim())).join("\n").trim();
  return {
    title: parts[0],
    organization: parts[0],
    role: parts[1],
    department: "",
    location: "",
    degree: parts[1],
    major: parts[2],
    courses: "",
    startDate: normalizeStructuredDate(dates[0] ?? ""),
    endDate: current ? "" : normalizeStructuredDate(dates[1] ?? ""),
    expectedEndDate: current ? normalizeStructuredDate(dates[1] ?? "") : "",
    current,
    description,
    highlights: [],
    outcomes: [],
    background: "",
    tools: []
  };
}

function parseStructuredHeader(rawHeader: string) {
  let header = rawHeader.trim();
  const current = /(?:至今|现在|present|current)/iu.test(header);
  const dates = extractStructuredDates(header);
  header = header
    .replace(/(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?/g, "")
    .replace(/(?:至今|现在|present|current)/giu, "")
    .replace(/\s+-\s*$/, "")
    .trim();
  const segments = header.split(/\s{2,}/u).map((value) => value.trim()).filter(Boolean);
  const identity = segments[0] ?? "";
  const separator = [" / ", " ｜ ", " | ", "，", ","].find((value) => identity.includes(value));
  const identityParts = separator ? identity.split(separator).map((value) => value.trim()) : [identity];
  return {
    title: identityParts[0] ?? "",
    organization: identityParts[0] ?? "",
    role: identityParts.slice(1).join(separator ?? " / "),
    degree: "",
    location: segments.slice(1).join(" "),
    startDate: normalizeStructuredDate(dates[0] ?? ""),
    endDate: current ? "" : normalizeStructuredDate(dates[1] ?? ""),
    current
  };
}

function extractStructuredDates(value: string) {
  return value.match(/(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?/g) ?? [];
}

function valueDate(value: string | undefined) {
  const date = extractStructuredDates(value ?? "")[0];
  return date ? normalizeStructuredDate(date) : "";
}

function isStructuredDateOnlyLine(value: string) {
  return /^(?:(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?\s*(?:-|至今|现在|present|current)?\s*)+$/iu.test(value);
}

function splitStructuredList(value: string) {
  return value
    .split(/[、,，;；\n]/u)
    .map((entry) => stripStructuredBullet(entry.trim()) ?? entry.trim())
    .filter(Boolean);
}

function uniqueStructuredList(values: string[]) {
  return [...new Map(values.map((value) => [value.trim(), value.trim()])).values()].filter(Boolean);
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => Boolean(value?.trim()))?.trim() ?? "";
}

function normalizeLegacyStructuredLabel(value: string): LegacyResumeStructuredLabel {
  const compact = value.replace(/\s+/gu, "");
  const label = LEGACY_RESUME_STRUCTURED_LABELS.find((candidate) => candidate.replace(/\s+/gu, "") === compact);
  if (!label) throw new Error("unknown_legacy_resume_label");
  return label;
}

function legacyLabelFromLine(value: string) {
  const match = /^\s*(项目名称|组织|公司|单位|学校名称|学校|职位名称|职位\/角色|职责\s*\/\s*角色|职位|角色|部门|地点|所在地|学校所在地|项目地点|开始日期|结束日期|至今|学历|学位\/学历|学位|专业|主修课程|预计结束日期|在读|进行中|荣誉|技能名称|类别|熟练度|项目链接|工具|技术工具|技术栈|项目背景|说明|亮点|成果与结果|成果)\s*[：:]/u.exec(value);
  return match ? normalizeLegacyStructuredLabel(match[1]) : undefined;
}

export function serializeStructuredExperienceText(fields: StructuredExperienceFields, category: ResumeFieldCategoryId): string {
  const role = category === "education" ? fields.degree || fields.role : fields.role;
  const identity = [fields.organization.trim(), role.trim()].filter(Boolean).join(" / ");
  const dates = fields.startDate
    ? `${serializeStructuredDate(fields.startDate)} - ${fields.current ? (fields.expectedEndDate ? `${serializeStructuredDate(fields.expectedEndDate)}（预计）` : "至今") : serializeStructuredDate(fields.endDate)}`.replace(/\s+-\s+$/, "")
    : fields.current ? "至今" : serializeStructuredDate(fields.endDate);
  const header = [identity, fields.location.trim(), dates].filter(Boolean).join("  ");
  const metadata = category === "education"
    ? [
        fields.major.trim() ? `专业：${fields.major.trim()}` : "",
        fields.courses.trim() ? `主修课程：${fields.courses.trim()}` : ""
      ].filter(Boolean)
    : [];
  const content = [
    fields.background?.trim() ? `项目背景：${fields.background.trim()}` : "",
    fields.tools?.length ? `技术栈：${fields.tools.map((value) => value.trim()).filter(Boolean).join("、")}` : "",
    fields.description.trim(),
    ...fields.highlights.map((value) => `• ${value.trim()}`).filter((value) => value !== "•"),
    fields.outcomes?.length ? "成果与结果：" : "",
    ...(fields.outcomes ?? []).map((value) => `• ${value.trim()}`).filter((value) => value !== "•")
  ];
  return [header, ...metadata, ...content].filter(Boolean).join("\n");
}

function stripStructuredBullet(value: string) {
  if (!/^[•●○\-–]\s*/u.test(value)) return undefined;
  return value.replace(/^[•●○\-–]\s*/u, "").trim() || undefined;
}

function normalizeStructuredDate(value: string) {
  if (!value) return "";
  const parts = value.split(/[./-]/);
  if (parts.length === 1) return `${parts[0]}-01-01`;
  if (parts.length === 2) return `${parts[0]}-${parts[1].padStart(2, "0")}-01`;
  return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function serializeStructuredDate(value: string) {
  if (!value) return "";
  if (/^\d{4}-01-01$/.test(value)) return value.slice(0, 4);
  if (/^\d{4}-\d{2}-01$/.test(value)) return `${value.slice(0, 4)}.${value.slice(5, 7)}`;
  return value.replace(/-/g, ".");
}
