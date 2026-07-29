import { z } from "zod";
import { invokeStructuredAi } from "@/ai/client";
import {
  ResumeItemV2Schema,
  ResumeSectionTypeV2Schema,
  type ImportedResumeDraft,
  type ResumeItemV2
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
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
    return {
      mode: "ai",
      providerStatus: "available",
      candidates: verified,
      followUpQuestion: highestValueFollowUp(
        verified.map((candidate) => candidate.normalization.structuredItem)
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
    if (!rawNarrative.includes(evidence.sourceQuote)) throw new Error("profile_intake_field_evidence_missing");
  }
  for (const field of populatedProposalFields(proposal)) {
    if (!proposal.fieldEvidence.some((evidence) => evidence.field === field)) {
      throw new Error(`profile_intake_field_evidence_missing:${field}`);
    }
  }
  for (const field of ["organization", "institution", "role"] as const) {
    const value = proposal[field];
    if (value && !rawNarrative.includes(value)) {
      throw new Error(`profile_intake_hard_field_not_grounded:${field}`);
    }
  }
  for (const value of [...proposal.tools, ...proposal.methods]) {
    if (!rawNarrative.toLocaleLowerCase().includes(value.toLocaleLowerCase())) {
      throw new Error("profile_intake_tool_not_grounded");
    }
  }
  for (const value of [proposal.startDate, proposal.endDate, proposal.awardedAt].filter((date): date is string => Boolean(date))) {
    const [year, month] = value.split("-");
    if (!rawNarrative.includes(year) || !new RegExp(`(?:^|\\D)0?${Number(month)}(?:\\D|$)`, "u").test(rawNarrative)) {
      throw new Error("profile_intake_date_not_grounded");
    }
  }
  if (proposal.current && !/(?:至今|现在|目前|ongoing|present|current)/iu.test(rawNarrative)) {
    throw new Error("profile_intake_current_not_grounded");
  }
  const id = `intake-${stableHashText(`${proposal.candidateKey}:${proposal.sourceQuote}`).slice(0, 16)}-${index}`;
  const item = buildResumeItem(id, proposal);
  assertFactPreserving(item, proposal.sourceQuote);
  const normalizedText = profileText(item);
  return {
    id,
    label: proposal.title ?? proposal.name ?? displayLabel(item),
    sourceQuote: proposal.sourceQuote,
    normalization: {
      sectionType: item.sectionType,
      normalizedText,
      structuredItem: item,
      confidence: proposal.confidence,
      needsConfirmation: proposal.needsConfirmation || proposal.fieldEvidence.some((entry) => entry.needsConfirmation),
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

function buildResumeItem(id: string, candidate: ProfileIntakeSemanticCandidate): ResumeItemV2 {
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
  switch (candidate.sectionType) {
    case "education":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "education", school: candidate.institution ?? candidate.organization ?? candidate.name ?? candidate.title, major: candidate.role, courses: [], honors: [], ...shared, ...dates });
    case "work":
    case "internship":
    case "campus":
    case "volunteer":
      return ResumeItemV2Schema.parse({ ...base, sectionType: candidate.sectionType, organization: candidate.organization ?? candidate.institution, role: candidate.role ?? candidate.title, ...shared, ...dates });
    case "project":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "project", title: candidate.title ?? candidate.name, organization: candidate.organization, role: candidate.role, tools: candidate.tools, outcomes: candidate.outcomes, ...shared, ...dates });
    case "research":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "research", title: candidate.title ?? candidate.name, institution: candidate.institution ?? candidate.organization, authorRole: candidate.role, methods: candidate.methods.length ? candidate.methods : candidate.tools, ...shared, ...dates });
    case "awards":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "awards", name: candidate.name ?? candidate.title ?? "待确认奖项", issuer: candidate.organization ?? candidate.institution, description: candidate.description, awardedAt: dates.awardedAt });
    case "skills":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "skills", name: candidate.name ?? candidate.title ?? "待确认技能", description: candidate.description });
    case "certificates":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "certificates", name: candidate.name ?? candidate.title ?? "待确认证书", issuer: candidate.organization ?? candidate.institution, issuedAt: dates.awardedAt ?? dates.startDate, description: candidate.description });
    case "languages":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "languages", language: candidate.name ?? candidate.title ?? "待确认语言", level: candidate.role, description: candidate.description });
    case "publications":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "publications", title: candidate.title ?? candidate.name ?? "待确认出版物", authors: [], publisher: candidate.organization ?? candidate.institution, description: candidate.description });
    case "patents":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "patents", title: candidate.title ?? candidate.name ?? "待确认专利", inventors: [], office: candidate.organization, description: candidate.description });
    case "portfolio":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "portfolio", title: candidate.title ?? candidate.name ?? "待确认作品", role: candidate.role, tools: candidate.tools, ...shared });
    case "custom":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "custom", title: candidate.title ?? candidate.name, ...shared });
    default:
      return ResumeItemV2Schema.parse({ ...base, sectionType: "other", title: candidate.title ?? candidate.name, description: candidate.description ?? candidate.sourceQuote, highlights: candidate.highlights });
  }
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
  const id = normalization.structuredItem.id;
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

function displayLabel(item: ResumeItemV2) {
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
