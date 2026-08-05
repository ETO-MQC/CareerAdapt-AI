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
  canonicalizeEducationItemFromSource,
  extractEducationFacts,
  ProfileIntakeNormalizer,
  normalizeCareerMonth,
  type ProfileIntakeNormalizationResult
} from "./ProfileIntakeNormalizer";
import type {
  ProfileIntakeExtractionStatus,
  ProfileIntakeProviderStatus
} from "./ProfileIntakeReviewProjection";
import { highestValueFollowUp } from "./ProfileIntakeCompleteness";
import { RESUME_AI_ITEM_FIELD_CONTRACT } from "@/domain/resumeFields";
import { currentRuntimeDate } from "@/services/runtimeDate";

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
  structuredItem: ResumeItemV2Schema.optional(),
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
  candidates: z.array(z.object({
    candidateKey: z.string().trim().min(1).max(120),
    sectionType: ResumeSectionTypeV2Schema.exclude(["basics", "summary"]),
    sourceSpan: z.object({
      start: z.number().int().min(0),
      end: z.number().int().min(0)
    }).strict(),
    // Keep this boundary tolerant. Candidate-level validation below is what
    // quarantines one malformed item without discarding the whole response.
    structuredItem: z.unknown().optional(),
    professionalText: z.string().trim().min(1).max(4_000).optional(),
    uncertainFields: z.array(z.string().trim().min(1).max(120)).max(80).default([])
  }).strict()).max(40),
  followUpQuestions: z.array(z.string().trim().min(1).max(500)).max(3).default([])
}).strict();

/**
 * The pre-P4.3f shape remains exported for old in-process callers and stored
 * test fixtures. Provider output and the network boundary use the V2 shape
 * above; normalize() accepts both during the transition.
 */
export const ProfileIntakeSemanticLegacyOutputSchema = z.object({
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
  canonicalSections: z.array(ResumeSectionTypeV2Schema).min(1),
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional()
}).strict();

export type ProfileIntakeSemanticCandidate = z.infer<typeof ProfileIntakeSemanticCandidateSchema>;
export type ProfileIntakeSemanticV2Candidate = z.infer<typeof ProfileIntakeSemanticOutputSchema>["candidates"][number];
export type ProfileIntakeSemanticV2Output = z.infer<typeof ProfileIntakeSemanticOutputSchema>;
export type ProfileIntakeSemanticLegacyOutput = z.infer<typeof ProfileIntakeSemanticLegacyOutputSchema>;
export type ProfileIntakeSemanticOutput = ProfileIntakeSemanticV2Output | ProfileIntakeSemanticLegacyOutput;
export type ProfileIntakeSemanticInput = z.infer<typeof ProfileIntakeSemanticInputSchema>;

export type VerifiedProfileIntakeCandidate = {
  id: string;
  label: string;
  sourceQuote: string;
  candidateKey?: string;
  sourceSpan?: { start: number; end: number };
  professionalText?: string;
  uncertainFields?: string[];
  normalization: ProfileIntakeNormalizationResult;
};

export type ProfileIntakeSemanticResult = {
  mode: "ai" | "deterministic";
  providerStatus: ProfileIntakeProviderStatus;
  extractionStatus?: ProfileIntakeExtractionStatus;
  candidates: VerifiedProfileIntakeCandidate[];
  quarantinedCandidateCount?: number;
  safeDiagnostics?: { code?: string };
  followUpQuestions?: string[];
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
    currentDate?: string;
    signal?: AbortSignal;
  }): Promise<ProfileIntakeSemanticResult> {
    const semanticInput = ProfileIntakeSemanticInputSchema.parse({
      rawNarrative: input.rawNarrative,
      existingDraftContext: draftContext(input.existingDraft),
      canonicalSections: CANONICAL_SECTIONS,
      currentDate: input.currentDate ?? currentRuntimeDate()
    });
    let response: Awaited<ReturnType<SemanticInvoker>>;
    try {
      response = await this.invoke(semanticInput, input.signal);
    } catch {
      response = { ok: false, errorCode: "provider_exception" };
    }
    if (!response.ok) return deterministicFallback(input.rawNarrative, response.errorCode);

    if (isV2SemanticOutput(response.data)) {
      return this.normalizeV2Output(response.data, input.rawNarrative);
    }

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
    if (verificationErrors.length) {
      console.warn("[profile-intake:proposal-validation]", {
        candidateCount: response.data.candidates.length,
        acceptedCount: verified.length,
        errorCodes: verificationErrors
      });
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
      extractionStatus: verificationErrors.length || localized.some((candidate) => candidate.normalization.needsConfirmation)
        ? "partial"
        : "structured_ai",
      candidates: localized,
      quarantinedCandidateCount: verificationErrors.length,
      safeDiagnostics: verificationErrors.length ? { code: "candidate_quarantined" } : undefined,
      followUpQuestions: [],
      followUpQuestion: highestValueFollowUp(
        localized.flatMap((candidate) =>
          candidate.normalization.structuredItem ? [candidate.normalization.structuredItem] : []
        )
      )
    };
  }

  private normalizeV2Output(
    output: ProfileIntakeSemanticV2Output,
    rawNarrative: string
  ): ProfileIntakeSemanticResult {
    const verified: VerifiedProfileIntakeCandidate[] = [];
    const verificationErrors: string[] = [];
    for (const [index, candidate] of output.candidates.entries()) {
      try {
        verified.push(verifyV2Proposal(candidate, rawNarrative, index));
      } catch (error) {
        verificationErrors.push(error instanceof Error ? error.message : "profile_intake_candidate_invalid");
      }
    }
    if (verificationErrors.length) {
      console.warn("[profile-intake:candidate-salvage]", {
        candidateCount: output.candidates.length,
        acceptedCount: verified.length,
        quarantinedCount: verificationErrors.length,
        errorCodes: verificationErrors
      });
    }
    if (!verified.length) {
      return deterministicFallback(
        rawNarrative,
        output.candidates.length ? `semantic_candidates_invalid:${verificationErrors.join(",")}` : "semantic_candidates_empty",
        "invalid"
      );
    }
    const localized = applyCandidateSourceSpanSanity(verified);
    const followUpQuestions = output.followUpQuestions.slice(0, 3);
    return {
      mode: "ai",
      providerStatus: "available",
      extractionStatus: verificationErrors.length || localized.some((candidate) => candidate.normalization.needsConfirmation)
        ? "partial"
        : "structured_ai",
      candidates: localized,
      quarantinedCandidateCount: verificationErrors.length,
      safeDiagnostics: verificationErrors.length ? { code: "candidate_quarantined" } : undefined,
      followUpQuestions,
      followUpQuestion: followUpQuestions[0] ?? highestValueFollowUp(
        localized.flatMap((candidate) => candidate.normalization.structuredItem
          ? [candidate.normalization.structuredItem]
          : [])
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

function isV2SemanticOutput(output: ProfileIntakeSemanticOutput): output is ProfileIntakeSemanticV2Output {
  return "followUpQuestions" in output;
}

function verifyV2Proposal(
  proposal: ProfileIntakeSemanticV2Candidate,
  rawNarrative: string,
  index: number
): VerifiedProfileIntakeCandidate {
  const sourceSpan = proposal.sourceSpan;
  if (sourceSpan.start < 0 || sourceSpan.end <= sourceSpan.start || sourceSpan.end > rawNarrative.length) {
    throw new Error("profile_intake_source_span_invalid");
  }
  const sourceQuote = rawNarrative.slice(sourceSpan.start, sourceSpan.end);
  if (!sourceQuote.trim()) throw new Error("profile_intake_source_span_empty");
  const id = `intake-${stableHashText(`${proposal.candidateKey}:${sourceQuote}`).slice(0, 16)}-${index}`;
  const uncertainFields = [...new Set(proposal.uncertainFields)];
  const item = normalizeV2StructuredItem(proposal.structuredItem, proposal.sectionType, id, uncertainFields);
  if (!item) throw new Error(`profile_intake_structured_item_invalid:${proposal.sectionType}`);
  assertFactPreserving(item, sourceQuote);
  const fieldEvidence = derivedV2FieldEvidence(item, sourceQuote, uncertainFields);
  const professionalText = safeProfessionalText(proposal.professionalText, item, sourceQuote, uncertainFields);
  const needsConfirmation = uncertainFields.length > 0 || fieldEvidence.some((entry) => entry.needsConfirmation);
  return {
    id,
    label: displayLabel(item),
    sourceQuote,
    candidateKey: proposal.candidateKey,
    sourceSpan,
    professionalText,
    uncertainFields,
    normalization: {
      sectionType: proposal.sectionType,
      normalizedText: professionalText,
      structuredItem: item,
      confidence: needsConfirmation ? 0.68 : 0.9,
      needsConfirmation,
      needsNormalization: false,
      fieldEvidence
    }
  };
}

function normalizeV2StructuredItem(
  rawItem: unknown,
  sectionType: ProfileIntakeSemanticV2Candidate["sectionType"],
  id: string,
  uncertainFields: string[]
): ResumeItemV2 | undefined {
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return undefined;
  const raw = rawItem as Record<string, unknown>;
  const allowed = new Set([
    "sectionType",
    "customFields",
    ...(RESUME_AI_ITEM_FIELD_CONTRACT[sectionType] ?? [])
  ]);
  const cleaned: Record<string, unknown> = { id, customFields: [], sectionType };
  for (const [field, value] of Object.entries(raw)) {
    if (field === "id" || field === "candidateKey" || field === "sourceQuote" || field === "fieldEvidence") continue;
    if (!allowed.has(field) || value === null) {
      if (value !== undefined && field !== "customFields") uncertainFields.push(field);
      continue;
    }
    if (field === "customFields") continue;
    if (isDateField(field) && typeof value === "string") {
      const normalized = normalizeCareerMonth(value);
      if (!normalized) {
        uncertainFields.push(field);
        continue;
      }
      cleaned[field] = normalized;
      continue;
    }
    cleaned[field] = value;
  }
  if (cleaned.current === true && cleaned.endDate !== undefined) {
    delete cleaned.endDate;
    uncertainFields.push("endDate");
  }
  const parsed = ResumeItemV2Schema.safeParse(cleaned);
  return parsed.success ? parsed.data : undefined;
}

function isDateField(field: string) {
  return ["startDate", "endDate", "awardedAt", "issuedAt", "expiresAt", "filedAt", "grantedAt", "publishedAt", "createdAt"].includes(field);
}

function derivedV2FieldEvidence(item: ResumeItemV2, sourceQuote: string, uncertainFields: string[]) {
  return Object.entries(item)
    .filter(([field, value]) => field !== "id" && field !== "sectionType" && field !== "customFields"
      && value !== undefined && value !== false && (!Array.isArray(value) || value.length > 0))
    .flatMap(([field, value]) => {
      const text = Array.isArray(value) ? value.join(" ") : typeof value === "string" || typeof value === "number" ? String(value) : "";
      if (!text) return [];
      const explicit = isDateField(field)
        ? sourceQuote.includes(text.slice(0, 4))
        : includesLoose(sourceQuote, text);
      return [{
        field,
        sourceQuote,
        support: explicit ? "explicit" as const : "uncertain" as const,
        confidence: explicit ? 0.96 : 0.58,
        needsConfirmation: uncertainFields.includes(field) || !explicit
      }];
    });
}

function safeProfessionalText(
  proposed: string | undefined,
  item: ResumeItemV2,
  sourceQuote: string,
  uncertainFields: string[]
) {
  const candidate = proposed?.trim();
  if (!candidate) return profileText(item);
  const guard = runRuleFactGuard({
    originalText: canonicalFactWording(sourceQuote),
    checkedText: candidate,
    usedEvidenceRefs: []
  });
  if (guard.status === "blocked_high_risk" || guard.status === "needs_edit") {
    uncertainFields.push("professionalText");
    return profileText(item);
  }
  return candidate;
}

function verifyProposal(
  proposal: ProfileIntakeSemanticCandidate,
  rawNarrative: string,
  index: number
): VerifiedProfileIntakeCandidate {
  validateProfileIntakeProposalGrounding(proposal, rawNarrative);
  if (proposal.structuredItem && proposal.structuredItem.sectionType !== proposal.sectionType) {
    throw new Error("profile_intake_section_type_mismatch");
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
  const item = proposal.structuredItem
    ? ResumeItemV2Schema.parse({ ...proposal.structuredItem, id })
    : buildResumeItem(id, proposal);
  const canonicalItem = item?.sectionType === "education"
    ? canonicalizeEducationItemFromSource(item, proposal.sourceQuote)
    : item;
  if (canonicalItem) assertFactPreserving(canonicalItem, proposal.sourceQuote);
  const missingIdentity = !canonicalItem;
  const normalizedText = canonicalItem
    ? profileText(canonicalItem)
    : proposal.description ?? "需要补充正式名称后才能写入资料库。";
  return {
    id,
    label: canonicalItem?.sectionType === "education"
      ? displayLabel(canonicalItem)
      : proposal.title ?? proposal.name ?? displayLabel(canonicalItem),
    sourceQuote: proposal.sourceQuote,
    normalization: {
      sectionType: proposal.sectionType,
      normalizedText,
      structuredItem: canonicalItem,
      confidence: proposal.confidence,
      needsConfirmation: missingIdentity
        || proposal.needsConfirmation
        || proposal.fieldEvidence.some((entry) => entry.needsConfirmation),
      needsNormalization: false,
      fieldEvidence: proposal.fieldEvidence
    }
  };
}

export function validateProfileIntakeProposalGrounding(
  proposal: ProfileIntakeSemanticCandidate,
  rawNarrative: string
) {
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
  if (proposal.structuredItem) {
    for (const field of populatedStructuredItemFields(proposal.structuredItem)) {
      if (!proposal.fieldEvidence.some((evidence) => evidence.field === field)) {
        throw new Error(`profile_intake_structured_field_evidence_missing:${field}`);
      }
      const value = proposal.structuredItem[field as keyof ResumeItemV2];
      const fieldSource = evidenceTextForField(proposal, field);
      if (typeof value === "string" && field !== "startDate" && field !== "endDate" && field !== "awardedAt"
        && !includesLoose(fieldSource, value)) {
        throw new Error(`profile_intake_structured_field_not_grounded:${field}`);
      }
      if (Array.isArray(value) && value.some((entry) => typeof entry === "string" && !includesLoose(fieldSource, entry))) {
        throw new Error(`profile_intake_structured_field_not_grounded:${field}`);
      }
      if (typeof value === "number" && !fieldSource.includes(String(value))) {
        throw new Error(`profile_intake_structured_number_not_grounded:${field}`);
      }
      if (["startDate", "endDate", "awardedAt", "issuedAt", "expiresAt", "filedAt", "grantedAt"].includes(field)
        && typeof value === "string") {
        const [year, month] = value.split("-");
        if (!fieldSource.includes(year) || !new RegExp(`(?:^|\\D)0?${Number(month)}(?:\\D|$)`, "u").test(fieldSource)) {
          throw new Error("profile_intake_structured_date_not_grounded");
        }
      }
    }
    if ("current" in proposal.structuredItem && proposal.structuredItem.current === true && !/(?:至今|现在|目前|ongoing|present|current)/iu.test(
      evidenceTextForField(proposal, "current")
    )) {
      throw new Error("profile_intake_structured_current_not_grounded");
    }
    return;
  }
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

function populatedStructuredItemFields(item: ResumeItemV2) {
  return Object.entries(item)
    .filter(([field, value]) => field !== "id" && field !== "sectionType" && field !== "customFields"
      && field !== "current" && value !== undefined
      && (!Array.isArray(value) || value.length > 0)
      && (typeof value === "string" || typeof value === "number" || value === true || Array.isArray(value)))
    .map(([field]) => field);
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
      const education = extractEducationFacts(candidate.sourceQuote);
      const legacySchool = candidate.institution
        ? extractEducationFacts(candidate.institution).school
        : undefined;
      const school = education.school ?? legacySchool;
      if (!school) return undefined;
      return ResumeItemV2Schema.parse({
        ...base,
        sectionType: "education",
        school,
        ...(education.degree ? { degree: education.degree } : {}),
        ...(education.major ? { major: education.major } : {}),
        courses: [],
        honors: [],
        ...shared,
        ...dates,
        ...education.datePatch
      });
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
  if (/(?:协助|参与|接触)/u.test(source) && /(?:主导|独立负责|独立完成|独立开发|精通|熟练掌握)/u.test(claimText)) {
    throw new Error("profile_intake_responsibility_upgrade");
  }
  if (/(?:RPA|机器人流程自动化)/iu.test(source) && /合规采集/u.test(claimText) && !/合规采集/u.test(source)) {
    throw new Error("profile_intake_unsupported_qualification");
  }
  if (/(?:竞赛|比赛|大赛)/u.test(source) && item.sectionType === "project") {
    throw new Error("profile_intake_competition_misclassified");
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
    extractionStatus: normalization.structuredItem && !normalization.needsNormalization
      ? "structured_local"
      : "failed",
    quarantinedCandidateCount: normalization.structuredItem ? 0 : 1,
    safeDiagnostics: { code: errorCode },
    warning: `AI 语义整理暂不可用（${errorCode}）；已保留原始回答，基础信息需要核对。`,
    followUpQuestions: [],
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
  if (item.sectionType === "education") return [item.school, item.degree, item.major].filter(Boolean).join(" / ") || "教育经历";
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
