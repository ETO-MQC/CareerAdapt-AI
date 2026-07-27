import { nanoid } from "nanoid";
import {
  ProfileReconciliationPlanSchema,
  type CareerProfile,
  type FactProvenance,
  type FactStatement,
  type ImportedResumeDraft,
  type ImportedResumeField,
  type ImportedResumeItem,
  type ImportedResumeSection,
  type ProfileReconciliationCandidate,
  type ProfileReconciliationDecision,
  type ProfileReconciliationFieldRelation,
  type ProfileReconciliationPlan,
  type ResumeItemV2
} from "@/domain/schemas";
import { locatePdfSourceQuote } from "@/domain/pdfImport/sourceMapping";

type ExistingCandidate = {
  entityType: ProfileReconciliationCandidate["entityType"];
  entityId?: string;
  structuredItemId?: string;
  factIds: string[];
  facts: FactStatement[];
  factStatements: string[];
  normalizedFields: Record<string, string>;
  canonicalKey: string;
};

const AUTHORITATIVE_FIELDS = new Set([
  "name", "email", "phone", "organization", "role", "school", "degree", "major",
  "title", "institution", "issuer", "credentialId", "startDate", "endDate",
  "awardedAt", "issuedAt", "score", "gpa", "rank", "url"
]);

const CONFLICT_RESOLUTIONS = [
  "keep_existing",
  "use_imported",
  "keep_both_as_distinct",
  "edit_value",
  "defer"
] as const;

export class ProfileReconciliationEngine {
  createPlan(input: {
    draft: ImportedResumeDraft;
    profile: CareerProfile;
    now?: string;
  }): ProfileReconciliationPlan {
    const now = input.now ?? new Date().toISOString();
    const candidates = collectIncomingCandidates(input.draft, now);
    const existing = collectExistingCandidates(input.profile);
    const decisions: ProfileReconciliationDecision[] = [];
    const conflicts: ProfileReconciliationPlan["conflicts"] = [];

    for (const candidate of candidates) {
      const evaluated = evaluateCandidate(candidate, existing);
      decisions.push(evaluated.decision);
      if (evaluated.conflict) conflicts.push(evaluated.conflict);
    }

    const reviewUnits = decisions.flatMap((decision) => {
      if (!decision.requiresUserConfirmation) return [];
      const kind = decision.state === "conflict" ? "conflict" as const : "likely_duplicate" as const;
      return [{
        id: `review-unit-${decision.incomingItemId}`,
        incomingItemId: decision.incomingItemId,
        kind,
        conflictId: decision.conflictId,
        resolved: false
      }];
    });
    const summary = summarize(decisions, input.draft.unclassifiedBlocks.length, reviewUnits.length);

    return ProfileReconciliationPlanSchema.parse({
      id: `profile-reconciliation-${nanoid(10)}`,
      schemaVersion: "profile-reconciliation-v1",
      importId: input.draft.importId,
      draftRevision: input.draft.revision,
      profileId: input.profile.id,
      profileVersion: input.profile.version,
      revision: 0,
      status: reviewUnits.length ? "needs_review" : "ready",
      sourceFileHash: input.draft.source.fileHash,
      sourceContentHash: input.draft.source.normalizedTextHash,
      candidates,
      decisions,
      conflicts,
      reviewUnits,
      summary,
      createdAt: now,
      updatedAt: now
    });
  }

  resolve(input: {
    plan: ProfileReconciliationPlan;
    incomingItemId: string;
    resolution: "keep_existing" | "use_imported" | "keep_both_as_distinct" | "edit_value" | "defer";
    editedValue?: string;
    now?: string;
  }): ProfileReconciliationPlan {
    const decision = input.plan.decisions.find((item) => item.incomingItemId === input.incomingItemId);
    if (!decision?.requiresUserConfirmation) throw new Error("profile_reconciliation_decision_not_reviewable");
    if (input.resolution === "edit_value" && !input.editedValue?.trim()) {
      throw new Error("profile_reconciliation_edited_value_required");
    }
    const resolved = input.resolution !== "defer";
    const decisions = input.plan.decisions.map((item) => item.incomingItemId !== input.incomingItemId
      ? item
      : {
          ...item,
          state: input.resolution === "keep_both_as_distinct" ? "keep_separate" as const : item.state,
          reasonCode: input.resolution === "keep_both_as_distinct" ? "user_keep_separate" as const : item.reasonCode,
          resolution: input.resolution,
          editedValue: input.resolution === "edit_value" ? input.editedValue?.trim() : undefined
        });
    const conflicts = input.plan.conflicts.map((conflict) => conflict.incomingItemId !== input.incomingItemId
      ? conflict
      : {
          ...conflict,
          resolution: input.resolution,
          editedValue: input.resolution === "edit_value" ? input.editedValue?.trim() : undefined
        });
    const reviewUnits = input.plan.reviewUnits.map((unit) => unit.incomingItemId === input.incomingItemId
      ? { ...unit, resolved }
      : unit);
    const unresolved = reviewUnits.filter((unit) => !unit.resolved).length;
    return ProfileReconciliationPlanSchema.parse({
      ...input.plan,
      revision: input.plan.revision + 1,
      status: unresolved ? "needs_review" : "resolved",
      decisions,
      conflicts,
      reviewUnits,
      summary: summarize(decisions, input.plan.summary.unclassified, unresolved),
      updatedAt: input.now ?? new Date().toISOString()
    });
  }
}

function collectIncomingCandidates(draft: ImportedResumeDraft, now: string) {
  const candidates: ProfileReconciliationCandidate[] = [];
  const basicEntries: Array<[string, ImportedResumeField | undefined]> = [
    ["name", draft.basics.name],
    ["email", draft.basics.email],
    ["phone", draft.basics.phone],
    ["location", draft.basics.location],
    ["summary", draft.basics.summary],
    ...draft.basics.links.map((link, index) => [`link:${index}`, link] as [string, ImportedResumeField])
  ];
  for (const [field, value] of basicEntries) {
    if (!value?.value.trim()) continue;
    const normalizedFields = { field: field.split(":")[0], value: normalizeField(field, value.value) };
    candidates.push({
      incomingItemId: `basic:${field}`,
      sourceItemId: `basic:${field}`,
      entityType: "basic",
      displayLabel: value.value,
      canonicalKey: `basic:${normalizedFields.field}:${normalizedFields.value}`,
      normalizedFields,
      factStatements: [value.value],
      sourceBlockIds: value.sourceBlockIds,
      sourceProvenance: [provenanceForField(draft, value, now)]
    });
  }

  for (const section of draft.sections.filter((value) => value.included)) {
    for (const item of section.items.filter((value) => value.included)) {
      if (sectionCategory(section) === "skills") {
        const names = splitSkillNames(item.structuredItem?.sectionType === "skills"
          ? item.structuredItem.name
          : item.normalizedText);
        for (const [index, name] of names.entries()) {
          const normalizedFields = { name: normalizeSkillName(name) };
          candidates.push({
            incomingItemId: `${item.id}:skill:${index}:${normalizedFields.name}`,
            sourceItemId: item.id,
            entityType: "skills",
            displayLabel: name,
            canonicalKey: `skills:${normalizedFields.name}`,
            normalizedFields,
            factStatements: [name],
            sourceBlockIds: item.sourceBlockIds,
            sourceProvenance: [provenanceForItem(draft, item, now)]
          });
        }
        continue;
      }
      const entityType = item.structuredItem?.sectionType ?? sectionCategory(section);
      const normalizedFields = item.structuredItem
        ? normalizedItemFields(item.structuredItem)
        : legacyItemFields(section, item);
      candidates.push({
        incomingItemId: item.id,
        sourceItemId: item.id,
        entityType,
        displayLabel: item.structuredItem
          ? displayIdentity(item.structuredItem)
          : item.normalizedText.split(/\r?\n/)[0] || item.normalizedText,
        canonicalKey: canonicalKey(entityType, normalizedFields),
        normalizedFields,
        factStatements: item.structuredItem
          ? itemFactStatements(item.structuredItem)
          : [item.normalizedText],
        sourceBlockIds: item.sourceBlockIds,
        sourceProvenance: [provenanceForItem(draft, item, now)]
      });
    }
  }
  return candidates;
}

function collectExistingCandidates(profile: CareerProfile): ExistingCandidate[] {
  const result: ExistingCandidate[] = [];
  const factIndex = new Map<string, { entityId: string; fact: FactStatement }>();
  for (const experience of profile.experiences) {
    for (const fact of experience.facts) factIndex.set(fact.id, { entityId: experience.id, fact });
  }
  for (const skill of profile.skills) {
    if (skill.fact) factIndex.set(skill.fact.id, { entityId: skill.id, fact: skill.fact });
  }
  for (const certificate of profile.certificates) {
    if (certificate.fact) factIndex.set(certificate.fact.id, { entityId: certificate.id, fact: certificate.fact });
  }

  for (const entry of profile.structuredFacts ?? []) {
    const normalizedFields = normalizedItemFields(entry.data);
    const indexedFacts = entry.factIds.flatMap((id) => factIndex.get(id) ? [factIndex.get(id)!] : []);
    result.push({
      entityType: entry.data.sectionType,
      entityId: indexedFacts[0]?.entityId,
      structuredItemId: entry.data.id,
      factIds: entry.factIds,
      facts: indexedFacts.map((value) => value.fact),
      factStatements: Array.from(new Set([
        ...indexedFacts.map((value) => value.fact.statement),
        ...itemFactStatements(entry.data)
      ])),
      normalizedFields,
      canonicalKey: canonicalKey(entry.data.sectionType, normalizedFields)
    });
  }

  const representedEntities = new Set(result.flatMap((item) => item.entityId ? [item.entityId] : []));
  for (const experience of profile.experiences.filter((item) => !representedEntities.has(item.id))) {
    const entityType = experience.type === "competition" ? "awards" : experience.type === "other" ? "other" : experience.type;
    const normalizedFields = compactFields({
      organization: normalizeText(experience.organization),
      role: normalizeText(experience.role),
      location: normalizeText(experience.location),
      degree: normalizeText(experience.degree),
      major: normalizeText(experience.major),
      startDate: normalizeDate(experience.startDate),
      endDate: normalizeDate(experience.endDate)
    });
    result.push({
      entityType,
      entityId: experience.id,
      factIds: experience.facts.map((fact) => fact.id),
      facts: experience.facts,
      factStatements: experience.facts.map((fact) => fact.statement),
      normalizedFields,
      canonicalKey: canonicalKey(entityType, normalizedFields)
    });
  }
  for (const skill of profile.skills) {
    const normalizedFields = { name: normalizeSkillName(skill.name) };
    result.push({
      entityType: skill.fact?.category === "language" ? "languages" : "skills",
      entityId: skill.id,
      factIds: skill.fact ? [skill.fact.id] : [],
      facts: skill.fact ? [skill.fact] : [],
      factStatements: skill.fact ? [skill.fact.statement] : [skill.name],
      normalizedFields,
      canonicalKey: canonicalKey("skills", normalizedFields)
    });
  }
  for (const certificate of profile.certificates.filter((item) => !representedEntities.has(item.id))) {
    const normalizedFields = compactFields({
      name: normalizeText(certificate.name),
      issuer: normalizeText(certificate.issuer),
      issuedAt: normalizeDate(certificate.issuedAt)
    });
    result.push({
      entityType: "certificates",
      entityId: certificate.id,
      factIds: certificate.fact ? [certificate.fact.id] : [],
      facts: certificate.fact ? [certificate.fact] : [],
      factStatements: certificate.fact ? [certificate.fact.statement] : [certificate.name],
      normalizedFields,
      canonicalKey: canonicalKey("certificates", normalizedFields)
    });
  }

  for (const [field, value] of Object.entries({
    name: profile.basics.name,
    email: profile.basics.email,
    phone: profile.basics.phone,
    location: profile.basics.location,
    summary: profile.basics.summary
  })) {
    if (!value) continue;
    const normalizedFields = { field, value: normalizeField(field, value) };
    result.push({
      entityType: "basic",
      entityId: `basic:${field}`,
      factIds: [],
      facts: [],
      factStatements: [value],
      normalizedFields,
      canonicalKey: `basic:${field}:${normalizedFields.value}`
    });
  }
  for (const link of profile.basics.links) {
    const normalizedFields = { field: "link", value: normalizeUrl(link) };
    result.push({
      entityType: "basic",
      entityId: "basic:link",
      factIds: [],
      facts: [],
      factStatements: [link],
      normalizedFields,
      canonicalKey: `basic:link:${normalizedFields.value}`
    });
  }
  return result;
}

function evaluateCandidate(
  incoming: ProfileReconciliationCandidate,
  existing: ExistingCandidate[]
): {
  decision: ProfileReconciliationDecision;
  conflict?: ProfileReconciliationPlan["conflicts"][number];
} {
  const sameType = existing.filter((item) => item.entityType === incoming.entityType);
  const exact = sameType.find((item) => item.canonicalKey === incoming.canonicalKey)
    ?? sameType.find((item) => identityFields(incoming.entityType, incoming.normalizedFields)
      .every((field) => Boolean(incoming.normalizedFields[field])
        && incoming.normalizedFields[field] === item.normalizedFields[field]));
  if (exact) {
    const comparisons = compareFields(exact.normalizedFields, incoming.normalizedFields);
    const conflicts = comparisons.filter((item) => item.relation === "conflicting");
    if (conflicts.length) {
      const conflictId = `reconciliation-conflict-${incoming.incomingItemId}`;
      return {
        decision: {
          ...decision(incoming, exact, "conflict", 1,
            "authoritative_field_conflict", comparisons, true),
          conflictId
        },
        conflict: {
          id: conflictId,
          incomingItemId: incoming.incomingItemId,
          existingEntityId: exact.entityId ?? exact.structuredItemId ?? "unknown",
          fields: conflicts,
          supportedResolutions: [...CONFLICT_RESOLUTIONS]
        }
      };
    }
    const hasCompatibleEnrichment = comparisons.some((item) => item.relation === "missing_existing");
    const newFacts = incoming.factStatements.filter((statement) =>
      !exact.factStatements.some((existingStatement) => normalizeFact(statement) === normalizeFact(existingStatement))
    );
    const alreadyRepresented = incoming.sourceProvenance.every((provenance) =>
      exact.facts.some((fact) => fact.provenance.some((value) => sameProvenance(value, provenance)))
    );
    const state = newFacts.length > 0 || hasCompatibleEnrichment
      ? "compatible_update"
      : alreadyRepresented
        ? "exact_duplicate"
        : "evidence_extension";
    return {
      decision: decision(incoming, exact, state, state === "compatible_update" ? 0.96 : 1,
        state === "compatible_update"
          ? "structured_identity_match"
          : alreadyRepresented ? "same_source_already_represented" : "same_fact_new_evidence",
        comparisons, false)
    };
  }

  if (incoming.entityType === "basic") {
    const field = incoming.normalizedFields.field;
    const sameField = sameType.find((item) => item.normalizedFields.field === field);
    if (sameField && field !== "link") {
      const authoritative = field !== "summary";
      const comparison = {
        field,
        existingValue: sameField.factStatements[0],
        incomingValue: incoming.factStatements[0],
        relation: authoritative ? "conflicting" as const : "different" as const,
        authoritative
      };
      if (authoritative) {
        const conflictId = `reconciliation-conflict-${incoming.incomingItemId}`;
        return {
          decision: {
            ...decision(incoming, sameField, "conflict", 1, "authoritative_field_conflict", [comparison], true),
            conflictId
          },
          conflict: {
            id: conflictId,
            incomingItemId: incoming.incomingItemId,
            existingEntityId: sameField.entityId ?? `basic:${field}`,
            fields: [comparison],
            supportedResolutions: [...CONFLICT_RESOLUTIONS]
          }
        };
      }
      return {
        decision: decision(incoming, sameField, "likely_duplicate", 0.85,
          "near_identity_match", [comparison], true)
      };
    }
  }

  const compatible = sameType
    .map((item) => ({ item, comparisons: compareFields(item.normalizedFields, incoming.normalizedFields) }))
    .filter(({ comparisons }) => hasStableIdentity(incoming.entityType, comparisons))
    .sort((left, right) => comparisonScore(right.comparisons) - comparisonScore(left.comparisons))[0];
  if (compatible) {
    const conflicts = compatible.comparisons.filter((item) => item.relation === "conflicting");
    if (conflicts.length) {
      const conflictId = `reconciliation-conflict-${incoming.incomingItemId}`;
      const base = decision(incoming, compatible.item, "conflict", 0.98,
        "authoritative_field_conflict", compatible.comparisons, true);
      return {
        decision: { ...base, conflictId },
        conflict: {
          id: conflictId,
          incomingItemId: incoming.incomingItemId,
          existingEntityId: compatible.item.entityId ?? compatible.item.structuredItemId ?? "basic",
          fields: conflicts,
          supportedResolutions: [...CONFLICT_RESOLUTIONS]
        }
      };
    }
    return {
      decision: decision(incoming, compatible.item, "compatible_update", 0.94,
        "compatible_missing_fields", compatible.comparisons, false)
    };
  }

  const closest = sameType
    .map((item) => ({ item, similarity: identitySimilarity(incoming, item) }))
    .sort((left, right) => right.similarity - left.similarity)[0];
  const hasMateriallyDifferentDates = closest
    ? compareFields(closest.item.normalizedFields, incoming.normalizedFields)
      .some((item) => ["startDate", "endDate"].includes(item.field) && item.relation === "conflicting")
    : false;
  if (closest && closest.similarity >= 0.72 && !hasMateriallyDifferentDates) {
    return {
      decision: decision(incoming, closest.item, "likely_duplicate", closest.similarity,
        "near_identity_match", compareFields(closest.item.normalizedFields, incoming.normalizedFields), true)
    };
  }
  return {
    decision: {
      incomingItemId: incoming.incomingItemId,
      state: "new_fact",
      existingFactIds: [],
      confidence: 1,
      reasonCode: "no_safe_match",
      fieldComparisons: [],
      sourceProvenance: incoming.sourceProvenance,
      requiresUserConfirmation: false
    }
  };
}

function decision(
  incoming: ProfileReconciliationCandidate,
  existing: ExistingCandidate,
  state: ProfileReconciliationDecision["state"],
  confidence: number,
  reasonCode: ProfileReconciliationDecision["reasonCode"],
  fieldComparisons: ProfileReconciliationDecision["fieldComparisons"],
  requiresUserConfirmation: boolean
): ProfileReconciliationDecision {
  return {
    incomingItemId: incoming.incomingItemId,
    state,
    existingEntityId: existing.entityId,
    existingStructuredItemId: existing.structuredItemId,
    existingFactIds: existing.factIds,
    confidence: round(confidence),
    reasonCode,
    fieldComparisons,
    sourceProvenance: incoming.sourceProvenance,
    requiresUserConfirmation
  };
}

function normalizedItemFields(item: ResumeItemV2): Record<string, string> {
  switch (item.sectionType) {
    case "summary": return compactFields({ text: normalizeText(item.text) });
    case "education": return compactFields({
      school: normalizeText(item.school), degree: normalizeText(item.degree), major: normalizeText(item.major),
      location: normalizeText(item.location), startDate: normalizeDate(item.startDate), endDate: normalizeDate(item.endDate),
      gpa: numberText(item.gpa), rank: item.rankPosition ? `${item.rankPosition}/${item.rankTotal ?? ""}` : ""
    });
    case "work":
    case "internship":
    case "campus":
    case "volunteer":
      return compactFields({
        organization: normalizeText(item.organization), role: normalizeText(item.role), location: normalizeText(item.location),
        startDate: normalizeDate(item.startDate), endDate: normalizeDate(item.endDate)
      });
    case "project": return compactFields({
      title: normalizeTitle(item.title), organization: normalizeText(item.organization), role: normalizeText(item.role),
      url: normalizeUrl(item.url), startDate: normalizeDate(item.startDate), endDate: normalizeDate(item.endDate)
    });
    case "research": return compactFields({
      title: normalizeTitle(item.title), institution: normalizeText(item.institution), authorRole: normalizeText(item.authorRole),
      url: normalizeUrl(item.url), startDate: normalizeDate(item.startDate), endDate: normalizeDate(item.endDate)
    });
    case "awards": return compactFields({
      name: normalizeTitle(item.name), issuer: normalizeText(item.issuer), awardedAt: normalizeDate(item.awardedAt), rank: normalizeText(item.rank)
    });
    case "certificates": return compactFields({
      credentialId: normalizeCredential(item.credentialId), name: normalizeTitle(item.name),
      issuer: normalizeText(item.issuer), issuedAt: normalizeDate(item.issuedAt)
    });
    case "languages": return compactFields({
      language: normalizeLanguage(item.language), testName: normalizeText(item.testName), score: normalizeText(item.score)
    });
    case "skills": return { name: normalizeSkillName(item.name) };
    case "publications": return compactFields({ title: normalizeTitle(item.title), doi: normalizeCredential(item.doi), url: normalizeUrl(item.url), publishedAt: normalizeDate(item.publishedAt) });
    case "patents": return compactFields({ title: normalizeTitle(item.title), patentNumber: normalizeCredential(item.patentNumber), filedAt: normalizeDate(item.filedAt), grantedAt: normalizeDate(item.grantedAt) });
    case "portfolio": return compactFields({ title: normalizeTitle(item.title), url: normalizeUrl(item.url), role: normalizeText(item.role), createdAt: normalizeDate(item.createdAt) });
    case "other":
    case "custom": return compactFields({ title: normalizeTitle(item.title), description: normalizeFact(item.description ?? "") });
  }
}

function itemFactStatements(item: ResumeItemV2) {
  if (item.sectionType === "summary") return [item.text];
  if (item.sectionType === "skills") return [item.name];
  if (item.sectionType === "languages") return [item.description ?? [item.language, item.testName, item.score].filter(Boolean).join(" ")];
  if (item.sectionType === "awards" || item.sectionType === "certificates") {
    return [item.description ?? [item.name, item.issuer].filter(Boolean).join(" ")];
  }
  const values = [
    "description" in item ? item.description : undefined,
    "highlights" in item ? item.highlights : [],
    item.sectionType === "project" ? item.outcomes : []
  ].flat().filter((value): value is string => Boolean(value?.trim()));
  return values.length ? values : [displayIdentity(item)];
}

function canonicalKey(
  entityType: ProfileReconciliationCandidate["entityType"],
  fields: Record<string, string>
) {
  const identity = identityFields(entityType, fields);
  return `${entityType}:${identity.map((field) => `${field}=${fields[field] ?? ""}`).join("|")}`;
}

function identityFields(
  entityType: ProfileReconciliationCandidate["entityType"],
  fields: Record<string, string>
) {
  switch (entityType) {
    case "basic": return ["field", "value"];
    case "education": return ["school", "degree", "major", "startDate", "endDate"];
    case "work":
    case "internship":
    case "campus":
    case "volunteer": return ["organization", "role", "startDate", "endDate"];
    case "project": return fields.url ? ["url", "title", "organization", "startDate", "endDate"] : ["title", "organization", "startDate", "endDate"];
    case "research": return ["title", "institution", "startDate", "endDate"];
    case "awards": return ["name", "issuer", "awardedAt"];
    case "certificates": return fields.credentialId ? ["credentialId"] : ["name", "issuer", "issuedAt"];
    case "languages": return ["language", "testName"];
    case "skills": return ["name"];
    case "publications": return fields.doi ? ["doi"] : ["title", "publishedAt"];
    case "patents": return fields.patentNumber ? ["patentNumber"] : ["title", "filedAt"];
    case "portfolio": return fields.url ? ["url"] : ["title", "createdAt"];
    default: return ["title", "description"];
  }
}

function compareFields(existing: Record<string, string>, incoming: Record<string, string>) {
  const keys = Array.from(new Set([...Object.keys(existing), ...Object.keys(incoming)]));
  return keys.map((field) => {
    const existingValue = existing[field];
    const incomingValue = incoming[field];
    let relation: ProfileReconciliationFieldRelation;
    if (!existingValue && incomingValue) relation = "missing_existing";
    else if (existingValue && !incomingValue) relation = "missing_incoming";
    else if (existingValue === incomingValue) relation = "equal";
    else if (equivalentValue(existingValue, incomingValue)) relation = "equivalent";
    else relation = AUTHORITATIVE_FIELDS.has(field) ? "conflicting" : "different";
    return {
      field,
      existingValue: existingValue || undefined,
      incomingValue: incomingValue || undefined,
      relation,
      authoritative: AUTHORITATIVE_FIELDS.has(field)
    };
  });
}

function hasStableIdentity(
  entityType: ProfileReconciliationCandidate["entityType"],
  comparisons: ProfileReconciliationDecision["fieldComparisons"]
) {
  const identity = new Set(identityFields(entityType, Object.fromEntries(comparisons.map((item) => [item.field, item.incomingValue ?? item.existingValue ?? ""]))));
  const stable = comparisons.filter((item) => identity.has(item.field) && item.existingValue && item.incomingValue);
  const core = stable.filter((item) => !["startDate", "endDate", "awardedAt", "issuedAt", "publishedAt", "filedAt", "grantedAt", "createdAt"].includes(item.field));
  return core.length > 0 && core.every((item) => item.relation === "equal" || item.relation === "equivalent");
}

function comparisonScore(comparisons: ProfileReconciliationDecision["fieldComparisons"]) {
  if (!comparisons.length) return 0;
  return comparisons.reduce((sum, item) =>
    sum + (item.relation === "equal" ? 1 : item.relation === "equivalent" ? 0.9 : item.relation.startsWith("missing") ? 0.6 : 0)
  , 0) / comparisons.length;
}

function identitySimilarity(incoming: ProfileReconciliationCandidate, existing: ExistingCandidate) {
  const fields = identityFields(incoming.entityType, incoming.normalizedFields)
    .filter((field) => !["startDate", "endDate", "awardedAt", "issuedAt"].includes(field));
  const scores = fields.flatMap((field) => {
    const left = incoming.normalizedFields[field];
    const right = existing.normalizedFields[field];
    return left && right ? [stringSimilarity(left, right)] : [];
  });
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
}

function provenanceForField(draft: ImportedResumeDraft, field: ImportedResumeField, now: string): FactProvenance {
  return provenance(draft, field.value, field.pageRefs[0]?.quote ?? field.value, field.pageRefs[0]?.pageNumber ?? 1, now);
}

function provenanceForItem(draft: ImportedResumeDraft, item: ImportedResumeItem, now: string): FactProvenance {
  const page = item.pageRefs[0];
  return provenance(draft, item.normalizedText, page?.quote ?? item.rawText, page?.pageNumber ?? 1, now);
}

function provenance(
  draft: ImportedResumeDraft,
  sourceText: string,
  sourceQuote: string,
  pageNumber: number,
  now: string
): FactProvenance {
  if (draft.source.mimeType !== "application/pdf") {
    return {
      sourceType: "imported_text",
      sourceId: draft.source.fileHash,
      sourceText,
      confidence: 0.9,
      confirmedByUser: true,
      riskLevel: "medium",
      createdAt: now,
      fileName: draft.source.fileName,
      sourceQuote
    };
  }
  const pages = draft.pages.map((page) => ({
    pageNumber: page.pageNumber,
    cleanedPageText: page.normalizedText,
    charStart: page.charStart ?? 0,
    charEnd: page.charEnd ?? page.normalizedText.length
  }));
  const located = locatePdfSourceQuote(sourceQuote, pages);
  if (located.status !== "located") throw new Error("profile_reconciliation_source_quote_unlocated");
  return {
    sourceType: "pdf_import",
    sourceId: draft.source.fileHash,
    sourceText: sourceQuote,
    confidence: 0.9,
    confirmedByUser: true,
    riskLevel: "low",
    createdAt: now,
    sourceSessionId: draft.source.sourceSessionId,
    fileName: draft.source.fileName,
    pageNumber: located.locator.pageNumber,
    pageRange: { startPage: located.locator.pageNumber, endPage: located.locator.pageNumber },
    sourceQuote,
    sourceLocatorStatus: "located",
    sourceLocator: located.locator
  };
}

function sameProvenance(left: FactProvenance, right: FactProvenance) {
  return left.sourceType === right.sourceType
    && left.sourceId === right.sourceId
    && normalizeText(left.fileName) === normalizeText(right.fileName)
    && normalizeFact(left.sourceQuote ?? left.sourceText) === normalizeFact(right.sourceQuote ?? right.sourceText)
    && left.pageNumber === right.pageNumber;
}

function legacyItemFields(section: ImportedResumeSection, item: ImportedResumeItem) {
  const lines = item.normalizedText.split(/\n+/).map((value) => value.trim()).filter(Boolean);
  return compactFields({
    title: normalizeTitle(lines[0]),
    organization: normalizeText(lines[0]),
    description: normalizeFact(item.normalizedText),
    section: normalizeText(section.detectedTitle)
  });
}

function sectionCategory(section: ImportedResumeSection): ProfileReconciliationCandidate["entityType"] {
  if (section.sectionType !== "experience" && section.sectionType !== "unknown") return section.sectionType;
  const category = section.category;
  if (category === "skill") return "skills";
  if (category === "certificate") return "certificates";
  if (category === "award") return "awards";
  if (category === "language") return "languages";
  if (category === "education" || category === "work"
    || category === "project" || category === "campus") return category;
  return "other";
}

function splitSkillNames(value: string) {
  return Array.from(new Set(value
    .split(/[，,、;；|\n/]+/)
    .map((item) => item.trim().replace(/^[-*•·●▪]\s*/, ""))
    .filter(Boolean)));
}

function normalizeSkillName(value: string) {
  const normalized = normalizeText(value).replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    js: "javascript",
    javascriptjs: "javascript",
    ts: "typescript",
    typescriptlang: "typescript",
    py: "python",
    structuredquerylanguage: "sql"
  };
  return aliases[normalized] ?? normalized;
}

function normalizeLanguage(value: string) {
  const normalized = normalizeText(value).replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    english: "英语", chinese: "中文", mandarin: "普通话", japanese: "日语"
  };
  return aliases[normalized] ?? normalized;
}

function normalizeField(field: string, value: string) {
  if (field.startsWith("email")) return value.trim().toLowerCase();
  if (field.startsWith("phone")) return value.replace(/[^\d+]/g, "");
  if (field.startsWith("link")) return normalizeUrl(value);
  return normalizeText(value);
}

function normalizeText(value?: string) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[，、；：｜]/g, (character) => ({ "，": ",", "、": ",", "；": ";", "：": ":", "｜": "|" })[character] ?? character)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(value?: string) {
  return normalizeText(value).replace(/[\s\p{P}]+/gu, "");
}

function normalizeFact(value: string) {
  return normalizeText(value).replace(/[\s\p{P}]+/gu, "");
}

function normalizeCredential(value?: string) {
  return normalizeText(value).replace(/[\s-]+/g, "");
}

function normalizeDate(value?: string) {
  const normalized = normalizeText(value)
    .replace(/[年/.]/g, "-")
    .replace(/月|日/g, "")
    .replace(/至今|present|current/g, "present");
  const match = normalized.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!match) return normalized;
  return [match[1], match[2]?.padStart(2, "0"), match[3]?.padStart(2, "0")].filter(Boolean).join("-");
}

function normalizeUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    url.hash = "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}${path}${url.search}`;
  } catch {
    return normalizeText(value).replace(/\/+$/, "");
  }
}

function equivalentValue(left?: string, right?: string) {
  if (!left || !right) return false;
  return normalizeText(left).replace(/\s+/g, "") === normalizeText(right).replace(/\s+/g, "");
}

function stringSimilarity(left: string, right: string) {
  if (left === right) return 1;
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((value) => b.has(value)).length;
  return (2 * overlap) / (a.size + b.size);
}

function bigrams(value: string) {
  const normalized = normalizeTitle(value);
  return new Set(Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2)));
}

function compactFields(fields: Record<string, string>) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => Boolean(value)));
}

function displayIdentity(item: ResumeItemV2) {
  if (item.sectionType === "education") return [item.school, item.degree, item.major].filter(Boolean).join(" ");
  if (item.sectionType === "project" || item.sectionType === "research" || item.sectionType === "portfolio"
    || item.sectionType === "publications" || item.sectionType === "patents") return item.title ?? item.sectionType;
  if ("organization" in item) return [item.organization, item.role].filter(Boolean).join(" ");
  if ("name" in item) return item.name;
  return "description" in item ? item.description ?? item.sectionType : item.sectionType;
}

function numberText(value?: number) {
  return value === undefined ? "" : String(value);
}

function summarize(
  decisions: ProfileReconciliationDecision[],
  unclassified: number,
  requiresReview: number
) {
  return {
    newFacts: decisions.filter((item) => item.state === "new_fact" || item.state === "keep_separate").length,
    existing: decisions.filter((item) => item.state === "exact_duplicate").length,
    mergedEvidence: decisions.filter((item) => item.state === "evidence_extension").length,
    compatibleUpdates: decisions.filter((item) => item.state === "compatible_update").length,
    likelyDuplicates: decisions.filter((item) => item.state === "likely_duplicate").length,
    conflicts: decisions.filter((item) => item.state === "conflict").length,
    unclassified,
    requiresReview
  };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
