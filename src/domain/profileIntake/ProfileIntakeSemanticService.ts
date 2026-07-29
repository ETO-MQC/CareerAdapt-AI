import { z } from "zod";
import { invokeStructuredAi } from "@/ai/client";
import {
  ResumeItemV2Schema,
  ResumeSectionTypeV2Schema,
  type ImportedResumeDraft,
  type ResumeItemV2
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import {
  ProfileIntakeFieldEvidenceSchema,
  ProfileIntakeNormalizer,
  type ProfileIntakeNormalizationResult
} from "./ProfileIntakeNormalizer";
import { highestValueFollowUp } from "./ProfileIntakeCompleteness";

const OptionalText = z.string().trim().min(1).max(4_000).optional();
const TextList = z.array(z.string().trim().min(1).max(2_000)).max(30).default([]);

export const ProfileIntakeSemanticCandidateSchema = z.object({
  candidateKey: z.string().trim().min(1).max(120),
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics", "summary"]),
  title: OptionalText,
  titleKind: z.enum(["explicit", "derived_display"]).optional(),
  name: OptionalText,
  organization: OptionalText,
  institution: OptionalText,
  role: OptionalText,
  startDate: OptionalText,
  endDate: OptionalText,
  current: z.boolean().default(false),
  awardedAt: OptionalText,
  description: OptionalText,
  highlights: TextList,
  tools: TextList,
  methods: TextList,
  outcomes: TextList,
  sourceQuote: z.string().trim().min(1).max(12_000),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
  fieldEvidence: z.array(ProfileIntakeFieldEvidenceSchema).min(1).max(80)
}).strict().superRefine((candidate, context) => {
  if (candidate.current && candidate.endDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "current candidate must not have endDate" });
  }
  if (candidate.sectionType === "awards" && (candidate.startDate || candidate.endDate)) {
    context.addIssue({ code: "custom", path: ["awardedAt"], message: "awards use awardedAt" });
  }
});

export const ProfileIntakeSemanticOutputSchema = z.object({
  candidates: z.array(ProfileIntakeSemanticCandidateSchema).max(40),
  followUpQuestion: z.string().trim().min(1).max(500).optional()
}).strict();

export const ProfileIntakeSemanticInputSchema = z.object({
  rawNarrative: z.string().trim().min(1).max(24_000),
  existingDraftContext: z.array(z.object({
    id: z.string().min(1),
    sectionType: ResumeSectionTypeV2Schema,
    label: z.string().min(1),
    normalizedText: z.string().min(1)
  }).strict()).max(40).default([]),
  canonicalSections: z.array(ResumeSectionTypeV2Schema).min(1)
}).strict();

export type ProfileIntakeSemanticCandidate = z.infer<typeof ProfileIntakeSemanticCandidateSchema>;
export type ProfileIntakeSemanticOutput = z.infer<typeof ProfileIntakeSemanticOutputSchema>;
export type ProfileIntakeSemanticInput = z.infer<typeof ProfileIntakeSemanticInputSchema>;

export type VerifiedProfileIntakeCandidate = {
  id: string;
  label: string;
  sourceQuote: string;
  normalization: ProfileIntakeNormalizationResult;
};

export type ProfileIntakeSemanticResult = {
  mode: "ai" | "deterministic";
  providerStatus: "available" | "failed" | "invalid";
  candidates: VerifiedProfileIntakeCandidate[];
  followUpQuestion?: string;
  warning?: string;
};

type SemanticInvoker = (input: ProfileIntakeSemanticInput, signal?: AbortSignal) => Promise<
  { ok: true; data: ProfileIntakeSemanticOutput } | { ok: false; errorCode: string }
>;

const CANONICAL_SECTIONS = [
  "education", "work", "internship", "project", "research", "campus", "volunteer",
  "awards", "skills", "certificates", "languages", "publications", "patents",
  "portfolio", "other", "custom"
] as const;

export class ProfileIntakeSemanticService {
  constructor(private readonly invoke: SemanticInvoker = defaultInvoker) {}

  async normalize(input: {
    rawNarrative: string;
    existingDraft?: ImportedResumeDraft;
    signal?: AbortSignal;
  }): Promise<ProfileIntakeSemanticResult> {
    const semanticInput = ProfileIntakeSemanticInputSchema.parse({
      rawNarrative: input.rawNarrative,
      existingDraftContext: draftContext(input.existingDraft),
      canonicalSections: CANONICAL_SECTIONS
    });
    let response: Awaited<ReturnType<SemanticInvoker>>;
    try {
      response = await this.invoke(semanticInput, input.signal);
    } catch {
      response = { ok: false, errorCode: "provider_exception" };
    }
    if (!response.ok) return deterministicFallback(input.rawNarrative, response.errorCode);

    const verified: VerifiedProfileIntakeCandidate[] = [];
    const verificationErrors: string[] = [];
    for (const [index, proposal] of response.data.candidates.entries()) {
      try {
        verified.push(verifyProposal(proposal, input.rawNarrative, index));
      } catch (error) {
        // A malformed or ungrounded proposal is never allowed into the Draft.
        verificationErrors.push(error instanceof Error ? error.message : "profile_intake_proposal_invalid");
      }
    }
    if (!verified.length) {
      return deterministicFallback(
        input.rawNarrative,
        `semantic_output_ungrounded:${verificationErrors.join(",")}`,
        "invalid"
      );
    }
    const localized = applyCandidateSourceSpanSanity(verified);
    return {
      mode: "ai",
      providerStatus: "available",
      candidates: localized,
      followUpQuestion: highestValueFollowUp(
        localized.flatMap((candidate) =>
          candidate.normalization.structuredItem ? [candidate.normalization.structuredItem] : []
        )
      )
    };
  }
}

async function defaultInvoker(input: ProfileIntakeSemanticInput, signal?: AbortSignal) {
  const result = await invokeStructuredAi({
    task: "profile-intake-semantic",
    businessInput: {
      ...input,
      inputHash: stableHashText(input.rawNarrative)
    },
    outputSchema: ProfileIntakeSemanticOutputSchema,
    signal
  });
  return result.ok
    ? { ok: true as const, data: result.data }
    : { ok: false as const, errorCode: result.errorCode };
}

function verifyProposal(
  proposal: ProfileIntakeSemanticCandidate,
  rawNarrative: string,
  index: number
): VerifiedProfileIntakeCandidate {
  if (!rawNarrative.includes(proposal.sourceQuote)) throw new Error("profile_intake_source_quote_missing");
  for (const evidence of proposal.fieldEvidence) {
    if (!proposal.sourceQuote.includes(evidence.sourceQuote)) {
      throw new Error("profile_intake_field_evidence_outside_candidate");
    }
  }
  for (const field of populatedProposalFields(proposal)) {
    if (!proposal.fieldEvidence.some((evidence) => evidence.field === field)) {
      throw new Error(`profile_intake_field_evidence_missing:${field}`);
    }
  }
  for (const field of ["name", "organization", "institution", "role"] as const) {
    const value = proposal[field];
    const fieldSource = evidenceTextForField(proposal, field);
    if (value && !includesLoose(fieldSource, value)) {
      throw new Error(`profile_intake_hard_field_not_grounded:${field}`);
    }
  }
  if (proposal.title && proposal.titleKind === "explicit"
    && !includesLoose(evidenceTextForField(proposal, "title"), proposal.title)) {
    throw new Error("profile_intake_hard_field_not_grounded:title");
  }
  if (proposal.title && proposal.titleKind === "derived_display"
    && !proposal.fieldEvidence.some((entry) => entry.field === "title" && entry.support === "derived")) {
    throw new Error("profile_intake_derived_title_not_marked");
  }
  for (const value of [...proposal.tools, ...proposal.methods]) {
    const field = proposal.tools.includes(value) ? "tools" : "methods";
    if (!includesLoose(evidenceTextForField(proposal, field), value)) {
      throw new Error("profile_intake_tool_not_grounded");
    }
  }
  for (const [field, value] of ([
    ["startDate", proposal.startDate],
    ["endDate", proposal.endDate],
    ["awardedAt", proposal.awardedAt]
  ] as const).filter((entry): entry is [typeof entry[0], string] => Boolean(entry[1]))) {
    const [year, month] = value.split("-");
    const fieldSource = evidenceTextForField(proposal, field);
    if (!fieldSource.includes(year) || !new RegExp(`(?:^|\\D)0?${Number(month)}(?:\\D|$)`, "u").test(fieldSource)) {
      throw new Error("profile_intake_date_not_grounded");
    }
  }
  if (proposal.current && !/(?:至今|现在|目前|ongoing|present|current)/iu.test(
    evidenceTextForField(proposal, "current")
  )) {
    throw new Error("profile_intake_current_not_grounded");
  }
  for (const field of ["description", "highlights", "outcomes"] as const) {
    const value = proposal[field];
    const checkedText = Array.isArray(value) ? value.join("\n") : value;
    if (!checkedText) continue;
    const guard = runRuleFactGuard({
      originalText: canonicalFactWording(proposal.sourceQuote),
      checkedText,
      usedEvidenceRefs: []
    });
    if (guard.status === "blocked_high_risk" || guard.status === "needs_edit") {
      throw new Error(`profile_intake_fact_guard:${field}:${guard.ruleFindings.map((finding) => finding.type).join(",")}`);
    }
  }
  const id = `intake-${stableHashText(`${proposal.candidateKey}:${proposal.sourceQuote}`).slice(0, 16)}-${index}`;
  const item = buildResumeItem(id, proposal);
  if (item) assertFactPreserving(item, proposal.sourceQuote);
  const missingIdentity = !item;
  const normalizedText = item
    ? profileText(item)
    : proposal.description ?? "需要补充正式名称后才能写入资料库。";
  return {
    id,
    label: proposal.title ?? proposal.name ?? displayLabel(item),
    sourceQuote: proposal.sourceQuote,
    normalization: {
      sectionType: proposal.sectionType,
      normalizedText,
      structuredItem: item,
      confidence: proposal.confidence,
      needsConfirmation: missingIdentity
        || proposal.needsConfirmation
        || proposal.fieldEvidence.some((entry) => entry.needsConfirmation),
      needsNormalization: false,
      fieldEvidence: proposal.fieldEvidence
    }
  };
}

function populatedProposalFields(proposal: ProfileIntakeSemanticCandidate) {
  return ([
    "title", "name", "organization", "institution", "role", "startDate", "endDate",
    "awardedAt", "description", "highlights", "tools", "methods", "outcomes"
  ] as const).filter((field) => {
    const value = proposal[field];
    return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.length > 0;
  });
}

function buildResumeItem(id: string, candidate: ProfileIntakeSemanticCandidate): ResumeItemV2 | undefined {
  const dates = new ProfileIntakeNormalizer().canonicalizeDates(candidate.sectionType, {
    startDate: candidate.startDate,
    endDate: candidate.endDate,
    current: candidate.current,
    awardedAt: candidate.awardedAt
  });
  const base = { id, customFields: [] };
  const shared = {
    description: candidate.description,
    highlights: candidate.highlights
  };
  const groundedTitle = candidate.title && (
    candidate.titleKind === "explicit"
    || (candidate.titleKind === undefined
      && includesLoose(evidenceTextForField(candidate, "title"), candidate.title))
  ) ? candidate.title : undefined;
  switch (candidate.sectionType) {
    case "education": {
      const school = candidate.institution ?? candidate.organization ?? candidate.name ?? groundedTitle;
      if (!school) return undefined;
      return ResumeItemV2Schema.parse({ ...base, sectionType: "education", school, major: candidate.role, courses: [], honors: [], ...shared, ...dates });
    }
    case "work":
    case "internship":
    case "campus":
    case "volunteer":
      return ResumeItemV2Schema.parse({ ...base, sectionType: candidate.sectionType, organization: candidate.organization ?? candidate.institution, role: candidate.role, ...shared, ...dates });
    case "project":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "project", title: groundedTitle ?? candidate.name, organization: candidate.organization, role: candidate.role, tools: candidate.tools, outcomes: candidate.outcomes, ...shared, ...dates });
    case "research":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "research", title: groundedTitle ?? candidate.name, institution: candidate.institution ?? candidate.organization, authorRole: candidate.role, methods: candidate.methods.length ? candidate.methods : candidate.tools, ...shared, ...dates });
    case "awards": {
      const name = candidate.name ?? groundedTitle;
      return name ? ResumeItemV2Schema.parse({ ...base, sectionType: "awards", name, issuer: candidate.organization ?? candidate.institution, description: candidate.description, awardedAt: dates.awardedAt }) : undefined;
    }
    case "skills": {
      const name = candidate.name ?? groundedTitle;
      return name ? ResumeItemV2Schema.parse({ ...base, sectionType: "skills", name, description: candidate.description }) : undefined;
    }
    case "certificates": {
      const name = candidate.name ?? groundedTitle;
      return name ? ResumeItemV2Schema.parse({ ...base, sectionType: "certificates", name, issuer: candidate.organization ?? candidate.institution, issuedAt: dates.awardedAt ?? dates.startDate, description: candidate.description }) : undefined;
    }
    case "languages": {
      const language = candidate.name ?? groundedTitle;
      return language ? ResumeItemV2Schema.parse({ ...base, sectionType: "languages", language, level: candidate.role, description: candidate.description }) : undefined;
    }
    case "publications": {
      const title = groundedTitle ?? candidate.name;
      return title ? ResumeItemV2Schema.parse({ ...base, sectionType: "publications", title, authors: [], publisher: candidate.organization ?? candidate.institution, description: candidate.description }) : undefined;
    }
    case "patents": {
      const title = groundedTitle ?? candidate.name;
      return title ? ResumeItemV2Schema.parse({ ...base, sectionType: "patents", title, inventors: [], office: candidate.organization, description: candidate.description }) : undefined;
    }
    case "portfolio": {
      const title = groundedTitle ?? candidate.name;
      return title ? ResumeItemV2Schema.parse({ ...base, sectionType: "portfolio", title, role: candidate.role, tools: candidate.tools, ...shared }) : undefined;
    }
    case "custom": {
      const title = groundedTitle ?? candidate.name;
      return title ? ResumeItemV2Schema.parse({ ...base, sectionType: "custom", title, ...shared }) : undefined;
    }
    default:
      return ResumeItemV2Schema.parse({ ...base, sectionType: "other", title: groundedTitle ?? candidate.name, description: candidate.description ?? candidate.sourceQuote, highlights: candidate.highlights });
  }
}

function canonicalFactWording(value: string) {
  return value
    .replace(/(?:交了|提交了|做出(?:了)?)/gu, "交付")
    .replace(/(?:拿到|取得(?:了)?)/gu, "获得")
    .replace(/我负责/gu, "本人负责");
}

function evidenceTextForField(proposal: ProfileIntakeSemanticCandidate, field: string) {
  return proposal.fieldEvidence
    .filter((entry) => entry.field === field)
    .map((entry) => entry.sourceQuote)
    .join("\n");
}

function includesLoose(text: string, value: string) {
  return text.toLocaleLowerCase().replace(/\s+/gu, "").includes(
    value.toLocaleLowerCase().replace(/\s+/gu, "")
  );
}

function assertFactPreserving(item: ResumeItemV2, source: string) {
  const claimText = Object.entries(item)
    .filter(([key]) => !["id", "startDate", "endDate", "awardedAt", "issuedAt", "expiresAt", "createdAt", "filedAt", "grantedAt"].includes(key))
    .map(([, value]) => Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "")
    .join(" ");
  const outputNumbers = claimText.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const sourceNumbers = (source.match(/\d+(?:[.,]\d+)?/g) ?? []).map(normalizeNumberToken);
  if (outputNumbers.some((value) => !sourceNumbers.includes(normalizeNumberToken(value)))) {
    throw new Error("profile_intake_new_number");
  }
  if (/(?:协助|参与|接触)/u.test(source) && /(?:主导|独立负责|精通|熟练掌握)/u.test(claimText)) {
    throw new Error("profile_intake_responsibility_upgrade");
  }
}

function normalizeNumberToken(value: string) {
  const normalized = value.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? String(number) : normalized;
}

function deterministicFallback(
  rawNarrative: string,
  errorCode: string,
  providerStatus: "failed" | "invalid" = "failed"
): ProfileIntakeSemanticResult {
  const normalization = new ProfileIntakeNormalizer().fallback(rawNarrative);
  const id = normalization.structuredItem?.id
    ?? `intake-fallback-${stableHashText(rawNarrative).slice(0, 16)}`;
  return {
    mode: "deterministic",
    providerStatus,
    warning: `AI 语义整理暂不可用（${errorCode}）；已保留原始回答，基础信息需要核对。`,
    candidates: [{
      id,
      label: displayLabel(normalization.structuredItem),
      sourceQuote: rawNarrative,
      normalization
    }]
  };
}

function draftContext(draft?: ImportedResumeDraft) {
  return draft?.sections.flatMap((section) => section.items.flatMap((item) =>
    item.structuredItem
      ? [{
          id: item.id,
          sectionType: item.structuredItem.sectionType,
          label: item.itemLabel ?? displayLabel(item.structuredItem),
          normalizedText: item.normalizedText
        }]
      : []
  )) ?? [];
}

function displayLabel(item?: ResumeItemV2) {
  if (!item) return "待核对经历";
  if (item.sectionType === "education") return [item.school, item.major].filter(Boolean).join(" / ") || "教育经历";
  if (item.sectionType === "skills") return item.name;
  if (item.sectionType === "languages") return item.language;
  if ("title" in item && item.title) return item.title;
  if ("name" in item && item.name) return item.name;
  if ("role" in item && item.role) return item.role;
  return "待整理经历";
}

function profileText(item: ResumeItemV2) {
  if (item.sectionType === "skills") return [item.name, item.description].filter(Boolean).join("：");
  if (item.sectionType === "languages") return [item.language, item.level, item.description].filter(Boolean).join(" · ");
  if (item.sectionType === "awards") return [item.name, item.description].filter(Boolean).join("：");
  const values = [
    "description" in item ? item.description : undefined,
    "highlights" in item ? item.highlights : [],
    "outcomes" in item ? item.outcomes : []
  ].flat().filter((value): value is string => Boolean(value));
  return values.join("\n") || displayLabel(item);
}

function applyCandidateSourceSpanSanity(
  candidates: VerifiedProfileIntakeCandidate[]
): VerifiedProfileIntakeCandidate[] {
  if (candidates.length < 2) return candidates;
  const quotes = candidates.map((candidate) => normalizeSpan(candidate.sourceQuote));
  const allHighlyOverlapping = quotes.every((left, index) =>
    quotes.every((right, otherIndex) =>
      index === otherIndex || sourceSpanOverlap(left, right) >= 0.85
    )
  );
  if (!allHighlyOverlapping) return candidates;
  return candidates.map((candidate) => ({
    ...candidate,
    normalization: {
      ...candidate.normalization,
      needsConfirmation: true,
      fieldEvidence: candidate.normalization.fieldEvidence.map((evidence) => ({
        ...evidence,
        needsConfirmation: true
      }))
    }
  }));
}

function normalizeSpan(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/gu, "");
}

function sourceSpanOverlap(left: string, right: string) {
  if (!left.length || !right.length) return 0;
  if (left === right) return 1;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  const leftPairs = characterPairs(left);
  const rightPairs = characterPairs(right);
  const shared = [...leftPairs].filter((pair) => rightPairs.has(pair)).length;
  return shared / Math.max(1, Math.min(leftPairs.size, rightPairs.size));
}

function characterPairs(value: string) {
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}
