import { migrateCareerProfileToV2, migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";
import {
  buildResumeImportProfileOnly
} from "@/domain/resumeImport/confirm";
import type {
  CareerProfile,
  FactStatement,
  ImportedResumeDraft,
  ProfileStructuredFact,
  ResumeBranch,
  ResumeItemV2,
  Skill,
  Certificate,
  Experience
} from "@/domain/schemas";
import { ProfileStructuredFactSchema } from "@/domain/schemas/profile";
import { stableHashText } from "@/services/security/text";

export type ProfileRecoverySourceType =
  | "imported_resume_draft"
  | "resume_source_document"
  | "confirmed_provenance"
  | "general_resume";

export type ProfileRecoveryItem = {
  structuredFact: ProfileStructuredFact;
  facts: FactStatement[];
  experience?: Experience;
  skill?: Skill;
  certificate?: Certificate;
  sourceItemId?: string;
  targetStructuredFactId?: string;
  targetExperienceId?: string;
  evidenceRefs?: string[];
};

export type ProfileRecoveryCandidate = {
  id: string;
  sourceType: ProfileRecoverySourceType;
  sourceId: string;
  sourceResumeId?: string;
  sourceLabel: string;
  items: ProfileRecoveryItem[];
  affectedEntityCount: number;
  candidateBulletCount: number;
  projectCount: number;
  projectBulletCount: number;
  workCount: number;
  workBulletCount: number;
  conflictCount: number;
  unchangedItemCount: number;
  sourceRevisionId: string;
  targetIds: string[];
  targetExperienceIds: string[];
  evidenceRefs: string[];
  conflictState: "none" | "review_required";
  candidateType: "authoritative_exact" | "confirmed_provenance" | "presentation_recovery";
  confidence: "high" | "medium" | "low";
  requiresUserConfirmation: boolean;
};

export type ProfileRecoveryCandidatePreview = Omit<ProfileRecoveryCandidate, "items">;

const recoverableSections = new Set<ResumeItemV2["sectionType"]>(["project", "work", "internship"]);

export function buildProfileRecoveryCandidates(input: {
  profile: CareerProfile;
  importedDraft?: ImportedResumeDraft;
  generalResume?: ResumeBranch;
}): ProfileRecoveryCandidate[] {
  const candidates: ProfileRecoveryCandidate[] = [];
  if (input.importedDraft && isConfirmedDraftForProfile(input.importedDraft, input.profile.id)) {
    const importedProfile = migrateCareerProfileToV2(buildResumeImportProfileOnly({
      draft: input.importedDraft,
      newProfileName: input.profile.name,
      now: input.importedDraft.updatedAt
    }));
    const importedItems = importedRecoveryItems(importedProfile, input.profile);
    if (importedItems.length > 0) {
      candidates.push(makeCandidate({
        sourceType: "imported_resume_draft",
        sourceId: input.importedDraft.importId,
        sourceRevisionId: input.importedDraft.confirmedRevisionId ?? `${input.importedDraft.importId}:revision-${input.importedDraft.revision}`,
        sourceLabel: "ImportedResumeDraft（已确认）",
        items: importedItems,
        profile: input.profile,
        candidateType: "authoritative_exact",
        confidence: "high",
        requiresUserConfirmation: true
      }));
    }
    // A V2 draft already contains the normalized ResumeSourceDocument blocks.
    // Keep the source priority visible without creating a second data path;
    // the selected candidate still reads the confirmed draft projection.
    if (input.importedDraft.schemaVersion === "resume-import-v2" && importedItems.length > 0) {
      candidates.push(makeCandidate({
        sourceType: "resume_source_document",
        sourceId: input.importedDraft.source.fileHash,
        sourceRevisionId: input.importedDraft.confirmedRevisionId ?? `${input.importedDraft.importId}:source-document`,
        sourceLabel: "ResumeSourceDocument（由已确认导入派生）",
        items: importedItems,
        profile: input.profile,
        candidateType: "authoritative_exact",
        confidence: "high",
        requiresUserConfirmation: true
      }));
    }
  }

  const confirmedItems = confirmedProvenanceItems(input.profile);
  if (confirmedItems.length > 0) {
    candidates.push(makeCandidate({
      sourceType: "confirmed_provenance",
      sourceId: input.profile.id,
      sourceRevisionId: `profile:${input.profile.id}:revision-${input.profile.version}`,
      sourceLabel: "已确认 provenance / evidence",
      items: confirmedItems,
      profile: input.profile,
      candidateType: "confirmed_provenance",
      confidence: "high",
      requiresUserConfirmation: true
    }));
  }

  if (input.generalResume) {
    const generalItems = generalResumeRecoveryItems(input.generalResume, input.profile);
    if (generalItems.length > 0) {
      candidates.push(makeCandidate({
        sourceType: "general_resume",
        sourceId: input.generalResume.id,
        sourceRevisionId: input.generalResume.currentRevisionId ?? `${input.generalResume.id}:revision-${input.generalResume.revision}`,
        sourceLabel: "通用简历（仅在无更强来源时）",
        items: generalItems,
        profile: input.profile,
        candidateType: "presentation_recovery",
        confidence: "medium",
        requiresUserConfirmation: true
      }));
    }
  }

  return candidates;
}

export function preferredProfileRecoveryCandidate(candidates: ProfileRecoveryCandidate[]) {
  return candidates.find((candidate) => candidate.affectedEntityCount > 0);
}

export function profileRecoveryCandidatePreview(candidate: ProfileRecoveryCandidate): ProfileRecoveryCandidatePreview {
  return {
    id: candidate.id,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    ...(candidate.sourceResumeId ? { sourceResumeId: candidate.sourceResumeId } : {}),
    sourceLabel: candidate.sourceLabel,
    affectedEntityCount: candidate.affectedEntityCount,
    candidateBulletCount: candidate.candidateBulletCount,
    projectCount: candidate.projectCount,
    projectBulletCount: candidate.projectBulletCount,
    workCount: candidate.workCount,
    workBulletCount: candidate.workBulletCount,
    conflictCount: candidate.conflictCount,
    unchangedItemCount: candidate.unchangedItemCount,
    sourceRevisionId: candidate.sourceRevisionId,
    targetIds: candidate.targetIds,
    targetExperienceIds: candidate.targetExperienceIds,
    evidenceRefs: candidate.evidenceRefs,
    conflictState: candidate.conflictState,
    candidateType: candidate.candidateType,
    confidence: candidate.confidence,
    requiresUserConfirmation: candidate.requiresUserConfirmation
  };
}

/** Merge only after the UI has received explicit confirmation. */
export function applyProfileRecoveryItems(input: {
  profile: CareerProfile;
  items: ProfileRecoveryItem[];
  now: string;
}) {
  const source = migrateCareerProfileToV2(input.profile);
  const byId = new Map(source.structuredFacts.map((entry) => [entry.data.id, entry]));
  const factsById = new Map<string, FactStatement>();
  source.experiences.flatMap((experience) => experience.facts).forEach((fact) => factsById.set(fact.id, fact));
  source.skills.flatMap((skill) => skill.fact ? [skill.fact] : []).forEach((fact) => factsById.set(fact.id, fact));
  source.certificates.flatMap((certificate) => certificate.fact ? [certificate.fact] : []).forEach((fact) => factsById.set(fact.id, fact));

  const experiences = [...source.experiences];
  const skills = [...source.skills];
  const certificates = [...source.certificates];
  for (const item of input.items) {
    const incoming = ProfileStructuredFactSchema.parse({
      ...item.structuredFact,
      data: {
        ...item.structuredFact.data,
        ...(item.targetStructuredFactId ? { id: item.targetStructuredFactId } : {})
      }
    });
    const current = byId.get(incoming.data.id);
    const targetExperience = item.targetExperienceId
      ? experiences.find((candidate) => candidate.id === item.targetExperienceId)
      : item.experience
        ? experiences.find((candidate) => sameExperienceIdentity(candidate, item.experience!))
        : undefined;
    const factIdMap = new Map<string, string>();
    if (targetExperience) {
      const mergedFacts = [...targetExperience.facts];
      for (const fact of item.facts) {
        const existing = mergedFacts.find((candidate) => normalizeFactStatement(candidate.statement) === normalizeFactStatement(fact.statement));
        if (existing) {
          const merged = mergeFactStatement(existing, fact);
          const index = mergedFacts.findIndex((candidate) => candidate.id === existing.id);
          mergedFacts[index] = merged;
          factsById.set(existing.id, merged);
          factIdMap.set(fact.id, existing.id);
        } else {
          mergedFacts.push(fact);
          factsById.set(fact.id, fact);
          factIdMap.set(fact.id, fact.id);
        }
      }
      if (mergedFacts.length !== targetExperience.facts.length) {
        const index = experiences.findIndex((candidate) => candidate.id === targetExperience.id);
        experiences[index] = { ...targetExperience, facts: mergedFacts, updatedAt: input.now };
      }
    } else {
      item.facts.forEach((fact) => {
        factsById.set(fact.id, fact);
        factIdMap.set(fact.id, fact.id);
      });
    }
    const remappedIncoming = ProfileStructuredFactSchema.parse({
      ...incoming,
      factIds: incoming.factIds.map((id) => factIdMap.get(id) ?? id)
    });
    byId.set(incoming.data.id, current ? mergeStructuredFact(current, remappedIncoming) : remappedIncoming);
    if (item.experience && !targetExperience && !experiences.some((candidate) => candidate.id === item.experience?.id)) experiences.push(item.experience);
    if (item.skill && !skills.some((candidate) => candidate.id === item.skill?.id)) skills.push(item.skill);
    if (item.certificate && !certificates.some((candidate) => candidate.id === item.certificate?.id)) certificates.push(item.certificate);
  }

  return migrateCareerProfileToV2({
    ...source,
    experiences: experiences.map((experience) => ({
      ...experience,
      facts: experience.facts.map((fact) => factsById.get(fact.id) ?? fact)
    })),
    skills: skills.map((skill) => ({ ...skill, fact: skill.fact ? factsById.get(skill.fact.id) ?? skill.fact : undefined })),
    certificates: certificates.map((certificate) => ({ ...certificate, fact: certificate.fact ? factsById.get(certificate.fact.id) ?? certificate.fact : undefined })),
    structuredFacts: [...byId.values()],
    updatedAt: input.now
  });
}

function normalizeFactStatement(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function mergeFactStatement(current: FactStatement, incoming: FactStatement): FactStatement {
  const provenance = [...current.provenance];
  for (const candidate of incoming.provenance) {
    if (!provenance.some((existing) => JSON.stringify(existing) === JSON.stringify(candidate))) provenance.push(candidate);
  }
  return {
    ...current,
    provenance,
    confirmedByUser: current.confirmedByUser || incoming.confirmedByUser,
    riskLevel: current.riskLevel === "high" || incoming.riskLevel === "high"
      ? "high"
      : current.riskLevel === "medium" || incoming.riskLevel === "medium" ? "medium" : "low",
    updatedAt: incoming.updatedAt
  };
}

function sameExperienceIdentity(left: Experience, right: Experience) {
  const fields = [left.organization, left.role, left.startDate, left.endDate]
    .map((value, index) => [normalizeIdentity(value), normalizeIdentity([right.organization, right.role, right.startDate, right.endDate][index])] as const)
    .filter(([current, incoming]) => current && incoming);
  return left.type === right.type
    && fields.length > 0
    && fields.every(([current, incoming]) => current === incoming);
}

function isConfirmedDraftForProfile(draft: ImportedResumeDraft, profileId: string) {
  return draft.status === "confirmed"
    && (!draft.confirmedProfileId || draft.confirmedProfileId === profileId)
    && draft.sections.some((section) => section.included && section.items.some((item) => item.included));
}

function importedRecoveryItems(profile: CareerProfile, targetProfile: CareerProfile): ProfileRecoveryItem[] {
  const canonical = migrateCareerProfileToV2(profile);
  const factsById = profileFactsById(canonical);
  return canonical.structuredFacts
    .filter((entry) => recoverableSections.has(entry.data.sectionType))
    .map((entry) => remapRecoveryItem({
      structuredFact: entry,
      facts: entry.factIds.flatMap((id) => factsById.get(id) ? [factsById.get(id)!] : []),
      experience: canonical.experiences.find((experience) => experience.facts.some((fact) => entry.factIds.includes(fact.id))),
      skill: canonical.skills.find((skill) => skill.fact && entry.factIds.includes(skill.fact.id)),
      certificate: canonical.certificates.find((certificate) => certificate.fact && entry.factIds.includes(certificate.fact.id)),
      sourceItemId: entry.data.id
    }, targetProfile));
}

function confirmedProvenanceItems(profile: CareerProfile): ProfileRecoveryItem[] {
  const canonical = migrateCareerProfileToV2(profile);
  const factsById = profileFactsById(canonical);
  return canonical.structuredFacts
    .filter((entry) => recoverableSections.has(entry.data.sectionType))
    .filter((entry) => Boolean(entry.sourceBlockIds.length || entry.provenance?.length || entry.factIds.length))
    .flatMap((entry) => {
      const facts = entry.factIds.flatMap((id) => factsById.get(id) ? [factsById.get(id)!] : []);
      const confirmedFacts = facts.filter((fact) => fact.confirmedByUser && fact.provenance.some((source) => source.confirmedByUser));
      if (!confirmedFacts.length) return [];
      const data = entry.data as Record<string, unknown>;
      const hasBody = arrayOfText(data.highlights).length > 0
        || (entry.data.sectionType === "project" && (arrayOfText(data.outcomes).length > 0 || arrayOfText(data.tools).length > 0))
        || (typeof data.description === "string" && data.description.trim().length > 0);
      const recoveredData = hasBody
        ? entry.data
        : { ...entry.data, highlights: confirmedFacts.map((fact) => fact.statement) };
      return [{
        structuredFact: ProfileStructuredFactSchema.parse({ ...entry, data: recoveredData }),
        facts,
        sourceItemId: entry.data.id,
        targetStructuredFactId: entry.data.id,
        targetExperienceId: canonical.experiences.find((experience) => experience.facts.some((fact) => entry.factIds.includes(fact.id)))?.id,
        evidenceRefs: [...new Set(confirmedFacts.flatMap((fact) => fact.provenance.map((source) => source.sourceId)))]
      }];
    });
}

function generalResumeRecoveryItems(branch: ResumeBranch, targetProfile: CareerProfile): ProfileRecoveryItem[] {
  const canonical = migrateResumeBranchToV2(branch);
  return (canonical.structuredContentItems ?? [])
    .filter((item) => recoverableSections.has(item.data.sectionType))
    .map((item) => remapRecoveryItem({
      structuredFact: ProfileStructuredFactSchema.parse({
        data: item.data,
        factIds: branchFactIds(item.factRefs),
        sourceBlockIds: item.sourceBlockIds,
        sourceRanges: item.sourceRanges,
        mappingTrace: item.mappingTrace,
        ...(item.sourceExcerpt ? { sourceExcerpt: item.sourceExcerpt } : item.legacyTextProjection ? { sourceExcerpt: item.legacyTextProjection } : {})
      }),
      facts: [],
      sourceItemId: item.id,
      evidenceRefs: branchFactIds(item.factRefs)
    }, targetProfile));
}

function branchFactIds(factRefs: Array<Record<string, unknown>>) {
  return [...new Set(factRefs.flatMap((ref) => Object.entries(ref)
    .filter(([key, value]) => key.toLowerCase().includes("fact") && typeof value === "string")
    .map(([, value]) => value as string)))];
}

function profileFactsById(profile: CareerProfile) {
  const factsById = new Map<string, FactStatement>();
  profile.experiences.flatMap((experience) => experience.facts).forEach((fact) => factsById.set(fact.id, fact));
  profile.skills.flatMap((skill) => skill.fact ? [skill.fact] : []).forEach((fact) => factsById.set(fact.id, fact));
  profile.certificates.flatMap((certificate) => certificate.fact ? [certificate.fact] : []).forEach((fact) => factsById.set(fact.id, fact));
  return factsById;
}

function remapRecoveryItem(item: ProfileRecoveryItem, targetProfile: CareerProfile): ProfileRecoveryItem {
  const target = matchTarget(item.structuredFact, targetProfile);
  const targetExperience = target?.experience
    ?? (item.experience ? targetProfile.experiences.find((candidate) => sameExperienceIdentity(candidate, item.experience!)) : undefined);
  return {
    ...item,
    structuredFact: ProfileStructuredFactSchema.parse({
      ...item.structuredFact,
      ...(target?.structuredFact ? { data: { ...item.structuredFact.data, id: target.structuredFact.data.id } } : {})
    }),
    ...(target?.structuredFact ? { targetStructuredFactId: target.structuredFact.data.id } : {}),
    ...(targetExperience ? { targetExperienceId: targetExperience.id } : {}),
    evidenceRefs: [...new Set(item.evidenceRefs ?? item.facts.flatMap((fact) => fact.provenance.map((source) => source.sourceId)))]
  };
}

function matchTarget(incoming: ProfileStructuredFact, profile: CareerProfile) {
  const canonical = migrateCareerProfileToV2(profile);
  const sameSection = canonical.structuredFacts.filter((entry) => entry.data.sectionType === incoming.data.sectionType);
  const sourceBlockMatch = sameSection.find((entry) => entry.sourceBlockIds.some((id) => incoming.sourceBlockIds.includes(id)));
  if (sourceBlockMatch) {
    return {
      structuredFact: sourceBlockMatch,
      experience: experienceForStructuredFact(canonical, sourceBlockMatch)
    };
  }
  const scored = sameSection
    .map((entry) => ({ entry, score: identityScore(incoming.data, entry.data) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  const uniqueBest = best && (!scored[1] || scored[1].score < best.score);
  if (!best || !(best.score >= 2 || uniqueBest)) return undefined;
  return {
    structuredFact: best.entry,
    experience: experienceForStructuredFact(canonical, best.entry)
  };
}

function experienceForStructuredFact(profile: ReturnType<typeof migrateCareerProfileToV2>, entry: ProfileStructuredFact) {
  return profile.experiences.find((experience) => experience.id === entry.data.id)
    ?? profile.experiences.find((experience) => experience.facts.some((fact) => entry.factIds.includes(fact.id)));
}

function identityScore(left: ResumeItemV2, right: ResumeItemV2) {
  if (left.sectionType !== right.sectionType) return 0;
  const leftRecord = left as unknown as Record<string, unknown>;
  const rightRecord = right as unknown as Record<string, unknown>;
  const fields = left.sectionType === "project"
    ? ["title", "organization", "role", "startDate", "endDate"]
    : ["organization", "role", "startDate", "endDate"];
  return fields.reduce((score, field) => {
    const l = normalizeIdentity(leftRecord[field]);
    const r = normalizeIdentity(rightRecord[field]);
    return l && r && l === r ? score + 1 : score;
  }, 0);
}

function makeCandidate(input: {
  sourceType: ProfileRecoverySourceType;
  sourceId: string;
  sourceRevisionId: string;
  sourceLabel: string;
  items: ProfileRecoveryItem[];
  profile: CareerProfile;
  candidateType: ProfileRecoveryCandidate["candidateType"];
  confidence: ProfileRecoveryCandidate["confidence"];
  requiresUserConfirmation: boolean;
}): ProfileRecoveryCandidate {
  const existing = new Map(migrateCareerProfileToV2(input.profile).structuredFacts.map((entry) => [entry.data.id, entry]));
  let affectedEntityCount = 0;
  let conflictCount = 0;
  let unchangedItemCount = 0;
  for (const item of input.items) {
    const current = existing.get(item.targetStructuredFactId ?? item.structuredFact.data.id);
    if (!current) {
      affectedEntityCount += 1;
      continue;
    }
    const recovery = recoverableContentDelta(current.data, item.structuredFact.data);
    if (!recovery.changed) {
      unchangedItemCount += 1;
    } else {
      affectedEntityCount += 1;
      conflictCount += recovery.conflict ? 1 : 0;
    }
  }
  const counts = input.items.reduce((total, item) => {
    const data = item.structuredFact.data as Record<string, unknown>;
    const bullets = arrayOfText(data.highlights).length + arrayOfText(data.outcomes).length;
    return {
      projectCount: total.projectCount + (item.structuredFact.data.sectionType === "project" ? 1 : 0),
      projectBulletCount: total.projectBulletCount + (item.structuredFact.data.sectionType === "project" ? bullets : 0),
      workCount: total.workCount + (item.structuredFact.data.sectionType === "work" ? 1 : 0),
      workBulletCount: total.workBulletCount + (item.structuredFact.data.sectionType === "work" ? bullets : 0)
    };
  }, { projectCount: 0, projectBulletCount: 0, workCount: 0, workBulletCount: 0 });
  const targetIds = [...new Set(input.items.flatMap((item) => item.targetStructuredFactId ?? item.structuredFact.data.id))];
  const targetExperienceIds = [...new Set(input.items.flatMap((item) => item.targetExperienceId ? [item.targetExperienceId] : []))];
  const evidenceRefs = [...new Set(input.items.flatMap((item) => item.evidenceRefs ?? []))];
  const candidateBulletCount = counts.projectBulletCount + counts.workBulletCount;
  return {
    id: `profile-recovery-${stableHashText(`${input.sourceType}:${input.sourceId}`)}`,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    ...(input.sourceType === "general_resume" ? { sourceResumeId: input.sourceId } : {}),
    sourceLabel: input.sourceLabel,
    items: input.items,
    affectedEntityCount,
    candidateBulletCount,
    ...counts,
    conflictCount,
    unchangedItemCount,
    sourceRevisionId: input.sourceRevisionId,
    targetIds,
    targetExperienceIds,
    evidenceRefs,
    conflictState: conflictCount > 0 ? "review_required" : "none",
    candidateType: input.candidateType,
    confidence: input.confidence,
    requiresUserConfirmation: input.requiresUserConfirmation
  };
}

function recoverableContentDelta(current: ResumeItemV2, incoming: ResumeItemV2) {
  const currentRecord = current as unknown as Record<string, unknown>;
  const incomingRecord = incoming as unknown as Record<string, unknown>;
  let changed = false;
  let conflict = false;
  for (const key of ["description", "background", "highlights", "outcomes", "tools"]) {
    const currentValue = currentRecord[key];
    const incomingValue = incomingRecord[key];
    const currentText = Array.isArray(currentValue) ? arrayOfText(currentValue) : typeof currentValue === "string" ? currentValue.trim() : "";
    const incomingText = Array.isArray(incomingValue) ? arrayOfText(incomingValue) : typeof incomingValue === "string" ? incomingValue.trim() : "";
    if (!incomingText || (Array.isArray(incomingText) && incomingText.length === 0)) continue;
    if (!currentText || (Array.isArray(currentText) && currentText.length === 0)) changed = true;
    else if (JSON.stringify(currentText) !== JSON.stringify(incomingText)) {
      changed = true;
      conflict = true;
    }
  }
  return { changed, conflict };
}

function mergeStructuredFact(current: ProfileStructuredFact, incoming: ProfileStructuredFact): ProfileStructuredFact {
  const currentData = current.data as Record<string, unknown>;
  const incomingData = incoming.data as Record<string, unknown>;
  const data = { ...incomingData, ...currentData };
  for (const key of ["description", "background"]) {
    const currentValue = currentData[key];
    const incomingValue = incomingData[key];
    if (!(typeof currentValue === "string" && currentValue.trim()) && typeof incomingValue === "string" && incomingValue.trim()) {
      data[key] = incomingValue;
    }
  }
  for (const key of ["highlights", "outcomes", "tools"]) {
    const currentValues = arrayOfText(currentData[key]);
    const incomingValues = arrayOfText(incomingData[key]);
    if (currentValues.length === 0 && incomingValues.length > 0) data[key] = incomingValues;
    else if (currentValues.length > 0 && incomingValues.length > 0) data[key] = uniqueText([...currentValues, ...incomingValues]);
  }
  return ProfileStructuredFactSchema.parse({
    ...current,
    data,
    factIds: uniqueText([...current.factIds, ...incoming.factIds]),
    sourceBlockIds: uniqueText([...current.sourceBlockIds, ...incoming.sourceBlockIds]),
    sourceRanges: [...current.sourceRanges, ...incoming.sourceRanges],
    mappingTrace: [...current.mappingTrace, ...incoming.mappingTrace],
    provenance: [...(current.provenance ?? []), ...(incoming.provenance ?? [])]
  });
}

function arrayOfText(value: unknown) {
  return Array.isArray(value) ? value.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0) : [];
}

function normalizeIdentity(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/[\s\-_/.,，。；;:：()（）]+/gu, "").toLocaleLowerCase()
    : "";
}

function uniqueText(values: string[]) {
  return [...new Set(values)];
}
