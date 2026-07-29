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
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics"]),
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
  kind: "education" | "work" | "internship" | "project" | "award" | "research" | "campus" | "volunteer" | "other";
  label: string;
  sourceQuote: string;
  needsConfirmation: boolean;
};

export class ProfileIntakeNormalizer {
  /**
   * Deterministic normalization is deliberately narrow. It canonicalizes
   * dates and an already-classified candidate; semantic classification belongs
   * to ProfileIntakeSemanticService.
   */
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
      needsNormalization: candidate.kind === "other",
      fieldEvidence
    });
  }

  fallback(rawNarrative: string): ProfileIntakeNormalizationResult {
    const sourceQuote = rawNarrative.trim();
    const id = `intake-fallback-${simpleHash(sourceQuote)}`;
    const dates = extractCareerDates(sourceQuote);
    const structuredItem = ResumeItemV2Schema.parse({
      id,
      sectionType: "other",
      description: sourceQuote,
      highlights: [],
      customFields: []
    });
    return ProfileIntakeNormalizationResultSchema.parse({
      sectionType: "other",
      normalizedText: sourceQuote,
      structuredItem,
      confidence: dates.fields.length ? 0.45 : 0.2,
      needsConfirmation: true,
      needsNormalization: true,
      fieldEvidence: [
        evidence("description", sourceQuote, "explicit", 1, true),
        ...dates.fields.map((field) => evidence(field, sourceQuote, "explicit", 0.99, true))
      ]
    });
  }

  canonicalizeDates(sectionType: ResumeItemV2["sectionType"], patch: ProfileIntakeStructuredPatch) {
    return canonicalizePatchDates(sectionType, patch);
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
  return Object.fromEntries(Object.entries({
    ...patch,
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(awardedAt ? { awardedAt } : {})
  }).filter(([, value]) => value !== undefined)) as ProfileIntakeStructuredPatch;
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
      school: candidate.label,
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
    return ResumeItemV2Schema.parse({
      ...base,
      sectionType: "research",
      title: candidate.label,
      methods: [],
      current: false,
      description: ensureSentence(cleanColloquial(candidate.sourceQuote)),
      highlights: [],
      ...datePatch
    });
  }
  if (["work", "internship", "campus", "volunteer"].includes(candidate.kind)) {
    return ResumeItemV2Schema.parse({
      ...base,
      sectionType: candidate.kind,
      role: candidate.label,
      current: false,
      description: ensureSentence(cleanColloquial(candidate.sourceQuote)),
      highlights: [],
      ...datePatch
    });
  }
  if (candidate.kind === "other") {
    return ResumeItemV2Schema.parse({
      ...base,
      sectionType: "other",
      title: candidate.label,
      description: candidate.sourceQuote,
      highlights: []
    });
  }
  return ResumeItemV2Schema.parse({
    ...base,
    sectionType: "project",
    title: candidate.label,
    current: false,
    tools: [],
    description: ensureSentence(cleanColloquial(candidate.sourceQuote)),
    highlights: [],
    outcomes: [],
    ...datePatch
  });
}

function cleanColloquial(value: string) {
  return value
    .replace(/(?:然后然后|然后|那个|反正|就是个|就是|当然我知道|当然|相当于)/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[，,]\s*[，,]+/g, "，")
    .replace(/^[，,、；;\s]+|[，,、；;\s]+$/g, "")
    .trim();
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
      : ["work", "internship", "campus", "volunteer"].includes(item.sectionType) ? "role" : "title";
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

function simpleHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
