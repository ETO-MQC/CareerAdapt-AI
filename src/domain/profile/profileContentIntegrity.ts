import { migrateCareerProfileToV2, migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";
import type { CareerProfile, ResumeBranch, ResumeItemV2 } from "@/domain/schemas";
import type { CanonicalExperienceEditorDocument } from "./experienceContentAdapter";
import { appBuildTechnicalDiagnostics } from "@/services/diagnostics/appBuildInfo";

export type LiveProfileIntegrityStatus = "PASS" | "FAIL" | "NOT_APPLICABLE";

export type ProfileIntegrityClassification =
  | "repository_content_missing"
  | "adapter_projection_loss"
  | "form_hydration_loss"
  | "editor_hydration_loss"
  | "editor_rehydration_loss"
  | "no_integrity_issue";

export type LiveProfileProjection = {
  profileId: string;
  profileRevision: number;
  selectedItemId?: string;
  selectedSectionType?: ResumeItemV2["sectionType"];
  adapter: {
    paragraphCount: number;
    bulletCount: number;
  };
  form: {
    paragraphCount: number;
    bulletCount: number;
  };
  editor: {
    visibleParagraphCount: number;
    visibleBulletCount: number;
  };
  dirty: boolean;
  rehydrationIssue?: boolean;
  capturedAt: string;
};

export type LiveProfileContentIntegrity = {
  profileId: string;
  revision: number;
  repository: {
    projectCount: number;
    projectDescriptionCount: number;
    projectHighlightCount: number;
    workCount: number;
    workHighlightCount: number;
    internshipCount: number;
    internshipHighlightCount: number;
  };
  adapter: {
    paragraphCount: number;
    bulletCount: number;
  };
  form: {
    paragraphCount: number;
    bulletCount: number;
  };
  editor: {
    visibleParagraphCount: number;
    visibleBulletCount: number;
  };
  generalResume: {
    projectCount: number;
    projectHighlightCount: number;
    workHighlightCount: number;
  };
};

export type LiveProfileContentIntegrityResult = {
  status: LiveProfileIntegrityStatus;
  classification: ProfileIntegrityClassification;
  profileContentIntegrity: LiveProfileContentIntegrity;
  liveProjectionAvailable: boolean;
  generalResumeContentMissingFromRepository: boolean;
};

export type ProfileContentIntegrityCounts = {
  items: number;
  descriptions: number;
  descriptionParagraphs: number;
  highlights: number;
  outcomes: number;
  tools: number;
  evidenceRefs: number;
};

export type ProfileContentIntegrity = {
  profileId: string;
  revision: number;
  canonical: {
    projectCount: number;
    projectDescriptionNonEmpty: number;
    projectHighlightCount: number;
    projectOutcomeCount: number;
    projectToolCount: number;
    workCount: number;
    workDescriptionNonEmpty: number;
    workHighlightCount: number;
    workOutcomeCount: number;
    workToolCount: number;
    internshipCount: number;
    internshipDescriptionNonEmpty: number;
    internshipHighlightCount: number;
    internshipOutcomeCount: number;
    internshipToolCount: number;
  };
  editorProjection: {
    itemCount: number;
    paragraphCount: number;
    bulletCount: number;
    outcomeCount: number;
    toolCount: number;
  };
  renderedEditor: {
    visibleParagraphCount: number;
    visibleBulletCount: number;
    visibleOutcomeCount: number;
    visibleToolCount: number;
  };
  generalResume: {
    projectBulletCount: number;
    projectOutcomeCount: number;
    workBulletCount: number;
    workOutcomeCount: number;
    internshipBulletCount: number;
    internshipOutcomeCount: number;
  };
  appBuildCommit: string;
  appBuildTimestamp: string;
  careerToolContractVersion: string;
};

export function buildProfileContentIntegrity(input: {
  profile: CareerProfile;
  editorProjection?: CanonicalExperienceEditorDocument | CanonicalExperienceEditorDocument[];
  renderedEditorCounts?: Partial<{
    descriptionParagraphs: number;
    highlights: number;
    outcomes: number;
    tools: number;
  }>;
  generalResume?: ResumeBranch;
}): ProfileContentIntegrity {
  const editorDocuments = input.editorProjection
    ? Array.isArray(input.editorProjection) ? input.editorProjection : [input.editorProjection]
    : [];
  const projection = editorProjectionContentCounts(editorDocuments);
  const rendered = input.renderedEditorCounts ?? {};
  return {
    profileId: input.profile.id,
    revision: input.profile.version,
    canonical: canonicalExperienceCategoryCounts(input.profile),
    editorProjection: projection,
    renderedEditor: {
      visibleParagraphCount: rendered.descriptionParagraphs ?? 0,
      visibleBulletCount: (rendered.highlights ?? 0) + (rendered.outcomes ?? 0),
      visibleOutcomeCount: rendered.outcomes ?? 0,
      visibleToolCount: rendered.tools ?? projection.toolCount
    },
    generalResume: input.generalResume
      ? generalResumeCounts(input.generalResume)
      : emptyGeneralResumeCounts(),
    ...appBuildTechnicalDiagnostics
  };
}

export function canonicalProfileContentCounts(profile: CareerProfile): ProfileContentIntegrityCounts {
  const canonical = migrateCareerProfileToV2(profile);
  const evidenceRefs = new Set<string>();
  for (const entry of canonical.structuredFacts) {
    entry.factIds.forEach((id) => evidenceRefs.add(id));
    entry.sourceBlockIds.forEach((id) => evidenceRefs.add(id));
  }
  return contentCounts(canonical.structuredFacts.map((entry) => entry.data), evidenceRefs.size);
}

/**
 * Build the compact, text-free integrity payload used by the P4.5 closure
 * diagnostic.  The existing richer ProfileContentIntegrity payload remains
 * available for technical exports; this shape is intentionally stable and
 * safe to display in Settings.
 */
export function buildLiveProfileContentIntegrity(input: {
  profile: CareerProfile;
  generalResume?: ResumeBranch;
  liveProjection?: LiveProfileProjection;
}): LiveProfileContentIntegrityResult {
  const repository = repositoryIntegrityCounts(input.profile);
  const generalResume = generalResumeIntegrityCounts(input.generalResume);
  const adapter = input.liveProjection?.adapter ?? adapterIntegrityCounts(input.profile);
  const form = input.liveProjection?.form ?? emptyFormIntegrityCounts();
  const editor = input.liveProjection?.editor ?? emptyEditorIntegrityCounts();
  const generalResumeContentMissingFromRepository = generalResume.projectHighlightCount > repository.projectHighlightCount
    || generalResume.workHighlightCount > repository.workHighlightCount
    || generalResume.projectCount > repository.projectCount;
  const profileContentIntegrity: LiveProfileContentIntegrity = {
    profileId: input.profile.id,
    revision: input.profile.version,
    repository,
    adapter,
    form,
    editor,
    generalResume
  };

  let classification: ProfileIntegrityClassification = "no_integrity_issue";
  if (generalResumeContentMissingFromRepository) {
    classification = "repository_content_missing";
  } else if (input.liveProjection?.rehydrationIssue) {
    classification = "editor_rehydration_loss";
  } else if (input.liveProjection && repositoryHasSelectedContent(input.profile, input.liveProjection.selectedItemId)
    && adapter.bulletCount === 0 && adapter.paragraphCount === 0) {
    classification = "adapter_projection_loss";
  } else if (input.liveProjection && !input.liveProjection.dirty
    && adapter.bulletCount + adapter.paragraphCount > 0
    && form.bulletCount + form.paragraphCount === 0) {
    classification = "form_hydration_loss";
  } else if (input.liveProjection && !input.liveProjection.dirty
    && form.bulletCount + form.paragraphCount > 0
    && editor.visibleBulletCount + editor.visibleParagraphCount === 0) {
    classification = "editor_hydration_loss";
  }

  return {
    status: classification === "no_integrity_issue" ? "PASS" : "FAIL",
    classification,
    profileContentIntegrity,
    liveProjectionAvailable: Boolean(input.liveProjection),
    generalResumeContentMissingFromRepository
  };
}

export function repositoryIntegrityCounts(profile: CareerProfile): LiveProfileContentIntegrity["repository"] {
  const canonical = migrateCareerProfileToV2(profile);
  const counts: LiveProfileContentIntegrity["repository"] = {
    projectCount: 0,
    projectDescriptionCount: 0,
    projectHighlightCount: 0,
    workCount: 0,
    workHighlightCount: 0,
    internshipCount: 0,
    internshipHighlightCount: 0
  };
  for (const entry of canonical.structuredFacts) {
    const section = entry.data.sectionType;
    if (section !== "project" && section !== "work" && section !== "internship") continue;
    if (section === "project") {
      counts.projectCount += 1;
      if (hasDescription(entry.data)) counts.projectDescriptionCount += 1;
      counts.projectHighlightCount += textListLength((entry.data as Record<string, unknown>).highlights);
    } else if (section === "work") {
      counts.workCount += 1;
      counts.workHighlightCount += textListLength((entry.data as Record<string, unknown>).highlights);
    } else {
      counts.internshipCount += 1;
      counts.internshipHighlightCount += textListLength((entry.data as Record<string, unknown>).highlights);
    }
  }
  return counts;
}

function adapterIntegrityCounts(profile: CareerProfile) {
  const canonical = migrateCareerProfileToV2(profile);
  const documents = canonical.structuredFacts
    .filter((entry) => entry.data.sectionType === "project" || entry.data.sectionType === "work" || entry.data.sectionType === "internship")
    .map((entry) => {
      const data = entry.data as Record<string, unknown>;
      return {
        description: typeof data.description === "string" ? data.description : "",
        highlights: textValues(data.highlights),
        outcomes: entry.data.sectionType === "project" ? textValues(data.outcomes) : [],
        tools: entry.data.sectionType === "project" ? textValues(data.tools) : [],
        background: entry.data.sectionType === "project" && typeof data.background === "string" ? data.background : ""
      };
    });
  return editorProjectionContentCounts(documents);
}

function generalResumeIntegrityCounts(branch?: ResumeBranch): LiveProfileContentIntegrity["generalResume"] {
  const counts: LiveProfileContentIntegrity["generalResume"] = {
    projectCount: 0,
    projectHighlightCount: 0,
    workHighlightCount: 0
  };
  if (!branch) return counts;
  const canonical = migrateResumeBranchToV2(branch);
  for (const item of canonical.structuredContentItems ?? []) {
    if (item.data.sectionType === "project") {
      counts.projectCount += 1;
      counts.projectHighlightCount += textListLength((item.data as Record<string, unknown>).highlights);
    } else if (item.data.sectionType === "work") {
      counts.workHighlightCount += textListLength((item.data as Record<string, unknown>).highlights);
    }
  }
  return counts;
}

function emptyFormIntegrityCounts() {
  return { paragraphCount: 0, bulletCount: 0 };
}

function emptyEditorIntegrityCounts() {
  return { visibleParagraphCount: 0, visibleBulletCount: 0 };
}

function textValues(value: unknown) {
  return Array.isArray(value) ? value.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0) : [];
}

function repositoryHasSelectedContent(profile: CareerProfile, selectedItemId?: string) {
  if (!selectedItemId) return true;
  const canonical = migrateCareerProfileToV2(profile);
  const selected = canonical.structuredFacts.find((entry) => entry.data.id === selectedItemId);
  if (!selected) return false;
  const data = selected.data as Record<string, unknown>;
  return hasDescription(selected.data)
    || textListLength(data.highlights) > 0
    || (selected.data.sectionType === "project" && (textListLength(data.outcomes) > 0 || textListLength(data.tools) > 0));
}

function canonicalExperienceCategoryCounts(profile: CareerProfile): ProfileContentIntegrity["canonical"] {
  const canonical = migrateCareerProfileToV2(profile);
  const counts = {
    projectCount: 0,
    projectDescriptionNonEmpty: 0,
    projectHighlightCount: 0,
    projectOutcomeCount: 0,
    projectToolCount: 0,
    workCount: 0,
    workDescriptionNonEmpty: 0,
    workHighlightCount: 0,
    workOutcomeCount: 0,
    workToolCount: 0,
    internshipCount: 0,
    internshipDescriptionNonEmpty: 0,
    internshipHighlightCount: 0,
    internshipOutcomeCount: 0,
    internshipToolCount: 0
  };
  for (const entry of canonical.structuredFacts) {
    const item = entry.data;
    if (item.sectionType !== "project" && item.sectionType !== "work" && item.sectionType !== "internship") continue;
    const prefix = item.sectionType;
    counts[`${prefix}Count`] += 1;
    if (hasDescription(item)) counts[`${prefix}DescriptionNonEmpty`] += 1;
    counts[`${prefix}HighlightCount`] += textListLength(item.highlights);
    counts[`${prefix}OutcomeCount`] += textListLength("outcomes" in item ? item.outcomes : undefined);
    counts[`${prefix}ToolCount`] += textListLength("tools" in item ? item.tools : undefined);
  }
  return counts;
}

function editorProjectionContentCounts(documents: CanonicalExperienceEditorDocument[]) {
  let paragraphCount = 0;
  let bulletCount = 0;
  let outcomeCount = 0;
  let toolCount = 0;
  for (const document of documents) {
    paragraphCount += paragraphCountFromText(document.description);
    bulletCount += textListLength(document.highlights) + textListLength(document.outcomes);
    outcomeCount += textListLength(document.outcomes);
    toolCount += textListLength(document.tools);
  }
  return { itemCount: documents.length, paragraphCount, bulletCount, outcomeCount, toolCount };
}

function generalResumeCounts(branch: ResumeBranch): ProfileContentIntegrity["generalResume"] {
  const canonical = migrateResumeBranchToV2(branch);
  const counts = emptyGeneralResumeCounts();
  for (const item of canonical.structuredContentItems ?? []) {
    if (item.data.sectionType !== "project" && item.data.sectionType !== "work" && item.data.sectionType !== "internship") continue;
    const bulletCount = textListLength(item.data.highlights);
    const outcomeCount = textListLength("outcomes" in item.data ? item.data.outcomes : undefined);
    if (item.data.sectionType === "project") {
      counts.projectBulletCount += bulletCount;
      counts.projectOutcomeCount += outcomeCount;
    } else if (item.data.sectionType === "work") {
      counts.workBulletCount += bulletCount;
      counts.workOutcomeCount += outcomeCount;
    } else {
      counts.internshipBulletCount += bulletCount;
      counts.internshipOutcomeCount += outcomeCount;
    }
  }
  return counts;
}

function emptyGeneralResumeCounts(): ProfileContentIntegrity["generalResume"] {
  return {
    projectBulletCount: 0,
    projectOutcomeCount: 0,
    workBulletCount: 0,
    workOutcomeCount: 0,
    internshipBulletCount: 0,
    internshipOutcomeCount: 0
  };
}

function contentCounts(items: Array<Record<string, unknown>>, evidenceRefs: number): ProfileContentIntegrityCounts {
  let descriptions = 0;
  let descriptionParagraphs = 0;
  let highlights = 0;
  let outcomes = 0;
  let tools = 0;
  for (const item of items) {
    if (hasDescription(item)) {
      descriptions += 1;
      descriptionParagraphs += paragraphCountFromText(item.description as string);
    }
    if (item.sectionType === "summary" && typeof item.text === "string" && item.text.trim()) {
      descriptions += 1;
      descriptionParagraphs += paragraphCountFromText(item.text);
    }
    highlights += textListLength(item.highlights);
    outcomes += textListLength("outcomes" in item ? item.outcomes : undefined);
    tools += textListLength("tools" in item ? item.tools : undefined);
  }
  return { items: items.length, descriptions, descriptionParagraphs, highlights, outcomes, tools, evidenceRefs };
}

function hasDescription(item: Record<string, unknown> | ResumeItemV2) {
  const description = (item as Record<string, unknown>).description;
  return typeof description === "string" && description.trim().length > 0;
}

function textListLength(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).length
    : 0;
}

function paragraphCountFromText(value: string) {
  return value.split(/\r?\n/u).map((paragraph) => paragraph.trim()).filter(Boolean).length;
}
