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
};

export type ProfileRecoveryCandidate = {
  id: string;
  sourceType: ProfileRecoverySourceType;
  sourceId: string;
  sourceLabel: string;
  items: ProfileRecoveryItem[];
  affectedEntityCount: number;
  candidateBulletCount: number;
  conflictCount: number;
  unchangedItemCount: number;
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
    const importedItems = importedRecoveryItems(importedProfile);
    if (importedItems.length > 0) {
      candidates.push(makeCandidate({
        sourceType: "imported_resume_draft",
        sourceId: input.importedDraft.importId,
        sourceLabel: "ImportedResumeDraft（已确认）",
        items: importedItems,
        profile: input.profile
      }));
    }
    // A V2 draft already contains the normalized ResumeSourceDocument blocks.
    // Keep the source priority visible without creating a second data path;
    // the selected candidate still reads the confirmed draft projection.
    if (input.importedDraft.schemaVersion === "resume-import-v2" && importedItems.length > 0) {
      candidates.push(makeCandidate({
        sourceType: "resume_source_document",
        sourceId: input.importedDraft.source.fileHash,
        sourceLabel: "ResumeSourceDocument（由已确认导入派生）",
        items: importedItems,
        profile: input.profile
      }));
    }
  }

  const confirmedItems = confirmedProvenanceItems(input.profile);
  if (confirmedItems.length > 0) {
    candidates.push(makeCandidate({
      sourceType: "confirmed_provenance",
      sourceId: input.profile.id,
      sourceLabel: "已确认 provenance / evidence",
      items: confirmedItems,
      profile: input.profile
    }));
  }

  if (input.generalResume) {
    const generalItems = generalResumeRecoveryItems(input.generalResume);
    if (generalItems.length > 0) {
      candidates.push(makeCandidate({
        sourceType: "general_resume",
        sourceId: input.generalResume.id,
        sourceLabel: "通用简历（仅在无更强来源时）",
        items: generalItems,
        profile: input.profile
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
    sourceLabel: candidate.sourceLabel,
    affectedEntityCount: candidate.affectedEntityCount,
    candidateBulletCount: candidate.candidateBulletCount,
    conflictCount: candidate.conflictCount,
    unchangedItemCount: candidate.unchangedItemCount
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
  for (const item of input.items) {
    const incoming = ProfileStructuredFactSchema.parse(item.structuredFact);
    const current = byId.get(incoming.data.id);
    byId.set(incoming.data.id, current ? mergeStructuredFact(current, incoming) : incoming);
  }

  const factsById = new Map<string, FactStatement>();
  source.experiences.flatMap((experience) => experience.facts).forEach((fact) => factsById.set(fact.id, fact));
  source.skills.flatMap((skill) => skill.fact ? [skill.fact] : []).forEach((fact) => factsById.set(fact.id, fact));
  source.certificates.flatMap((certificate) => certificate.fact ? [certificate.fact] : []).forEach((fact) => factsById.set(fact.id, fact));

  const experiences = [...source.experiences];
  const skills = [...source.skills];
  const certificates = [...source.certificates];
  for (const item of input.items) {
    item.facts.forEach((fact) => factsById.set(fact.id, fact));
    if (item.experience && !experiences.some((candidate) => candidate.id === item.experience?.id)) experiences.push(item.experience);
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

function isConfirmedDraftForProfile(draft: ImportedResumeDraft, profileId: string) {
  return draft.status === "confirmed"
    && (!draft.confirmedProfileId || draft.confirmedProfileId === profileId)
    && draft.sections.some((section) => section.included && section.items.some((item) => item.included));
}

function importedRecoveryItems(profile: CareerProfile): ProfileRecoveryItem[] {
  const canonical = migrateCareerProfileToV2(profile);
  const factsById = new Map<string, FactStatement>();
  canonical.experiences.flatMap((experience) => experience.facts).forEach((fact) => factsById.set(fact.id, fact));
  canonical.skills.flatMap((skill) => skill.fact ? [skill.fact] : []).forEach((fact) => factsById.set(fact.id, fact));
  canonical.certificates.flatMap((certificate) => certificate.fact ? [certificate.fact] : []).forEach((fact) => factsById.set(fact.id, fact));
  return canonical.structuredFacts
    .filter((entry) => recoverableSections.has(entry.data.sectionType))
    .map((entry) => ({
      structuredFact: entry,
      facts: entry.factIds.flatMap((id) => factsById.get(id) ? [factsById.get(id)!] : []),
      experience: canonical.experiences.find((experience) => experience.facts.some((fact) => entry.factIds.includes(fact.id))),
      skill: canonical.skills.find((skill) => skill.fact && entry.factIds.includes(skill.fact.id)),
      certificate: canonical.certificates.find((certificate) => certificate.fact && entry.factIds.includes(certificate.fact.id))
    }));
}

function confirmedProvenanceItems(profile: CareerProfile): ProfileRecoveryItem[] {
  const canonical = migrateCareerProfileToV2(profile);
  return canonical.structuredFacts
    .filter((entry) => recoverableSections.has(entry.data.sectionType))
    .filter((entry) => Boolean(entry.sourceBlockIds.length || entry.provenance?.length))
    .map((entry) => ({ structuredFact: entry, facts: [] }));
}

function generalResumeRecoveryItems(branch: ResumeBranch): ProfileRecoveryItem[] {
  const canonical = migrateResumeBranchToV2(branch);
  return (canonical.structuredContentItems ?? [])
    .filter((item) => recoverableSections.has(item.data.sectionType))
    .map((item) => ({
      structuredFact: ProfileStructuredFactSchema.parse({
        data: item.data,
        factIds: branchFactIds(item.factRefs),
        sourceBlockIds: [],
        sourceRanges: [],
        mappingTrace: [],
        ...(item.legacyTextProjection ? { sourceExcerpt: item.legacyTextProjection } : {})
      }),
      facts: []
    }));
}

function branchFactIds(factRefs: Array<Record<string, unknown>>) {
  return [...new Set(factRefs.flatMap((ref) => Object.entries(ref)
    .filter(([key, value]) => key.toLowerCase().includes("fact") && typeof value === "string")
    .map(([, value]) => value as string)))];
}

function makeCandidate(input: {
  sourceType: ProfileRecoverySourceType;
  sourceId: string;
  sourceLabel: string;
  items: ProfileRecoveryItem[];
  profile: CareerProfile;
}): ProfileRecoveryCandidate {
  const existing = new Map(migrateCareerProfileToV2(input.profile).structuredFacts.map((entry) => [entry.data.id, entry]));
  let affectedEntityCount = 0;
  let conflictCount = 0;
  let unchangedItemCount = 0;
  for (const item of input.items) {
    const current = existing.get(item.structuredFact.data.id);
    if (!current) {
      affectedEntityCount += 1;
      continue;
    }
    if (JSON.stringify(current.data) === JSON.stringify(item.structuredFact.data)) {
      unchangedItemCount += 1;
    } else {
      affectedEntityCount += 1;
      conflictCount += 1;
    }
  }
  const candidateBulletCount = input.items.reduce((total, item) => {
    const data = item.structuredFact.data;
    const record = data as Record<string, unknown>;
    return total
      + arrayOfText(record.highlights).length
      + (data.sectionType === "project" ? arrayOfText(record.outcomes).length : 0);
  }, 0);
  return {
    id: `profile-recovery-${stableHashText(`${input.sourceType}:${input.sourceId}`)}`,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceLabel: input.sourceLabel,
    items: input.items,
    affectedEntityCount,
    candidateBulletCount,
    conflictCount,
    unchangedItemCount
  };
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

function uniqueText(values: string[]) {
  return [...new Set(values)];
}
