import type { ExperienceType } from "@/domain/schemas/profile";

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
  organization: string;
  role: string;
  location: string;
  degree: string;
  major: string;
  courses: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
  highlights: string[];
};

export const emptyStructuredExperienceFields: StructuredExperienceFields = {
  organization: "",
  role: "",
  location: "",
  degree: "",
  major: "",
  courses: "",
  startDate: "",
  endDate: "",
  current: false,
  description: "",
  highlights: []
};

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
      description: "项目成果与说明"
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
      description: "实习内容与成果"
    };
  }
  return {
    organization: "公司 / 组织",
    role: "职位 / 角色",
    location: "工作地点",
    startDate: "开始日期",
    endDate: "结束日期",
    description: "工作内容与成果"
  };
}

export function parseStructuredExperienceText(text: string): StructuredExperienceFields {
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
  const description = rawLines
    .filter((line) => !/^(学历|专业|主修课程)[：:]/.test(line.trim()))
    .join("\n")
    .trim();
  return {
    organization: identityParts[0] ?? "",
    role: identityParts.slice(1).join(separator ?? " / "),
    location: segments.slice(1).join(" "),
    degree: degreeLine?.replace(/^学历[：:]\s*/, "").trim() ?? "",
    major: majorLine?.replace(/^专业[：:]\s*/, "").trim() ?? "",
    courses: coursesLine?.replace(/^主修课程[：:]\s*/, "").trim() ?? "",
    startDate: normalizeStructuredDate(dates[0] ?? ""),
    endDate: current ? "" : normalizeStructuredDate(dates[1] ?? ""),
    current,
    description,
    highlights: []
  };
}

export function serializeStructuredExperienceText(fields: StructuredExperienceFields, category: ResumeFieldCategoryId): string {
  const role = category === "education" ? fields.degree || fields.role : fields.role;
  const identity = [fields.organization.trim(), role.trim()].filter(Boolean).join(" / ");
  const dates = fields.startDate
    ? `${serializeStructuredDate(fields.startDate)} - ${fields.current ? "至今" : serializeStructuredDate(fields.endDate)}`.replace(/\s+-\s+$/, "")
    : fields.current ? "至今" : serializeStructuredDate(fields.endDate);
  const header = [identity, fields.location.trim(), dates].filter(Boolean).join("  ");
  const metadata = category === "education"
    ? [
        fields.major.trim() ? `专业：${fields.major.trim()}` : "",
        fields.courses.trim() ? `主修课程：${fields.courses.trim()}` : ""
      ].filter(Boolean)
    : [];
  return [header, ...metadata, fields.description.trim()].filter(Boolean).join("\n");
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
