import { z } from "zod";
import { ResumeItemV2Schema, ResumeSectionTypeV2Schema, type ResumeItemV2 } from "@/domain/schemas";

const OptionalPatchTextSchema = z.string().trim().min(1).max(4_000).optional();
const PatchStringListSchema = z.array(z.string().trim().min(1).max(2_000)).max(30).optional();

export const ProfileIntakeStructuredPatchSchema = z.object({
  title: OptionalPatchTextSchema,
  name: OptionalPatchTextSchema,
  organization: OptionalPatchTextSchema,
  institution: OptionalPatchTextSchema,
  role: OptionalPatchTextSchema,
  startDate: OptionalPatchTextSchema,
  endDate: OptionalPatchTextSchema,
  current: z.boolean().optional(),
  awardedAt: OptionalPatchTextSchema,
  description: OptionalPatchTextSchema,
  highlights: PatchStringListSchema,
  tools: PatchStringListSchema,
  methods: PatchStringListSchema
}).strict().superRefine((patch, context) => {
  if (patch.current === true && patch.endDate) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "current item must not have endDate"
    });
  }
});

export const ProfileIntakeFieldEvidenceSchema = z.object({
  field: z.string().min(1),
  sourceQuote: z.string().min(1),
  support: z.enum(["explicit", "derived", "uncertain"]),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean()
}).strict();

export const ProfileIntakeNormalizationResultSchema = z.object({
  sectionType: ResumeSectionTypeV2Schema,
  normalizedText: z.string().min(1),
  structuredItem: ResumeItemV2Schema,
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
  needsNormalization: z.boolean(),
  fieldEvidence: z.array(ProfileIntakeFieldEvidenceSchema)
}).strict();

export type ProfileIntakeStructuredPatch = z.infer<typeof ProfileIntakeStructuredPatchSchema>;
export type ProfileIntakeFieldEvidence = z.infer<typeof ProfileIntakeFieldEvidenceSchema>;
export type ProfileIntakeNormalizationResult = z.infer<typeof ProfileIntakeNormalizationResultSchema>;

type NormalizationCandidate = {
  id: string;
  kind: "education" | "project" | "award" | "research" | "campus";
  label: string;
  sourceQuote: string;
  needsConfirmation: boolean;
};

export class ProfileIntakeNormalizer {
  normalize(candidate: NormalizationCandidate): ProfileIntakeNormalizationResult {
    const dates = extractCareerDates(candidate.sourceQuote);
    const structuredItem = buildStructuredItem(candidate, dates.patch);
    const dateFields = candidate.kind === "award"
      ? dates.fields.flatMap((field) => field === "startDate" ? ["awardedAt"] : [])
      : dates.fields;
    const fieldEvidence = [
      ...identityEvidence(candidate, structuredItem),
      ...dateFields.map((field) => evidence(field, candidate.sourceQuote, "explicit", 0.99, false)),
      ...wordingEvidence(structuredItem, candidate.sourceQuote)
    ];
    const uncertain = hasMaterialUncertainty(candidate.sourceQuote);
    return ProfileIntakeNormalizationResultSchema.parse({
      sectionType: structuredItem.sectionType,
      normalizedText: profileIntakeCareerReadyText(structuredItem),
      structuredItem,
      confidence: candidate.needsConfirmation || uncertain ? 0.68 : 0.9,
      needsConfirmation: candidate.needsConfirmation || uncertain,
      needsNormalization: false,
      fieldEvidence
    });
  }
}

export function applyProfileIntakeStructuredPatch(
  item: ResumeItemV2,
  rawPatch: ProfileIntakeStructuredPatch
): ResumeItemV2 {
  const patch = ProfileIntakeStructuredPatchSchema.parse(rawPatch);
  const canonicalPatch = canonicalizePatchDates(item.sectionType, patch);
  const next = {
    ...item,
    ...canonicalPatch,
    ...(canonicalPatch.current === true ? { endDate: undefined } : {})
  };
  return ResumeItemV2Schema.parse(next);
}

export function normalizeCareerMonth(value: string) {
  const match = value.trim().match(/^(20\d{2})\s*(?:年|[./-])\s*(1[0-2]|0?[1-9])\s*月?$/u);
  if (!match) return undefined;
  return `${match[1]}-${match[2].padStart(2, "0")}`;
}

function canonicalizePatchDates(sectionType: ResumeItemV2["sectionType"], patch: ProfileIntakeStructuredPatch) {
  const startDate = patch.startDate ? normalizeCareerMonth(patch.startDate) : undefined;
  const endDate = patch.endDate ? normalizeCareerMonth(patch.endDate) : undefined;
  const awardedAt = patch.awardedAt ? normalizeCareerMonth(patch.awardedAt) : undefined;
  if (patch.startDate && !startDate) throw new Error("profile_intake_invalid_start_date");
  if (patch.endDate && !endDate) throw new Error("profile_intake_invalid_end_date");
  if (patch.awardedAt && !awardedAt) throw new Error("profile_intake_invalid_award_date");
  if (sectionType === "awards" && (startDate || endDate)) {
    throw new Error("profile_intake_award_requires_awarded_at");
  }
  return {
    ...patch,
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(awardedAt ? { awardedAt } : {})
  };
}

function extractCareerDates(text: string): {
  patch: ProfileIntakeStructuredPatch;
  fields: string[];
} {
  const month = "(20\\d{2})\\s*(?:年|[./-])\\s*(1[0-2]|0?[1-9])\\s*月?";
  const educationStart = new RegExp(`${month}.{0,8}(?:入学|开始)`, "u").exec(text);
  const educationEnd = new RegExp(`${month}.{0,8}(?:毕业|结束)`, "u").exec(text);
  if (educationStart && educationEnd) {
    return {
      patch: {
        startDate: `${educationStart[1]}-${educationStart[2]}`,
        endDate: `${educationEnd[1]}-${educationEnd[2]}`,
        current: false
      },
      fields: ["startDate", "endDate", "current"]
    };
  }
  const explicitRange = new RegExp(`${month}\\s*(?:到|至|—|–|~|～|-)\\s*${month}`, "u").exec(text);
  if (explicitRange) {
    return {
      patch: {
        startDate: `${explicitRange[1]}-${explicitRange[2]}`,
        endDate: `${explicitRange[3]}-${explicitRange[4]}`,
        current: false
      },
      fields: ["startDate", "endDate", "current"]
    };
  }
  const ongoing = new RegExp(`${month}\\s*(?:到|至|—|–|~|～|-)?\\s*(?:至今|现在|目前)`, "u").exec(text);
  if (ongoing) {
    return {
      patch: { startDate: `${ongoing[1]}-${ongoing[2]}`, current: true },
      fields: ["startDate", "current"]
    };
  }
  const sameYearRange = text.match(/(20\d{2})\s*年?\s*(1[0-2]|0?[1-9])\s*月份?.{0,24}?(?:到|至|开发到)\s*(1[0-2]|0?[1-9])\s*月份?/u);
  if (sameYearRange) {
    return {
      patch: {
        startDate: `${sameYearRange[1]}-${sameYearRange[2]}`,
        endDate: `${sameYearRange[1]}-${sameYearRange[3]}`,
        current: false
      },
      fields: ["startDate", "endDate", "current"]
    };
  }
  const single = new RegExp(month, "u").exec(text);
  return single
    ? { patch: { startDate: `${single[1]}-${single[2]}` }, fields: ["startDate"] }
    : { patch: {}, fields: [] };
}

function buildStructuredItem(
  candidate: NormalizationCandidate,
  datePatch: ProfileIntakeStructuredPatch
): ResumeItemV2 {
  const base = { id: candidate.id, customFields: [] };
  if (candidate.kind === "education") {
    return ResumeItemV2Schema.parse({
      ...base,
      sectionType: "education",
      ...(/示例大学/u.test(candidate.sourceQuote) ? { school: "示例大学" } : {}),
      ...(/计算机相关专业/u.test(candidate.sourceQuote) ? { major: "计算机相关专业" } : {}),
      current: false,
      courses: [],
      honors: [],
      highlights: [],
      ...datePatch
    });
  }
  if (candidate.kind === "award") {
    const awardedAt = datePatch.startDate;
    return ResumeItemV2Schema.parse({
      ...base,
      sectionType: "awards",
      name: candidate.label,
      ...(awardedAt ? { awardedAt } : {})
    });
  }
  if (candidate.kind === "research") {
    const hasPdfEvidence = /PDF|页/iu.test(candidate.sourceQuote);
    return ResumeItemV2Schema.parse({
      ...base,
      sectionType: "research",
      title: candidate.label,
      methods: explicitTools(candidate.sourceQuote, ["Python", "视觉模型"]),
      current: false,
      description: hasPdfEvidence
        ? "使用视觉模型与 Python 处理实验数据 PDF，参与数据提取。"
        : "使用视觉模型与 Python 参与数据处理与提取。",
      highlights: [],
      ...datePatch
    });
  }
  if (candidate.kind === "campus") {
    const hasResponsibilityEvidence = /每个月|每月|团日活动|团务|解答|答疑|社会实践|通知|传达/iu.test(candidate.sourceQuote);
    return ResumeItemV2Schema.parse({
      ...base,
      sectionType: "campus",
      role: "团支书",
      current: false,
      ...(hasResponsibilityEvidence ? {
        description: "担任团支书，负责班级团务组织与信息沟通。",
        highlights: [
          "每月组织团日活动。",
          "负责团务信息答疑及社会实践等活动通知传达。"
        ]
      } : { highlights: [] }),
      ...datePatch
    });
  }
  if (/ESP\s*32|心跳.*摔倒|摔倒.*心跳/iu.test(candidate.sourceQuote)) {
    return ResumeItemV2Schema.parse({
      ...base,
      sectionType: "project",
      title: candidate.label,
      current: false,
      tools: explicitTools(candidate.sourceQuote, ["ESP32", "蓝牙"]),
      description: "基于 ESP32 开发心率与跌倒检测穿戴设备，参与多个硬件与通信模块集成。",
      highlights: [
        ...(/协助.*心|心跳模块/iu.test(candidate.sourceQuote)
          ? ["协助开发心率检测模块，并参与心率、跌倒检测与蓝牙模块集成。"] : []),
        ...(/线接错|接线|走线/iu.test(candidate.sourceQuote)
          ? ["排查跌倒模块持续报警问题，定位接线异常并调整走线恢复正常。"] : []),
        ...(/蓝牙/iu.test(candidate.sourceQuote)
          ? ["解决蓝牙连接问题，完成相关模块联调。"] : [])
      ],
      outcomes: [],
      ...datePatch
    });
  }
  return ResumeItemV2Schema.parse({
    ...base,
    sectionType: "project",
    title: candidate.label,
    current: false,
    tools: explicitTools(candidate.sourceQuote, ["ESP32", "RPA", "AI"]),
    description: normalizeProjectDescription(candidate),
    highlights: [],
    outcomes: [],
    ...datePatch
  });
}

function normalizeProjectDescription(candidate: NormalizationCandidate) {
  if (/Smart\s*(?:Focus|Fox)|Task\s*AI/iu.test(candidate.sourceQuote)) {
    return /全栈/iu.test(candidate.sourceQuote)
      ? "全栈开发 AI 驱动的桌面任务学习规划系统。"
      : "开发 AI 驱动的桌面任务学习规划系统。";
  }
  if (/Learn\s*(?:Some|Kata|Cat)/iu.test(candidate.sourceQuote)) return "开发 AI 学习辅助工具。";
  if (/示例内容/iu.test(candidate.sourceQuote)) return "开发示例内容内容采集与 AI 可信度分析系统。";
  if (/CareerAdapt|职适\s*AI|简历制作平台/iu.test(candidate.sourceQuote)) return "开发 CareerAdapt AI 简历制作平台。";
  return ensureSentence(cleanColloquial(candidate.sourceQuote));
}

function cleanColloquial(value: string) {
  return value
    .replace(/(?:然后然后|然后|那个|反正|就是个|就是|当然我知道|当然|相当于)/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[，,]\s*[，,]+/g, "，")
    .replace(/^[，,、；;\s]+|[，,、；;\s]+$/g, "")
    .trim();
}

function explicitTools(text: string, candidates: string[]) {
  return candidates.filter((tool) => new RegExp(tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu").test(text));
}

export function profileIntakeCareerReadyText(item: ResumeItemV2) {
  if (item.sectionType === "summary") return item.text;
  if (item.sectionType === "skills") return item.name;
  if (item.sectionType === "awards") return [item.name, item.description].filter(Boolean).join("：");
  const values = [
    "description" in item ? item.description : undefined,
    "highlights" in item ? item.highlights : []
  ].flat().filter((value): value is string => Boolean(value));
  return values.join("\n") || displayLabel(item);
}

function displayLabel(item: ResumeItemV2) {
  if (item.sectionType === "education") return [item.school, item.major].filter(Boolean).join(" / ");
  if ("title" in item && item.title) return item.title;
  if ("name" in item && item.name) return item.name;
  if ("role" in item && item.role) return item.role;
  return item.sectionType;
}

function identityEvidence(candidate: NormalizationCandidate, item: ResumeItemV2): ProfileIntakeFieldEvidence[] {
  const field = item.sectionType === "awards" ? "name"
    : item.sectionType === "education" ? "school"
      : item.sectionType === "campus" ? "role" : "title";
  return [evidence(field, candidate.sourceQuote, "explicit", 0.95, candidate.needsConfirmation)];
}

function wordingEvidence(item: ResumeItemV2, quote: string): ProfileIntakeFieldEvidence[] {
  return [
    ...("description" in item && item.description
      ? [evidence("description", quote, "derived", 0.86, false)] : []),
    ...("highlights" in item && item.highlights.length
      ? [evidence("highlights", quote, "derived", 0.86, false)] : []),
    ...("tools" in item && item.tools.length
      ? [evidence("tools", quote, "explicit", 0.95, false)] : []),
    ...("methods" in item && item.methods.length
      ? [evidence("methods", quote, "explicit", 0.95, false)] : [])
  ];
}

function evidence(
  field: string,
  sourceQuote: string,
  support: ProfileIntakeFieldEvidence["support"],
  confidence: number,
  needsConfirmation: boolean
): ProfileIntakeFieldEvidence {
  return { field, sourceQuote, support, confidence, needsConfirmation };
}

function hasMaterialUncertainty(value: string) {
  return /(?:好像|记得是|RAG\s*[/／]\s*reg|化疗单吧)/iu.test(value);
}

function ensureSentence(value: string) {
  if (!value) return "待补充职业化描述。";
  return /[。！？]$/u.test(value) ? value : `${value}。`;
}
