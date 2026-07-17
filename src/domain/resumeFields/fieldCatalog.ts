import type { CanonicalFieldId, ResumeFieldDefinition, ResumeFieldUiControl, ResumeFieldValueType, ResumeSectionTypeV2 } from "./types";

type FieldSeed = readonly [name: string, label: string, valueType?: ResumeFieldValueType, aliases?: readonly string[], uiControl?: ResumeFieldUiControl, sensitive?: boolean];

const seeds: Partial<Record<Exclude<ResumeSectionTypeV2, "custom">, readonly FieldSeed[]>> = {
  basics: [
    ["name", "姓名", "string", ["fullName", "姓名"], "text", true], ["photo", "照片", "url", ["avatar"], "url", true],
    ["headline", "职业标题", "string", ["title"], "text"], ["targetRole", "目标岗位", "string", ["objective", "position"], "text"],
    ["summary", "职业简介", "text", ["profileSummary", "professionalSummary"], "textarea"],
    ["phone", "电话", "string", ["mobile", "tel"], "text", true], ["email", "邮箱", "string", ["mail"], "text", true],
    ["location", "所在地", "string", ["address", "city"], "text", true], ["homepage", "个人主页", "url", ["website"], "url"],
    ["linkedin", "LinkedIn", "url", [], "url"], ["github", "GitHub", "url", [], "url"],
    ["portfolioLinks", "作品集链接", "string_list", ["portfolio", "portfolioUrls"], "tags"], ["otherLinks", "其他链接", "string_list", ["links", "socialLinks"], "tags"]
  ],
  summary: [["text", "自我评价", "text", ["summary", "profile", "about"], "textarea"]],
  education: [
    ["school", "学校", "string", ["institution", "university"], "text"], ["major", "专业", "string", ["fieldOfStudy"], "text"],
    ["degree", "学位/学历", "string", ["qualification"], "text"], ["department", "院系", "string", ["faculty"], "text"],
    ["location", "所在地", "string", ["city"], "text"], ["startDate", "开始日期", "date", ["from"], "date"],
    ["endDate", "结束日期", "date", ["to"], "date"], ["current", "在读", "boolean", ["present"], "checkbox"],
    ["gpa", "GPA", "number", ["gradePointAverage"], "number"], ["gpaScale", "GPA 满分", "number", ["gpaMax"], "number"],
    ["rankPosition", "排名", "number", ["rank"], "number"], ["rankTotal", "排名总人数", "number", ["cohortSize"], "number"],
    ["courses", "主修课程", "string_list", ["coursework"], "tags"], ["honors", "荣誉", "string_list", ["academicHonors"], "tags"],
    ["description", "说明", "text", ["details"], "textarea"], ["highlights", "亮点", "string_list", ["bullets", "achievements"], "tags"]
  ],
  work: experienceSeeds(),
  internship: experienceSeeds(),
  project: [
    ["title", "项目名称", "string", ["name"], "text"], ["role", "角色", "string", ["position"], "text"],
    ["organization", "组织", "string", ["company"], "text"], ["location", "所在地", "string", ["city"], "text"], ["startDate", "开始日期", "date", ["from"], "date"],
    ["endDate", "结束日期", "date", ["to"], "date"], ["current", "进行中", "boolean", ["present"], "checkbox"],
    ["url", "项目链接", "url", ["link"], "url"],
    ["tools", "技术工具", "string_list", ["technologies", "techStack"], "tags"], ["background", "项目背景", "text", ["context"], "textarea"],
    ["description", "说明", "text", ["details"], "textarea"], ["highlights", "亮点", "string_list", ["bullets", "achievements"], "tags"],
    ["outcomes", "成果", "string_list", ["results", "impact"], "tags"]
  ],
  research: [
    ["title", "研究题目", "string", ["name"], "text"], ["authorRole", "作者身份", "string", ["role", "authorship"], "text"],
    ["institution", "研究机构", "string", ["organization"], "text"], ["startDate", "开始日期", "date", ["from"], "date"],
    ["endDate", "结束日期", "date", ["to"], "date"], ["current", "进行中", "boolean", ["present"], "checkbox"],
    ["methods", "研究方法", "string_list", ["methodology"], "tags"],
    ["samples", "样本", "text", ["sample"], "textarea"], ["publication", "关联论文", "string", ["paper"], "text"],
    ["publicationStatus", "发表状态", "string", ["status"], "select"], ["url", "链接", "url", ["link", "doi"], "url"],
    ["description", "说明", "text", ["details"], "textarea"], ["highlights", "亮点", "string_list", ["bullets", "findings"], "tags"]
  ],
  campus: experienceSeeds(),
  volunteer: experienceSeeds(),
  awards: [
    ["name", "奖项名称", "string", ["title"], "text"], ["issuer", "颁发方", "string", ["organization"], "text"],
    ["level", "级别", "string", ["scope"], "select"], ["awardedAt", "获奖日期", "date", ["date"], "date"],
    ["rank", "名次", "string", ["placement"], "text"], ["description", "说明", "text", ["details"], "textarea"]
  ],
  skills: [["name", "技能名称", "string", ["skill"], "text"], ["category", "类别", "string", ["group"], "text"], ["level", "熟练度", "string", ["proficiency"], "select"], ["description", "说明", "text", ["details"], "textarea"]],
  certificates: [["name", "证书名称", "string", ["title"], "text"], ["issuer", "颁发方", "string", ["organization"], "text"], ["issuedAt", "颁发日期", "date", ["date"], "date"], ["expiresAt", "到期日期", "date", ["expiryDate"], "date"], ["credentialId", "证书编号", "string", ["credentialNumber"], "text", true], ["status", "状态", "string", [], "select"], ["description", "说明", "text", ["details"], "textarea"]],
  languages: [["language", "语言", "string", ["name"], "text"], ["level", "水平", "string", ["proficiency"], "select"], ["testName", "考试名称", "string", ["test"], "text"], ["score", "成绩", "string", ["grade"], "text"], ["description", "说明", "text", ["details"], "textarea"]],
  publications: [["title", "标题", "string", ["name"], "text"], ["authors", "作者", "string_list", ["author"], "tags"], ["authorRole", "作者身份", "string", ["authorship"], "text"], ["publisher", "期刊/出版方", "string", ["journal", "venue"], "text"], ["publishedAt", "发表日期", "date", ["date"], "date"], ["status", "状态", "string", [], "select"], ["doi", "DOI", "string", [], "text"], ["url", "链接", "url", ["link"], "url"], ["description", "说明", "text", ["abstract"], "textarea"]],
  patents: [["title", "专利名称", "string", ["name"], "text"], ["inventors", "发明人", "string_list", ["inventor"], "tags"], ["patentNumber", "专利号", "string", ["number"], "text"], ["office", "受理机构", "string", ["authority"], "text"], ["filedAt", "申请日期", "date", ["applicationDate"], "date"], ["grantedAt", "授权日期", "date", ["grantDate"], "date"], ["status", "状态", "string", [], "select"], ["url", "链接", "url", ["link"], "url"], ["description", "说明", "text", ["abstract"], "textarea"]],
  portfolio: [["title", "作品名称", "string", ["name"], "text"], ["type", "作品类型", "string", ["category"], "text"], ["role", "角色", "string", [], "text"], ["url", "链接", "url", ["link"], "url"], ["createdAt", "创作日期", "date", ["date"], "date"], ["tools", "工具", "string_list", ["technologies"], "tags"], ["description", "说明", "text", ["details"], "textarea"], ["highlights", "亮点", "string_list", ["bullets"], "tags"]],
  other: [["title", "标题", "string", ["name"], "text"], ["description", "内容", "text", ["text", "details"], "textarea"], ["highlights", "要点", "string_list", ["bullets"], "tags"]]
};

function experienceSeeds(): readonly FieldSeed[] {
  return [["organization", "组织", "string", ["company", "institution"], "text"], ["role", "职位/角色", "string", ["position", "title"], "text"], ["department", "部门", "string", ["team"], "text"], ["location", "所在地", "string", ["city"], "text"], ["startDate", "开始日期", "date", ["from"], "date"], ["endDate", "结束日期", "date", ["to"], "date"], ["current", "至今", "boolean", ["present"], "checkbox"], ["description", "说明", "text", ["details"], "textarea"], ["highlights", "亮点", "string_list", ["bullets", "achievements"], "tags"]];
}

export const resumeFieldCatalog: readonly ResumeFieldDefinition[] = Object.entries(seeds).flatMap(([sectionType, fields]) =>
  (fields ?? []).map(([name, label, valueType = "string", aliases = [], uiControl, sensitive = false], index) => ({
    id: `${sectionType}.${name}` as CanonicalFieldId,
    sectionType: sectionType as ResumeSectionTypeV2,
    label,
    aliases,
    valueType,
    repeatable: valueType === "string_list",
    required: name === "name" && ["basics", "skills", "certificates", "awards"].includes(sectionType),
    importable: true,
    aiMappable: true,
    sensitive,
    defaultVisible: true,
    displayOrder: (index + 1) * 10,
    uiControl
  }))
);

export const resumeFieldById = new Map(resumeFieldCatalog.map((field) => [field.id, field]));

export function getResumeFieldDefinition(id: CanonicalFieldId) {
  return resumeFieldById.get(id);
}

export function isCanonicalFieldId(value: string): value is CanonicalFieldId {
  return resumeFieldById.has(value as CanonicalFieldId);
}

export function findResumeFieldsByAlias(alias: string, sectionType?: ResumeSectionTypeV2) {
  const normalized = alias.trim().toLocaleLowerCase();
  return resumeFieldCatalog.filter((field) => (!sectionType || field.sectionType === sectionType) &&
    [field.id.split(".").at(-1) ?? "", ...field.aliases].some((candidate) => candidate.toLocaleLowerCase() === normalized));
}
