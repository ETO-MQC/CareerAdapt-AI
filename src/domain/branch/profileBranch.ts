import { nanoid } from "nanoid";
import { BranchContentItemSchema, ResumeBranchSchema, ResumeContentItemV2Schema, type BranchContentItem, type BranchFactRef, type CareerProfile, type ResumeBranch, type ResumeBranchBasics, type ResumeItemV2, type ResumeRevision } from "@/domain/schemas";
import { migrateCareerProfileToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { stableHashText } from "@/services/security/text";
import { createResumeRevision } from "./revision";

export type ProfileBranchBuildResult = { branch: ResumeBranch; firstRevision: ResumeRevision };

export function resumeBasicsFromProfile(profile: CareerProfile): ResumeBranchBasics {
  return { name: profile.basics.name, targetRole: profile.structuredBasics?.targetRole ?? profile.structuredBasics?.headline ?? "", email: profile.basics.email ?? "", phone: profile.basics.phone ?? "", location: profile.basics.location ?? "", summary: profile.basics.summary ?? "", links: profile.basics.links };
}

export function buildGeneralBranchFromProfile(input: { profile: CareerProfile; operationId: string; name: string; includeProfileFacts: boolean; includeProfileBasics: boolean; now?: string }): ProfileBranchBuildResult {
  const now = input.now ?? new Date().toISOString();
  const pairs = input.includeProfileFacts ? profileContentItems(input.profile, now) : [];
  const contentItems = pairs.length ? pairs.map((pair) => pair.legacy) : [structuralPlaceholder(now)];
  const sourceProfileSnapshotId = `profile-snapshot-${input.profile.id}-${input.profile.version}-${nanoid(6)}`;
  const branchBase = ResumeBranchSchema.parse({
    id: `branch-general-${nanoid(10)}`, schemaVersion: pairs.length ? "resume-branch-v2" : undefined,
    branchPurpose: "general", profileId: input.profile.id, name: input.name.trim() || "未命名简历",
    sourceProfileVersion: input.profile.version, sourceProfileSnapshotId, sourceDraftRevision: 0,
    matcherVersion: "profile-snapshot-v2", sourceMatchSetHash: sourceProfileSnapshotId, requirementMatchIds: [], revision: 0,
    lifecycleStatus: "active", migrationStatus: "verified",
    syncStatusCache: { status: "in_sync", sourceProfileVersion: input.profile.version, currentProfileVersion: input.profile.version, invalidFactRefs: [], checkedAt: now, message: "General branch is in sync with its source profile." },
    resumeBasics: input.includeProfileBasics ? resumeBasicsFromProfile(input.profile) : { name: "", targetRole: "", email: "", phone: "", location: "", summary: "", links: [] },
    contentItems, structuredContentItems: pairs.length ? pairs.map((pair) => pair.structured) : undefined, createdAt: now, updatedAt: now
  });
  const firstRevision = createResumeRevision({ branch: branchBase, source: input.includeProfileBasics || input.includeProfileFacts ? "created_from_profile" : "created_blank", operationId: input.operationId, now });
  return { branch: ResumeBranchSchema.parse({ ...branchBase, currentRevisionId: firstRevision.id }), firstRevision };
}

export function buildJobBranchFromProfile(input: {
  profile: CareerProfile;
  jobId: string;
  jobTitle: string;
  jobVersion: string;
  operationId: string;
  name: string;
  selectedCanonicalItemIds: string[];
  requirementMatchIds: string[];
  sourceMatchSetHash: string;
  now?: string;
}): ProfileBranchBuildResult {
  const now = input.now ?? new Date().toISOString();
  const selected = new Set(input.selectedCanonicalItemIds);
  const pairs = profileContentItems(input.profile, now).filter((pair) => selected.has(pair.structured.data.id));
  if (pairs.length === 0) throw new Error("profile_library_selection_empty");
  const sourceProfileSnapshotId = `profile-snapshot-${input.profile.id}-${input.profile.version}-${stableHashText(input.selectedCanonicalItemIds.slice().sort().join(":"))}`;
  const branchBase = ResumeBranchSchema.parse({
    id: `branch-job-profile-${nanoid(10)}`,
    schemaVersion: "resume-branch-v2",
    branchPurpose: "job_specific",
    profileId: input.profile.id,
    jobId: input.jobId,
    name: input.name.trim() || input.jobTitle,
    sourceProfileVersion: input.profile.version,
    sourceProfileSnapshotId,
    sourceJobVersion: input.jobVersion,
    derivedAt: now,
    sourceDraftRevision: 0,
    matcherVersion: "job-source-mode.profile-library.v2",
    sourceMatchSetHash: input.sourceMatchSetHash,
    requirementMatchIds: input.requirementMatchIds,
    revision: 0,
    lifecycleStatus: "active",
    migrationStatus: "verified",
    syncStatusCache: {
      status: "in_sync",
      sourceProfileVersion: input.profile.version,
      currentProfileVersion: input.profile.version,
      sourceJobVersion: input.jobVersion,
      currentJobVersion: input.jobVersion,
      invalidFactRefs: [],
      checkedAt: now,
      message: "Job branch is in sync with its profile-library source and job version."
    },
    resumeBasics: { ...resumeBasicsFromProfile(input.profile), targetRole: input.jobTitle },
    contentItems: pairs.map((pair) => pair.legacy),
    structuredContentItems: pairs.map((pair) => pair.structured),
    createdAt: now,
    updatedAt: now
  });
  const firstRevision = createResumeRevision({ branch: branchBase, source: "created_from_profile", operationId: input.operationId, now });
  return { branch: ResumeBranchSchema.parse({ ...branchBase, currentRevisionId: firstRevision.id }), firstRevision };
}

function profileContentItems(profile: CareerProfile, now: string) {
  const facts = [...migrateCareerProfileToV2(profile).structuredFacts];
  const summary = profile.basics.summary?.trim();
  if (summary && !facts.some((entry) => entry.data.sectionType === "summary")) facts.unshift({ data: { id: `profile-summary-${profile.id}`, sectionType: "summary", text: summary, customFields: [] }, factIds: [], sourceBlockIds: [], sourceRanges: [], mappingTrace: [] });
  return facts.flatMap((entry, order) => {
    const factRefs = resolveProfileFactRefs(profile, entry.factIds);
    if (entry.data.sectionType !== "summary" && (!factRefs.length || factRefs.length !== entry.factIds.length)) return [];
    const text = projectResumeItemV2(entry.data);
    const id = `branch-item-profile-${entry.data.id}-${nanoid(6)}`;
    const legacy = BranchContentItemSchema.parse({ id, itemType: canonicalItemType(entry.data.sectionType), source: "user_manual", sourceSectionId: entry.data.sectionType, text, originalText: text, order, visible: true, requirementIds: [], sourceSuggestionIds: [], factRefs, guardMode: entry.data.sectionType === "summary" ? "not_fact" : "rule_verified", guardStatus: "pass", guardRiskLevel: profileFactRiskLevel(profile, entry.factIds), guardFindings: [], guardedAt: now, guardVersion: "profile-snapshot-v2", userConfirmation: entry.data.sectionType === "summary" ? { scope: "resume_only", confirmedTextHash: stableHashText(text), confirmedAt: now } : undefined });
    const structured = ResumeContentItemV2Schema.parse({ id, schemaVersion: "resume-content-item-v2", data: entry.data, factRefs, source: legacy.source, order, visible: true, guardMode: legacy.guardMode, guardStatus: legacy.guardStatus, guardFindings: [], userConfirmation: legacy.userConfirmation, legacyTextProjection: text, sourceBlockIds: entry.sourceBlockIds, sourceRanges: entry.sourceRanges, sourceExcerpt: entry.sourceExcerpt, mappingTrace: entry.mappingTrace });
    return [{ legacy, structured }];
  });
}

function canonicalItemType(sectionType: ResumeItemV2["sectionType"]): BranchContentItem["itemType"] {
  if (sectionType === "summary") return "summary";
  if (sectionType === "skills") return "skill";
  if (sectionType === "certificates") return "certificate";
  return ["education", "work", "internship", "project", "research", "campus", "volunteer"].includes(sectionType) ? "experience" : "custom";
}

function resolveProfileFactRefs(profile: CareerProfile, factIds: string[]): BranchFactRef[] {
  const refs: BranchFactRef[] = [];
  for (const factId of factIds) {
    const experience = profile.experiences.find((item) => item.facts.some((fact) => fact.id === factId && isConfirmedFact(fact)));
    if (experience) { refs.push({ type: "experience_fact", experienceId: experience.id, factId }); continue; }
    const skill = profile.skills.find((item) => item.fact?.id === factId && isConfirmedFact(item.fact));
    if (skill) { refs.push({ type: "skill_fact", skillId: skill.id, factId }); continue; }
    const certificate = profile.certificates.find((item) => item.fact?.id === factId && isConfirmedFact(item.fact));
    if (certificate) refs.push({ type: "certificate_fact", certificateId: certificate.id, factId });
  }
  return refs;
}

function profileFactRiskLevel(profile: CareerProfile, factIds: string[]) {
  const risks = factIds.flatMap((factId) => [...profile.experiences.flatMap((item) => item.facts.filter((fact) => fact.id === factId).map((fact) => fact.riskLevel)), ...profile.skills.filter((item) => item.fact?.id === factId).map((item) => item.fact!.riskLevel), ...profile.certificates.filter((item) => item.fact?.id === factId).map((item) => item.fact!.riskLevel)]);
  return risks.includes("high") ? "high" : risks.includes("medium") ? "medium" : "low";
}

function structuralPlaceholder(now: string): BranchContentItem {
  return BranchContentItemSchema.parse({ id: `branch-item-structural-${nanoid(10)}`, itemType: "structural", source: "system_structural", sourceSectionId: "empty", text: "empty-resume-placeholder", originalText: "empty-resume-placeholder", order: 0, visible: false, requirementIds: [], sourceSuggestionIds: [], factRefs: [], guardMode: "not_fact", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [], guardedAt: now, guardVersion: "profile-snapshot-v2" });
}

function isConfirmedFact(fact: CareerProfile["experiences"][number]["facts"][number]) {
  return fact.confirmedByUser && fact.riskLevel !== "high" && fact.provenance.some((source) => source.confirmedByUser);
}
