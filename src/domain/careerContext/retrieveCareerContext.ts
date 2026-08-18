import { z } from "zod";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import type {
  CareerProfile,
  FactStatement,
  JobDescription,
  RequirementMatch,
  ResumeBranch
} from "@/domain/schemas";

export const CareerContextIntentSchema = z.enum([
  "general_question",
  "application_reason",
  "interview_answer",
  "self_introduction",
  "evidence_search",
  "strength_analysis",
  "job_fit_explanation",
  "career_story",
  "other"
]);

export const CareerContextRetrieveInputSchema = z.object({
  profileId: z.string().min(1),
  query: z.string().trim().min(1).max(4_000),
  intent: CareerContextIntentSchema.optional(),
  /** Ephemeral wording supplied for this turn; it is never persisted. */
  targetText: z.string().trim().min(1).max(12_000).optional(),
  jobId: z.string().min(1).optional(),
  resumeId: z.string().min(1).optional(),
  maxFacts: z.number().int().min(1).max(24).default(12)
}).strict();

const CareerContextFactSchema = z.object({
  factId: z.string().min(1),
  type: z.enum(["basic", "education", "experience", "project", "award", "skill", "language", "certificate", "other"]),
  title: z.string().min(1),
  statement: z.string().min(1),
  sourceEntityId: z.string().min(1),
  sourceEntityType: z.enum(["profile", "experience", "education", "project", "award", "skill", "language", "certificate", "other"]),
  evidenceRefs: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  date: z.string().min(1).optional(),
  relevanceReason: z.string().min(1)
}).strict();

const CareerContextSourceSummarySchema = z.object({
  profileId: z.string().min(1),
  profileVersion: z.number().int().min(1),
  confirmedFactCount: z.number().int().min(0),
  returnedFactCount: z.number().int().min(0),
  evidenceCount: z.number().int().min(0),
  includedSourceTypes: z.array(z.string().min(1)),
  excludedSourceTypes: z.array(z.string().min(1)),
  job: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    requirementCount: z.number().int().min(0),
    freshFitAvailable: z.boolean(),
    staleFitCount: z.number().int().min(0)
  }).strict().optional(),
  resume: z.object({
    id: z.string().min(1),
    purpose: z.string().min(1),
    revision: z.number().int().min(0),
    factBackedVisibleItemCount: z.number().int().min(0)
  }).strict().optional()
}).strict();

/** Safe retrieval coverage telemetry; it never contains evidence text. */
export const CareerContextResultSummarySchema = z.object({
  profileId: z.string().min(1),
  factsReturned: z.number().int().min(0),
  entityCounts: z.record(z.string().min(1), z.number().int().min(0)),
  contentCoverage: z.record(z.string().min(1), z.number().int().min(0)),
  evidenceRefCount: z.number().int().min(0)
}).strict();

export const CareerContextRetrieveResultSchema = z.object({
  profileId: z.string().min(1),
  query: z.string().min(1),
  intent: CareerContextIntentSchema,
  facts: z.array(CareerContextFactSchema),
  targetSignals: z.array(z.string().min(1)),
  unsupportedClaims: z.array(z.string().min(1)),
  sourceSummary: CareerContextSourceSummarySchema,
  careerContextResultSummary: CareerContextResultSummarySchema
}).strict();

export type CareerContextIntent = z.infer<typeof CareerContextIntentSchema>;
export type CareerContextRetrieveInput = z.infer<typeof CareerContextRetrieveInputSchema>;
export type CareerContextFact = z.infer<typeof CareerContextFactSchema>;
export type CareerContextResultSummary = z.infer<typeof CareerContextResultSummarySchema>;
export type CareerContextRetrieveResult = z.infer<typeof CareerContextRetrieveResultSchema>;

type FactSource = {
  fact: FactStatement;
  sourceEntityId: string;
  sourceEntityType: CareerContextFact["sourceEntityType"];
  title: string;
  evidenceRefs: string[];
  date?: string;
  searchableText: string;
};

const EXCLUDED_SOURCE_TYPES = [
  "unconfirmed",
  "high_risk",
  "quarantined",
  "unsupported_metrics",
  "stale_derived"
];

/**
 * Deterministic, evidence-first retrieval for ordinary Career Agent turns.
 * It deliberately accepts already-read repository entities so this module
 * cannot write to storage or silently widen the repository boundary.
 */
export function retrieveCareerContext(input: {
  request: CareerContextRetrieveInput;
  profile: CareerProfile;
  job?: JobDescription;
  resume?: ResumeBranch;
  requirementMatches?: RequirementMatch[];
}): CareerContextRetrieveResult {
  const request = CareerContextRetrieveInputSchema.parse(input.request);
  const profile = migrateCareerProfileToV2(input.profile);
  const factSources = buildFactSources(profile);
  const queryTerms = extractTerms(`${request.query}\n${request.targetText ?? ""}`);
  const jobTerms = input.job?.requirements.flatMap((requirement) => [
    ...requirement.keywords,
    ...extractTerms(requirement.description)
  ]) ?? [];
  const allTerms = uniqueTerms([...queryTerms, ...jobTerms]);
  const targetSignals = buildTargetSignals(request, input.job, input.resume, input.requirementMatches, allTerms);
  const rankedFacts = factSources
    .map((source) => ({ source, score: scoreFact(source, request, allTerms) }))
    .sort((left, right) => right.score - left.score || left.source.fact.id.localeCompare(right.source.fact.id))
    .slice(0, request.maxFacts);
  const facts = rankedFacts.map(({ source, score }) => toContextFact(source, score, request, allTerms));
  const factSearchText = factSources.map((source) => source.searchableText).join("\n").toLowerCase();
  const unsupportedClaims = buildUnsupportedClaims({
    request,
    facts,
    factSearchText,
    jobTerms
  });
  const freshFit = freshFitSummary(input.job, input.requirementMatches, profile);
  const sourceSummary = {
    profileId: profile.id,
    profileVersion: profile.version,
    confirmedFactCount: factSources.length,
    returnedFactCount: facts.length,
    evidenceCount: profile.evidences.length,
    includedSourceTypes: uniqueStrings(facts.map((fact) => fact.sourceEntityType)),
    excludedSourceTypes: EXCLUDED_SOURCE_TYPES,
    ...(input.job ? {
      job: {
        id: input.job.id,
        title: input.job.title,
        requirementCount: input.job.requirements.length,
        freshFitAvailable: freshFit.freshFitAvailable,
        staleFitCount: freshFit.staleFitCount
      }
    } : {}),
    ...(input.resume ? {
      resume: {
        id: input.resume.id,
        purpose: input.resume.branchPurpose,
        revision: input.resume.revision,
        factBackedVisibleItemCount: factBackedVisibleItemCount(input.resume)
      }
    } : {})
  };
  const careerContextResultSummary = buildCareerContextResultSummary(profile, facts.length);
  return CareerContextRetrieveResultSchema.parse({
    profileId: profile.id,
    query: request.query,
    intent: request.intent ?? inferIntent(request.query),
    facts,
    targetSignals,
    unsupportedClaims,
    sourceSummary,
    careerContextResultSummary
  });
}

function buildCareerContextResultSummary(
  profile: ReturnType<typeof migrateCareerProfileToV2>,
  factsReturned: number
): CareerContextResultSummary {
  const entityCounts: Record<string, number> = {
    summary: 0,
    education: 0,
    work: 0,
    internship: 0,
    project: 0,
    research: 0,
    campus: 0,
    volunteer: 0,
    awards: 0,
    skills: 0,
    certificates: 0,
    languages: 0,
    publications: 0,
    patents: 0,
    portfolio: 0,
    other: 0,
    custom: 0
  };
  const contentCoverage: Record<string, number> = {};
  for (const sectionType of ["summary", "education", "work", "internship", "project", "research", "campus", "volunteer", "awards", "skills", "certificates", "languages", "publications", "patents", "portfolio", "other", "custom"]) {
    for (const field of ["Description", "Highlights", "Outcomes", "Tools"]) {
      contentCoverage[`${sectionType}${field}NonEmpty`] = 0;
    }
  }
  const evidenceRefs = new Set<string>(profile.evidences.map((evidence) => evidence.id));
  for (const experience of profile.experiences) {
    for (const evidenceId of experience.evidenceIds) evidenceRefs.add(evidenceId);
  }
  for (const skill of profile.skills) {
    for (const evidenceId of skill.evidenceIds) evidenceRefs.add(evidenceId);
  }
  for (const certificate of profile.certificates) {
    for (const evidenceId of certificate.evidenceIds) evidenceRefs.add(evidenceId);
  }

  for (const entry of profile.structuredFacts ?? []) {
    const item = entry.data as unknown as Record<string, unknown>;
    const sectionType = entry.data.sectionType;
    entityCounts[sectionType] = (entityCounts[sectionType] ?? 0) + 1;
    for (const sourceId of entry.sourceBlockIds) evidenceRefs.add(sourceId);
    for (const factId of entry.factIds) evidenceRefs.add(factId);
    const prefix = resultSummarySectionPrefix(sectionType);
    incrementCoverage(contentCoverage, `${prefix}DescriptionNonEmpty`, nonEmptyText(item.description));
    incrementCoverage(contentCoverage, `${prefix}HighlightsNonEmpty`, nonEmptyListLength(item.highlights) > 0);
    incrementCoverage(contentCoverage, `${prefix}OutcomesNonEmpty`, nonEmptyListLength(item.outcomes) > 0);
    incrementCoverage(contentCoverage, `${prefix}ToolsNonEmpty`, nonEmptyListLength(item.tools) > 0);
  }

  return CareerContextResultSummarySchema.parse({
    profileId: profile.id,
    factsReturned,
    entityCounts,
    contentCoverage,
    evidenceRefCount: evidenceRefs.size
  });
}

function resultSummarySectionPrefix(sectionType: string) {
  if (sectionType === "skills") return "skills";
  if (sectionType === "certificates") return "certificates";
  if (sectionType === "languages") return "languages";
  if (sectionType === "awards") return "awards";
  return sectionType;
}

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyListLength(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).length
    : 0;
}

function incrementCoverage(target: Record<string, number>, key: string, present: boolean) {
  if (present) target[key] = (target[key] ?? 0) + 1;
}

function buildFactSources(profile: ReturnType<typeof migrateCareerProfileToV2>): FactSource[] {
  const entities = new Map<string, {
    sourceEntityType: FactSource["sourceEntityType"];
    title: string;
    evidenceRefs: string[];
    date?: string;
  }>();
  for (const experience of profile.experiences) {
    entities.set(experience.id, {
      sourceEntityType: experience.type === "education" ? "education" : experience.type === "project" ? "project" : "experience",
      title: `${experience.organization}${experience.role ? ` · ${experience.role}` : ""}`,
      evidenceRefs: experience.evidenceIds,
      date: experience.endDate ?? experience.startDate
    });
    for (const fact of experience.facts) entities.set(`fact:${fact.id}`, {
      sourceEntityType: experience.type === "education" ? "education" : experience.type === "project" ? "project" : "experience",
      title: `${experience.organization}${experience.role ? ` · ${experience.role}` : ""}`,
      evidenceRefs: experience.evidenceIds,
      date: experience.endDate ?? experience.startDate
    });
  }
  for (const skill of profile.skills) {
    if (!skill.fact) continue;
    entities.set(`fact:${skill.fact.id}`, {
      sourceEntityType: skill.fact.category === "language" ? "language" : "skill",
      title: skill.name,
      evidenceRefs: skill.evidenceIds,
      date: skill.lastUsedAt
    });
  }
  for (const certificate of profile.certificates) {
    if (!certificate.fact) continue;
    entities.set(`fact:${certificate.fact.id}`, {
      sourceEntityType: "certificate",
      title: certificate.name,
      evidenceRefs: certificate.evidenceIds,
      date: certificate.issuedAt
    });
  }

  const structured = profile.structuredFacts ?? [];
  const sources: FactSource[] = [];
  for (const entry of structured) {
    const item = entry.data as unknown as Record<string, unknown>;
    const title = firstText(item, ["title", "name", "organization", "school", "institution", "language"]) ?? entry.data.sectionType;
    for (const factId of entry.factIds) {
      const fact = findFact(profile, factId);
      const entity = entities.get(`fact:${factId}`);
      if (!fact || !entity || !isConfirmedFact(fact)) continue;
      const evidenceRefs = uniqueStrings([
        ...entity.evidenceRefs,
        ...fact.provenance
          .map((provenance) => provenance.sourceId)
          .filter((sourceId) => profile.evidences.some((evidence) => evidence.id === sourceId))
      ]);
      sources.push({
        fact,
        sourceEntityId: entry.data.id,
        sourceEntityType: entity.sourceEntityType,
        title,
        evidenceRefs,
        date: entity.date,
        searchableText: `${title}\n${fact.statement}\n${fact.provenance.map((item) => item.sourceText).join("\n")}`.toLowerCase()
      });
    }
  }
  return uniqueBy(sources, (source) => source.fact.id);
}

function scoreFact(source: FactSource, request: CareerContextRetrieveInput, terms: string[]) {
  const haystack = source.searchableText;
  const title = source.title.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (haystack.includes(term)) score += title.includes(term) ? 7 : 4;
  }
  const intent = request.intent ?? inferIntent(request.query);
  if (intent === "evidence_search") score += source.evidenceRefs.length ? 5 : 0;
  if (intent === "strength_analysis") score += ["skill", "language", "project", "experience"].includes(source.sourceEntityType) ? 2 : 0;
  if (intent === "interview_answer" || intent === "application_reason" || intent === "job_fit_explanation") {
    score += ["project", "experience", "education", "skill", "language"].includes(source.sourceEntityType) ? 2 : 0;
  }
  score += Math.min(2, source.evidenceRefs.length);
  return score;
}

function toContextFact(source: FactSource, score: number, request: CareerContextRetrieveInput, terms: string[]): CareerContextFact {
  const matched = terms.filter((term) => source.searchableText.includes(term)).slice(0, 3);
  const relevanceReason = matched.length
    ? `与问题中的“${matched.join("、")}”相符${score > 8 ? "，且有直接来源支持" : ""}。`
    : "这是已确认的职业事实，可作为补充证据。";
  return {
    factId: source.fact.id,
    type: source.sourceEntityType === "profile" ? "basic" : source.sourceEntityType,
    title: source.title,
    statement: source.fact.statement,
    sourceEntityId: source.sourceEntityId,
    sourceEntityType: source.sourceEntityType,
    evidenceRefs: source.evidenceRefs,
    confidence: Math.max(0, Math.min(1, Math.max(...source.fact.provenance.map((item) => item.confidence)))),
    ...(source.date ? { date: source.date } : {}),
    relevanceReason
  };
}

function buildTargetSignals(
  request: CareerContextRetrieveInput,
  job: JobDescription | undefined,
  resume: ResumeBranch | undefined,
  matches: RequirementMatch[] | undefined,
  terms: string[]
) {
  const signals = [
    ...(job?.requirements.flatMap((requirement) => requirement.keywords) ?? []),
    ...extractTerms(request.targetText ?? ""),
    ...(resume && factBackedVisibleItemCount(resume) > 0 ? [resume.name] : []),
    ...freshFitSignals(job, matches)
  ];
  return uniqueStrings([...signals, ...terms]).slice(0, 16);
}

function freshFitSignals(job: JobDescription | undefined, matches: RequirementMatch[] | undefined) {
  if (!job || !matches?.length) return [];
  return matches
    .filter((match) => !match.isStale && match.jobVersion === job.updatedAt)
    .map((match) => match.requirementQuote.text)
    .filter(Boolean)
    .slice(0, 8);
}

function buildUnsupportedClaims(input: {
  request: CareerContextRetrieveInput;
  facts: CareerContextFact[];
  factSearchText: string;
  jobTerms: string[];
}) {
  if (!input.facts.length) return ["当前资料库没有可引用的已确认经历、技能或证据。"];
  const candidateTerms = uniqueTerms([
    ...input.jobTerms,
    ...extractTerms(input.request.targetText ?? ""),
    ...extractTerms(input.request.query)
  ]).filter((term) => isMeaningfulSignal(term));
  return candidateTerms
    .filter((term) => !input.factSearchText.includes(term.toLowerCase()))
    .slice(0, 6)
    .map((term) => `未找到与“${term}”直接对应的已确认经历或证据。`);
}

function freshFitSummary(job: JobDescription | undefined, matches: RequirementMatch[] | undefined, profile: ReturnType<typeof migrateCareerProfileToV2>) {
  if (!job || !matches) return { freshFitAvailable: false, staleFitCount: 0 };
  const fresh = matches.filter((match) => !match.isStale && match.profileVersion === profile.version && match.jobVersion === job.updatedAt);
  return {
    freshFitAvailable: fresh.length > 0,
    staleFitCount: matches.length - fresh.length
  };
}

function factBackedVisibleItemCount(resume: ResumeBranch) {
  if (resume.syncStatusCache?.status !== "in_sync") return 0;
  return resume.contentItems.filter((item) => item.visible && item.factRefs.length > 0 && item.guardStatus === "pass").length;
}

function findFact(profile: CareerProfile, factId: string) {
  for (const experience of profile.experiences) {
    const fact = experience.facts.find((candidate) => candidate.id === factId);
    if (fact) return fact;
  }
  const skillFact = profile.skills.find((skill) => skill.fact?.id === factId)?.fact;
  if (skillFact) return skillFact;
  return profile.certificates.find((certificate) => certificate.fact?.id === factId)?.fact;
}

function isConfirmedFact(fact: FactStatement) {
  return fact.confirmedByUser
    && fact.riskLevel !== "high"
    && fact.provenance.some((provenance) => provenance.confirmedByUser);
}

function inferIntent(query: string): CareerContextIntent {
  if (/申请理由|为什么适合|岗位要求|岗位匹配/u.test(query)) return "application_reason";
  if (/面试|回答|自我介绍/u.test(query)) return "interview_answer";
  if (/优势|强项|擅长/u.test(query)) return "strength_analysis";
  if (/证据|证明|依据|来源/u.test(query)) return "evidence_search";
  if (/项目|经历|故事|成长/u.test(query)) return "career_story";
  return "general_question";
}

function extractTerms(value: string) {
  const terms = value.toLowerCase().match(/[a-z0-9][a-z0-9+.#/_-]*/giu) ?? [];
  const hanRuns = value.match(/[\u4e00-\u9fff]{2,16}/gu) ?? [];
  const hanTerms = hanRuns.flatMap((run) => {
    const result = [run];
    for (let size = 2; size <= Math.min(4, run.length); size += 1) {
      for (let index = 0; index + size <= run.length; index += 1) result.push(run.slice(index, index + size));
    }
    return result;
  });
  return uniqueTerms([...terms, ...hanTerms]);
}

function uniqueTerms(values: string[]) {
  return uniqueStrings(values.map((value) => value.trim().toLowerCase()).filter(isMeaningfulSignal));
}

function isMeaningfulSignal(value: string) {
  return value.length >= 2 && !/^(?:什么|哪些|哪个|怎么|如何|为什么|是否|请问|结合|我的|这个|岗位|经历|项目|能力|水平|一下|帮我|写一段|申请理由)$/u.test(value);
}

function firstText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
