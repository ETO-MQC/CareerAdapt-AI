import { migrateCareerProfileToV2, migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";
import type { CareerProfile, ResumeBranch } from "@/domain/schemas";

export type ProfileSyncDirection = "profile_to_resume" | "resume_to_profile";

export type SyncFieldPresence = {
  basics: boolean;
  description: boolean;
  highlights: boolean;
  outcomes: boolean;
  tools: boolean;
  evidenceRefs: boolean;
};

export type SyncContentCounts = {
  basicFields: number;
  careerItems: number;
  descriptions: number;
  highlights: number;
  outcomes: number;
  tools: number;
  evidenceRefs: number;
};

type SyncSideSnapshot = {
  fieldPresence: SyncFieldPresence;
  contentCounts: SyncContentCounts;
};

export type ProfileSyncDiagnostics = {
  direction: ProfileSyncDirection;
  sourceId: string;
  targetId: string;
  sourceRevision: number;
  targetRevision: number;
  fieldPresenceBefore: {
    source: SyncFieldPresence;
    target: SyncFieldPresence;
  };
  fieldPresenceAfter: {
    source: SyncFieldPresence;
    target: SyncFieldPresence;
  };
  changedFields: string[];
  contentCountsBefore: {
    source: SyncContentCounts;
    target: SyncContentCounts;
  };
  contentCountsAfter: {
    source: SyncContentCounts;
    target: SyncContentCounts;
  };
  readbackVerified: boolean;
};

export function buildProfileSyncDiagnostics(input: {
  direction: ProfileSyncDirection;
  sourceBefore: CareerProfile | ResumeBranch;
  targetBefore: CareerProfile | ResumeBranch;
  sourceAfter: CareerProfile | ResumeBranch;
  targetAfter: CareerProfile | ResumeBranch;
  sourceId: string;
  targetId: string;
  sourceRevision: number;
  targetRevision: number;
  readbackVerified: boolean;
}): ProfileSyncDiagnostics {
  const sourceBefore = snapshotSyncSide(input.sourceBefore);
  const targetBefore = snapshotSyncSide(input.targetBefore);
  const sourceAfter = snapshotSyncSide(input.sourceAfter);
  const targetAfter = snapshotSyncSide(input.targetAfter);
  return {
    direction: input.direction,
    sourceId: input.sourceId,
    targetId: input.targetId,
    sourceRevision: input.sourceRevision,
    targetRevision: input.targetRevision,
    fieldPresenceBefore: {
      source: sourceBefore.fieldPresence,
      target: targetBefore.fieldPresence
    },
    fieldPresenceAfter: {
      source: sourceAfter.fieldPresence,
      target: targetAfter.fieldPresence
    },
    changedFields: changedFieldNames(sourceBefore, targetBefore, sourceAfter, targetAfter),
    contentCountsBefore: {
      source: sourceBefore.contentCounts,
      target: targetBefore.contentCounts
    },
    contentCountsAfter: {
      source: sourceAfter.contentCounts,
      target: targetAfter.contentCounts
    },
    readbackVerified: input.readbackVerified
  };
}

function snapshotSyncSide(entity: CareerProfile | ResumeBranch): SyncSideSnapshot {
  if (isProfile(entity)) return profileSnapshot(entity);
  return resumeSnapshot(entity);
}

function profileSnapshot(profile: CareerProfile): SyncSideSnapshot {
  const canonical = migrateCareerProfileToV2(profile);
  const items = canonical.structuredFacts ?? [];
  const evidenceRefs = new Set<string>(canonical.evidences.map((evidence) => evidence.id));
  for (const experience of canonical.experiences) {
    for (const evidenceId of experience.evidenceIds) evidenceRefs.add(evidenceId);
  }
  for (const skill of canonical.skills) {
    for (const evidenceId of skill.evidenceIds) evidenceRefs.add(evidenceId);
  }
  for (const certificate of canonical.certificates) {
    for (const evidenceId of certificate.evidenceIds) evidenceRefs.add(evidenceId);
  }
  for (const item of items) {
    for (const sourceBlockId of item.sourceBlockIds) evidenceRefs.add(sourceBlockId);
    for (const factId of item.factIds) evidenceRefs.add(factId);
  }
  const basicFields = [
    canonical.basics.name,
    canonical.basics.headline,
    canonical.basics.phone,
    canonical.basics.email,
    canonical.basics.location,
    canonical.basics.summary,
    ...canonical.basics.links
  ].filter((value) => typeof value === "string" && value.trim().length > 0).length;
  const counts = countItems(items.map((item) => item.data), basicFields, evidenceRefs.size);
  return {
    fieldPresence: presenceFromCounts(counts),
    contentCounts: counts
  };
}

function resumeSnapshot(branch: ResumeBranch): SyncSideSnapshot {
  const canonical = migrateResumeBranchToV2(branch);
  const items = canonical.structuredContentItems ?? [];
  const evidenceRefs = new Set<string>();
  for (const item of canonical.contentItems) {
    for (const reference of item.factRefs) {
      for (const value of Object.values(reference)) {
        if (typeof value === "string" && value !== reference.type) evidenceRefs.add(value);
      }
    }
  }
  const resumeBasics = canonical.resumeBasics;
  const basicFields = resumeBasics
    ? [
        resumeBasics.name,
        resumeBasics.email,
        resumeBasics.phone,
        resumeBasics.location,
        resumeBasics.summary,
        ...resumeBasics.links
      ].filter((value) => typeof value === "string" && value.trim().length > 0).length
    : 0;
  const counts = countItems(items.map((item) => item.data), basicFields, evidenceRefs.size);
  return {
    fieldPresence: presenceFromCounts(counts),
    contentCounts: counts
  };
}

function countItems(
  items: Array<Record<string, unknown>>,
  basicFields: number,
  evidenceRefs: number
): SyncContentCounts {
  let descriptions = 0;
  let highlights = 0;
  let outcomes = 0;
  let tools = 0;
  for (const item of items) {
    if (typeof item.description === "string" && item.description.trim()) descriptions += 1;
    if (item.sectionType === "summary" && typeof item.text === "string" && item.text.trim()) descriptions += 1;
    highlights += textListLength(item.highlights);
    outcomes += textListLength(item.outcomes);
    tools += textListLength(item.tools);
  }
  return {
    basicFields,
    careerItems: items.length,
    descriptions,
    highlights,
    outcomes,
    tools,
    evidenceRefs
  };
}

function presenceFromCounts(counts: SyncContentCounts): SyncFieldPresence {
  return {
    basics: counts.basicFields > 0,
    description: counts.descriptions > 0,
    highlights: counts.highlights > 0,
    outcomes: counts.outcomes > 0,
    tools: counts.tools > 0,
    evidenceRefs: counts.evidenceRefs > 0
  };
}

function changedFieldNames(
  sourceBefore: SyncSideSnapshot,
  targetBefore: SyncSideSnapshot,
  sourceAfter: SyncSideSnapshot,
  targetAfter: SyncSideSnapshot
) {
  const changed: string[] = [];
  for (const side of ["source", "target"] as const) {
    const before = side === "source" ? sourceBefore : targetBefore;
    const after = side === "source" ? sourceAfter : targetAfter;
    for (const field of ["basics", "description", "highlights", "outcomes", "tools", "evidenceRefs"] as const) {
      if (before.fieldPresence[field] !== after.fieldPresence[field]) changed.push(`${side}.${field}`);
      else if (before.contentCounts[fieldCountKey(field)] !== after.contentCounts[fieldCountKey(field)]) changed.push(`${side}.${field}`);
    }
  }
  return changed;
}

function fieldCountKey(field: keyof SyncFieldPresence): keyof SyncContentCounts {
  if (field === "description") return "descriptions";
  if (field === "highlights") return "highlights";
  if (field === "outcomes") return "outcomes";
  if (field === "tools") return "tools";
  if (field === "evidenceRefs") return "evidenceRefs";
  return "basicFields";
}

function textListLength(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).length
    : 0;
}

function isProfile(entity: CareerProfile | ResumeBranch): entity is CareerProfile {
  return "basics" in entity;
}
