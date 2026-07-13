import { nanoid } from "nanoid";
import {
  BranchContentItemSchema,
  ResumeBranchSchema,
  type BranchContentItem,
  type CareerProfile,
  type ResumeBranch,
  type ResumeBranchBasics,
  type ResumeRevision
} from "@/domain/schemas";
import { createResumeRevision } from "./revision";
import { parseStructuredExperienceText, serializeStructuredExperienceText, type ResumeFieldCategoryId } from "@/domain/resumeFields/catalog";

export type ProfileBranchBuildResult = {
  branch: ResumeBranch;
  firstRevision: ResumeRevision;
};

export function resumeBasicsFromProfile(profile: CareerProfile): ResumeBranchBasics {
  return {
    name: profile.basics.name,
    email: profile.basics.email ?? "",
    phone: profile.basics.phone ?? "",
    location: profile.basics.location ?? "",
    summary: profile.basics.summary ?? "",
    links: profile.basics.links
  };
}

export function buildGeneralBranchFromProfile(input: {
  profile: CareerProfile;
  operationId: string;
  name: string;
  includeProfileFacts: boolean;
  includeProfileBasics: boolean;
  now?: string;
}): ProfileBranchBuildResult {
  const now = input.now ?? new Date().toISOString();
  const contentItems = input.includeProfileFacts
    ? profileContentItems(input.profile, now)
    : [];
  const safeContentItems = contentItems.length > 0
    ? contentItems
    : [structuralPlaceholder(now)];
  const sourceProfileSnapshotId = `profile-snapshot-${input.profile.id}-${input.profile.version}-${nanoid(6)}`;
  const branchBase = ResumeBranchSchema.parse({
    id: `branch-general-${nanoid(10)}`,
    branchPurpose: "general",
    profileId: input.profile.id,
    name: input.name.trim() || "未命名简历",
    sourceProfileVersion: input.profile.version,
    sourceProfileSnapshotId,
    sourceDraftRevision: 0,
    matcherVersion: "profile-snapshot-v1",
    sourceMatchSetHash: sourceProfileSnapshotId,
    requirementMatchIds: [],
    revision: 0,
    lifecycleStatus: "active",
    migrationStatus: "verified",
    syncStatusCache: {
      status: "in_sync",
      sourceProfileVersion: input.profile.version,
      currentProfileVersion: input.profile.version,
      invalidFactRefs: [],
      checkedAt: now,
      message: "General branch is in sync with its source profile."
    },
    resumeBasics: input.includeProfileBasics ? resumeBasicsFromProfile(input.profile) : {
      name: "",
      email: "",
      phone: "",
      location: "",
      summary: "",
      links: []
    },
    contentItems: safeContentItems,
    createdAt: now,
    updatedAt: now
  });
  const firstRevision = createResumeRevision({
    branch: branchBase,
    source: input.includeProfileBasics || input.includeProfileFacts ? "created_from_profile" : "created_blank",
    operationId: input.operationId,
    now
  });
  const branch = ResumeBranchSchema.parse({
    ...branchBase,
    currentRevisionId: firstRevision.id
  });
  return { branch, firstRevision };
}

function profileContentItems(profile: CareerProfile, now: string) {
  const items: BranchContentItem[] = [];
  for (const experience of profile.experiences) {
    for (const fact of experience.facts.filter(isConfirmedFact)) {
      const draft = experience.resumeDrafts.find((candidate) => candidate.factIds.includes(fact.id));
      const description = draft?.text.trim() || fact.statement.trim();
      const category: ResumeFieldCategoryId = experience.type === "education" ? "education"
        : experience.type === "project" ? "project"
          : experience.type === "campus" || experience.type === "volunteer" ? "campus" : "work";
      const parsedDraft = parseStructuredExperienceText(description);
      const text = serializeStructuredExperienceText({
        organization: experience.organization,
        role: experience.role,
        location: experience.location ?? parsedDraft.location,
        degree: experience.degree ?? (experience.type === "education" ? experience.role : ""),
        major: experience.major ?? parsedDraft.major,
        courses: (experience.courses ?? []).join("、") || parsedDraft.courses,
        startDate: experience.startDate ?? parsedDraft.startDate,
        endDate: experience.endDate ?? parsedDraft.endDate,
        current: Boolean(experience.startDate && !experience.endDate),
        description: parsedDraft.organization ? parsedDraft.description : description
      }, category);
      items.push(BranchContentItemSchema.parse({
        id: `branch-item-profile-${experience.id}-${fact.id}`,
        itemType: "experience",
        source: "user_manual",
        sourceSectionId: experienceSection(experience.type),
        text,
        originalText: text,
        order: items.length,
        visible: true,
        requirementIds: [],
        sourceSuggestionIds: [],
        factRefs: [{ type: "experience_fact", experienceId: experience.id, factId: fact.id }],
        guardMode: "rule_verified",
        guardStatus: "pass",
        guardRiskLevel: fact.riskLevel,
        guardFindings: [],
        guardedAt: now,
        guardVersion: "profile-snapshot-v1"
      }));
    }
  }
  for (const skill of profile.skills) {
    if (!skill.fact || !isConfirmedFact(skill.fact)) continue;
    items.push(BranchContentItemSchema.parse({
      id: `branch-item-profile-${skill.id}-${skill.fact.id}`,
      itemType: "skill",
      source: "user_manual",
      sourceSectionId: "skills",
      text: skill.name,
      originalText: skill.name,
      order: items.length,
      visible: true,
      requirementIds: [],
      sourceSuggestionIds: [],
      factRefs: [{ type: "skill_fact", skillId: skill.id, factId: skill.fact.id }],
      guardMode: "rule_verified",
      guardStatus: "pass",
      guardRiskLevel: skill.fact.riskLevel,
      guardFindings: [],
      guardedAt: now,
      guardVersion: "profile-snapshot-v1"
    }));
  }
  for (const certificate of profile.certificates) {
    if (!certificate.fact || !isConfirmedFact(certificate.fact)) continue;
    items.push(BranchContentItemSchema.parse({
      id: `branch-item-profile-${certificate.id}-${certificate.fact.id}`,
      itemType: "certificate",
      source: "user_manual",
      sourceSectionId: "certificates",
      text: certificate.name,
      originalText: certificate.name,
      order: items.length,
      visible: true,
      requirementIds: [],
      sourceSuggestionIds: [],
      factRefs: [{ type: "certificate_fact", certificateId: certificate.id, factId: certificate.fact.id }],
      guardMode: "rule_verified",
      guardStatus: "pass",
      guardRiskLevel: certificate.fact.riskLevel,
      guardFindings: [],
      guardedAt: now,
      guardVersion: "profile-snapshot-v1"
    }));
  }
  return items;
}

function structuralPlaceholder(now: string): BranchContentItem {
  return BranchContentItemSchema.parse({
    id: `branch-item-structural-${nanoid(10)}`,
    itemType: "structural",
    source: "system_structural",
    sourceSectionId: "empty",
    text: "empty-resume-placeholder",
    originalText: "empty-resume-placeholder",
    order: 0,
    visible: false,
    requirementIds: [],
    sourceSuggestionIds: [],
    factRefs: [],
    guardMode: "not_fact",
    guardStatus: "pass",
    guardRiskLevel: "low",
    guardFindings: [],
    guardedAt: now,
    guardVersion: "profile-snapshot-v1"
  });
}

function isConfirmedFact(fact: CareerProfile["experiences"][number]["facts"][number]) {
  return fact.confirmedByUser
    && fact.riskLevel !== "high"
    && fact.provenance.some((source) => source.confirmedByUser);
}

function experienceSection(type: CareerProfile["experiences"][number]["type"]) {
  if (type === "education") return "education";
  if (type === "project" || type === "competition") return "projects";
  if (type === "campus" || type === "volunteer") return "campus";
  return "experience";
}
