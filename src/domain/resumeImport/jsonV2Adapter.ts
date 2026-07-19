import {
  CareerAdaptResumeJsonV2Schema,
  StructuredResumeDraftSchema,
  type CareerAdaptResumeJsonV2,
  type CareerProfile,
  type ResumeBranch,
  type ResumeItemV2,
  type StructuredResumeDraft
} from "@/domain/schemas";
import { mapExternalResumeJson } from "./jsonMapper";
import { projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import type { ResumeJsonMapperOutput } from "@/domain/schemas";
import { migrateCareerProfileToV2, migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";
import { getResumeSectionDefinition } from "@/domain/resumeFields";
import { matchResumeSectionHeading } from "./sectionHeading";
import { adaptWenmoResumeJson, isWenmoResumeJson, type ExternalJsonValidationIssue } from "./wenmoJsonAdapter";

type AdapterResult =
  | { ok: true; value: CareerAdaptResumeJsonV2; sourceKind: "v2" | "v1" | "external"; validationIssues?: ExternalJsonValidationIssue[] }
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
  const grouped = new Map<Exclude<ResumeItemV2["sectionType"], "basics">, ResumeItemV2[]>();
  for (const [sectionIndex, section] of draft.sections.entries()) {
    for (const [itemIndex, rawItem] of section.items.entries()) {
      const sectionType = inferV1SectionType(section, rawItem);
      const item = toV2Item(rawItem, sectionType, `v1-${sectionIndex + 1}-${itemIndex + 1}`);
      if (item) grouped.set(sectionType, [...(grouped.get(sectionType) ?? []), item]);
    }
  }
  const sections = Array.from(grouped.entries()).map(([sectionType, items], order) => ({
    id: `v1-section-${sectionType}`,
    sectionType,
    title: getResumeSectionDefinition(sectionType).label,
    order,
    visible: true,
    items
  }));
  const summary = readValue(draft.basics.summary);
  if (summary) sections.unshift({ id: "v1-summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ id: "v1-summary-1", sectionType: "summary", text: summary, customFields: [] }] });
  return CareerAdaptResumeJsonV2Schema.parse({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics, sections: sections.map((section, order) => ({ ...section, order })), unclassifiedBlocks: [] });
}

export function adaptResumeJsonToV2(value: unknown): AdapterResult {
  const direct = CareerAdaptResumeJsonV2Schema.safeParse(value);
  if (direct.success) return { ok: true, value: direct.data, sourceKind: "v2" };
  if (value && typeof value === "object" && "schemaVersion" in value && (value as { schemaVersion?: unknown }).schemaVersion === "careeradapt-resume-v2") {
    const compatible = CareerAdaptResumeJsonV2Schema.safeParse(normalizeV2TemplateDialect(value));
    if (compatible.success) return { ok: true, value: compatible.data, sourceKind: "v2" };
    return { ok: false, message: "CareerAdapt JSON v2 不符合严格 Schema。", details: compatible.error.issues };
  }
  const v1 = StructuredResumeDraftSchema.safeParse(value);
  if (v1.success) return { ok: true, value: v1ToJsonV2(v1.data), sourceKind: "v1" };
  if (isWenmoResumeJson(value)) {
    const adapted = adaptWenmoResumeJson(value);
    return { ok: true, value: adapted.canonicalResume, sourceKind: "external", validationIssues: adapted.issues };
  }
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
    basics: {
      name: "陈同学", photo: "https://example.com/photo.png", headline: "数据与产品实践者", targetRole: "数据分析师",
      summary: "关注可验证的数据分析与产品实践。", phone: "13800000000", email: "student@example.com", location: "杭州",
      homepage: "https://example.com", linkedin: "https://www.linkedin.com/in/example", github: "https://github.com/example",
      portfolioLinks: ["https://example.com/portfolio"], otherLinks: ["https://example.com/profile"], customFields: []
    },
    sections: [
      { id: "summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ id: "summary-1", sectionType: "summary", text: "重视证据、结构与交付质量。", customFields: [] }] },
      { id: "education", sectionType: "education", title: "教育经历", order: 1, visible: true, items: [{ id: "education-1", sectionType: "education", school: "示例大学", major: "统计学", degree: "本科", department: "数据学院", location: "杭州", startDate: "2022-09", endDate: "2026-06", current: false, gpa: 3.8, gpaScale: 4, rankPosition: 5, rankTotal: 120, courses: ["统计建模"], honors: ["优秀学生"], description: "完成数据分析方向培养。", highlights: ["参与课程项目"], customFields: [] }] },
      { id: "work", sectionType: "work", title: "工作经历", order: 2, visible: true, items: [{ id: "work-1", sectionType: "work", organization: "示例科技", role: "数据分析师", department: "产品部", location: "杭州", startDate: "2025-01", endDate: "2025-12", current: false, description: "负责分析支持。", highlights: ["建立可复核指标"], customFields: [] }] },
      { id: "internship", sectionType: "internship", title: "实习经历", order: 3, visible: true, items: [{ id: "internship-1", sectionType: "internship", organization: "示例研究院", role: "研究实习生", department: "数据组", location: "上海", startDate: "2024-07", endDate: "2024-09", current: false, description: "参与数据清洗。", highlights: ["核对样本口径"], customFields: [] }] },
      { id: "project", sectionType: "project", title: "项目经历", order: 4, visible: true, items: [{ id: "project-1", sectionType: "project", title: "分析看板", role: "项目成员", organization: "课程团队", location: "杭州", startDate: "2024-03", endDate: "2024-06", current: false, url: "https://example.com/project", tools: ["SQL", "TypeScript"], background: "课程实践。", description: "构建数据看板。", highlights: ["完成指标核对"], outcomes: ["交付可演示版本"], customFields: [] }] },
      { id: "research", sectionType: "research", title: "科研经历", order: 5, visible: true, items: [{ id: "research-1", sectionType: "research", title: "样本质量研究", authorRole: "研究助理", institution: "示例实验室", startDate: "2024-09", endDate: "2025-01", current: false, methods: ["定量分析"], samples: "公开脱敏样本", publication: "关联研究报告", publicationStatus: "已完成", url: "https://example.com/research", description: "分析标注一致性。", highlights: ["形成复核记录"], customFields: [] }] },
      { id: "campus", sectionType: "campus", title: "校园经历", order: 6, visible: true, items: [{ id: "campus-1", sectionType: "campus", organization: "学生组织", role: "项目负责人", department: "实践部", location: "杭州", startDate: "2023-09", endDate: "2024-06", current: false, description: "组织校园活动。", highlights: ["整理执行清单"], customFields: [] }] },
      { id: "volunteer", sectionType: "volunteer", title: "志愿经历", order: 7, visible: true, items: [{ id: "volunteer-1", sectionType: "volunteer", organization: "社区服务中心", role: "志愿者", department: "活动组", location: "杭州", startDate: "2023-05", endDate: "2023-05", current: false, description: "参与现场服务。", highlights: ["完成信息登记"], customFields: [] }] },
      { id: "awards", sectionType: "awards", title: "奖项荣誉", order: 8, visible: true, items: [{ id: "award-1", sectionType: "awards", name: "示例竞赛二等奖", issuer: "示例组委会", level: "省级", awardedAt: "2024-05", rank: "二等奖", description: "以官方证书为准。", customFields: [] }] },
      { id: "skills", sectionType: "skills", title: "专业技能", order: 9, visible: true, items: [{ id: "skill-1", sectionType: "skills", name: "SQL", category: "数据分析", level: "熟练", description: "可完成查询与核对。", customFields: [] }] },
      { id: "certificates", sectionType: "certificates", title: "证书", order: 10, visible: true, items: [{ id: "certificate-1", sectionType: "certificates", name: "示例资格证书", issuer: "示例机构", issuedAt: "2024-03", expiresAt: "2027-03", credentialId: "EXAMPLE-001", status: "有效", description: "示例字段覆盖数据。", customFields: [] }] },
      { id: "languages", sectionType: "languages", title: "语言能力", order: 11, visible: true, items: [{ id: "language-1", sectionType: "languages", language: "英语", level: "工作沟通", testName: "示例考试", score: "合格", description: "以证书记录为准。", customFields: [] }] },
      { id: "publications", sectionType: "publications", title: "论文与出版物", order: 12, visible: true, items: [{ id: "publication-1", sectionType: "publications", title: "示例论文", authors: ["陈同学"], authorRole: "第一作者", publisher: "示例期刊", publishedAt: "2025-02", status: "已发表", doi: "10.0000/example", url: "https://example.com/publication", description: "公开示例。", customFields: [] }] },
      { id: "patents", sectionType: "patents", title: "专利", order: 13, visible: true, items: [{ id: "patent-1", sectionType: "patents", title: "示例专利", inventors: ["陈同学"], patentNumber: "CN000000", office: "示例受理机构", filedAt: "2024-01", grantedAt: "2025-01", status: "已授权", url: "https://example.com/patent", description: "公开示例。", customFields: [] }] },
      { id: "portfolio", sectionType: "portfolio", title: "作品集", order: 14, visible: true, items: [{ id: "portfolio-1", sectionType: "portfolio", title: "数据作品集", type: "网页", role: "作者", url: "https://example.com/work", createdAt: "2025-03", tools: ["TypeScript"], description: "展示公开练习项目。", highlights: ["保留复核说明"], customFields: [] }] },
      { id: "other", sectionType: "other", title: "其他内容", order: 15, visible: true, items: [{ id: "other-1", sectionType: "other", title: "补充说明", description: "仅用于字段覆盖测试。", highlights: ["不包含真实个人信息"], customFields: [] }] },
      { id: "custom-example", sectionType: "custom", title: "自定义栏目", order: 16, visible: true, items: [{ id: "custom-item-1", sectionType: "custom", title: "开源贡献", description: "维护示例组件。", highlights: ["提交文档修订"], customFields: [{ id: "stars", label: "Stars", valueType: "number", value: 120, order: 0, sensitive: false }] }] }
    ],
    unclassifiedBlocks: []
  });
}

export function exportCareerAdaptResumeJsonV2(input: {
  profile: CareerProfile;
  branch: ResumeBranch;
}): CareerAdaptResumeJsonV2 {
  const profile = migrateCareerProfileToV2(input.profile);
  const branch = migrateResumeBranchToV2(input.branch);
  const branchBasics = branch.resumeBasics;
  const basics = {
    ...profile.structuredBasics,
    targetRole: branchBasics && Object.prototype.hasOwnProperty.call(branchBasics, "targetRole")
      ? branchBasics.targetRole
      : profile.structuredBasics.targetRole,
    name: branchBasics?.name || profile.structuredBasics.name,
    email: branchBasics?.email || profile.structuredBasics.email,
    phone: branchBasics?.phone || profile.structuredBasics.phone,
    location: branchBasics?.location || profile.structuredBasics.location,
    summary: branchBasics?.summary || profile.structuredBasics.summary,
    otherLinks: branchBasics?.links.length ? branchBasics.links : profile.structuredBasics.otherLinks
  };
  const grouped = new Map<Exclude<ResumeItemV2["sectionType"], "basics">, typeof branch.structuredContentItems>();
  for (const item of [...branch.structuredContentItems].sort((left, right) => left.order - right.order)) {
    const sectionType = item.data.sectionType;
    grouped.set(sectionType, [...(grouped.get(sectionType) ?? []), item]);
  }
  const sections = Array.from(grouped.entries()).map(([sectionType, items], order) => ({
    id: `section-${sectionType}`,
    sectionType,
    title: getResumeSectionDefinition(sectionType).label,
    order,
    visible: items.some((item) => item.visible),
    items: items.filter((item) => item.visible).map((item) => item.data),
    mappingTrace: dedupeMappingTrace(items.flatMap((item) => item.mappingTrace))
  }));
  return CareerAdaptResumeJsonV2Schema.parse({
    schemaVersion: "careeradapt-resume-v2",
    locale: "zh-CN",
    basics,
    sections,
    unclassifiedBlocks: profile.unclassifiedBlocks.map((sourceValue, index) => ({
      id: `unclassified-${index + 1}`,
      sourcePath: `profile.unclassifiedBlocks[${index}]`,
      sourceValue,
      reason: "导入时未映射到正式栏目，原样保留"
    }))
  });
}

export function jsonV2ToLegacyMapperOutput(input: CareerAdaptResumeJsonV2): ResumeJsonMapperOutput {
  const resume = CareerAdaptResumeJsonV2Schema.parse(input);
  const categoryBySection = {
    summary: "summary", education: "education", work: "work", internship: "work", project: "project", research: "custom",
    campus: "campus", volunteer: "campus", awards: "award", skills: "skill", certificates: "certificate", languages: "language",
    publications: "custom", patents: "custom", portfolio: "custom", other: "custom", custom: "custom"
  } as const;
  const renderTypeBySection = {
    summary: "summary", education: "experience", work: "experience", internship: "experience", project: "experience", research: "experience",
    campus: "experience", volunteer: "experience", awards: "certificates", skills: "skills", certificates: "certificates", languages: "certificates",
    publications: "unknown", patents: "unknown", portfolio: "unknown", other: "unknown", custom: "unknown"
  } as const;
  return {
    structuredDraft: {
      schemaVersion: "structured-resume-draft-v1",
      basics: {
        name: resume.basics.name,
        email: resume.basics.email,
        phone: resume.basics.phone,
        location: resume.basics.location,
        summary: resume.sections.find((section) => section.sectionType === "summary")?.items[0] && projectResumeItemV2(resume.sections.find((section) => section.sectionType === "summary")!.items[0]!),
        links: [...resume.basics.portfolioLinks, ...resume.basics.otherLinks, ...[resume.basics.homepage, resume.basics.linkedin, resume.basics.github].filter((value): value is string => Boolean(value))]
      },
      sections: resume.sections.filter((section) => section.sectionType !== "summary").map((section) => ({
        title: section.title,
        category: categoryBySection[section.sectionType],
        sectionType: renderTypeBySection[section.sectionType],
        included: section.visible,
        items: section.items.map(projectResumeItemV2).filter(Boolean)
      }))
    },
    unclassifiedBlocks: resume.unclassifiedBlocks.map(({ sourcePath, sourceValue, reason }) => ({ sourcePath, sourceValue, reason })),
    mappingDecisions: resume.sections.flatMap((section) => section.mappingTrace ?? [])
      .map((trace) => ({ kind: "canonical_field" as const, ...trace }))
  };
}

function readValue(value: StructuredResumeDraft["basics"]["name"]): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.value;
}

function dedupeMappingTrace(trace: CareerAdaptResumeJsonV2["sections"][number]["mappingTrace"]) {
  if (!trace?.length) return undefined;
  return Array.from(new Map(trace.map((item) => [
    `${item.targetFieldId}\u0000${item.sourceBlockIds.join(",")}\u0000${item.sourceQuote}`,
    item
  ])).values());
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
  internship: (item: V1Item, id: string) => ({ ...base(item, id), sectionType: "internship" as const, organization: item.organization, role: item.role, location: item.location, startDate: item.startDate, endDate: item.endDate, current: item.current ?? false }),
  project: (item: V1Item, id: string) => ({ ...base(item, id), sectionType: "project" as const, title: item.organization, role: item.role, location: item.location, startDate: item.startDate, endDate: item.endDate, current: item.current ?? false, tools: [], outcomes: [] }),
  campus: (item: V1Item, id: string) => ({ ...base(item, id), sectionType: "campus" as const, organization: item.organization, role: item.role, location: item.location, startDate: item.startDate, endDate: item.endDate, current: item.current ?? false }),
  volunteer: (item: V1Item, id: string) => ({ ...base(item, id), sectionType: "volunteer" as const, organization: item.organization, role: item.role, location: item.location, startDate: item.startDate, endDate: item.endDate, current: item.current ?? false }),
  research: (item: V1Item, id: string) => ({ ...base(item, id), sectionType: "research" as const, title: item.organization, authorRole: item.role, startDate: item.startDate, endDate: item.endDate, current: item.current ?? false, methods: [] }),
  awards: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "awards" as const, name: requiredText(item)!, description: item.text, customFields: [] }) : undefined,
  skills: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "skills" as const, name: requiredText(item)!, description: item.text, customFields: [] }) : undefined,
  certificates: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "certificates" as const, name: requiredText(item)!, description: item.text, customFields: [] }) : undefined,
  languages: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "languages" as const, language: requiredText(item)!, description: item.text, customFields: [] }) : undefined,
  other: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "other" as const, title: item.organization || item.role, description: item.text || requiredText(item)!, highlights: item.highlights ?? [], customFields: [] }) : undefined,
  custom: (item: V1Item, id: string) => requiredText(item) ? ({ id, sectionType: "custom" as const, title: item.organization || item.role, description: item.text || requiredText(item), highlights: item.highlights ?? [], customFields: [] }) : undefined
} satisfies Record<string, (item: V1Item, id: string) => ResumeItemV2 | undefined>;

function inferV1SectionType(
  section: StructuredResumeDraft["sections"][number],
  rawItem: StructuredResumeDraft["sections"][number]["items"][number]
): keyof typeof v2Builders {
  const heading = matchResumeSectionHeading(section.title);
  if (heading?.kind === "canonical_section" && heading.sectionType !== "basics" && heading.sectionType in v2Builders) {
    return heading.sectionType as keyof typeof v2Builders;
  }
  if (section.category) return sectionTypeByV1Category[section.category];
  if (section.sectionType === "skills") return "skills";
  if (section.sectionType === "certificates") return "certificates";
  const item = typeof rawItem === "string" ? { text: rawItem } : rawItem;
  const text = [item.organization, item.role, item.text, ...(item.highlights ?? [])].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
  if (/(志愿|公益|volunteer)/i.test(text)) return "volunteer";
  if (/(科研|研究|论文|课题|research)/i.test(text)) return "research";
  if (/(实习|intern)/i.test(text)) return "internship";
  if (/(大学|学院|本科|硕士|博士|学位|学历|专业|gpa|education)/i.test(text)) return "education";
  if (/(奖|荣誉|竞赛|大赛|奖学金|award|honou?r)/i.test(text)) return "awards";
  if (/(项目|系统|平台|应用|project|taskai|smartfocus)/i.test(text)) return "project";
  if (/(校园|学生会|社团|班级|campus)/i.test(text)) return "campus";
  if (/(证书|认证|certificate|certification)/i.test(text)) return "certificates";
  if (/(语言|英语|中文|雅思|托福|cet|language)/i.test(text)) return "languages";
  if (/(技能|技术栈|skill)/i.test(text)) return "skills";
  if (item.organization || item.role) return "work";
  return "other";
}

function normalizeV2TemplateDialect(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  const basicsInput = asRecord(root.basics) ?? {};
  const basics = { ...basicsInput };
  if (Array.isArray(basics.links)) {
    basics.otherLinks = [...(Array.isArray(basics.otherLinks) ? basics.otherLinks : []), ...basics.links];
    delete basics.links;
  }
  const sections = Array.isArray(root.sections) ? root.sections.map((rawSection, sectionIndex) => {
    const section = asRecord(rawSection) ?? {};
    const sectionType = section.sectionType ?? section.type;
    const items = Array.isArray(section.items) ? section.items.map((rawItem) => normalizeTemplateItem(asRecord(rawItem) ?? {}, String(sectionType ?? "custom"))) : [];
    const normalized: Record<string, unknown> = { ...section, sectionType, order: section.order ?? sectionIndex, visible: section.visible ?? true, items };
    delete normalized.type;
    return normalized;
  }) : [];
  return { ...root, basics, sections, unclassifiedBlocks: root.unclassifiedBlocks ?? [] };
}

function normalizeTemplateItem(itemInput: Record<string, unknown>, sectionType: string) {
  const item: Record<string, unknown> = { ...itemInput, sectionType };
  const alias = (from: string, to: string) => {
    if (item[to] === undefined && item[from] !== undefined) item[to] = item[from];
    delete item[from];
  };
  if (sectionType === "publications") alias("publication", "publisher");
  if (sectionType === "portfolio") alias("portfolioType", "type");
  if (sectionType === "other") alias("text", "description");
  const customFields: Record<string, unknown>[] = Array.isArray(item.customFields) ? item.customFields.map((rawField: unknown, index: number) => {
    const field = { ...(asRecord(rawField) ?? {}) };
    field.order = field.order ?? field.displayOrder ?? index;
    field.sensitive = field.sensitive ?? false;
    delete field.displayOrder;
    return field;
  }) : [];
  if (sectionType === "patents" && typeof item.role === "string" && item.role.trim()) {
    customFields.push({ id: "patent-role", label: "角色", valueType: "string", value: item.role, order: customFields.length, sensitive: false });
    delete item.role;
  }
  item.customFields = customFields;
  return item;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
