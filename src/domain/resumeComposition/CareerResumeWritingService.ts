import { invokeStructuredAi } from "@/ai/client";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import type { CareerProfile, FactStatement, JobDescription, MatchEvidenceRef } from "@/domain/schemas";
import { dedupeCareerWriting, isFiller, isRawOrNegativeSpeech } from "@/domain/profileIntake/CareerWritingQuality";
import {
  CareerResumeWritingOutputSchema,
  type CareerResumeWritingOutput,
  type ResumeBlueprint,
  type ResumeEvidenceGraph
} from "./contracts";
import { resolveCareerAssetDisplayIdentity } from "./CareerAssetDisplayIdentity";
import { canonicalTechnicalTerm, compactSkillCategory, normalizeSkillGroups, technicalTermCategory } from "./ResumeSkillTaxonomy";

export class CareerResumeWritingService {
  async write(input: {
    profile: CareerProfile;
    graph: ResumeEvidenceGraph;
    blueprint: ResumeBlueprint;
    mode: "general" | "job_specific";
    job?: JobDescription;
    targetDirection?: string;
    targetAudience?: string;
    companyType?: string;
    signal?: AbortSignal;
  }): Promise<CareerResumeWritingOutput | undefined> {
    const profile = migrateCareerProfileToV2(input.profile);
    const facts = collectFacts(profile);
    const entriesById = new Map(profile.structuredFacts.map((entry) => [entry.data.id, entry]));
    const businessInput = {
      mode: input.mode,
      ...(input.job?.title ? { targetRole: input.job.title } : {}),
      ...((input.targetDirection ?? input.blueprint.targetDirection) ? { targetDirection: input.targetDirection ?? input.blueprint.targetDirection } : {}),
      ...((input.targetAudience ?? input.blueprint.targetAudience) ? { targetAudience: input.targetAudience ?? input.blueprint.targetAudience } : {}),
      ...((input.companyType ?? input.blueprint.companyType) ? { companyType: input.companyType ?? input.blueprint.companyType } : {}),
      assets: input.blueprint.assets.map((asset) => {
        const entry = entriesById.get(asset.sourceAssetId);
        const sourceFacts = entry?.factIds.map((id) => facts.get(id)).filter((fact): fact is FactStatement => Boolean(fact)) ?? [];
        const evidence = input.graph.nodes.filter((node) => node.sourceAssetIds.includes(asset.sourceAssetId));
        return {
          sourceAssetId: asset.sourceAssetId,
          displayIdentity: entry ? resolveCareerAssetDisplayIdentity(entry.data).label : asset.title,
          sectionType: asset.sectionType,
          canonicalItem: entry?.data ?? { sectionType: asset.sectionType },
          factStatements: sourceFacts.map((fact) => fact.statement),
          evidenceExcerpts: [...new Set([
            ...(entry?.sourceExcerpt ? [entry.sourceExcerpt] : []),
            ...evidence.flatMap((node) => node.sourceExcerpts)
          ])].slice(0, 12),
          ownershipStrength: Math.max(0, ...evidence.map((node) => node.ownershipStrength)),
          explicitTools: asset.explicitTools
        };
      }),
      skillGroups: normalizeSkillGroups(input.graph.skillMatrix),
      instructions: [
        "Use one or two lines for the summary; omit it if the evidence does not support a useful opening.",
        "Prefer action plus concrete object or result plus a supported method/tool when evidence allows; retain the source's ownership strength.",
        "For early-career general resumes, favor a one-page selection: education, compact skills, three or four strongest projects, research, and one award before campus activities.",
        "Treat targetDirection, targetAudience, and companyType as presentation context only; never write them as a personal fact.",
        "Do not expose sourceAssetId, fact IDs, evidence IDs, or process commentary in any title, summary, role, or highlight."
      ]
    };
    const response = await invokeStructuredAi({
      task: "resume-career-writer",
      businessInput,
      outputSchema: CareerResumeWritingOutputSchema,
      signal: input.signal
    });
    if (!response.ok) return undefined;
    return sanitizeOutput(response.data, input);
  }
}

function sanitizeOutput(
  output: CareerResumeWritingOutput,
  input: { profile: CareerProfile; graph: ResumeEvidenceGraph; blueprint: ResumeBlueprint }
) {
  const profile = migrateCareerProfileToV2(input.profile);
  const facts = collectFacts(profile);
  const entriesById = new Map(profile.structuredFacts.map((entry) => [entry.data.id, entry]));
  const blueprintById = new Map(input.blueprint.assets.map((asset) => [asset.sourceAssetId, asset]));
  const allowedSkills = new Map(input.graph.skillMatrix.map((skill) => [canonicalTechnicalTerm(skill.name) ?? skill.name, skill]));
  const assets = output.assets.flatMap((candidate) => {
    const entry = entriesById.get(candidate.sourceAssetId);
    const blueprintAsset = blueprintById.get(candidate.sourceAssetId);
    if (!entry || !blueprintAsset) return [];
    const canonical = entry.data as unknown as Record<string, unknown>;
    const canonicalRole = [canonical.role, canonical.authorRole].find((value): value is string => typeof value === "string" && Boolean(value.trim()));
    const role = candidate.role && canonicalRole && sameText(candidate.role, canonicalRole) ? canonicalRole : undefined;
    const explicitTools = blueprintAsset.explicitTools;
    const techStack = unique(candidate.techStack.filter((value) => explicitTools.some((tool) => sameText(tool, value)
      || canonicalTechnicalTerm(tool) !== undefined && canonicalTechnicalTerm(tool) === canonicalTechnicalTerm(value))));
    const sourceFacts = entry.factIds.map((id) => facts.get(id)).filter((fact): fact is FactStatement => Boolean(fact));
    const originalText = [JSON.stringify(canonical), ...sourceFacts.map((fact) => fact.statement), ...sourceFacts.flatMap((fact) => fact.provenance.map((source) => source.sourceText))].join("\n");
    const evidenceRefs = evidenceRefsForFacts(sourceFacts);
    const highlights = dedupeCareerWriting(candidate.highlights)
      .filter((value) => !isFiller(value) && !containsProcessLanguage(value) && !isRawOrNegativeSpeech(value) && passesFactGuard(originalText, value, evidenceRefs))
      .slice(0, 4);
    return [{
      sourceAssetId: candidate.sourceAssetId,
      title: resolveCareerAssetDisplayIdentity(entry.data).label,
      ...(role ? { role } : {}),
      techStack,
      highlights
    }];
  });
  const deterministicGroups = normalizeSkillGroups(input.graph.skillMatrix);
  const skillGroups = sanitizeSkillGroups(output.skillGroups, deterministicGroups, allowedSkills);
  const allFacts = [...facts.values()];
  const summaryEvidence = evidenceRefsForFacts(allFacts);
  const summaryOriginalText = allFacts.map((fact) => fact.statement).join("\n");
  const summary = output.summary && !isFiller(output.summary) && !containsProcessLanguage(output.summary) && !isRawOrNegativeSpeech(output.summary)
    && passesFactGuard(summaryOriginalText, output.summary, summaryEvidence)
    ? dedupeCareerWriting([output.summary])[0]
    : undefined;
  return CareerResumeWritingOutputSchema.parse({
    ...(summary ? { summary } : {}),
    assets,
    skillGroups
  });
}

function sanitizeSkillGroups(
  requested: CareerResumeWritingOutput["skillGroups"],
  deterministic: Record<string, string[]>,
  allowed: Map<string, { name: string; category: string }>
) {
  const requestedByCategory = new Map<string, string[]>();
  for (const group of requested) {
    for (const value of group.skills) {
      const canonical = canonicalTechnicalTerm(value) ?? value.trim();
      const source = allowed.get(canonical);
      if (!source) continue;
      const category = compactSkillCategory(technicalTermCategory(canonical) ?? source.category ?? group.category);
      requestedByCategory.set(category, unique([...(requestedByCategory.get(category) ?? []), canonical]));
    }
  }
  return Object.entries(deterministic).map(([category, skills]) => ({
    category,
    skills: unique([...(requestedByCategory.get(category) ?? []), ...skills]).slice(0, 16)
  }));
}

function collectFacts(profile: ReturnType<typeof migrateCareerProfileToV2>) {
  const facts = new Map<string, FactStatement>();
  for (const experience of profile.experiences) for (const fact of experience.facts) facts.set(fact.id, fact);
  for (const skill of profile.skills) if (skill.fact) facts.set(skill.fact.id, skill.fact);
  for (const certificate of profile.certificates) if (certificate.fact) facts.set(certificate.fact.id, certificate.fact);
  return facts;
}

function evidenceRefsForFacts(facts: FactStatement[]): MatchEvidenceRef[] {
  return facts.map((fact) => {
    const source = fact.provenance[0];
    if (fact.category === "skill") return { type: "skill_fact", skillId: source.sourceId, factId: fact.id, factQuote: source.sourceQuote ?? source.sourceText, factText: fact.statement };
    if (fact.category === "certificate" || fact.category === "achievement") return { type: "certificate_fact", certificateId: source.sourceId, factId: fact.id, factQuote: source.sourceQuote ?? source.sourceText, factText: fact.statement };
    return { type: "experience_fact", experienceId: source.sourceId, factId: fact.id, factQuote: source.sourceQuote ?? source.sourceText, factText: fact.statement };
  });
}

function passesFactGuard(originalText: string, checkedText: string, evidenceRefs: MatchEvidenceRef[]) {
  return runRuleFactGuard({ originalText, checkedText, usedEvidenceRefs: evidenceRefs }).status === "pass";
}

function containsProcessLanguage(value: string) {
  return /(?:基于(?:已确认|当前)(?:资料|事实)|来源事实|资料库|source\s*(?:fact|evidence)|待补充|待整理|内部标识|asset[_ -]?id|fact[_ -]?id)/iu.test(value);
}

function sameText(left: string, right: string) {
  return left.trim().toLocaleLowerCase().replace(/\s+/gu, "") === right.trim().toLocaleLowerCase().replace(/\s+/gu, "");
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
