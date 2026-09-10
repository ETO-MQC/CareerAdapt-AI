import { nanoid } from "nanoid";
import { migrateCareerProfileToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { CareerProfileSchema, type CareerProfile, type CareerProfileV2, type Experience, type FactCategory, type FactStatement, type ProfileStructuredFact, type ResumeItemV2, type Skill, type Certificate } from "@/domain/schemas";

/**
 * The Profile write boundary keeps the v2 structured projection, the legacy
 * editor mirrors, and the confirmed fact ledger moving together.  A missing
 * reference is a data-integrity failure, not a reason for branch generation to
 * silently omit an item.
 */
export class ProfileFactReferenceIntegrityError extends Error {
  readonly code = "profile_fact_reference_unresolved";
  readonly factIds: string[];

  constructor(factIds: string[], message = "Profile contains an unresolved or unconfirmed structured fact reference.") {
    super(message);
    this.name = "ProfileFactReferenceIntegrityError";
    this.factIds = [...new Set(factIds)];
  }
}

/**
 * Normalize a Profile immediately before persistence.  `previousProfile` is
 * used only for deletion-aware mirror cleanup; v2 structuredFacts remains the
 * canonical set and is never rebuilt from legacy data during a normal read.
 */
export function synchronizeProfileStructuredFacts(
  nextProfile: CareerProfile,
  previousProfile?: CareerProfile
): CareerProfileV2 {
  const source = migrateCareerProfileToV2(CareerProfileSchema.parse(nextProfile));
  const previous = previousProfile ? migrateCareerProfileToV2(CareerProfileSchema.parse(previousProfile)) : undefined;
  const deletionAware = removeDeletedMirrors(source, previous);
  const structuredFacts = deletionAware.structuredFacts.map(cloneStructuredFact);
  const experiences = [...deletionAware.experiences];
  const skills = [...deletionAware.skills];
  const certificates = [...deletionAware.certificates];
  const confirmedFacts = collectConfirmedFacts(experiences, skills, certificates);
  const now = source.updatedAt;

  for (const entry of structuredFacts) {
    if (entry.data.sectionType === "summary") continue;

    const projectedText = projectResumeItemV2(entry.data).trim();
    if (!projectedText) {
      throw new ProfileFactReferenceIntegrityError([], `Profile item ${entry.data.id} has no confirmed factual content.`);
    }

    let factIds = [...entry.factIds];
    if (factIds.length > 0) {
      const unresolved = factIds.filter((factId) => {
        const fact = confirmedFacts.get(factId);
        return !fact || !isConfirmedFact(fact);
      });
      if (unresolved.length > 0) throw new ProfileFactReferenceIntegrityError(unresolved, `Profile item ${entry.data.id} contains unresolved or unconfirmed fact references: ${unresolved.join(", ")}.`);
    } else {
      factIds = existingFactIdsForEntry(entry.data, experiences, skills, certificates);
      if (factIds.length === 0) {
        const fact = createUserConfirmedFact(entry.data, projectedText, now);
        factIds = [fact.id];
        addFactMirror(entry.data, fact, experiences, skills, certificates, now, projectedText);
        confirmedFacts.set(fact.id, fact);
      }
    }

    synchronizeFactMirror(entry.data, factIds, projectedText, experiences, skills, certificates, now);
    entry.factIds = factIds;
  }

  return migrateCareerProfileToV2(CareerProfileSchema.parse({
    ...source,
    schemaVersion: "career-profile-v2",
    structuredBasics: {
      ...source.structuredBasics,
      name: source.basics.name,
      headline: source.basics.headline,
      phone: source.basics.phone,
      email: source.basics.email,
      location: source.basics.location,
      summary: source.basics.summary,
      otherLinks: source.basics.links
    },
    experiences,
    skills,
    certificates,
    structuredFacts
  }));
}

/** Fail-closed assertion for branch/composition callers that already have a normalized Profile. */
export function assertProfileFactReferenceIntegrity(profile: CareerProfile) {
  const canonical = migrateCareerProfileToV2(CareerProfileSchema.parse(profile));
  const confirmedFacts = collectConfirmedFacts(canonical.experiences, canonical.skills, canonical.certificates);
  const unresolved = canonical.structuredFacts
    .filter((entry) => entry.data.sectionType !== "summary")
    .flatMap((entry) => entry.factIds)
    .filter((factId) => {
      const fact = confirmedFacts.get(factId);
      return !fact || !isConfirmedFact(fact);
    });
  if (unresolved.length > 0) throw new ProfileFactReferenceIntegrityError(unresolved);
}

function removeDeletedMirrors(profile: ReturnType<typeof migrateCareerProfileToV2>, previous?: ReturnType<typeof migrateCareerProfileToV2>) {
  if (!previous) return profile;
  const currentIds = new Set(profile.structuredFacts.map((entry) => entry.data.id));
  const deletedIds = new Set(previous.structuredFacts
    .filter((entry) => !currentIds.has(entry.data.id))
    .map((entry) => entry.data.id));
  const deletedFactIds = new Set(previous.structuredFacts
    .filter((entry) => !currentIds.has(entry.data.id))
    .flatMap((entry) => entry.factIds));
  const isDeletedMirror = (id: string, factIds: string[]) =>
    deletedIds.has(id) || factIds.some((factId) => deletedFactIds.has(factId));
  return {
    ...profile,
    experiences: profile.experiences.filter((item) => !isDeletedMirror(item.id, item.facts.map((fact) => fact.id))),
    skills: profile.skills.filter((item) => !isDeletedMirror(item.id, item.fact ? [item.fact.id] : [])),
    certificates: profile.certificates.filter((item) => !isDeletedMirror(item.id, item.fact ? [item.fact.id] : []))
  };
}

function cloneStructuredFact(entry: ProfileStructuredFact): ProfileStructuredFact {
  return {
    ...entry,
    factIds: [...entry.factIds],
    sourceBlockIds: [...entry.sourceBlockIds],
    sourceRanges: [...entry.sourceRanges],
    mappingTrace: [...entry.mappingTrace],
    ...(entry.provenance ? { provenance: [...entry.provenance] } : {})
  };
}

function collectConfirmedFacts(
  experiences: Experience[],
  skills: Skill[],
  certificates: Certificate[]
) {
  const facts = new Map<string, FactStatement>();
  experiences.flatMap((experience) => experience.facts).forEach((fact) => facts.set(fact.id, fact));
  skills.flatMap((skill) => skill.fact ? [skill.fact] : []).forEach((fact) => facts.set(fact.id, fact));
  certificates.flatMap((certificate) => certificate.fact ? [certificate.fact] : []).forEach((fact) => facts.set(fact.id, fact));
  return facts;
}

function existingFactIdsForEntry(
  data: ResumeItemV2,
  experiences: Experience[],
  skills: Skill[],
  certificates: Certificate[]
) {
  if (isSkillSection(data.sectionType)) {
    const skill = skills.find((candidate) => candidate.id === data.id);
    return skill?.fact && isConfirmedFact(skill.fact) ? [skill.fact.id] : [];
  }
  if (data.sectionType === "certificates") {
    const certificate = certificates.find((candidate) => candidate.id === data.id);
    return certificate?.fact && isConfirmedFact(certificate.fact) ? [certificate.fact.id] : [];
  }
  const experience = experiences.find((candidate) => candidate.id === data.id);
  return experience?.facts.filter(isConfirmedFact).map((fact) => fact.id) ?? [];
}

function createUserConfirmedFact(data: ResumeItemV2, statement: string, now: string): FactStatement {
  const sourceId = `profile:${data.id}`;
  return {
    id: `fact-profile-${nanoid(10)}`,
    statement,
    category: factCategoryForSection(data.sectionType),
    provenance: [{
      sourceType: "user_input",
      sourceId,
      sourceText: statement,
      confidence: 1,
      confirmedByUser: true,
      riskLevel: "low",
      createdAt: now
    }],
    confirmedByUser: true,
    riskLevel: "low",
    maturity: data.sectionType === "skills" || data.sectionType === "languages"
      ? "confirmed_capability"
      : "demonstrated",
    createdAt: now,
    updatedAt: now
  };
}

function addFactMirror(
  data: ResumeItemV2,
  fact: FactStatement,
  experiences: Experience[],
  skills: Skill[],
  certificates: Certificate[],
  now: string,
  projectedText: string
) {
  if (isSkillItem(data)) {
    skills.push({
      id: data.id,
      name: data.sectionType === "skills" ? data.name : data.language,
      ...(data.sectionType === "skills" && legacySkillLevel(data.level) ? { level: legacySkillLevel(data.level) } : {}),
      evidenceIds: [],
      fact,
      createdAt: now,
      updatedAt: now
    });
    return;
  }
  if (data.sectionType === "certificates") {
    certificates.push({
      id: data.id,
      name: data.name,
      issuer: data.issuer,
      issuedAt: data.issuedAt,
      evidenceIds: [],
      fact,
      createdAt: now,
      updatedAt: now
    });
    return;
  }
  experiences.push(experienceMirrorFromStructured(data, fact, now, projectedText));
}

function synchronizeFactMirror(
  data: ResumeItemV2,
  factIds: string[],
  projectedText: string,
  experiences: Experience[],
  skills: Skill[],
  certificates: Certificate[],
  now: string
) {
  if (isSkillItem(data)) {
    const indexById = skills.findIndex((candidate) => candidate.id === data.id);
    const index = indexById >= 0
      ? indexById
      : skills.findIndex((candidate) => Boolean(candidate.fact && factIds.includes(candidate.fact.id)));
    if (index < 0) throw new ProfileFactReferenceIntegrityError(factIds, `Profile skill ${data.id} has no fact owner.`);
    // An imported combined skill item can legitimately point at several
    // split skill facts. Its display name must not overwrite the first
    // split mirror with the unsplit source string.
    if (indexById < 0 && factIds.length !== 1) return;
    const current = skills[index];
    skills[index] = {
      ...current,
      name: data.sectionType === "skills" ? data.name : data.language,
      ...(data.sectionType === "skills" && legacySkillLevel(data.level) ? { level: legacySkillLevel(data.level) } : {}),
      updatedAt: now
    };
    return;
  }
  if (data.sectionType === "certificates") {
    const indexById = certificates.findIndex((candidate) => candidate.id === data.id);
    const index = indexById >= 0
      ? indexById
      : certificates.findIndex((candidate) => Boolean(candidate.fact && factIds.includes(candidate.fact.id)));
    if (index < 0) throw new ProfileFactReferenceIntegrityError(factIds, `Profile certificate ${data.id} has no fact owner.`);
    const current = certificates[index];
    certificates[index] = {
      ...current,
      name: data.name,
      issuer: data.issuer,
      issuedAt: data.issuedAt,
      updatedAt: now
    };
    return;
  }

  const indexById = experiences.findIndex((candidate) => candidate.id === data.id);
  const index = indexById >= 0
    ? indexById
    : experiences.findIndex((candidate) => candidate.facts.some((fact) => factIds.includes(fact.id)));
  if (index < 0) throw new ProfileFactReferenceIntegrityError(factIds, `Profile experience ${data.id} has no fact owner.`);
  const current = experiences[index];
  const fields = experienceFieldsFromStructured(data, current);
  experiences[index] = {
    ...current,
    organization: fields.organization ?? current.organization,
    role: fields.role ?? current.role,
    location: fields.location,
    degree: fields.degree,
    major: fields.major,
    courses: fields.courses,
    startDate: fields.startDate,
    endDate: fields.endDate,
    resumeDrafts: upsertResumeDraft(current.resumeDrafts, factIds, projectedText, now),
    updatedAt: now
  };
}

function experienceMirrorFromStructured(data: ResumeItemV2, fact: FactStatement, now: string, projectedText: string): Experience {
  const fields = experienceFieldsFromStructured(data);
  return {
    id: data.id,
    type: experienceTypeForSection(data.sectionType),
    organization: fields.organization ?? sectionLabel(data.sectionType),
    role: fields.role ?? sectionLabel(data.sectionType),
    location: fields.location,
    degree: fields.degree,
    major: fields.major,
    courses: fields.courses,
    startDate: fields.startDate,
    endDate: fields.endDate,
    facts: [fact],
    resumeDrafts: [{
      id: `draft-profile-${nanoid(10)}`,
      text: projectedText,
      factIds: [fact.id],
      createdAt: now,
      updatedAt: now
    }],
    tags: [data.sectionType],
    evidenceIds: [],
    createdAt: now,
    updatedAt: now
  };
}

function experienceFieldsFromStructured(data: ResumeItemV2, current?: Experience) {
  const record = data as unknown as Record<string, unknown>;
  const text = (key: string) => typeof record[key] === "string" && String(record[key]).trim() ? String(record[key]).trim() : undefined;
  const list = (key: string) => Array.isArray(record[key]) ? record[key].filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : undefined;
  return {
    organization: text(data.sectionType === "education" ? "school" : data.sectionType === "project" ? "organization" : data.sectionType === "research" ? "institution" : "organization")
      ?? (data.sectionType === "project" ? text("title") : undefined)
      ?? current?.organization,
    role: text(data.sectionType === "education" ? "degree" : data.sectionType === "project" ? "role" : data.sectionType === "awards" ? "name" : data.sectionType === "research" ? "authorRole" : "role") ?? current?.role,
    location: text("location") ?? current?.location,
    degree: text("degree") ?? current?.degree,
    major: text("major") ?? current?.major,
    courses: list("courses") ?? current?.courses,
    startDate: text("startDate") ?? current?.startDate,
    endDate: text("endDate") ?? ("current" in data && data.current ? undefined : current?.endDate)
  };
}

function upsertResumeDraft(
  drafts: Experience["resumeDrafts"],
  factIds: string[],
  text: string,
  now: string
) {
  const index = drafts.findIndex((draft) => draft.factIds.some((factId) => factIds.includes(factId)));
  if (index < 0) return [...drafts, { id: `draft-profile-${nanoid(10)}`, text, factIds: [...factIds], createdAt: now, updatedAt: now }];
  return drafts.map((draft, draftIndex) => draftIndex === index ? { ...draft, text, factIds: [...new Set([...draft.factIds, ...factIds])], updatedAt: now } : draft);
}

function isSkillSection(sectionType: ResumeItemV2["sectionType"]): sectionType is "skills" | "languages" {
  return sectionType === "skills" || sectionType === "languages";
}

function isSkillItem(data: ResumeItemV2): data is Extract<ResumeItemV2, { sectionType: "skills" | "languages" }> {
  return isSkillSection(data.sectionType);
}

function factCategoryForSection(sectionType: ResumeItemV2["sectionType"]): FactCategory {
  if (sectionType === "education") return "education";
  if (isSkillSection(sectionType)) return sectionType === "languages" ? "language" : "skill";
  if (sectionType === "certificates") return "certificate";
  if (sectionType === "awards") return "achievement";
  if (sectionType === "summary") return "other";
  return "experience";
}

function experienceTypeForSection(sectionType: ResumeItemV2["sectionType"]): Experience["type"] {
  if (sectionType === "education") return "education";
  if (sectionType === "internship") return "internship";
  if (sectionType === "project") return "project";
  if (sectionType === "campus") return "campus";
  if (sectionType === "volunteer") return "volunteer";
  if (sectionType === "work") return "work";
  if (sectionType === "awards") return "competition";
  return "other";
}

function sectionLabel(sectionType: ResumeItemV2["sectionType"]) {
  if (sectionType === "education") return "教育经历";
  if (sectionType === "internship") return "实习经历";
  if (sectionType === "project") return "项目经历";
  if (sectionType === "research") return "研究经历";
  if (sectionType === "campus") return "校园经历";
  if (sectionType === "volunteer") return "志愿经历";
  if (sectionType === "work") return "工作经历";
  if (sectionType === "awards") return "获奖经历";
  return "其他经历";
}

function legacySkillLevel(value: string | undefined): Skill["level"] | undefined {
  return value === "basic" || value === "familiar" || value === "proficient" ? value : undefined;
}

function isConfirmedFact(fact: FactStatement) {
  // Confirmation is the Profile write invariant. Risk remains an independent
  // resume/Fact Guard concern; a user-confirmed low-confidence fact may stay
  // high-risk and must still be excluded by downstream guarded composition.
  return fact.confirmedByUser && fact.provenance.some((source) => source.confirmedByUser);
}
