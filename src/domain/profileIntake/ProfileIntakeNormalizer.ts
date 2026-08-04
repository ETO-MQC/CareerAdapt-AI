import { z } from "zod";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { ResumeItemV2Schema, ResumeSectionTypeV2Schema, type EducationItemV2, type ResumeItemV2 } from "@/domain/schemas";

const OptionalPatchTextSchema = z.string().trim().min(1).max(4_000).optional();
const PatchStringListSchema = z.array(z.string().trim().min(1).max(2_000)).max(30).optional();

export const ProfileIntakeStructuredPatchSchema = z.object({
  title: OptionalPatchTextSchema,
  name: OptionalPatchTextSchema,
  organization: OptionalPatchTextSchema,
  institution: OptionalPatchTextSchema,
  role: OptionalPatchTextSchema,
  school: OptionalPatchTextSchema,
  degree: OptionalPatchTextSchema,
  major: OptionalPatchTextSchema,
  department: OptionalPatchTextSchema,
  location: OptionalPatchTextSchema,
  startDate: OptionalPatchTextSchema,
  endDate: OptionalPatchTextSchema,
  current: z.boolean().optional(),
  gpa: z.number().min(0).optional(),
  gpaScale: z.number().positive().optional(),
  rankPosition: z.number().int().positive().optional(),
  rankTotal: z.number().int().positive().optional(),
  courses: PatchStringListSchema,
  honors: PatchStringListSchema,
  awardedAt: OptionalPatchTextSchema,
  level: OptionalPatchTextSchema,
  category: OptionalPatchTextSchema,
  language: OptionalPatchTextSchema,
  testName: OptionalPatchTextSchema,
  score: OptionalPatchTextSchema,
  issuer: OptionalPatchTextSchema,
  issuedAt: OptionalPatchTextSchema,
  expiresAt: OptionalPatchTextSchema,
  credentialId: OptionalPatchTextSchema,
  status: OptionalPatchTextSchema,
  rank: OptionalPatchTextSchema,
  authorRole: OptionalPatchTextSchema,
  publisher: OptionalPatchTextSchema,
  publishedAt: OptionalPatchTextSchema,
  patentNumber: OptionalPatchTextSchema,
  office: OptionalPatchTextSchema,
  filedAt: OptionalPatchTextSchema,
  grantedAt: OptionalPatchTextSchema,
  url: OptionalPatchTextSchema,
  background: OptionalPatchTextSchema,
  description: OptionalPatchTextSchema,
  highlights: PatchStringListSchema,
  tools: PatchStringListSchema,
  methods: PatchStringListSchema,
  outcomes: PatchStringListSchema
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
  structuredItem: ResumeItemV2Schema.optional(),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
  needsNormalization: z.boolean(),
  deterministicDatePatch: z.object({
    startDate: OptionalPatchTextSchema,
    endDate: OptionalPatchTextSchema,
    current: z.boolean().optional(),
    awardedAt: OptionalPatchTextSchema
  }).strict().optional(),
  fieldEvidence: z.array(ProfileIntakeFieldEvidenceSchema)
}).strict();

export type ProfileIntakeStructuredPatch = z.infer<typeof ProfileIntakeStructuredPatchSchema>;
export type ProfileIntakeFieldEvidence = z.infer<typeof ProfileIntakeFieldEvidenceSchema>;
export type ProfileIntakeNormalizationResult = z.infer<typeof ProfileIntakeNormalizationResultSchema>;
export type ProfileIntakePatchEvidenceSource = {
  sourceQuote: string;
  supportedFields?: string[];
};

type NormalizationCandidate = {
  id: string;
  kind: "education" | "work" | "internship" | "project" | "award" | "research" | "campus" | "volunteer" | "other";
  label: string;
  sourceQuote: string;
  needsConfirmation: boolean;
};

export type ExtractedEducationFacts = {
  school?: string;
  degree?: string;
  major?: string;
  datePatch: Pick<ProfileIntakeStructuredPatch, "startDate" | "endDate" | "current">;
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
    const education = sourceQuote.length <= 180
      ? buildEducationFallback(id, sourceQuote, dates.patch)
      : undefined;
    if (education) {
      const fieldEvidence = [
        ...(["school", "degree", "major"] as const).flatMap((field) => field in education && education[field]
          ? [evidence(field, sourceQuote, "explicit", 0.95, true)] : []),
        ...dates.fields.map((field) => evidence(field, sourceQuote, "explicit", 0.99, true))
      ];
      return ProfileIntakeNormalizationResultSchema.parse({
        sectionType: "education",
        normalizedText: profileIntakeCareerReadyText(education),
        structuredItem: education,
        confidence: 0.68,
        needsConfirmation: true,
        needsNormalization: false,
        deterministicDatePatch: dates.patch,
        fieldEvidence
      });
    }
    const structuredItem = ResumeItemV2Schema.parse({
      id,
      sectionType: "other",
      description: "原始回答已保留，等待职业化整理。",
      highlights: [],
      customFields: []
    });
    return ProfileIntakeNormalizationResultSchema.parse({
      sectionType: "other",
      normalizedText: "原始回答已保留，等待职业化整理。",
      structuredItem,
      confidence: dates.fields.length ? 0.45 : 0.2,
      needsConfirmation: true,
      needsNormalization: true,
      deterministicDatePatch: dates.patch,
      fieldEvidence: [
        evidence("rawNarrative", sourceQuote, "explicit", 1, true),
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

export function validateProfileIntakeStructuredPatch(input: {
  item: ResumeItemV2;
  rawPatch: ProfileIntakeStructuredPatch;
  evidenceSources: ProfileIntakePatchEvidenceSource[];
}): {
  patch: ProfileIntakeStructuredPatch;
  fieldEvidence: ProfileIntakeFieldEvidence[];
} {
  const patch = ProfileIntakeStructuredPatchSchema.parse(input.rawPatch);
  const canonicalPatch = canonicalizePatchDates(input.item.sectionType, patch);
  const sources = input.evidenceSources
    .filter((source) => source.sourceQuote.trim())
    .map((source) => ({ ...source, sourceQuote: source.sourceQuote.trim() }));
  if (!sources.length) throw new Error("profile_intake_patch_evidence_missing");

  const fieldEvidence: ProfileIntakeFieldEvidence[] = [];
  for (const [field, value] of Object.entries(canonicalPatch)) {
    const supporting = sources.find((source) =>
      (!source.supportedFields || source.supportedFields.includes(field))
      && patchValueGrounded(field, value, source.sourceQuote)
    );
    if (isHardPatchField(field)) {
      if (!supporting) throw new Error(`profile_intake_patch_field_unsupported:${field}`);
      fieldEvidence.push(evidence(field, supporting.sourceQuote, "explicit", 1, false));
      continue;
    }
    const allowedText = sources.map((source) => source.sourceQuote).join("\n");
    const checkedText = patchValueText(value);
    const guard = runRuleFactGuard({
      originalText: canonicalFactWording(allowedText),
      checkedText,
      usedEvidenceRefs: []
    });
    if (guard.status === "blocked_high_risk" || guard.status === "needs_edit") {
      throw new Error(`profile_intake_patch_fact_guard:${field}:${guard.ruleFindings.map((finding) => finding.type).join(",")}`);
    }
    fieldEvidence.push(evidence(
      field,
      supporting?.sourceQuote ?? allowedText,
      supporting ? "explicit" : "derived",
      supporting ? 1 : 0.86,
      false
    ));
  }
  return { patch: canonicalPatch, fieldEvidence };
}

export function normalizeCareerMonth(value: string) {
  const match = value.trim().match(/^(20\d{2})\s*(?:年|[./-])\s*(1[0-2]|0?[1-9])\s*月?$/u);
  if (!match) return undefined;
  return `${match[1]}-${match[2].padStart(2, "0")}`;
}

/**
 * Extract only education-specific identity and date dimensions from the
 * user's source sentence. These values repair model mappings; they are not
 * a general-purpose entity recognizer.
 */
export function extractEducationFacts(text: string): ExtractedEducationFacts {
  const datePatch = extractCareerDates(text).patch;
  return {
    school: extractSchoolName(text),
    degree: text.match(/博士研究生|硕士研究生|本科|硕士|博士|专科|大专/u)?.[0],
    major: extractMajorName(text),
    datePatch: {
      ...(datePatch.startDate ? { startDate: datePatch.startDate } : {}),
      ...(datePatch.endDate ? { endDate: datePatch.endDate } : {}),
      ...(datePatch.current !== undefined ? { current: datePatch.current } : {})
    }
  };
}

export function canonicalizeEducationItemFromSource(
  item: EducationItemV2,
  sourceQuote: string
): EducationItemV2 {
  const facts = extractEducationFacts(sourceQuote);
  return ResumeItemV2Schema.parse({
    ...item,
    ...(facts.school ? { school: facts.school } : {}),
    ...(facts.degree ? { degree: facts.degree } : {}),
    ...(facts.major ? { major: facts.major } : {}),
    ...facts.datePatch
  }) as EducationItemV2;
}

function canonicalizePatchDates(sectionType: ResumeItemV2["sectionType"], patch: ProfileIntakeStructuredPatch) {
  const startDate = patch.startDate ? normalizeCareerMonth(patch.startDate) : undefined;
  const endDate = patch.endDate ? normalizeCareerMonth(patch.endDate) : undefined;
  const awardedAt = patch.awardedAt ? normalizeCareerMonth(patch.awardedAt) : undefined;
  const issuedAt = patch.issuedAt ? normalizeCareerMonth(patch.issuedAt) : undefined;
  const expiresAt = patch.expiresAt ? normalizeCareerMonth(patch.expiresAt) : undefined;
  const filedAt = patch.filedAt ? normalizeCareerMonth(patch.filedAt) : undefined;
  const grantedAt = patch.grantedAt ? normalizeCareerMonth(patch.grantedAt) : undefined;
  if (patch.startDate && !startDate) throw new Error("profile_intake_invalid_start_date");
  if (patch.endDate && !endDate) throw new Error("profile_intake_invalid_end_date");
  if (patch.awardedAt && !awardedAt) throw new Error("profile_intake_invalid_award_date");
  if (patch.issuedAt && !issuedAt) throw new Error("profile_intake_invalid_issued_date");
  if (patch.expiresAt && !expiresAt) throw new Error("profile_intake_invalid_expiry_date");
  if (patch.filedAt && !filedAt) throw new Error("profile_intake_invalid_filed_date");
  if (patch.grantedAt && !grantedAt) throw new Error("profile_intake_invalid_granted_date");
  if (sectionType === "awards" && (startDate || endDate)) {
    throw new Error("profile_intake_award_requires_awarded_at");
  }
  return Object.fromEntries(Object.entries({
    ...patch,
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(awardedAt ? { awardedAt } : {}),
    ...(issuedAt ? { issuedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(filedAt ? { filedAt } : {}),
    ...(grantedAt ? { grantedAt } : {})
  }).filter(([, value]) => value !== undefined)) as ProfileIntakeStructuredPatch;
}

export function extractCareerDates(text: string): {
  patch: ProfileIntakeStructuredPatch;
  fields: string[];
} {
  const month = "(20\\d{2})\\s*(?:年|[./-])\\s*(1[0-2]|0?[1-9])\\s*月?";
  const educationStart = new RegExp(`${month}.{0,8}(?:入学|开始)|(?:入学|开始).{0,8}${month}`, "u").exec(text);
  const educationEnd = new RegExp(`(?:预计)?毕业(?:时间|于)?.{0,8}${month}|${month}.{0,2}(?:毕业|结束)`, "u").exec(text);
  if (educationStart && educationEnd) {
    const startYear = educationStart[1] ?? educationStart[3];
    const startMonth = educationStart[2] ?? educationStart[4];
    const endYear = educationEnd[1] ?? educationEnd[3];
    const endMonth = educationEnd[2] ?? educationEnd[4];
    return {
      patch: {
        startDate: careerMonth(startYear, startMonth),
        endDate: careerMonth(endYear, endMonth),
        current: false
      },
      fields: ["startDate", "endDate", "current"]
    };
  }
  const explicitRange = new RegExp(`${month}\\s*(?:到|至|—|–|~|～|-)\\s*${month}`, "u").exec(text);
  if (explicitRange) {
    return {
      patch: {
        startDate: careerMonth(explicitRange[1], explicitRange[2]),
        endDate: careerMonth(explicitRange[3], explicitRange[4]),
        current: false
      },
      fields: ["startDate", "endDate", "current"]
    };
  }
  const ongoing = new RegExp(`${month}\\s*(?:到|至|—|–|~|～|-)?\\s*(?:至今|现在|目前)`, "u").exec(text);
  if (ongoing) {
    return {
      patch: { startDate: careerMonth(ongoing[1], ongoing[2]), current: true },
      fields: ["startDate", "current"]
    };
  }
  const sameYearRange = text.match(/(20\d{2})\s*年?\s*(1[0-2]|0?[1-9])\s*月份?.{0,24}?(?:到|至|开发到)\s*(1[0-2]|0?[1-9])\s*月份?/u);
  if (sameYearRange) {
    return {
      patch: {
        startDate: careerMonth(sameYearRange[1], sameYearRange[2]),
        endDate: careerMonth(sameYearRange[1], sameYearRange[3]),
        current: false
      },
      fields: ["startDate", "endDate", "current"]
    };
  }
  const single = new RegExp(month, "u").exec(text);
  return single
    ? { patch: { startDate: careerMonth(single[1], single[2]) }, fields: ["startDate"] }
    : { patch: {}, fields: [] };
}

function careerMonth(year: string, month: string) {
  return `${year}-${month.padStart(2, "0")}`;
}

function isHardPatchField(field: string) {
  return [
    "title", "name", "organization", "institution", "role", "school", "degree", "major",
    "department", "location", "startDate", "endDate", "current", "gpa", "gpaScale",
    "rankPosition", "rankTotal", "courses", "honors", "awardedAt", "level", "category",
    "language", "testName", "score", "issuer", "issuedAt", "expiresAt", "credentialId",
    "status", "rank", "authorRole", "publisher", "publishedAt", "patentNumber", "office",
    "filedAt", "grantedAt", "url", "tools", "methods"
  ].includes(field);
}

function patchValueGrounded(field: string, value: unknown, source: string) {
  if (field === "current") {
    return value === true
      ? /(?:至今|现在|目前|ongoing|present|current)/iu.test(source)
      : /(?:结束|离开|完成|不再|已毕业|ended|finished|left)/iu.test(source);
  }
  if (["startDate", "endDate", "awardedAt", "issuedAt", "expiresAt", "filedAt", "grantedAt"].includes(field) && typeof value === "string") {
    const [year, month] = value.split("-");
    return source.includes(year)
      && new RegExp(`(?:^|\\D)0?${Number(month)}(?:\\D|$)`, "u").test(source);
  }
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === "string" && includesLoose(source, entry));
  }
  return typeof value === "string" && includesLoose(source, value);
}

function patchValueText(value: unknown) {
  return Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : String(value);
}

function includesLoose(text: string, value: string) {
  return text.toLocaleLowerCase().replace(/\s+/gu, "").includes(
    value.toLocaleLowerCase().replace(/\s+/gu, "")
  );
}

function canonicalFactWording(value: string) {
  return value
    .replace(/(?:交了|提交了|做出(?:了)?)/gu, "交付")
    .replace(/(?:拿到|取得(?:了)?)/gu, "获得")
    .replace(/我负责/gu, "本人负责");
}

function buildStructuredItem(
  candidate: NormalizationCandidate,
  datePatch: ProfileIntakeStructuredPatch
): ResumeItemV2 {
  const base = { id: candidate.id, customFields: [] };
  if (candidate.kind === "education") {
    const education = extractEducationFacts(candidate.sourceQuote);
    return ResumeItemV2Schema.parse({
      ...base,
      sectionType: "education",
      ...(education.school ? { school: education.school } : {}),
      ...(education.degree ? { degree: education.degree } : {}),
      ...(education.major ? { major: education.major } : {}),
      current: false,
      courses: [],
      honors: [],
      highlights: [],
      ...datePatch,
      ...education.datePatch
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

function buildEducationFallback(id: string, sourceQuote: string, datePatch: ProfileIntakeStructuredPatch): EducationItemV2 | undefined {
  const facts = extractEducationFacts(sourceQuote);
  const school = facts.school;
  const degree = facts.degree;
  const major = facts.major;
  if (!school && !degree && !major) return undefined;
  return ResumeItemV2Schema.parse({
    id,
    sectionType: "education",
    school,
    degree,
    major,
    current: false,
    courses: [],
    honors: [],
    highlights: [],
    customFields: [],
    ...datePatch,
    ...facts.datePatch
  }) as EducationItemV2;
}

const SCHOOL_TOKEN = "[\\p{L}\\p{N}·&（）()\\-]{2,80}(?:大学|学院|学校)";
const SCHOOL_CONTEXT = new RegExp(
  `(?:我(?:现在|目前)?是|我(?:现在|目前)?在|(?:就读|毕业)(?:于)?|来自|学校(?:是|为)|在)\\s*(${SCHOOL_TOKEN})`,
  "u"
);
const STANDALONE_SCHOOL = new RegExp(`(?:^|[，,。；;\\s])(${SCHOOL_TOKEN})(?=$|本科|硕士|博士|专科|大专|[^\\p{L}\\p{N}])`, "u");

function extractSchoolName(text: string) {
  return SCHOOL_CONTEXT.exec(text)?.[1] ?? STANDALONE_SCHOOL.exec(text)?.[1];
}

function extractMajorName(text: string) {
  return text.match(/专业(?:是|为|：|:)\s*([\p{L}\p{N}·&（）()\-]{2,80})/u)?.[1]
    ?? text.match(/(?:主修|就读|学习|攻读)(?:的是|为|：|:)?\s*([\p{L}\p{N}·&（）()\-]{2,80})专业/u)?.[1]
    ?? text.match(/(?:^|[，,、；;])\s*([\p{L}\p{N}·&（）()\-]{2,80})专业/u)?.[1]
    ?? text.match(/([\p{L}\p{N}·&（）()\-]{2,80})专业/u)?.[1];
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

export function profileIntakeDisplayLabel(item: ResumeItemV2, fallback = "待核对经历") {
  const label = displayLabel(item);
  return label || fallback;
}

function displayLabel(item: ResumeItemV2) {
  if (item.sectionType === "education") return [item.school, item.degree, item.major].filter(Boolean).join(" / ");
  if ("title" in item && item.title) return item.title;
  if ("name" in item && item.name) return item.name;
  if ("role" in item && item.role) return item.role;
  return item.sectionType;
}

function identityEvidence(candidate: NormalizationCandidate, item: ResumeItemV2): ProfileIntakeFieldEvidence[] {
  if (item.sectionType === "education") {
    return (["school", "degree", "major"] as const).flatMap((field) =>
      item[field] ? [evidence(field, candidate.sourceQuote, "explicit", 0.95, candidate.needsConfirmation)] : []
    );
  }
  const field = item.sectionType === "awards" ? "name"
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
