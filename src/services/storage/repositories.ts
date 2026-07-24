import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateBranchContentItem, migrateCareerProfileToV2, migrateResumeBranchToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import {
  AiLogSchema,
  AiSuggestionSchema,
  ActiveProfileContextSchema,
  ApplicationPreparationPackSchema,
  ApplicationRecordSchema,
  BranchContentItemSchema,
  CareerProfileSchema,
  DraftCommitSchema,
  ExportRecordSchema,
  JobAdaptationDraftSchema,
  JobAdaptationSnapshotSchema,
  JobAnalysisDraftSchema,
  JobDescriptionSchema,
  ImportedResumeDraftSchema,
  ImportedResumeConfirmResultSchema,
  MatchOperationSchema,
  PdfImportSessionSchema,
  PdfPageTextSchema,
  ProfileImportDraftSchema,
  ProfileRecycleItemSchema,
  RawInputDocumentSchema,
  RecycleBinStateSchema,
  RequirementMatchSchema,
  ResumeBranchSchema,
  ResumeContentItemV2Schema,
  ResumeBranchOperationSchema,
  ResumePresentationConfigSchema,
  ResumeRevisionSchema,
  TemplateIdSchema,
  SuggestionOperationSchema,
  type AiLog,
  type AiSuggestion,
  type ApplicationPreparationPack,
  type ApplicationDiagnosticSummary,
  type ApplicationPriority,
  type ApplicationReadiness,
  type ApplicationRecord,
  type ApplicationSourceChannel,
  type ApplicationStatus,
  type ApplicationTimelineEvent,
  type ApplicationTimelineEventType,
  type CareerProfile,
  type DraftCommit,
  type ExportRecord,
  type ExportOverflowStatus,
  type ExportStatus,
  type FactGuardResult,
  type JobAdaptationDraft,
  type JobAdaptationSectionText,
  type JobAdaptationSnapshot,
  type JobAnalysisDraft,
  type JobDescription,
  type ImportedResumeDraft,
  type ImportTarget,
  type ImportMergeDecision,
  type ImportedResumeConfirmResult,
  type ImportedResumeBranchConfirmResult,
  type MatchEvaluation,
  type MatchOperation,
  type PdfImportSession,
  type PdfPageText,
  type ProfileImportDraft,
  type RawInputDocument,
  type ProfileRecycleItem,
  type RecycleBinState,
  type RequirementMatch,
  type ResumeBranch,
  type ResumeContentItemV2,
  type ResumeItemV2,
  type ResumeBranchOperation,
  type ResumePresentationConfig,
  type ResumeFieldPatch,
  type ResumeTailoringDiff,
  type ResumeTailoringPlan,
  type TailoringClaim,
  type ResumeRenderSectionType,
  type ResumeRevision,
  type SuggestionOperation
} from "@/domain/schemas";
import { AgentSessionSchema, serializeAgentSession, type AgentSession } from "@/agent/contracts/agentSession";
import { validateEachTailoringDiffLocally } from "@/domain/jobOptimization/tailoringDiff";
import { assertApplicationStatusTransition, computeApplicationReadiness } from "@/domain/application";
import {
  buildApplicationPreparationContext,
  createEmptyApplicationPreparationPack,
  rebaseApplicationPreparationPack,
  withUpdatedApplicationPreparationChecklist,
  type ApplicationPreparationContext
} from "@/domain/applicationPreparation";
import { mapAdaptationDraftToResumeBranch } from "@/domain/branch/mapper";
import { createResumeRevision } from "@/domain/branch/revision";
import {
  computeBranchSyncStatus,
  computeGeneralBranchSyncStatus,
  resolveBranchFactRefs,
  toBranchFactRef
} from "@/domain/branch/validation";
import { buildGeneralBranchFromProfile, buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import {
  defaultResumeRenderSectionOrder,
  parseStructuredExperienceText,
  serializeStructuredExperienceText,
  type ResumeFieldCategoryId
} from "@/domain/resumeFields/catalog";
import { buildResumeImportConfirmation, buildResumeImportProfileOnly } from "@/domain/resumeImport/confirm";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import {
  AdaptationDraftError,
  assertC2MatchesUsable,
  createJobAdaptationDraft
} from "@/domain/adaptation/draft";
import { computeRequirementsHash, validateTailoringClaimClosure } from "@/domain/jobOptimization";
import { isTextSuggestionType, staleReasonForSuggestion } from "@/domain/jobOptimization/suggestions";
import {
  matchesResumeSource,
  resolveEffectiveMatch,
  validateRequirementMatchReferences,
  withResolvedEffectiveMatch
} from "@/domain/match/matcher";
import { stableHashText } from "@/services/security/text";
import { CareerAdaptDb, careerAdaptDb, type AppMeta } from "./db";

const RECYCLE_BIN_META_KEY = "workspaceRecycleBin:v1";
const ACTIVE_PROFILE_META_KEY = "activeProfileContext:v1";
const EMPTY_RECYCLE_BIN: RecycleBinState = { version: 1, jobIds: [], profileItems: [] };

function syncStructuredContentItems(
  branch: ResumeBranch,
  contentItems: ResumeBranch["contentItems"]
) {
  const current = new Map((branch.structuredContentItems ?? []).map((item) => [item.id, item]));
  return contentItems.map((legacy) => {
    const structured = current.get(legacy.id);
    if (!structured) return migrateBranchContentItem(legacy);
    // Fix legacy data where internship was misclassified as work
    const patchedData = legacy.sourceSectionId === "internship" && structured.data.sectionType === "work"
      ? { ...structured.data, sectionType: "internship" as const }
      : structured.data;
    return ResumeContentItemV2Schema.parse({
      ...structured,
      data: patchedData,
      order: legacy.order,
      visible: legacy.visible,
      source: legacy.source,
      factRefs: legacy.factRefs,
      guardMode: legacy.guardMode,
      guardStatus: legacy.guardStatus,
      guardFindings: legacy.guardFindings,
      userConfirmation: legacy.userConfirmation,
      legacyTextProjection: legacy.text
    });
  });
}

function applyTailoringClaimsToBranch(
  branch: ResumeBranch,
  claims: TailoringClaim[],
  now: string
) {
  const patches = claims.flatMap((claim) => {
    if (!claim.targetPatches?.length) throw new Error("tailoring_typed_patch_required");
    return claim.targetPatches.map((patch) => ({ patch, claim }));
  });
  let structuredContentItems = syncStructuredContentItems(branch, branch.contentItems);
  for (const { patch, claim } of patches) {
    const index = structuredContentItems.findIndex((item) => item.id === patch.itemId);
    if (index < 0) {
      structuredContentItems = [...structuredContentItems, createConfirmedSkillItem(patch, structuredContentItems, now)];
      continue;
    }
    const current = structuredContentItems[index];
    const patched = applyTypedPatchToStructuredItem(current, patch);
    const verifiedFactRefs = claim.supportLevel === "verified"
      ? claim.evidenceRefs.map(toBranchFactRef)
      : [];
    structuredContentItems[index] = ResumeContentItemV2Schema.parse({
      ...patched,
      factRefs: dedupeBranchFactRefs([...patched.factRefs, ...verifiedFactRefs])
    });
  }

  const claimsByItem = new Map<string, TailoringClaim[]>();
  for (const claim of claims) for (const patch of claim.targetPatches ?? []) {
    const current = claimsByItem.get(patch.itemId) ?? [];
    if (!current.some((item) => item.id === claim.id)) claimsByItem.set(patch.itemId, [...current, claim]);
  }
  const previousById = new Map(branch.contentItems.map((item) => [item.id, item]));
  const contentItems = structuredContentItems.map((structured) => {
    const previous = previousById.get(structured.id);
    const itemClaims = claimsByItem.get(structured.id) ?? [];
    if (!itemClaims.length && previous) return previous;
    const text = tailoringBodyProjection(structured.data);
    const userDeclared = itemClaims.some((claim) => claim.supportLevel !== "verified");
    const confirmation = userDeclared ? { scope: "resume_only" as const, confirmedTextHash: stableHashText(text), confirmedAt: now } : undefined;
    return BranchContentItemSchema.parse({
      ...(previous ?? {}),
      id: structured.id,
      itemType: structured.data.sectionType === "summary" ? "summary" : structured.data.sectionType === "skills" ? "skill" : "experience",
      source: userDeclared ? "user_manual" : "adaptation_draft",
      sourceSectionId: structured.data.sectionType,
      text,
      originalText: previous?.originalText ?? text,
      order: structured.order,
      visible: structured.visible,
      requirementIds: Array.from(new Set(itemClaims.flatMap((claim) => claim.requirementIds ?? []))),
      sourceSuggestionIds: itemClaims.map((claim) => claim.id),
      factRefs: structured.factRefs,
      guardMode: userDeclared ? "not_fact" : "rule_verified",
      guardStatus: "pass",
      guardRiskLevel: userDeclared ? "medium" : "low",
      guardFindings: [],
      guardedAt: now,
      guardVersion: "tailoring-field-patch-v1",
      userConfirmation: confirmation
    });
  });
  return { contentItems, structuredContentItems };
}

function dedupeBranchFactRefs<T>(refs: T[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyTypedPatchToStructuredItem(item: ResumeContentItemV2, patch: ResumeFieldPatch) {
  if (patch.sectionId !== item.data.sectionType) throw new Error("tailoring_patch_section_mismatch");
  if (patch.fieldPath === "visible" || patch.fieldPath === "order") {
    const current = item[patch.fieldPath];
    assertPatchBefore(current, patch.before, patch);
    return ResumeContentItemV2Schema.parse({ ...item, [patch.fieldPath]: patch.after });
  }
  const allowed = item.data.sectionType === "summary" ? ["text"]
    : item.data.sectionType === "skills" ? ["name", "description"]
      : ["project", "work", "internship"].includes(item.data.sectionType) ? ["description", "highlights"] : [];
  if (!allowed.includes(patch.fieldPath)) throw new Error("tailoring_field_path_not_allowed");
  const data = item.data as ResumeItemV2;
  const current = (data as unknown as Record<string, unknown>)[patch.fieldPath] ?? (patch.fieldPath === "highlights" ? [] : "");
  assertPatchBefore(current, patch.before, patch);
  const parsed = ResumeContentItemV2Schema.parse({ ...item, data: { ...data, [patch.fieldPath]: patch.after } });
  return ResumeContentItemV2Schema.parse({ ...parsed, legacyTextProjection: tailoringBodyProjection(parsed.data) });
}

function createConfirmedSkillItem(patch: ResumeFieldPatch, existing: ResumeContentItemV2[], now: string) {
  if (patch.sectionId !== "skills" || patch.fieldPath !== "name" || patch.operation !== "append" || typeof patch.after !== "string") {
    throw new Error("tailoring_patch_item_missing");
  }
  const text = patch.after.trim();
  return ResumeContentItemV2Schema.parse({
    id: patch.itemId,
    schemaVersion: "resume-content-item-v2",
    data: { id: patch.itemId, sectionType: "skills", name: text, customFields: [] },
    factRefs: [],
    source: "user_manual",
    order: Math.max(-1, ...existing.map((item) => item.order)) + 1,
    visible: true,
    guardMode: "not_fact",
    guardStatus: "pass",
    guardFindings: [],
    userConfirmation: { scope: "resume_only", confirmedTextHash: stableHashText(text), confirmedAt: now },
    legacyTextProjection: text,
    sourceBlockIds: [],
    sourceRanges: [],
    mappingTrace: []
  });
}

function assertPatchBefore(current: unknown, before: unknown, patch: ResumeFieldPatch) {
  if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error(`tailoring_patch_before_mismatch:${patch.itemId}:${patch.fieldPath}`);
}

function tailoringBodyProjection(item: ResumeItemV2) {
  if (item.sectionType === "summary") return item.text;
  if (item.sectionType === "skills") return item.description?.trim() || item.name;
  if (["project", "work", "internship"].includes(item.sectionType)) {
    const experience = item as Extract<ResumeItemV2, { sectionType: "project" | "work" | "internship" }>;
    return [experience.description, ...experience.highlights].filter((value): value is string => Boolean(value?.trim())).join("\n");
  }
  throw new Error("tailoring_body_projection_not_allowed");
}

function applySuggestionToStructuredItems(
  branch: ResumeBranch,
  contentItems: ResumeBranch["contentItems"],
  suggestion: AiSuggestion,
  acceptedText: string
) {
  return syncStructuredContentItems(branch, contentItems).map((item) => {
    if (item.id !== suggestion.targetContentItemId || !suggestion.targetFieldId) return item;
    const field = suggestion.targetFieldId.split(".").at(-1)!;
    const current = (item.data as unknown as Record<string, unknown>)[field];
    const value = Array.isArray(current) ? [acceptedText, ...current.slice(1)] : acceptedText;
    return ResumeContentItemV2Schema.parse({
      ...item,
      data: { ...item.data, [field]: value }
    });
  });
}

function applyLegacyTextEditToStructuredItem(item: ResumeItemV2, text: string): ResumeItemV2 {
  const value = (candidate: string) => candidate.trim() || undefined;
  const parsed = parseStructuredExperienceText(text);
  const dateFields = {
    startDate: value(parsed.startDate),
    endDate: parsed.current ? undefined : value(parsed.endDate),
    current: parsed.current
  };

  switch (item.sectionType) {
    case "summary":
      return { ...item, text: text.trim() };
    case "education":
      return {
        ...item,
        school: value(parsed.organization),
        degree: value(parsed.degree || parsed.role),
        major: value(parsed.major),
        location: value(parsed.location),
        courses: parsed.courses.trim()
          ? parsed.courses.split(/[,，、;；]/).map((course) => course.trim()).filter(Boolean)
          : item.courses,
        description: value(parsed.description),
        ...dateFields
      };
    case "work":
    case "internship":
    case "campus":
    case "volunteer":
      return {
        ...item,
        organization: value(parsed.organization),
        role: value(parsed.role),
        location: value(parsed.location),
        description: value(parsed.description),
        ...dateFields
      };
    case "project":
      return {
        ...item,
        title: value(parsed.organization),
        role: value(parsed.role),
        location: value(parsed.location),
        description: value(parsed.description),
        ...dateFields
      };
    case "custom":
      return { ...item, description: value(text) };
    default:
      return item;
  }
}

export type WorkspaceExport = {
  schemaVersion: "stage-e-e1-v1";
  exportedAt: string;
  profiles: CareerProfile[];
  jobDescriptions: JobDescription[];
  rawInputs: RawInputDocument[];
  pdfImportSessions: PdfImportSession[];
  pdfPageTexts: PdfPageText[];
  profileImportDrafts: ProfileImportDraft[];
  jobAnalysisDrafts: JobAnalysisDraft[];
  draftCommits: DraftCommit[];
  requirementMatches: RequirementMatch[];
  matchOperations: MatchOperation[];
  jobAdaptationDrafts: JobAdaptationDraft[];
  aiSuggestions: AiSuggestion[];
  adaptationSnapshots: JobAdaptationSnapshot[];
  suggestionOperations: SuggestionOperation[];
  resumeBranches: ResumeBranch[];
  resumeRevisions: ResumeRevision[];
  resumeBranchOperations: ResumeBranchOperation[];
  aiLogs: AiLog[];
  exportRecords: ExportRecord[];
  applications: ApplicationRecord[];
  appMeta: AppMeta[];
};

export type ApplicationContext = {
  application: ApplicationRecord;
  profile?: CareerProfile;
  job?: JobDescription;
  sourceGeneralBranch?: ResumeBranch;
  jobSpecificBranch?: ResumeBranch;
  selectedRevision?: ResumeRevision;
  selectedExportRecord?: ExportRecord;
  latestExportRecord?: ExportRecord;
  presentationConfig?: ResumePresentationConfig;
  revisions: ResumeRevision[];
  exportRecords: ExportRecord[];
  preparationContext?: ApplicationPreparationContext;
  preparationPack?: ApplicationPreparationPack;
  preparationPackCorrupted?: boolean;
};

export class WorkspaceRepository {
  constructor(private readonly db: CareerAdaptDb = careerAdaptDb) {}

  async saveAgentSession(session: AgentSession) {
    const parsed = AgentSessionSchema.parse(serializeAgentSession(session));
    await this.db.agentSessions.put(parsed);
    return parsed;
  }

  async getAgentSession(sessionId: string) {
    const session = await this.db.agentSessions.get(sessionId);
    return session ? AgentSessionSchema.parse(session) : undefined;
  }

  async listAgentSessions(limit = 30) {
    const sessions = await this.db.agentSessions.orderBy("updatedAt").reverse().limit(Math.min(Math.max(limit, 1), 100)).toArray();
    return sessions.filter((s) => !s.archived).map((session) => AgentSessionSchema.parse(session));
  }

  async listArchivedAgentSessions(limit = 50) {
    const sessions = await this.db.agentSessions.orderBy("updatedAt").reverse().limit(Math.min(Math.max(limit, 1), 200)).toArray();
    return sessions.filter((s) => s.archived).map((session) => AgentSessionSchema.parse(session));
  }

  async archiveAgentSession(id: string) {
    const session = await this.db.agentSessions.get(id);
    if (!session) return;
    const now = new Date().toISOString();
    const updated = AgentSessionSchema.parse({ ...session, archived: true, archivedAt: now, updatedAt: now });
    await this.db.agentSessions.put(updated);
    return updated;
  }

  async unarchiveAgentSession(id: string) {
    const session = await this.db.agentSessions.get(id);
    if (!session) return;
    const now = new Date().toISOString();
    const updated = AgentSessionSchema.parse({ ...session, archived: false, archivedAt: undefined, updatedAt: now });
    await this.db.agentSessions.put(updated);
    return updated;
  }

  async renameAgentSession(id: string, title: string) {
    const session = await this.db.agentSessions.get(id);
    if (!session) return;
    const now = new Date().toISOString();
    const updated = AgentSessionSchema.parse({ ...session, title, updatedAt: now });
    await this.db.agentSessions.put(updated);
    return updated;
  }

  async deleteAgentSession(id: string) {
    await this.db.agentSessions.delete(id);
  }

  async seedDemoWorkspace() {
    await this.saveProfile(demoCareerProfile);
    await this.setActiveProfileId(demoCareerProfile.id);
    await this.saveJobDescriptions(demoJobDescriptions);
    await this.setMeta("demoSeededAt", new Date().toISOString());
  }

  async ensureDemoWorkspace() {
    const seededAt = await this.getMeta("demoSeededAt");

    if (!seededAt) {
      await this.seedDemoWorkspace();
      return true;
    }

    return false;
  }

  async saveProfile(profile: CareerProfile) {
    const parsed = migrateCareerProfileToV2(CareerProfileSchema.parse(profile));
    await this.db.profiles.put(parsed);
    return parsed;
  }

  async saveRawInput(rawInput: RawInputDocument) {
    const parsed = RawInputDocumentSchema.parse(rawInput);
    await this.db.rawInputs.put(parsed);
    return parsed;
  }

  async getRawInput(id: string) {
    const rawInput = await this.db.rawInputs.get(id);
    return rawInput ? RawInputDocumentSchema.parse(rawInput) : undefined;
  }

  async listRawInputs() {
    const rawInputs = await this.db.rawInputs.toArray();
    return rawInputs.map((rawInput) => RawInputDocumentSchema.parse(rawInput));
  }

  async createPdfImportSession(session: PdfImportSession) {
    const parsed = PdfImportSessionSchema.parse(session);
    await this.db.pdfImportSessions.put(parsed);
    return parsed;
  }

  async updatePdfImportSession(session: PdfImportSession) {
    const parsed = PdfImportSessionSchema.parse({
      ...session,
      updatedAt: new Date().toISOString()
    });
    await this.db.pdfImportSessions.put(parsed);
    return parsed;
  }

  async getPdfImportSession(id: string) {
    const session = await this.db.pdfImportSessions.get(id);
    return session ? PdfImportSessionSchema.parse(session) : undefined;
  }

  async getLatestPdfImportSession() {
    const sessions = await this.db.pdfImportSessions.orderBy("updatedAt").reverse().toArray();
    return sessions[0] ? PdfImportSessionSchema.parse(sessions[0]) : undefined;
  }

  async findPdfImportByFileHash(fileHash: string) {
    const sessions = await this.db.pdfImportSessions.where("fileHash").equals(fileHash).toArray();
    const latest = sessions
      .map((session) => PdfImportSessionSchema.parse(session))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return latest;
  }

  async savePdfPageTexts(sessionId: string, pages: PdfPageText[]) {
    const parsed = pages.map((page) => PdfPageTextSchema.parse(page));
    await this.db.transaction("rw", this.db.pdfPageTexts, async () => {
      await this.db.pdfPageTexts.where("sessionId").equals(sessionId).delete();
      if (parsed.length > 0) {
        await this.db.pdfPageTexts.bulkPut(parsed);
      }
    });
    return parsed;
  }

  async listPdfPageTexts(sessionId: string) {
    const pages = await this.db.pdfPageTexts.where("sessionId").equals(sessionId).toArray();
    return pages
      .map((page) => PdfPageTextSchema.parse(page))
      .sort((a, b) => a.pageNumber - b.pageNumber);
  }

  async deletePdfImportSession(sessionId: string) {
    await this.db.transaction("rw", this.db.pdfImportSessions, this.db.pdfPageTexts, async () => {
      await this.db.pdfPageTexts.where("sessionId").equals(sessionId).delete();
      await this.db.pdfImportSessions.delete(sessionId);
    });
  }

  async createProfileImportDraft(draft: ProfileImportDraft) {
    const parsed = ProfileImportDraftSchema.parse(draft);
    await this.db.profileImportDrafts.put(parsed);
    return parsed;
  }

  async getProfileImportDraft(id: string) {
    const draft = await this.db.profileImportDrafts.get(id);
    return draft ? ProfileImportDraftSchema.parse(draft) : undefined;
  }

  async getLatestProfileImportDraft() {
    const drafts = await this.db.profileImportDrafts.orderBy("updatedAt").reverse().toArray();
    return drafts[0] ? ProfileImportDraftSchema.parse(drafts[0]) : undefined;
  }

  async saveProfileImportDraftRevision(draft: ProfileImportDraft, expectedRevision: number) {
    return this.db.transaction("rw", this.db.profileImportDrafts, async () => {
      const existing = await this.db.profileImportDrafts.get(draft.id);

      if (!existing) {
        if (expectedRevision !== 0) {
          throw new RevisionConflictError();
        }

        const parsed = ProfileImportDraftSchema.parse({
          ...draft,
          revision: 0,
          updatedAt: new Date().toISOString()
        });
        await this.db.profileImportDrafts.put(parsed);
        return parsed;
      }

      if (existing.revision !== expectedRevision) {
        throw new RevisionConflictError();
      }

      const parsed = ProfileImportDraftSchema.parse({
        ...draft,
        revision: existing.revision + 1,
        updatedAt: new Date().toISOString(),
        lastAutosavedAt: new Date().toISOString()
      });
      await this.db.profileImportDrafts.put(parsed);
      return parsed;
    });
  }

  async commitProfileDraft(input: {
    draftId: string;
    expectedRevision: number;
    commitId: string;
    profile: CareerProfile;
  }) {
    return this.db.transaction("rw", this.db.profileImportDrafts, this.db.profiles, this.db.draftCommits, async () => {
      const existingCommit = await this.db.draftCommits.get(input.commitId);

      if (existingCommit) {
        const profile = await this.getProfile(existingCommit.entityId);
        if (!profile) {
          throw new Error("committed_profile_missing");
        }

        return {
          profile,
          commit: DraftCommitSchema.parse(existingCommit),
          idempotent: true
        };
      }

      const draft = await this.db.profileImportDrafts.get(input.draftId);

      if (!draft || draft.revision !== input.expectedRevision) {
        throw new RevisionConflictError();
      }

      const now = new Date().toISOString();
      const profile = CareerProfileSchema.parse(input.profile);
      const commit = DraftCommitSchema.parse({
        id: input.commitId,
        commitId: input.commitId,
        draftId: input.draftId,
        kind: "profile",
        entityId: profile.id,
        expectedRevision: input.expectedRevision,
        createdAt: now,
        updatedAt: now
      });

      await this.db.profiles.put(profile);
      await this.db.draftCommits.put(commit);
      await this.db.profileImportDrafts.put(
        ProfileImportDraftSchema.parse({
          ...draft,
          revision: draft.revision + 1,
          status: "committed",
          committedProfileId: profile.id,
          committedAt: now,
          updatedAt: now
        })
      );

      return { profile, commit, idempotent: false };
    });
  }

  async saveImportedResumeDraft(draft: ImportedResumeDraft, expectedRevision?: number) {
    return this.db.transaction("rw", this.db.appMeta, async () => {
      const stored = await this.db.appMeta.get(importedResumeDraftKey(draft.importId));
      if (stored) {
        const existing = ImportedResumeDraftSchema.parse(stored.value);
        if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
          throw new RevisionConflictError();
        }
        const parsed = ImportedResumeDraftSchema.parse({
          ...draft,
          revision: existing.revision + 1,
          updatedAt: new Date().toISOString()
        });
        await this.db.appMeta.put({
          key: importedResumeDraftKey(parsed.importId),
          value: parsed,
          updatedAt: parsed.updatedAt
        });
        return parsed;
      }

      if (expectedRevision !== undefined && expectedRevision !== 0) {
        throw new RevisionConflictError();
      }
      const parsed = ImportedResumeDraftSchema.parse({
        ...draft,
        revision: 0,
        updatedAt: new Date().toISOString()
      });
      await this.db.appMeta.put({
        key: importedResumeDraftKey(parsed.importId),
        value: parsed,
        updatedAt: parsed.updatedAt
      });
      return parsed;
    });
  }

  async getImportedResumeDraft(importId: string) {
    const stored = await this.db.appMeta.get(importedResumeDraftKey(importId));
    return stored ? ImportedResumeDraftSchema.parse(stored.value) : undefined;
  }

  async getLatestImportedResumeDraft() {
    const rows = await this.db.appMeta
      .where("key")
      .startsWith(IMPORTED_RESUME_DRAFT_KEY_PREFIX)
      .toArray();
    const drafts = rows
      .map((row) => ImportedResumeDraftSchema.safeParse(row.value))
      .filter((result): result is { success: true; data: ImportedResumeDraft } => result.success)
      .map((result) => result.data)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return drafts[0];
  }

  async cancelImportedResumeDraft(importId: string, expectedRevision: number) {
    const existing = await this.getImportedResumeDraft(importId);
    if (!existing) {
      return undefined;
    }
    return this.saveImportedResumeDraft({
      ...existing,
      status: "cancelled"
    }, expectedRevision);
  }

  async confirmImportedResume(input: {
    importId: string;
    expectedDraftRevision: number;
    operationId: string;
    mergeDecisions?: ImportMergeDecision[];
    target?: { mode: "existing"; profileId: string } | { mode: "new"; profileName: string; createGeneralResume: true };
  }): Promise<ImportedResumeBranchConfirmResult>;
  async confirmImportedResume(input: {
    importId: string;
    expectedDraftRevision: number;
    operationId: string;
    mergeDecisions?: ImportMergeDecision[];
    target?: ImportTarget;
  }): Promise<ImportedResumeConfirmResult>;
  async confirmImportedResume(input: {
    importId: string;
    expectedDraftRevision: number;
    operationId: string;
    mergeDecisions?: ImportMergeDecision[];
    target?: ImportTarget;
  }): Promise<ImportedResumeConfirmResult> {
    return this.db.transaction(
      "rw",
      [
        this.db.appMeta,
        this.db.profiles,
        this.db.resumeBranches,
        this.db.resumeRevisions,
        this.db.resumeBranchOperations,
        this.db.pdfImportSessions
      ],
      async () => {
        const existingOperation = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
        if (existingOperation?.branchId && existingOperation.revisionId) {
          const branch = await this.db.resumeBranches.get(existingOperation.branchId);
          if (!branch) {
            throw new Error("resume_import_branch_missing_for_operation");
          }
          const parsedBranch = ResumeBranchSchema.parse(branch);
          const result = ImportedResumeConfirmResultSchema.parse({
            profileId: parsedBranch.profileId,
            branchId: parsedBranch.id,
            revisionId: existingOperation.revisionId,
            presentationRevision: 0,
            idempotent: true
          });
          return result;
        }

        const stored = await this.db.appMeta.get(importedResumeDraftKey(input.importId));
        if (!stored) {
          throw new Error("resume_import_draft_missing");
        }
        const draft = ImportedResumeDraftSchema.parse(stored.value);
        if (draft.revision !== input.expectedDraftRevision) {
          throw new RevisionConflictError();
        }
        if (draft.status !== "reviewing") {
          throw new Error("resume_import_draft_not_reviewing");
        }

        const profiles = await this.db.profiles.toArray();
        const existingProfile = input.target?.mode === "existing"
          ? await this.db.profiles.get(input.target.profileId).then((profile) => profile ? CareerProfileSchema.parse(profile) : undefined)
          : input.target?.mode === "new"
            ? undefined
            : profiles[0] ? CareerProfileSchema.parse(profiles[0]) : undefined;
        if (input.target?.mode === "existing" && !existingProfile) {
          throw new Error("resume_import_target_profile_missing");
        }
        const now = new Date().toISOString();
        const createBranch = input.target?.mode !== "new" || input.target.createGeneralResume;
        const built = createBranch ? buildResumeImportConfirmation({
          draft,
          existingProfile,
          mergeDecisions: input.mergeDecisions,
          newProfileName: input.target?.mode === "new" ? input.target.profileName : undefined,
          operationId: input.operationId,
          now
        }) : undefined;
        const committedProfile = built?.profile ?? buildResumeImportProfileOnly({
          draft,
          newProfileName: input.target?.mode === "new" ? input.target.profileName : draft.basics.name?.value ?? "未命名",
          now
        });
        const operation = built ? ResumeBranchOperationSchema.parse({
          id: `resume-branch-op-${input.operationId}`,
          operationId: input.operationId,
          branchId: built.branch.id,
          type: "resume_import_confirm",
          expectedRevision: input.expectedDraftRevision,
          beforeRevision: 0,
          afterRevision: built.branch.revision,
          revisionId: built.firstRevision.id,
          occurredAt: now,
          createdAt: now,
          updatedAt: now
        }) : undefined;
        const presentationConfig = built ? createDefaultPresentationConfig({
          branch: built.branch,
          now
        }) : undefined;
        const runtimeProfile = migrateCareerProfileToV2(committedProfile);
        const runtimeBranch = built ? migrateResumeBranchToV2(built.branch) : undefined;

        await this.db.profiles.put(runtimeProfile);
        if (built && runtimeBranch && operation && presentationConfig) {
          await this.db.resumeBranches.put(runtimeBranch);
          await this.db.resumeRevisions.put(built.firstRevision);
          await this.db.resumeBranchOperations.put(operation);
          await this.db.appMeta.put({
            key: resumePresentationConfigKey(built.branch.id),
            value: presentationConfig,
            updatedAt: now
          });
        }
        await this.db.appMeta.put({
          key: ACTIVE_PROFILE_META_KEY,
          value: ActiveProfileContextSchema.parse({ schemaVersion: "active-profile-v1", profileId: runtimeProfile.id }),
          updatedAt: now
        });
        await this.db.appMeta.put({
          key: importedResumeDraftKey(draft.importId),
          value: ImportedResumeDraftSchema.parse({
            ...draft,
            status: "confirmed",
            revision: draft.revision + 1,
            confirmedProfileId: runtimeProfile.id,
            confirmedBranchId: built?.branch.id,
            confirmedRevisionId: built?.firstRevision.id,
            confirmedAt: now,
            updatedAt: now
          }),
          updatedAt: now
        });
        if (draft.source.sourceSessionId) {
          const session = await this.db.pdfImportSessions.get(draft.source.sourceSessionId);
          if (session) {
            await this.db.pdfImportSessions.put(PdfImportSessionSchema.parse({
              ...session,
              status: "committed",
              committedProfileId: runtimeProfile.id,
              committedAt: now,
              updatedAt: now
            }));
          }
        }

        return ImportedResumeConfirmResultSchema.parse({
          profileId: runtimeProfile.id,
          branchId: built?.branch.id,
          revisionId: built?.firstRevision.id,
          presentationRevision: presentationConfig?.presentationRevision,
          idempotent: false
        });
      }
    );
  }

  async getProfile(id: string) {
    const profile = await this.db.profiles.get(id);
    return profile ? migrateCareerProfileToV2(CareerProfileSchema.parse(profile)) : undefined;
  }

  async listProfiles() {
    const profiles = await this.db.profiles.toArray();
    return profiles.map((profile) => migrateCareerProfileToV2(CareerProfileSchema.parse(profile)));
  }

  async getActiveProfileId() {
    const stored = await this.db.appMeta.get(ACTIVE_PROFILE_META_KEY);
    const parsed = ActiveProfileContextSchema.safeParse(stored?.value);
    if (!parsed.success) {
      return undefined;
    }
    return await this.db.profiles.get(parsed.data.profileId) ? parsed.data.profileId : undefined;
  }

  async setActiveProfileId(profileId: string) {
    if (!await this.db.profiles.get(profileId)) {
      throw new Error("Profile not found.");
    }
    const value = ActiveProfileContextSchema.parse({
      schemaVersion: "active-profile-v1",
      profileId
    });
    await this.setMeta(ACTIVE_PROFILE_META_KEY, value);
    return value;
  }

  async getProfileDeleteBlockers(profileId: string) {
    const [branches, matches, matchOperations, adaptationDrafts, applications, commits] = await Promise.all([
      this.db.resumeBranches.where("profileId").equals(profileId).count(),
      this.db.requirementMatches.filter((item) => item.profileId === profileId).count(),
      this.db.matchOperations.filter((item) => item.profileId === profileId).count(),
      this.db.jobAdaptationDrafts.filter((item) => item.profileId === profileId).count(),
      this.db.applications.where("profileId").equals(profileId).count(),
      this.db.draftCommits.where("entityId").equals(profileId).count()
    ]);
    return { branches, matches, matchOperations, adaptationDrafts, applications, commits };
  }

  async deleteProfileIfUnreferenced(profileId: string) {
    const blockers = await this.getProfileDeleteBlockers(profileId);
    if (Object.values(blockers).some((count) => count > 0)) {
      return { deleted: false as const, blockers };
    }
    await this.db.transaction("rw", this.db.profiles, this.db.appMeta, async () => {
      await this.db.profiles.delete(profileId);
      await this.db.appMeta.delete(`profileArchive:${profileId}:skills`);
      await this.db.appMeta.delete(`profileArchive:${profileId}:managed-items`);
    });
    return { deleted: true as const, blockers };
  }

  async clearProfileBlockers(profileId: string, categories: Array<"branches" | "matches" | "matchOperations" | "adaptationDrafts" | "applications" | "commits">) {
    const ops: Array<Promise<unknown>> = [];
    for (const category of categories) {
      switch (category) {
        case "branches":
          ops.push(this.db.resumeBranches.where("profileId").equals(profileId).delete());
          break;
        case "matches":
          ops.push(this.db.requirementMatches.filter((item) => item.profileId === profileId).delete());
          break;
        case "matchOperations":
          ops.push(this.db.matchOperations.filter((item) => item.profileId === profileId).delete());
          break;
        case "adaptationDrafts":
          ops.push(this.db.jobAdaptationDrafts.filter((item) => item.profileId === profileId).delete());
          break;
        case "applications":
          ops.push(this.db.applications.where("profileId").equals(profileId).delete());
          break;
        case "commits":
          ops.push(this.db.draftCommits.where("entityId").equals(profileId).delete());
          break;
      }
    }
    await Promise.all(ops);
  }

  async forceDeleteProfile(profileId: string) {
    await this.db.transaction("rw", this.db.profiles, this.db.appMeta, async () => {
      await this.db.profiles.delete(profileId);
      await this.db.appMeta.delete(`profileArchive:${profileId}:skills`);
      await this.db.appMeta.delete(`profileArchive:${profileId}:managed-items`);
    });
  }

  async getOrphanedDataCounts() {
    const [allProfiles, allDrafts, allRawInputs, allPdfSessions] = await Promise.all([
      this.db.profiles.toArray(),
      this.db.profileImportDrafts.toArray(),
      this.db.rawInputs.toArray(),
      this.db.pdfImportSessions.toArray()
    ]);
    const profileIds = new Set(allProfiles.map((p) => p.id));
    const orphanedDrafts = allDrafts.filter((d) => d.committedProfileId && !profileIds.has(d.committedProfileId));
    const orphanedDraftRawInputIds = new Set(orphanedDrafts.map((d) => d.rawInputId));
    const orphanedRawInputs = allRawInputs.filter((r) => orphanedDraftRawInputIds.has(r.id));
    const orphanedRawInputSessionIds = new Set(
      orphanedRawInputs.map((r) => r.sourceSessionId).filter((id): id is string => Boolean(id))
    );
    const orphanedPdfSessions = allPdfSessions.filter((s) => orphanedRawInputSessionIds.has(s.id));
    return {
      drafts: orphanedDrafts.length,
      rawInputs: orphanedRawInputs.length,
      pdfSessions: orphanedPdfSessions.length,
      orphanedDraftIds: orphanedDrafts.map((d) => d.id),
      orphanedRawInputIds: orphanedRawInputs.map((r) => r.id),
      orphanedPdfSessionIds: orphanedPdfSessions.map((s) => s.id)
    };
  }

  async clearOrphanedData(orphanedDraftIds: string[], orphanedRawInputIds: string[], orphanedPdfSessionIds: string[]) {
    await this.db.transaction("rw", this.db.profileImportDrafts, this.db.rawInputs, this.db.pdfImportSessions, async () => {
      await Promise.all([
        ...orphanedDraftIds.map((id) => this.db.profileImportDrafts.delete(id)),
        ...orphanedRawInputIds.map((id) => this.db.rawInputs.delete(id)),
        ...orphanedPdfSessionIds.map((id) => this.db.pdfImportSessions.delete(id))
      ]);
    });
  }

  async saveJobDescription(jobDescription: JobDescription) {
    const parsed = JobDescriptionSchema.parse(jobDescription);
    await this.db.jobDescriptions.put(parsed);
    return parsed;
  }

  async createJobAnalysisDraft(draft: JobAnalysisDraft) {
    const parsed = JobAnalysisDraftSchema.parse(draft);
    await this.db.jobAnalysisDrafts.put(parsed);
    return parsed;
  }

  async getJobAnalysisDraft(id: string) {
    const draft = await this.db.jobAnalysisDrafts.get(id);
    return draft ? JobAnalysisDraftSchema.parse(draft) : undefined;
  }

  async getLatestJobAnalysisDraft() {
    const drafts = await this.db.jobAnalysisDrafts.orderBy("updatedAt").reverse().toArray();
    return drafts[0] ? JobAnalysisDraftSchema.parse(drafts[0]) : undefined;
  }

  async getLatestActiveJobAnalysisDraft() {
    const activeStatuses = new Set(["privacy_pending", "analyzing", "ai_validated", "needs_review", "editing", "manual_mode", "error"]);
    const drafts = await this.db.jobAnalysisDrafts.orderBy("updatedAt").reverse().toArray();
    const activeDraft = drafts.find((draft) => activeStatuses.has(draft.status));
    return activeDraft ? JobAnalysisDraftSchema.parse(activeDraft) : undefined;
  }

  async saveJobAnalysisDraftRevision(draft: JobAnalysisDraft, expectedRevision: number) {
    return this.db.transaction("rw", this.db.jobAnalysisDrafts, async () => {
      const existing = await this.db.jobAnalysisDrafts.get(draft.id);

      if (!existing) {
        if (expectedRevision !== 0) {
          throw new RevisionConflictError();
        }

        const parsed = JobAnalysisDraftSchema.parse({
          ...draft,
          revision: 0,
          updatedAt: new Date().toISOString()
        });
        await this.db.jobAnalysisDrafts.put(parsed);
        return parsed;
      }

      if (existing.revision !== expectedRevision) {
        throw new RevisionConflictError();
      }

      const parsed = JobAnalysisDraftSchema.parse({
        ...draft,
        revision: existing.revision + 1,
        updatedAt: new Date().toISOString(),
        lastAutosavedAt: new Date().toISOString()
      });
      await this.db.jobAnalysisDrafts.put(parsed);
      return parsed;
    });
  }

  async commitJobDraft(input: {
    draftId: string;
    expectedRevision: number;
    commitId: string;
    jobDescription: JobDescription;
  }) {
    return this.db.transaction("rw", this.db.jobAnalysisDrafts, this.db.jobDescriptions, this.db.draftCommits, async () => {
      const existingCommit = await this.db.draftCommits.get(input.commitId);

      if (existingCommit) {
        const [jobDescription, committedDraft] = await Promise.all([
          this.db.jobDescriptions.get(existingCommit.entityId),
          this.db.jobAnalysisDrafts.get(input.draftId)
        ]);
        if (!jobDescription || !committedDraft) {
          throw new Error("committed_job_missing");
        }

        return {
          jobDescription: JobDescriptionSchema.parse(jobDescription),
          draft: JobAnalysisDraftSchema.parse(committedDraft),
          commit: DraftCommitSchema.parse(existingCommit),
          idempotent: true
        };
      }

      const draft = await this.db.jobAnalysisDrafts.get(input.draftId);

      if (!draft || draft.revision !== input.expectedRevision) {
        throw new RevisionConflictError();
      }

      const now = new Date().toISOString();
      const existingJob = await this.db.jobDescriptions.get(input.jobDescription.id);
      const jobDescription = JobDescriptionSchema.parse({
        ...input.jobDescription,
        createdAt: existingJob?.createdAt ?? input.jobDescription.createdAt,
        updatedAt: now
      });
      const commit = DraftCommitSchema.parse({
        id: input.commitId,
        commitId: input.commitId,
        draftId: input.draftId,
        kind: "job",
        entityId: jobDescription.id,
        expectedRevision: input.expectedRevision,
        createdAt: now,
        updatedAt: now
      });

      await this.db.jobDescriptions.put(jobDescription);
      await this.db.draftCommits.put(commit);
      const committedDraft = JobAnalysisDraftSchema.parse({
        ...draft,
        revision: draft.revision + 1,
        status: "committed",
        analysisRunStatus: "committed",
        analysisRuns: (draft.analysisRuns ?? []).map((run, index, runs) => index === runs.length - 1 ? { ...run, status: "committed", finishedAt: run.finishedAt ?? now } : run),
        committedJobId: jobDescription.id,
        committedAt: now,
        updatedAt: now
      });
      await this.db.jobAnalysisDrafts.put(committedDraft);

      return { jobDescription, draft: committedDraft, commit, idempotent: false };
    });
  }

  async saveJobDescriptions(jobDescriptions: JobDescription[]) {
    const parsed = jobDescriptions.map((jobDescription) => JobDescriptionSchema.parse(jobDescription));
    await this.db.jobDescriptions.bulkPut(parsed);
    return parsed;
  }

  async listJobDescriptions() {
    const jobDescriptions = await this.db.jobDescriptions.toArray();
    return jobDescriptions.map((jobDescription) => JobDescriptionSchema.parse(jobDescription));
  }

  async getJobDescription(id: string) {
    const jobDescription = await this.db.jobDescriptions.get(id);
    return jobDescription ? JobDescriptionSchema.parse(jobDescription) : undefined;
  }

  async saveResumeBranch(branch: ResumeBranch) {
    const parsed = migrateResumeBranchToV2(ResumeBranchSchema.parse(branch));
    await this.db.resumeBranches.put(parsed);
    return parsed;
  }

  async applyTailoringPlan(input: {
    plan: ResumeTailoringPlan;
    operationId: string;
    expectedBranchRevision: number;
    expectedRevisionId: string;
  }) {
    return this.db.transaction("rw", [this.db.resumeBranches, this.db.resumeRevisions, this.db.resumeBranchOperations], async () => {
      const existing = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
      if (existing?.revisionId) {
        const branch = await this.db.resumeBranches.get(input.plan.branchId);
        if (!branch) throw new Error("tailoring_branch_missing");
        return { branch: ResumeBranchSchema.parse(branch), revision: await this.getResumeRevisionInTransaction(existing.revisionId), idempotent: true };
      }
      const branch = await this.requireEditableResumeBranch(input.plan.branchId);
      if (branch.branchPurpose !== "job_specific" || branch.jobId !== input.plan.jobId) throw new Error("tailoring_plan_target_invalid");
      if (branch.revision !== input.expectedBranchRevision || branch.currentRevisionId !== input.expectedRevisionId || input.plan.basedOnBranchRevision !== branch.revision) throw new RevisionConflictError();
      const applicable = input.plan.claims.filter((claim) => claim.syncScope !== "rejected" && (claim.decision === "auto_applicable" || claim.confirmed));
      if (input.plan.claims.some((claim) => claim.decision === "blocked" && claim.syncScope !== "rejected")) throw new Error("unsupported_hard_fact_blocked");
      if (input.plan.claims.some((claim) => claim.decision === "requires_confirmation" && !claim.confirmed && claim.syncScope !== "rejected")) throw new Error("tailoring_claim_confirmation_required");
      if (!applicable.length) throw new Error("tailoring_no_selected_changes");
      if (input.plan.basedOnRevisionId && input.plan.basedOnRevisionId !== branch.currentRevisionId) throw new RevisionConflictError();
      const closureIssues = validateTailoringClaimClosure({ claims: applicable, branch });
      if (closureIssues.length) throw new Error(closureIssues[0].code);
      const now = new Date().toISOString();
      const patched = applyTailoringClaimsToBranch(branch, applicable, now);
      const contentItems = patched.contentItems;
      const nextBase = ResumeBranchSchema.parse({
        ...branch,
        contentItems,
        structuredContentItems: patched.structuredContentItems,
        revision: branch.revision + 1,
        updatedAt: now
      });
      const revision = createResumeRevision({ branch: nextBase, source: "suggestion_accept", operationId: input.operationId, previousRevisionId: branch.currentRevisionId, now });
      const nextBranch = ResumeBranchSchema.parse({ ...nextBase, currentRevisionId: revision.id, tailoringAppliedCount: (branch.tailoringAppliedCount ?? 0) + 1 });
      const operation = ResumeBranchOperationSchema.parse({
        id: `resume-branch-op-${input.operationId}`, operationId: input.operationId, branchId: branch.id, type: "suggestion_accept",
        expectedRevision: input.expectedBranchRevision, beforeRevision: branch.revision, afterRevision: nextBranch.revision,
        revisionId: revision.id, occurredAt: now, createdAt: now, updatedAt: now
      });
      await this.db.resumeBranches.put(nextBranch);
      await this.db.resumeRevisions.put(revision);
      await this.db.resumeBranchOperations.put(operation);
      return { branch: nextBranch, revision, idempotent: false };
    });
  }

  async applyTailoringDiffs(input: {
    branchId: string;
    jobId: string;
    diffs: ResumeTailoringDiff[];
    confirmedRequirementIds?: string[];
    operationId: string;
    expectedBranchRevision: number;
    expectedRevisionId: string;
  }) {
    return this.db.transaction("rw", [this.db.resumeBranches, this.db.resumeRevisions, this.db.resumeBranchOperations], async () => {
      const existing = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
      if (existing?.revisionId) {
        const branch = await this.db.resumeBranches.get(input.branchId);
        if (!branch) throw new Error("tailoring_branch_missing");
        return {
          branch: ResumeBranchSchema.parse(branch),
          revision: await this.getResumeRevisionInTransaction(existing.revisionId),
          appliedDiffs: input.diffs,
          rejectedDiffs: [],
          warnings: [],
          idempotent: true
        };
      }
      const branch = await this.requireEditableResumeBranch(input.branchId);
      if (branch.branchPurpose !== "job_specific" || branch.jobId !== input.jobId) throw new Error("tailoring_plan_target_invalid");
      if (branch.revision !== input.expectedBranchRevision || branch.currentRevisionId !== input.expectedRevisionId) throw new RevisionConflictError();

      const validation = validateEachTailoringDiffLocally({
        branch,
        diffs: input.diffs,
        confirmedRequirementIds: input.confirmedRequirementIds,
        allowUnconfirmed: false
      });
      if (!validation.patches.length) {
        return {
          branch,
          revision: undefined,
          appliedDiffs: validation.appliedDiffs,
          rejectedDiffs: validation.rejectedDiffs,
          warnings: [...validation.warnings, "No valid selected diff was written; no revision was created."],
          idempotent: false
        };
      }

      const now = new Date().toISOString();
      const claims = validation.appliedDiffs.map((diff, index): TailoringClaim => ({
        id: `tailoring-diff-${input.operationId}-${index}`,
        section: diff.target.sectionId as TailoringClaim["section"],
        targetContentItemId: diff.target.itemId,
        targetFieldPath: diff.target.fieldPath,
        currentText: Array.isArray(diff.original) ? diff.original.join("\n") : String(diff.original),
        proposedText: Array.isArray(diff.value) ? diff.value.join("\n") : String(diff.value),
        reason: diff.reason,
        keywords: diff.targetKeywords,
        requirementIds: diff.requirementIds,
        supportLevel: diff.supportLevel,
        decision: diff.supportLevel === "verified" ? "auto_applicable" : "requires_confirmation",
        evidenceRefs: diff.evidenceRefs,
        syncScope: "resume_only",
        confirmed: diff.supportLevel !== "verified",
        targetPatches: [validation.patches[index]]
      }));
      const patched = applyTailoringClaimsToBranch(branch, claims, now);
      const nextBase = ResumeBranchSchema.parse({
        ...branch,
        contentItems: patched.contentItems,
        structuredContentItems: patched.structuredContentItems,
        revision: branch.revision + 1,
        updatedAt: now
      });
      const revision = createResumeRevision({ branch: nextBase, source: "suggestion_accept", operationId: input.operationId, previousRevisionId: branch.currentRevisionId, now });
      const nextBranch = ResumeBranchSchema.parse({ ...nextBase, currentRevisionId: revision.id, tailoringAppliedCount: (branch.tailoringAppliedCount ?? 0) + 1 });
      const operation = ResumeBranchOperationSchema.parse({
        id: `resume-branch-op-${input.operationId}`,
        operationId: input.operationId,
        branchId: branch.id,
        type: "suggestion_accept",
        expectedRevision: input.expectedBranchRevision,
        beforeRevision: branch.revision,
        afterRevision: nextBranch.revision,
        revisionId: revision.id,
        occurredAt: now,
        createdAt: now,
        updatedAt: now
      });
      await this.db.resumeBranches.put(nextBranch);
      await this.db.resumeRevisions.put(revision);
      await this.db.resumeBranchOperations.put(operation);
      return {
        branch: nextBranch,
        revision,
        appliedDiffs: validation.appliedDiffs,
        rejectedDiffs: validation.rejectedDiffs,
        warnings: validation.warnings,
        idempotent: false
      };
    });
  }

  async createGeneralResumeBranch(input: {
    profileId: string;
    operationId: string;
    name: string;
    includeProfileFacts: boolean;
    includeProfileBasics: boolean;
  }) {
    return this.db.transaction(
      "rw",
      this.db.profiles,
      this.db.resumeBranches,
      this.db.resumeRevisions,
      this.db.resumeBranchOperations,
      this.db.appMeta,
      async () => {
        const existingOperation = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
        if (existingOperation?.branchId && existingOperation.revisionId) {
          const existingBranch = await this.db.resumeBranches.get(existingOperation.branchId);
          if (!existingBranch) throw new Error("resume_branch_missing_for_operation");
          return {
            branch: ResumeBranchSchema.parse(existingBranch),
            revision: await this.getResumeRevisionInTransaction(existingOperation.revisionId),
            idempotent: true
          };
        }
        const storedProfile = await this.db.profiles.get(input.profileId);
        if (!storedProfile) throw new Error("profile_missing");
        const profile = CareerProfileSchema.parse(storedProfile);
        const now = new Date().toISOString();
        const built = buildGeneralBranchFromProfile({ ...input, profile, now });
        const operation = ResumeBranchOperationSchema.parse({
          id: `resume-branch-op-${input.operationId}`,
          operationId: input.operationId,
          branchId: built.branch.id,
          type: input.includeProfileBasics || input.includeProfileFacts ? "create_from_profile" : "create_blank",
          beforeRevision: 0,
          afterRevision: built.branch.revision,
          revisionId: built.firstRevision.id,
          occurredAt: now,
          createdAt: now,
          updatedAt: now
        });
        const presentationConfig = createDefaultPresentationConfig({ branch: built.branch, now });
        const runtimeBranch = migrateResumeBranchToV2(built.branch);
        await this.db.resumeBranches.put(runtimeBranch);
        await this.db.resumeRevisions.put(built.firstRevision);
        await this.db.resumeBranchOperations.put(operation);
        await this.db.appMeta.put({
          key: resumePresentationConfigKey(built.branch.id),
          value: presentationConfig,
          updatedAt: now
        });
        return { branch: runtimeBranch, revision: built.firstRevision, idempotent: false };
      }
    );
  }

  async createJobSpecificBranchFromProfile(input: {
    profileId: string;
    jobId: string;
    operationId: string;
    name: string;
    selectedCanonicalItemIds: string[];
    requirementMatchIds: string[];
  }) {
    return this.db.transaction(
      "rw",
      [
        this.db.profiles,
        this.db.jobDescriptions,
        this.db.requirementMatches,
        this.db.resumeBranches,
        this.db.resumeRevisions,
        this.db.resumeBranchOperations,
        this.db.appMeta
      ],
      async () => {
        const existingOperation = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
        if (existingOperation?.branchId && existingOperation.revisionId) {
          const existingBranch = await this.db.resumeBranches.get(existingOperation.branchId);
          if (!existingBranch) throw new Error("resume_branch_missing_for_operation");
          return { branch: ResumeBranchSchema.parse(existingBranch), revision: await this.getResumeRevisionInTransaction(existingOperation.revisionId), idempotent: true };
        }
        const [storedProfile, storedJob, storedMatches] = await Promise.all([
          this.db.profiles.get(input.profileId),
          this.db.jobDescriptions.get(input.jobId),
          this.db.requirementMatches.where("[profileId+jobId]").equals([input.profileId, input.jobId]).toArray()
        ]);
        if (!storedProfile) throw new Error("profile_missing");
        if (!storedJob) throw new Error("job_missing");
        const profile = CareerProfileSchema.parse(storedProfile);
        const job = JobDescriptionSchema.parse(storedJob);
        if (job.requirements.length === 0) throw new Error("job_has_no_requirements");
        const requestedIds = new Set(input.requirementMatchIds);
        const matches = storedMatches.map((match) => RequirementMatchSchema.parse(match)).filter((match) => requestedIds.has(match.id));
        // Branch creation copies only explicitly selected, already-confirmed source
        // content. Evidence coverage is required when applying generated claims,
        // not when creating an isolated job-specific branch.
        const now = new Date().toISOString();
        const built = buildJobBranchFromProfile({
          profile,
          jobId: job.id,
          jobTitle: job.title,
          jobVersion: job.updatedAt,
          operationId: input.operationId,
          name: input.name,
          selectedCanonicalItemIds: input.selectedCanonicalItemIds,
          requirementMatchIds: matches.map((match) => match.id),
          sourceMatchSetHash: computeRequirementsHash({ job, matches }),
          now
        });
        const operation = ResumeBranchOperationSchema.parse({
          id: `resume-branch-op-${input.operationId}`,
          operationId: input.operationId,
          branchId: built.branch.id,
          type: "derive_job_branch",
          beforeRevision: 0,
          afterRevision: built.branch.revision,
          revisionId: built.firstRevision.id,
          occurredAt: now,
          createdAt: now,
          updatedAt: now
        });
        const presentationConfig = createDefaultPresentationConfig({ branch: built.branch, now });
        await this.db.resumeBranches.put(built.branch);
        await this.db.resumeRevisions.put(built.firstRevision);
        await this.db.resumeBranchOperations.put(operation);
        await this.db.appMeta.put({ key: resumePresentationConfigKey(built.branch.id), value: presentationConfig, updatedAt: now });
        return { branch: built.branch, revision: built.firstRevision, idempotent: false };
      }
    );
  }

  async createResumeBranchFromDraft(input: {
    draftId: string;
    expectedDraftRevision: number;
    operationId: string;
    name: string;
  }) {
    return this.db.transaction(
      "rw",
      [
        this.db.jobAdaptationDrafts,
        this.db.aiSuggestions,
        this.db.profiles,
        this.db.jobDescriptions,
        this.db.requirementMatches,
        this.db.resumeBranches,
        this.db.resumeRevisions,
        this.db.resumeBranchOperations
      ],
      async () => {
        const existingOperation = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
        if (existingOperation?.branchId) {
          const branch = await this.db.resumeBranches.get(existingOperation.branchId);
          if (!branch) {
            throw new Error("resume_branch_missing_for_operation");
          }
          return {
            branch: ResumeBranchSchema.parse(branch),
            revision: existingOperation.revisionId ? await this.getResumeRevisionInTransaction(existingOperation.revisionId) : undefined,
            idempotent: true,
            warnings: [] as string[]
          };
        }

        const draft = await this.db.jobAdaptationDrafts.get(input.draftId);
        if (!draft || draft.revision !== input.expectedDraftRevision) {
          throw new RevisionConflictError();
        }
        const parsedDraft = JobAdaptationDraftSchema.parse(draft);
        const [profile, job, suggestions, matches] = await Promise.all([
          this.db.profiles.get(parsedDraft.profileId),
          this.db.jobDescriptions.get(parsedDraft.jobId),
          this.db.aiSuggestions.where("draftId").equals(parsedDraft.id).toArray(),
          this.db.requirementMatches.where("[profileId+jobId]").equals([parsedDraft.profileId, parsedDraft.jobId]).toArray()
        ]);

        if (!profile || !job) {
          throw new Error("branch_source_missing");
        }

        const now = new Date().toISOString();
        const mapped = mapAdaptationDraftToResumeBranch({
          draft: parsedDraft,
          suggestions: suggestions.map((suggestion) => AiSuggestionSchema.parse(suggestion)),
          profile: CareerProfileSchema.parse(profile),
          job: JobDescriptionSchema.parse(job),
          matches: matches.map((match) => RequirementMatchSchema.parse(match)),
          operationId: input.operationId,
          name: input.name,
          now
        });
        const operation = ResumeBranchOperationSchema.parse({
          id: `resume-branch-op-${input.operationId}`,
          operationId: input.operationId,
          branchId: mapped.branch.id,
          sourceAdaptationDraftId: parsedDraft.id,
          type: "create_from_draft",
          expectedRevision: input.expectedDraftRevision,
          beforeRevision: 0,
          afterRevision: mapped.branch.revision,
          revisionId: mapped.firstRevision.id,
          occurredAt: now,
          createdAt: now,
          updatedAt: now
        });

        const runtimeBranch = migrateResumeBranchToV2(mapped.branch);
        await this.db.resumeBranches.put(runtimeBranch);
        await this.db.resumeRevisions.put(mapped.firstRevision);
        await this.db.resumeBranchOperations.put(operation);
        return {
          branch: runtimeBranch,
          revision: mapped.firstRevision,
          idempotent: false,
          warnings: mapped.warnings
        };
      }
    );
  }

  async findDerivedJobBranches(input: {
    sourceBranchId: string;
    jobId: string;
    sourceRevisionId?: string;
  }) {
    const branches = await this.db.resumeBranches.toArray();
    return branches
      .map((branch) => ResumeBranchSchema.parse(branch))
      .filter((branch) =>
        branch.branchPurpose === "job_specific"
        && branch.sourceBranchId === input.sourceBranchId
        && branch.jobId === input.jobId
        && (!input.sourceRevisionId || branch.sourceRevisionId === input.sourceRevisionId)
        && branch.lifecycleStatus === "active"
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async deriveJobSpecificBranchFromBranch(input: {
    sourceBranchId: string;
    jobId: string;
    expectedSourceRevision: number;
    expectedSourceRevisionId: string;
    operationId: string;
    name: string;
    allowDuplicate?: boolean;
  }) {
    return this.db.transaction(
      "rw",
      [
        this.db.profiles,
        this.db.jobDescriptions,
        this.db.requirementMatches,
        this.db.resumeBranches,
        this.db.resumeRevisions,
        this.db.resumeBranchOperations,
        this.db.appMeta
      ],
      async () => {
        const existingOperation = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
        if (existingOperation?.branchId) {
          const branch = await this.db.resumeBranches.get(existingOperation.branchId);
          if (!branch) {
            throw new Error("resume_branch_missing_for_operation");
          }
          return {
            branch: ResumeBranchSchema.parse(branch),
            revision: existingOperation.revisionId ? await this.getResumeRevisionInTransaction(existingOperation.revisionId) : undefined,
            duplicate: false,
            idempotent: true
          };
        }

        const duplicate = (await this.findDerivedJobBranches({
          sourceBranchId: input.sourceBranchId,
          jobId: input.jobId,
          sourceRevisionId: input.expectedSourceRevisionId
        }))[0];
        if (duplicate && !input.allowDuplicate) {
          return {
            branch: duplicate,
            revision: duplicate.currentRevisionId ? await this.getResumeRevisionInTransaction(duplicate.currentRevisionId) : undefined,
            duplicate: true,
            idempotent: true
          };
        }

        const sourceBranch = await this.requireEditableResumeBranch(input.sourceBranchId);
        if (sourceBranch.branchPurpose !== "general") {
          throw new Error("derive_branch_requires_general_source");
        }
        if (sourceBranch.revision !== input.expectedSourceRevision || sourceBranch.currentRevisionId !== input.expectedSourceRevisionId) {
          throw new RevisionConflictError();
        }

        const [profile, job, matches] = await Promise.all([
          this.db.profiles.get(sourceBranch.profileId),
          this.db.jobDescriptions.get(input.jobId),
          this.db.requirementMatches.where("[profileId+jobId]").equals([sourceBranch.profileId, input.jobId]).toArray()
        ]);
        if (!profile || !job) {
          throw new Error("derive_branch_source_missing");
        }
        const parsedProfile = CareerProfileSchema.parse(profile);
        const parsedJob = JobDescriptionSchema.parse(job);
        const parsedMatches = matches
          .map((match) => RequirementMatchSchema.parse(match))
          .filter((match) => matchesResumeSource(match, {
            branchId: sourceBranch.id,
            branchRevision: sourceBranch.revision,
            revisionId: sourceBranch.currentRevisionId ?? ""
          }));
        if (parsedJob.requirements.length === 0) throw new Error("job_has_no_requirements");
        if (sourceBranch.contentItems.every((item) => item.itemType === "structural" || !item.text.trim())) {
          throw new Error("source_resume_has_no_content");
        }

        const now = new Date().toISOString();
        const sourceMatchSetHash = computeRequirementsHash({ job: parsedJob, matches: parsedMatches });
        const branchId = `branch-${sourceBranch.profileId}-${parsedJob.id}-${stableHashText(input.operationId).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 18)}`;
        const branchWithoutSync = ResumeBranchSchema.parse({
          ...sourceBranch,
          id: branchId,
          branchPurpose: "job_specific",
          jobId: parsedJob.id,
          name: input.name.trim(),
          sourceProfileVersion: parsedProfile.version,
          sourceJobVersion: parsedJob.updatedAt,
          sourceAdaptationDraftId: undefined,
          sourceImportId: sourceBranch.sourceImportId,
          sourceBranchId: sourceBranch.id,
          sourceRevisionId: sourceBranch.currentRevisionId,
          derivedAt: now,
          sourceDraftRevision: sourceBranch.revision,
          matcherVersion: parsedMatches[0]?.matcherVersion ?? "evidence-matcher.v1",
          sourceMatchSetHash,
          requirementMatchIds: parsedMatches.map((match) => match.id),
          revision: 0,
          currentRevisionId: undefined,
          lifecycleStatus: "active",
          migrationStatus: "verified",
          resumeBasics: { ...sourceBranch.resumeBasics, targetRole: parsedJob.title },
          contentItems: sourceBranch.contentItems,
          syncStatusCache: {
            status: "in_sync",
            sourceProfileVersion: parsedProfile.version,
            currentProfileVersion: parsedProfile.version,
            sourceJobVersion: parsedJob.updatedAt,
            currentJobVersion: parsedJob.updatedAt,
            invalidFactRefs: [],
            checkedAt: now,
            message: "Branch is in sync with its source profile and job versions."
          },
          legacyPayload: undefined,
          createdAt: now,
          updatedAt: now
        });
        const branchWithSync = ResumeBranchSchema.parse({
          ...branchWithoutSync,
          syncStatusCache: computeBranchSyncStatus({
            branch: branchWithoutSync,
            profile: parsedProfile,
            job: parsedJob,
            now
          })
        });
        const firstRevision = createResumeRevision({
          branch: branchWithSync,
          source: "created",
          operationId: input.operationId,
          now
        });
        const branch = ResumeBranchSchema.parse({
          ...branchWithSync,
          currentRevisionId: firstRevision.id
        });
        const operation = ResumeBranchOperationSchema.parse({
          id: `resume-branch-op-${input.operationId}`,
          operationId: input.operationId,
          branchId: branch.id,
          type: "derive_job_branch",
          beforeRevision: sourceBranch.revision,
          afterRevision: branch.revision,
          revisionId: firstRevision.id,
          occurredAt: now,
          createdAt: now,
          updatedAt: now
        });

        const sourcePresentation = await this.getResumePresentationConfig(sourceBranch.id);
        const targetPresentation = sanitizePresentationConfigForBranch(
          ResumePresentationConfigSchema.parse({
            ...sourcePresentation,
            branchId: branch.id,
            contentRevision: {
              branchRevision: branch.revision,
              currentRevisionId: firstRevision.id
            },
            presentationRevision: 0,
            updatedAt: now
          }),
          branch
        );

        await this.db.resumeBranches.put(branch);
        await this.db.resumeRevisions.put(firstRevision);
        await this.db.resumeBranchOperations.put(operation);
        await this.db.appMeta.put({
          key: resumePresentationConfigKey(branch.id),
          value: targetPresentation,
          updatedAt: now
        });
        return {
          branch,
          revision: firstRevision,
          duplicate: false,
          idempotent: false
        };
      }
    );
  }

  async saveRuleRequirementMatches(input: {
    profile: CareerProfile;
    job: JobDescription;
    matches: RequirementMatch[];
  }) {
    return this.db.transaction("rw", this.db.requirementMatches, this.db.matchOperations, async () => {
      const now = new Date().toISOString();
      const parsed = input.matches.map((match) => {
        validateRequirementMatchReferences(match, {
          profile: input.profile,
          job: input.job,
          matcherVersion: match.matcherVersion
        });
        return withResolvedEffectiveMatch(match);
      });

      const operations = parsed.map((match) =>
        MatchOperationSchema.parse({
          id: `match-op-rule-${match.id}`,
          operationId: `rule-${match.id}-${match.candidateSetHash}`,
          requirementMatchId: match.id,
          profileId: match.profileId,
          jobId: match.jobId,
          type: "rule_evaluation",
          afterEvaluation: match.ruleEvaluation,
          occurredAt: now,
          createdAt: now,
          updatedAt: now
        })
      );

      await this.db.requirementMatches.bulkPut(parsed);
      await this.db.matchOperations.bulkPut(operations);
      return parsed;
    });
  }

  async saveAiRequirementMatches(input: {
    profile: CareerProfile;
    job: JobDescription;
    matches: RequirementMatch[];
  }) {
    return this.db.transaction("rw", this.db.requirementMatches, this.db.matchOperations, async () => {
      const now = new Date().toISOString();
      const parsed = input.matches.map((match) => {
        validateRequirementMatchReferences(match, {
          profile: input.profile,
          job: input.job,
          matcherVersion: match.matcherVersion
        });
        return withResolvedEffectiveMatch(match);
      });

      const operations = parsed
        .filter((match) => match.aiEvaluation)
        .map((match) =>
          MatchOperationSchema.parse({
            id: `match-op-ai-${match.id}`,
            operationId: `ai-${match.id}-${match.candidateSetHash}`,
            requirementMatchId: match.id,
            profileId: match.profileId,
            jobId: match.jobId,
            type: "ai_evaluation",
            afterEvaluation: match.aiEvaluation,
            occurredAt: now,
            createdAt: now,
            updatedAt: now
          })
        );

      await this.db.requirementMatches.bulkPut(parsed);
      if (operations.length > 0) {
        await this.db.matchOperations.bulkPut(operations);
      }
      return parsed;
    });
  }

  async saveManualMatchOverride(input: {
    profile: CareerProfile;
    job: JobDescription;
    matchId: string;
    operationId: string;
    nextEvaluation: MatchEvaluation & { source: "manual" };
    reason: string;
  }) {
    return this.db.transaction("rw", this.db.requirementMatches, this.db.matchOperations, async () => {
      const existingOperation = await this.db.matchOperations.where("operationId").equals(input.operationId).first();
      if (existingOperation) {
        const existingMatch = await this.db.requirementMatches.get(existingOperation.requirementMatchId);
        if (!existingMatch) {
          throw new Error("manual_override_match_missing");
        }
        return RequirementMatchSchema.parse(existingMatch);
      }

      const match = await this.db.requirementMatches.get(input.matchId);
      if (!match) {
        throw new Error("requirement_match_missing");
      }

      const parsedMatch = RequirementMatchSchema.parse(match);
      const previousEvaluation = resolveEffectiveMatch(parsedMatch);
      const now = new Date().toISOString();
      const manualOverride = {
        id: `manual-override-${input.operationId}`,
        previousEvaluation,
        nextEvaluation: input.nextEvaluation,
        reason: input.reason,
        overriddenAt: now,
        createdAt: now,
        updatedAt: now
      };
      const updated = withResolvedEffectiveMatch({
        ...parsedMatch,
        manualOverride,
        updatedAt: now
      });

      validateRequirementMatchReferences(updated, {
        profile: input.profile,
        job: input.job,
        matcherVersion: updated.matcherVersion
      });

      const operation = MatchOperationSchema.parse({
        id: `match-op-manual-${input.operationId}`,
        operationId: input.operationId,
        requirementMatchId: updated.id,
        profileId: updated.profileId,
        jobId: updated.jobId,
        type: "manual_override",
        beforeEvaluation: previousEvaluation,
        afterEvaluation: input.nextEvaluation,
        reason: input.reason,
        occurredAt: now,
        createdAt: now,
        updatedAt: now
      });

      await this.db.requirementMatches.put(updated);
      await this.db.matchOperations.put(operation);
      return updated;
    });
  }

  async listRequirementMatches(profileId: string, jobId: string) {
    const matches = await this.db.requirementMatches.where("[profileId+jobId]").equals([profileId, jobId]).toArray();
    return matches.map((match) => RequirementMatchSchema.parse(match));
  }

  async markStaleRequirementMatches(profileId: string, jobId: string, reason: string) {
    return this.db.transaction("rw", this.db.requirementMatches, this.db.matchOperations, async () => {
      const now = new Date().toISOString();
      const matches = await this.db.requirementMatches.where("[profileId+jobId]").equals([profileId, jobId]).toArray();
      const updated = matches.map((match) =>
        RequirementMatchSchema.parse({
          ...match,
          isStale: true,
          updatedAt: now
        })
      );
      const operations = updated.map((match) =>
        MatchOperationSchema.parse({
          id: `match-op-stale-${match.id}-${now}`,
          operationId: `stale-${match.id}-${now}`,
          requirementMatchId: match.id,
          profileId,
          jobId,
          type: "mark_stale",
          reason,
          occurredAt: now,
          createdAt: now,
          updatedAt: now
        })
      );

      if (updated.length > 0) {
        await this.db.requirementMatches.bulkPut(updated);
        await this.db.matchOperations.bulkPut(operations);
      }

      return updated;
    });
  }

  resolveEffectiveMatch(match: RequirementMatch) {
    return resolveEffectiveMatch(match);
  }

  async createJobAdaptationDraft(input: {
    profile: CareerProfile;
    job: JobDescription;
    matches: RequirementMatch[];
    operationId: string;
    branchId?: string;
    sourceBranchId?: string;
    sourceRevisionId?: string;
    sourceBranchRevision?: number;
  }) {
    return this.db.transaction("rw", this.db.jobAdaptationDrafts, this.db.adaptationSnapshots, this.db.suggestionOperations, async () => {
      const existingOperation = await this.db.suggestionOperations.where("operationId").equals(input.operationId).first();
      if (existingOperation) {
        const draft = await this.db.jobAdaptationDrafts.get(existingOperation.draftId);
        if (!draft) {
          throw new Error("adaptation_draft_missing_for_operation");
        }
        return { draft: JobAdaptationDraftSchema.parse(draft), idempotent: true };
      }

      const draft = createJobAdaptationDraft(input);
      const firstSnapshot = draft.snapshots[0];
      const now = new Date().toISOString();
      const operation = SuggestionOperationSchema.parse({
        id: `suggestion-op-${input.operationId}`,
        operationId: input.operationId,
        draftId: draft.id,
        type: "create_draft",
        expectedRevision: 0,
        beforeRevision: 0,
        afterRevision: draft.revision,
        snapshotId: firstSnapshot.id,
        occurredAt: now,
        createdAt: now,
        updatedAt: now
      });

      await this.db.jobAdaptationDrafts.put(draft);
      await this.db.adaptationSnapshots.put(firstSnapshot);
      await this.db.suggestionOperations.put(operation);
      return { draft, idempotent: false };
    });
  }

  async getLatestJobAdaptationDraft(profileId: string, jobId: string) {
    const drafts = await this.db.jobAdaptationDrafts.where("[profileId+jobId]").equals([profileId, jobId]).toArray();
    const draft = drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return draft ? JobAdaptationDraftSchema.parse(draft) : undefined;
  }

  async getJobAdaptationDraft(id: string) {
    const draft = await this.db.jobAdaptationDrafts.get(id);
    return draft ? JobAdaptationDraftSchema.parse(draft) : undefined;
  }

  async listJobAdaptationDrafts(profileId?: string) {
    const drafts = await this.db.jobAdaptationDrafts.toArray();
    return drafts
      .map((draft) => JobAdaptationDraftSchema.parse(draft))
      .filter((draft) => !profileId || draft.profileId === profileId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listAiSuggestions(draftId: string) {
    const suggestions = await this.db.aiSuggestions.where("draftId").equals(draftId).toArray();
    return suggestions.map((suggestion) => AiSuggestionSchema.parse(suggestion));
  }

  async saveGeneratedSuggestions(input: {
    profile: CareerProfile;
    job: JobDescription;
    draftId: string;
    matches: RequirementMatch[];
    suggestions: AiSuggestion[];
    expectedRevision: number;
    operationId: string;
  }) {
    return this.db.transaction("rw", this.db.jobAdaptationDrafts, this.db.aiSuggestions, this.db.adaptationSnapshots, this.db.suggestionOperations, async () => {
      const existingOperation = await this.db.suggestionOperations.where("operationId").equals(input.operationId).first();
      if (existingOperation) {
        const draft = await this.db.jobAdaptationDrafts.get(input.draftId);
        if (!draft) {
          throw new Error("adaptation_draft_missing_for_operation");
        }
        return {
          draft: JobAdaptationDraftSchema.parse(draft),
          suggestions: await this.listAiSuggestions(input.draftId),
          idempotent: true
        };
      }

      const draft = await this.requireDraftRevision(input.draftId, input.expectedRevision);
      assertC2MatchesUsable({ profile: input.profile, job: input.job, matches: input.matches });

      const now = new Date().toISOString();
      const parsedSuggestions = input.suggestions.map((suggestion) => AiSuggestionSchema.parse(suggestion));
      const nextDraft = JobAdaptationDraftSchema.parse({
        ...draft,
        revision: draft.revision + 1,
        status: "ai_completed",
        updatedAt: now
      });
      const snapshot = this.createAdaptationSnapshot(nextDraft, "suggestions_generated", input.operationId, now);
      const operation = this.createSuggestionOperation({
        operationId: input.operationId,
        draftId: draft.id,
        type: "generate",
        expectedRevision: input.expectedRevision,
        beforeRevision: draft.revision,
        afterRevision: nextDraft.revision,
        snapshotId: snapshot.id,
        now
      });

      await this.db.aiSuggestions.bulkPut(parsedSuggestions);
      await this.db.jobAdaptationDrafts.put(nextDraft);
      await this.db.adaptationSnapshots.put(snapshot);
      await this.db.suggestionOperations.put(operation);
      return { draft: nextDraft, suggestions: parsedSuggestions, idempotent: false };
    });
  }

  async saveGeneratedBlockSuggestion(input: {
    profile: CareerProfile;
    job: JobDescription;
    draftId: string;
    matches: RequirementMatch[];
    suggestion: AiSuggestion;
    expectedRevision: number;
    operationId: string;
  }) {
    return this.db.transaction("rw", this.db.jobAdaptationDrafts, this.db.aiSuggestions, this.db.adaptationSnapshots, this.db.suggestionOperations, async () => {
      const existingOperation = await this.db.suggestionOperations.where("operationId").equals(input.operationId).first();
      if (existingOperation) {
        const draft = await this.db.jobAdaptationDrafts.get(input.draftId);
        const suggestion = await this.db.aiSuggestions.get(input.suggestion.id);
        if (!draft || !suggestion) {
          throw new Error("block_suggestion_operation_target_missing");
        }
        return {
          draft: JobAdaptationDraftSchema.parse(draft),
          suggestion: AiSuggestionSchema.parse(suggestion),
          idempotent: true
        };
      }

      const draft = await this.requireDraftRevision(input.draftId, input.expectedRevision);
      assertC2MatchesUsable({ profile: input.profile, job: input.job, matches: input.matches });
      const suggestion = AiSuggestionSchema.parse(input.suggestion);
      if (suggestion.draftId !== draft.id) {
        throw new Error("block_suggestion_draft_mismatch");
      }

      const now = new Date().toISOString();
      const nextDraft = JobAdaptationDraftSchema.parse({
        ...draft,
        revision: draft.revision + 1,
        status: suggestion.status === "blocked_high_risk" ? "ai_partial" : "ai_completed",
        lastGuardedAt: now,
        updatedAt: now
      });
      const snapshot = this.createAdaptationSnapshot(nextDraft, "suggestions_generated", input.operationId, now);
      const nextDraftWithSnapshot = JobAdaptationDraftSchema.parse({
        ...nextDraft,
        snapshots: [...nextDraft.snapshots, snapshot]
      });
      const operation = this.createSuggestionOperation({
        operationId: input.operationId,
        draftId: draft.id,
        suggestionId: suggestion.id,
        type: "generate",
        expectedRevision: input.expectedRevision,
        beforeRevision: draft.revision,
        afterRevision: nextDraftWithSnapshot.revision,
        snapshotId: snapshot.id,
        now
      });

      await this.db.aiSuggestions.put(suggestion);
      await this.db.jobAdaptationDrafts.put(nextDraftWithSnapshot);
      await this.db.adaptationSnapshots.put(snapshot);
      await this.db.suggestionOperations.put(operation);
      return { draft: nextDraftWithSnapshot, suggestion, idempotent: false };
    });
  }

  async rejectSuggestion(input: {
    draftId: string;
    suggestionId: string;
    expectedRevision: number;
    operationId: string;
  }) {
    return this.mutateSuggestion(input, "reject", (draft, suggestion, now) => ({
      draft,
      suggestion: AiSuggestionSchema.parse({ ...suggestion, status: "rejected", updatedAt: now })
    }));
  }

  async ignoreSuggestion(input: {
    draftId: string;
    suggestionId: string;
    expectedRevision: number;
    operationId: string;
  }) {
    return this.mutateSuggestion(input, "ignore", (draft, suggestion, now) => ({
      draft,
      suggestion: AiSuggestionSchema.parse({ ...suggestion, status: "ignored", updatedAt: now })
    }));
  }

  async editSuggestionGuarded(input: {
    draftId: string;
    suggestionId: string;
    expectedRevision: number;
    operationId: string;
    editedText: string;
    guardResult: FactGuardResult;
  }) {
    return this.mutateSuggestion(input, "edit", (draft, suggestion, now) => ({
      draft: JobAdaptationDraftSchema.parse({ ...draft, lastGuardedAt: now, updatedAt: now }),
      suggestion: AiSuggestionSchema.parse({
        ...suggestion,
        editedText: input.editedText,
        guardResult: input.guardResult,
        riskLevel: input.guardResult.riskLevel,
        status: input.guardResult.status === "pass" || input.guardResult.status === "ai_failed_rule_kept" ? "edited_guarded" : input.guardResult.status === "blocked_high_risk" ? "blocked_high_risk" : "edited_pending_guard",
        updatedAt: now
      })
    }));
  }

  async rerunSuggestionGuard(input: {
    draftId: string;
    suggestionId: string;
    expectedRevision: number;
    operationId: string;
    checkedText: string;
    guardResult: FactGuardResult;
  }) {
    return this.mutateSuggestion(input, "rerun_guard", (draft, suggestion, now) => ({
      draft: JobAdaptationDraftSchema.parse({ ...draft, lastGuardedAt: now, updatedAt: now }),
      suggestion: AiSuggestionSchema.parse({
        ...suggestion,
        editedText: input.checkedText === suggestion.suggestedText ? suggestion.editedText : input.checkedText,
        guardResult: input.guardResult,
        riskLevel: input.guardResult.riskLevel,
        status: input.guardResult.status === "pass" || input.guardResult.status === "ai_failed_rule_kept" ? "edited_guarded" : input.guardResult.status === "blocked_high_risk" ? "blocked_high_risk" : "edited_pending_guard",
        updatedAt: now
      })
    }));
  }

  async acceptSuggestion(input: {
    profile: CareerProfile;
    job: JobDescription;
    matches: RequirementMatch[];
    draftId: string;
    suggestionId: string;
    expectedRevision: number;
    operationId: string;
  }) {
    return this.mutateSuggestion(input, "accept", (draft, suggestion, now) => {
      assertC2MatchesUsable({ profile: input.profile, job: input.job, matches: input.matches });

      if (suggestion.status === "blocked_high_risk" || suggestion.riskLevel === "high") {
        throw new AdaptationDraftError("blocked_high_risk_suggestion_cannot_accept");
      }
      if (suggestion.guardResult.status !== "pass" && suggestion.guardResult.status !== "ai_failed_rule_kept") {
        throw new AdaptationDraftError("suggestion_guard_not_passed");
      }

      const nextSections = applySuggestionToSections(draft.sectionTexts, suggestion, now);
      return {
        draft: JobAdaptationDraftSchema.parse({
          ...draft,
          sectionTexts: nextSections,
          appliedSuggestionIds: Array.from(new Set([...draft.appliedSuggestionIds, suggestion.id])),
          updatedAt: now
        }),
        suggestion: AiSuggestionSchema.parse({ ...suggestion, status: "accepted", updatedAt: now })
      };
    });
  }

  async applyResumeBlockSuggestion(input: {
    branchId: string;
    suggestionId: string;
    contentItemId: string;
    expectedBranchRevision: number;
    expectedRevisionId: string;
    expectedOriginalTextHash: string;
    requirementsHash: string;
    operationId: string;
    acceptedText: string;
  }) {
    return this.db.transaction(
      "rw",
      [
        this.db.resumeBranches,
        this.db.resumeRevisions,
        this.db.resumeBranchOperations,
        this.db.profiles,
        this.db.jobDescriptions,
        this.db.requirementMatches,
        this.db.jobAdaptationDrafts,
        this.db.aiSuggestions,
        this.db.adaptationSnapshots,
        this.db.suggestionOperations
      ],
      async () => {
        const existingOperation = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
        if (existingOperation) {
          const branch = await this.db.resumeBranches.get(input.branchId);
          const suggestion = await this.db.aiSuggestions.get(input.suggestionId);
          if (!branch || !suggestion) {
            throw new Error("block_suggestion_apply_target_missing");
          }
          return {
            branch: ResumeBranchSchema.parse(branch),
            suggestion: AiSuggestionSchema.parse(suggestion),
            revision: existingOperation.revisionId ? await this.getResumeRevisionInTransaction(existingOperation.revisionId) : undefined,
            idempotent: true
          };
        }

        const branch = await this.requireEditableResumeBranch(input.branchId);
        if (branch.revision !== input.expectedBranchRevision || branch.currentRevisionId !== input.expectedRevisionId) {
          throw new RevisionConflictError();
        }
        const suggestionRow = await this.db.aiSuggestions.get(input.suggestionId);
        if (!suggestionRow) {
          throw new Error("suggestion_not_found");
        }
        const suggestion = AiSuggestionSchema.parse(suggestionRow);
        if (suggestion.branchId !== branch.id || suggestion.targetContentItemId !== input.contentItemId) {
          throw new Error("suggestion_branch_or_item_mismatch");
        }
        if (!isTextSuggestionType(suggestion.type)) {
          throw new Error("structure_suggestion_requires_presentation_path");
        }
        if (suggestion.status === "accepted") {
          return {
            branch,
            suggestion,
            revision: branch.currentRevisionId ? await this.getResumeRevisionInTransaction(branch.currentRevisionId) : undefined,
            idempotent: true
          };
        }
        if (suggestion.status !== "pending_review" && suggestion.status !== "edited_guarded") {
          throw new Error("suggestion_not_accept_ready");
        }

        const [profile, job, draft, matches] = await Promise.all([
          this.db.profiles.get(branch.profileId),
          branch.jobId ? this.db.jobDescriptions.get(branch.jobId) : Promise.resolve(undefined),
          this.db.jobAdaptationDrafts.get(suggestion.draftId),
          branch.jobId ? this.db.requirementMatches.where("[profileId+jobId]").equals([branch.profileId, branch.jobId]).toArray() : Promise.resolve([])
        ]);
        if (!profile || !job || !draft) {
          throw new Error("block_suggestion_source_missing");
        }
        const parsedProfile = CareerProfileSchema.parse(profile);
        const parsedJob = JobDescriptionSchema.parse(job);
        const parsedDraft = JobAdaptationDraftSchema.parse(draft);
        const matchSource = branch.sourceBranchId && branch.sourceRevisionId
          ? {
            branchId: branch.sourceBranchId,
            branchRevision: branch.sourceDraftRevision,
            revisionId: branch.sourceRevisionId
          }
          : undefined;
        const parsedMatches = matches
          .map((match) => RequirementMatchSchema.parse(match))
          .filter((match) => !matchSource || matchesResumeSource(match, matchSource));
        assertC2MatchesUsable({ profile: parsedProfile, job: parsedJob, matches: parsedMatches });

        const currentRequirementsHash = computeRequirementsHash({ job: parsedJob, matches: parsedMatches });
        const staleReason = staleReasonForSuggestion({ suggestion, branch, requirementsHash: currentRequirementsHash });
        if (staleReason || currentRequirementsHash !== input.requirementsHash) {
          throw new Error(staleReason ?? "requirements_changed");
        }

        const contentItem = branch.contentItems.find((item) => item.id === input.contentItemId);
        if (!contentItem) {
          throw new Error("content_item_not_found");
        }
        if (stableHashText(contentItem.text) !== input.expectedOriginalTextHash) {
          throw new RevisionConflictError();
        }

        const acceptedText = input.acceptedText.trim();
        if (!acceptedText) {
          throw new Error("accepted_text_empty");
        }
        const now = new Date().toISOString();
        const guardResult = runRuleFactGuard({
          originalText: contentItem.originalText,
          checkedText: acceptedText,
          usedEvidenceRefs: suggestion.usedEvidenceRefs.length > 0
            ? suggestion.usedEvidenceRefs
            : resolveBranchFactRefs(parsedProfile, contentItem.factRefs),
          now
        });
        if (guardResult.status === "blocked_high_risk" || guardResult.status === "needs_edit" || guardResult.riskLevel === "high") {
          throw new Error("guard_blocked");
        }

        const nextItems = branch.contentItems.map((item) => {
          if (item.id !== contentItem.id) {
            return item;
          }
          return BranchContentItemSchema.parse({
            ...item,
            text: acceptedText,
            source: "adaptation_draft",
            requirementIds: Array.from(new Set([...item.requirementIds, ...suggestion.requirementIds])),
            sourceSuggestionIds: Array.from(new Set([...item.sourceSuggestionIds, suggestion.id])),
            guardMode: "rule_verified",
            guardStatus: "pass",
            guardRiskLevel: guardResult.riskLevel,
            guardFindings: guardResult.ruleFindings.map((finding) => ({
              type: finding.type,
              text: finding.text,
              severity: finding.severity,
              allowed: finding.allowed,
              message: finding.message
            })),
            guardedAt: guardResult.checkedAt,
            guardVersion: guardResult.guardVersion
          });
        });
        const nextBranchBase = ResumeBranchSchema.parse({
          ...branch,
          contentItems: nextItems,
          structuredContentItems: applySuggestionToStructuredItems(branch, nextItems, suggestion, acceptedText),
          revision: branch.revision + 1,
          updatedAt: now
        });
        const nextBranchWithSync = ResumeBranchSchema.parse({
          ...nextBranchBase,
          syncStatusCache: computeBranchSyncStatus({
            branch: nextBranchBase,
            profile: parsedProfile,
            job: parsedJob,
            now
          })
        });
        const revision = createResumeRevision({
          branch: nextBranchWithSync,
          source: "suggestion_accept",
          operationId: input.operationId,
          previousRevisionId: branch.currentRevisionId ?? undefined,
          now
        });
        const nextBranch = ResumeBranchSchema.parse({
          ...nextBranchWithSync,
          currentRevisionId: revision.id
        });
        const nextSuggestion = AiSuggestionSchema.parse({
          ...suggestion,
          editedText: acceptedText === suggestion.suggestedText ? suggestion.editedText : acceptedText,
          guardResult,
          riskLevel: guardResult.riskLevel,
          status: "accepted",
          updatedAt: now
        });
        const nextDraft = JobAdaptationDraftSchema.parse({
          ...parsedDraft,
          revision: parsedDraft.revision + 1,
          appliedSuggestionIds: Array.from(new Set([...parsedDraft.appliedSuggestionIds, suggestion.id])),
          lastGuardedAt: now,
          updatedAt: now
        });
        const snapshot = this.createAdaptationSnapshot(nextDraft, "suggestion_applied", input.operationId, now);
        const nextDraftWithSnapshot = JobAdaptationDraftSchema.parse({
          ...nextDraft,
          snapshots: [...nextDraft.snapshots, snapshot]
        });
        const suggestionOperation = this.createSuggestionOperation({
          operationId: input.operationId,
          draftId: parsedDraft.id,
          suggestionId: suggestion.id,
          type: "accept",
          expectedRevision: parsedDraft.revision,
          beforeRevision: parsedDraft.revision,
          afterRevision: nextDraftWithSnapshot.revision,
          snapshotId: snapshot.id,
          now
        });
        const branchOperation = ResumeBranchOperationSchema.parse({
          id: `resume-branch-op-${input.operationId}`,
          operationId: input.operationId,
          branchId: branch.id,
          sourceAdaptationDraftId: parsedDraft.id,
          type: "suggestion_accept",
          expectedRevision: input.expectedBranchRevision,
          beforeRevision: branch.revision,
          afterRevision: nextBranch.revision,
          revisionId: revision.id,
          occurredAt: now,
          createdAt: now,
          updatedAt: now
        });

        await this.db.resumeBranches.put(nextBranch);
        await this.db.resumeRevisions.put(revision);
        await this.db.resumeBranchOperations.put(branchOperation);
        await this.db.aiSuggestions.put(nextSuggestion);
        await this.db.jobAdaptationDrafts.put(nextDraftWithSnapshot);
        await this.db.adaptationSnapshots.put(snapshot);
        await this.db.suggestionOperations.put(suggestionOperation);
        return { branch: nextBranch, suggestion: nextSuggestion, revision, idempotent: false };
      }
    );
  }

  async undoSuggestion(input: {
    draftId: string;
    suggestionId: string;
    expectedRevision: number;
    operationId: string;
  }) {
    return this.mutateSuggestion(input, "undo", (draft, suggestion, now) => {
      const snapshots = [...draft.snapshots].sort((a, b) => b.revision - a.revision);
      const previous = snapshots.find((snapshot) => snapshot.revision < draft.revision);
      if (!previous) {
        throw new Error("adaptation_snapshot_missing");
      }

      return {
        draft: JobAdaptationDraftSchema.parse({
          ...draft,
          sectionTexts: previous.sectionTexts,
          appliedSuggestionIds: draft.appliedSuggestionIds.filter((id) => id !== suggestion.id),
          updatedAt: now
        }),
        suggestion: AiSuggestionSchema.parse({ ...suggestion, status: "undone", updatedAt: now })
      };
    });
  }

  async listResumeBranches(profileId?: string) {
    const branches = profileId
      ? await this.db.resumeBranches.where("profileId").equals(profileId).toArray()
      : await this.db.resumeBranches.toArray();
    return branches.map((branch) => migrateResumeBranchToV2(ResumeBranchSchema.parse(branch)));
  }

  async getResumeBranch(branchId: string) {
    const branch = await this.db.resumeBranches.get(branchId);
    return branch ? migrateResumeBranchToV2(ResumeBranchSchema.parse(branch)) : undefined;
  }

  async getResumePresentationConfig(branchId: string) {
    const branch = await this.db.resumeBranches.get(branchId);
    if (!branch) {
      throw new Error("resume_branch_missing");
    }
    const parsedBranch = ResumeBranchSchema.parse(branch);
    const stored = await this.db.appMeta.get(resumePresentationConfigKey(branchId));
    if (stored) {
      try {
        return sanitizePresentationConfigForBranch(
          ResumePresentationConfigSchema.parse(stored.value),
          parsedBranch
        );
      } catch {
        // Stored presentation config is corrupt (malformed JSON, schema mismatch,
        // branch mismatch, or all visible content hidden). Fall back to default.
      }
    }

    const legacyWorkbenchState = await this.db.appMeta.get(resumeWorkbenchStateKey(parsedBranch.profileId));
    return createDefaultPresentationConfig({
      branch: parsedBranch,
      templateId: parseLegacyWorkbenchTemplateId(legacyWorkbenchState?.value),
      now: new Date().toISOString()
    });
  }

  async saveResumePresentationConfig(input: {
    branchId: string;
    expectedBranchRevision: number;
    expectedRevisionId: string;
    expectedPresentationRevision: number;
    operationId: string;
    nextConfig: ResumePresentationConfig;
  }) {
    return this.db.transaction("rw", this.db.resumeBranches, this.db.appMeta, async () => {
      const existingOperation = await this.db.appMeta.get(resumePresentationOperationKey(input.operationId));
      if (existingOperation) {
        const value = existingOperation.value;
        if (!isPresentationOperationValue(value) || value.branchId !== input.branchId) {
          throw new Error("resume_presentation_operation_conflict");
        }
        return {
          config: await this.getResumePresentationConfig(input.branchId),
          idempotent: true
        };
      }

      const branch = await this.requireEditableResumeBranch(input.branchId);
      if (branch.revision !== input.expectedBranchRevision || branch.currentRevisionId !== input.expectedRevisionId) {
        throw new RevisionConflictError();
      }

      const current = await this.getResumePresentationConfig(input.branchId);
      if (current.presentationRevision !== input.expectedPresentationRevision) {
        throw new RevisionConflictError();
      }
      if (input.nextConfig.branchId !== input.branchId) {
        throw new Error("resume_presentation_branch_mismatch");
      }
      if (input.nextConfig.presentationRevision !== input.expectedPresentationRevision + 1) {
        throw new Error("resume_presentation_revision_mismatch");
      }

      const now = new Date().toISOString();
      const nextConfig = sanitizePresentationConfigForBranch(
        ResumePresentationConfigSchema.parse({
          ...input.nextConfig,
          contentRevision: {
            branchRevision: branch.revision,
            currentRevisionId: branch.currentRevisionId
          },
          updatedAt: now
        }),
        branch
      );

      const configMeta: AppMeta = {
        key: resumePresentationConfigKey(input.branchId),
        value: nextConfig,
        updatedAt: now
      };
      const operationMeta: AppMeta = {
        key: resumePresentationOperationKey(input.operationId),
        value: {
          branchId: input.branchId,
          presentationRevision: nextConfig.presentationRevision,
          operationId: input.operationId
        },
        updatedAt: now
      };

      await this.db.appMeta.put(configMeta);
      await this.db.appMeta.put(operationMeta);
      return { config: nextConfig, idempotent: false };
    });
  }

  async listResumeRevisions(branchId: string) {
    const revisions = await this.db.resumeRevisions.where("branchId").equals(branchId).toArray();
    return revisions
      .map((revision) => ResumeRevisionSchema.parse(revision))
      .sort((a, b) => a.revisionNumber - b.revisionNumber);
  }

  async editResumeBranch(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    confirmAsResumeOnly?: boolean;
    edits: Array<{
      itemId: string;
      text?: string;
      structuredItem?: ResumeItemV2;
      order?: number;
      visible?: boolean;
    }>;
  }) {
    return this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "manual_edit",
      source: "manual_edit",
      mutate: async ({ branch, profile, now }) => {
        const nextItems = branch.contentItems.map((item) => {
          const edit = input.edits.find((candidate) => candidate.itemId === item.id);
          if (!edit) {
            return item;
          }

          const nextText = edit.text ?? item.text;
          const textChanged = edit.text !== undefined && edit.text !== item.text;

          // Only run Fact Guard when text actually changed.
          // Visibility-only or order-only edits should not trigger Fact Guard,
          // because originalText vs text divergence from C2 suggestion acceptance
          // would cause false-positive "new entity" findings.
          let guardResult = undefined;
          if (textChanged && item.itemType !== "structural" && !input.confirmAsResumeOnly) {
            const factRefs = item.factRefs;
            const evidenceRefs = resolveBranchFactRefs(profile, factRefs);
            guardResult = runRuleFactGuard({
              originalText: item.originalText,
              checkedText: nextText,
              usedEvidenceRefs: evidenceRefs,
              now
            });

            if (guardResult.status === "blocked_high_risk" || guardResult.status === "needs_edit" || guardResult.riskLevel === "high") {
              throw new Error("branch_edit_fact_guard_blocked");
            }
          }

          return BranchContentItemSchema.parse({
            ...item,
            text: nextText,
            originalText: textChanged && input.confirmAsResumeOnly ? nextText : item.originalText,
            order: edit.order ?? item.order,
            visible: edit.visible ?? item.visible,
            source: "user_manual",
            guardMode: guardResult ? "rule_verified" : item.guardMode,
            guardStatus: guardResult ? "pass" : item.guardStatus,
            guardRiskLevel: guardResult?.riskLevel ?? item.guardRiskLevel,
            guardFindings: guardResult
              ? guardResult.ruleFindings.map((finding) => ({
                  type: finding.type,
                  text: finding.text,
                  severity: finding.severity,
                  allowed: finding.allowed,
                  message: finding.message
                }))
              : item.guardFindings,
            guardedAt: guardResult?.checkedAt ?? item.guardedAt,
            guardVersion: guardResult?.guardVersion ?? item.guardVersion,
            userConfirmation: textChanged && input.confirmAsResumeOnly
              ? {
                  scope: "resume_only",
                  confirmedTextHash: stableHashText(nextText),
                  confirmedAt: now
                }
              : item.userConfirmation
          });
        }).sort((a, b) => a.order - b.order);

        const nextStructuredItems = branch.structuredContentItems?.map((item) => {
          const edit = input.edits.find((candidate) => candidate.itemId === item.id);
          if (!edit) return item;
          const legacyItem = nextItems.find((candidate) => candidate.id === item.id);
          return ResumeContentItemV2Schema.parse({
            ...item,
            data: edit.structuredItem
              ?? (edit.text !== undefined ? applyLegacyTextEditToStructuredItem(item.data, edit.text) : item.data),
            order: edit.order ?? item.order,
            visible: edit.visible ?? item.visible,
            source: legacyItem?.source ?? item.source,
            factRefs: legacyItem?.factRefs ?? item.factRefs,
            guardMode: legacyItem?.guardMode ?? item.guardMode,
            guardStatus: legacyItem?.guardStatus ?? item.guardStatus,
            guardFindings: legacyItem?.guardFindings ?? item.guardFindings,
            userConfirmation: legacyItem?.userConfirmation ?? item.userConfirmation,
            legacyTextProjection: legacyItem?.text ?? item.legacyTextProjection
          });
        }).sort((a, b) => a.order - b.order);

        return ResumeBranchSchema.parse({
          ...branch,
          contentItems: nextItems,
          structuredContentItems: nextStructuredItems
        });
      }
    });
  }

  async editResumeBranchBasics(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    basics: Partial<NonNullable<ResumeBranch["resumeBasics"]>>;
    acknowledgeProfileVersion?: boolean;
  }) {
    return this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "manual_edit",
      source: "manual_edit",
      mutate: async ({ branch, profile }) => {
        const currentBasics = branch.resumeBasics ?? {
            name: profile.basics.name,
            email: profile.basics.email ?? "",
            phone: profile.basics.phone ?? "",
            location: profile.basics.location ?? "",
            summary: profile.basics.summary ?? "",
            links: profile.basics.links
        };
        return ResumeBranchSchema.parse({
          ...branch,
          sourceProfileVersion: input.acknowledgeProfileVersion ? profile.version : branch.sourceProfileVersion,
          resumeBasics: { ...currentBasics, ...input.basics }
        });
      }
    });
  }

  async renameResumeBranch(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    name: string;
  }) {
    return this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "manual_edit",
      source: "manual_edit",
      mutate: async ({ branch }) => {
        const name = input.name.trim();
        if (!name) {
          throw new Error("resume_branch_name_required");
        }
        return ResumeBranchSchema.parse({
          ...branch,
          name
        });
      }
    });
  }

  async duplicateResumeContentItem(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    itemId: string;
  }) {
    const duplicatedItemId = `branch-item-copy-${stableHashText(`${input.branchId}:${input.itemId}:${input.operationId}`).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 28)}`;
    const result = await this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "manual_edit",
      source: "manual_edit",
      mutate: async ({ branch }) => {
        const orderedItems = [...branch.contentItems].sort((a, b) => a.order - b.order);
        const sourceIndex = orderedItems.findIndex((item) => item.id === input.itemId);
        if (sourceIndex < 0) {
          throw new Error("branch_content_item_missing");
        }

        const sourceItem = orderedItems[sourceIndex];
        if (sourceItem.itemType !== "structural" && sourceItem.factRefs.length === 0 && !sourceItem.userConfirmation) {
          throw new Error("branch_content_item_missing_fact_refs");
        }
        if (orderedItems.some((item) => item.id === duplicatedItemId)) {
          return ResumeBranchSchema.parse(branch);
        }

        const duplicatedItem = BranchContentItemSchema.parse({
          ...sourceItem,
          id: duplicatedItemId,
          source: "user_manual",
          visible: true
        });
        const nextItems = [
          ...orderedItems.slice(0, sourceIndex + 1),
          duplicatedItem,
          ...orderedItems.slice(sourceIndex + 1)
        ].map((item, order) => BranchContentItemSchema.parse({
          ...item,
          order
        }));

        return ResumeBranchSchema.parse({
          ...branch,
          contentItems: nextItems,
          structuredContentItems: (() => {
            const sourceStructured = branch.structuredContentItems?.find((item) => item.id === input.itemId);
            if (!sourceStructured) return syncStructuredContentItems(branch, nextItems);
            const withDuplicate = [
              ...(branch.structuredContentItems ?? []),
              ResumeContentItemV2Schema.parse({
                ...sourceStructured,
                id: duplicatedItemId,
                data: { ...sourceStructured.data, id: duplicatedItemId },
                source: "user_manual"
              })
            ];
            return syncStructuredContentItems({ ...branch, structuredContentItems: withDuplicate }, nextItems);
          })()
        });
      }
    });

    return {
      ...result,
      duplicatedItemId
    };
  }

  async addResumeContentItem(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    section: string;
    itemType: "experience" | "skill" | "certificate" | "summary" | "custom";
    text: string;
    organization?: string;
    role?: string;
    location?: string;
    degree?: string;
    major?: string;
    courses?: string[];
    startDate?: string;
    endDate?: string;
    syncToProfile?: boolean;
  }) {
    const newItemId = `branch-item-new-${stableHashText(`${input.branchId}:${input.operationId}`).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 28)}`;
    const text = input.text.trim();
    if (!text) throw new Error("branch_content_item_text_required");
    const result = await this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "manual_edit",
      source: "manual_edit",
      mutate: async ({ branch, profile, now }) => {
        if (branch.contentItems.some((item) => item.id === newItemId)) {
          return ResumeBranchSchema.parse(branch);
        }
        if (!input.syncToProfile) {
          const guardResult = runRuleFactGuard({
            originalText: text,
            checkedText: text,
            usedEvidenceRefs: [],
            now
          });
          const orderedItems = [...branch.contentItems].sort((a, b) => a.order - b.order);
          const maxOrder = orderedItems.length > 0 ? orderedItems[orderedItems.length - 1].order : 0;
          const newItem = BranchContentItemSchema.parse({
            id: newItemId,
            itemType: input.itemType,
            source: "user_manual",
            sourceSectionId: input.section,
            text,
            originalText: text,
            order: maxOrder + 1,
            visible: true,
            requirementIds: [],
            sourceSuggestionIds: [],
            factRefs: [],
            guardMode: "rule_verified",
            guardStatus: "pass",
            guardRiskLevel: guardResult.riskLevel,
            guardFindings: [],
            guardedAt: guardResult.checkedAt,
            guardVersion: guardResult.guardVersion,
            userConfirmation: {
              scope: "resume_only",
              confirmedTextHash: stableHashText(text),
              confirmedAt: now
            }
          });
          const nextItems = [...orderedItems, newItem].map((item, order) =>
            BranchContentItemSchema.parse({ ...item, order })
          );
          return ResumeBranchSchema.parse({
            ...branch,
            contentItems: nextItems,
            structuredContentItems: syncStructuredContentItems(branch, nextItems)
          });
        }
        const entitySuffix = stableHashText(input.operationId).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20);
        const factId = `fact-user-${entitySuffix}`;
        const fact = {
          id: factId,
          statement: text,
          category: input.section === "education" ? "education"
            : input.section === "skills" ? "skill"
              : input.section === "certificates" ? "certificate"
                : input.section === "awards" ? "achievement"
                  : input.section === "language" ? "language"
                    : input.itemType === "experience" ? "experience" : "other",
          provenance: [{
            sourceType: "user_input",
            sourceId: input.operationId,
            sourceText: text,
            confidence: 1,
            confirmedByUser: true,
            riskLevel: "medium",
            createdAt: now
          }],
          confirmedByUser: true,
          riskLevel: "medium",
          createdAt: now,
          updatedAt: now
        };
        let factRefs: ResumeBranch["contentItems"][number]["factRefs"];
        let nextProfile: CareerProfile;
        if (input.itemType === "skill") {
          const skillId = `skill-user-${entitySuffix}`;
          nextProfile = CareerProfileSchema.parse({
            ...profile,
            version: profile.version + 1,
            skills: [...profile.skills, {
              id: skillId,
              name: text.split("\n")[0].slice(0, 80),
              evidenceIds: [],
              fact,
              createdAt: now,
              updatedAt: now
            }],
            updatedAt: now
          });
          factRefs = [{ type: "skill_fact", skillId, factId }];
        } else if (input.itemType === "certificate") {
          const certificateId = `cert-user-${entitySuffix}`;
          nextProfile = CareerProfileSchema.parse({
            ...profile,
            version: profile.version + 1,
            certificates: [...profile.certificates, {
              id: certificateId,
              name: text.split("\n")[0].slice(0, 120),
              evidenceIds: [],
              fact,
              createdAt: now,
              updatedAt: now
            }],
            updatedAt: now
          });
          factRefs = [{ type: "certificate_fact", certificateId, factId }];
        } else {
          const experienceId = `exp-user-${entitySuffix}`;
          const experienceType = input.section === "education" ? "education"
            : input.section === "internship" ? "internship"
              : input.section === "projects" ? "project"
                : input.section === "campus" ? "campus"
                  : input.itemType === "experience" ? "work" : "other";
          nextProfile = CareerProfileSchema.parse({
            ...profile,
            version: profile.version + 1,
            experiences: [...profile.experiences, {
              id: experienceId,
              type: experienceType,
              organization: input.organization?.trim() || sectionProfileLabel(input.section),
              role: input.role?.trim() || sectionProfileLabel(input.section),
              location: input.location?.trim() || undefined,
              degree: input.degree?.trim() || undefined,
              major: input.major?.trim() || undefined,
              courses: input.courses ?? [],
              startDate: input.startDate || undefined,
              endDate: input.endDate || undefined,
              facts: [fact],
              resumeDrafts: [{
                id: `draft-user-${entitySuffix}`,
                text,
                factIds: [factId],
                createdAt: now,
                updatedAt: now
              }],
              tags: [input.section],
              evidenceIds: [],
              createdAt: now,
              updatedAt: now
            }],
            updatedAt: now
          });
          factRefs = [{ type: "experience_fact", experienceId, factId }];
        }
        const guardResult = runRuleFactGuard({
          originalText: text,
          checkedText: text,
          usedEvidenceRefs: resolveBranchFactRefs(nextProfile, factRefs),
          now
        });
        if (guardResult.status === "blocked_high_risk" || guardResult.status === "needs_edit" || guardResult.riskLevel === "high") {
          throw new Error("branch_edit_fact_guard_blocked");
        }
        const orderedItems = [...branch.contentItems].sort((a, b) => a.order - b.order);
        const maxOrder = orderedItems.length > 0 ? orderedItems[orderedItems.length - 1].order : 0;
        const newItem = BranchContentItemSchema.parse({
          id: newItemId,
          itemType: input.itemType,
          source: "user_manual",
          sourceSectionId: input.section,
          text,
          originalText: text,
          order: maxOrder + 1,
          visible: true,
          requirementIds: [],
          sourceSuggestionIds: [],
          factRefs,
          guardMode: "rule_verified",
          guardStatus: "pass",
          guardRiskLevel: guardResult.riskLevel,
          guardFindings: guardResult.ruleFindings.map((finding) => ({
            type: finding.type,
            text: finding.text,
            severity: finding.severity,
            allowed: finding.allowed,
            message: finding.message
          })),
          guardedAt: guardResult.checkedAt,
          guardVersion: guardResult.guardVersion
        });
        const nextItems = [...orderedItems, newItem].map((item, order) =>
          BranchContentItemSchema.parse({ ...item, order })
        );
        await this.db.profiles.put(nextProfile);
        return ResumeBranchSchema.parse({
          ...branch,
          sourceProfileVersion: nextProfile.version,
          contentItems: nextItems,
          structuredContentItems: syncStructuredContentItems(branch, nextItems)
        });
      }
    });
    return { ...result, newItemId };
  }

  async syncResumeContentItemToProfile(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    itemId: string;
    organization?: string;
    role?: string;
    location?: string;
    degree?: string;
    major?: string;
    courses?: string[];
    startDate?: string;
    endDate?: string;
  }) {
    return this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "manual_edit",
      source: "manual_edit",
      mutate: async ({ branch, profile, now }) => {
        const item = branch.contentItems.find((candidate) => candidate.id === input.itemId);
        if (!item || item.itemType === "structural") {
          throw new Error("branch_content_item_missing");
        }

        const text = item.text.trim();
        const inferredFields = inferProfileFieldsFromResumeText(text);
        const entitySuffix = stableHashText(`${input.operationId}:${item.id}`).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20);
        const existingRef = item.factRefs[0];
        let factRefs: ResumeBranch["contentItems"][number]["factRefs"] = item.factRefs;
        let nextProfile: CareerProfile;

        if (item.itemType === "summary") {
          nextProfile = CareerProfileSchema.parse({
            ...profile,
            basics: {
              ...profile.basics,
              summary: text
            },
            version: profile.version + 1,
            updatedAt: now
          });
          await this.db.profiles.put(nextProfile);
          return ResumeBranchSchema.parse({
            ...branch,
            sourceProfileVersion: nextProfile.version
          });
        } else if (existingRef?.type === "experience_fact") {
          nextProfile = CareerProfileSchema.parse({
            ...profile,
            version: profile.version + 1,
            experiences: profile.experiences.map((experience) => experience.id === existingRef.experienceId
              ? {
                  ...experience,
                  organization: input.organization?.trim() || inferredFields.organization || experience.organization,
                  role: input.role?.trim() || inferredFields.role || experience.role,
                  location: input.location?.trim() || inferredFields.location || experience.location,
                  degree: input.degree?.trim() || inferredFields.degree || experience.degree,
                  major: input.major?.trim() || inferredFields.major || experience.major,
                  courses: input.courses ?? (inferredFields.courses ? inferredFields.courses.split(/[、,，]/).map((value) => value.trim()).filter(Boolean) : experience.courses),
                  startDate: input.startDate || inferredFields.startDate || experience.startDate,
                  endDate: input.endDate || inferredFields.endDate || experience.endDate,
                  facts: experience.facts.map((fact) => fact.id === existingRef.factId
                    ? confirmedUserFact({ ...fact, statement: text }, input.operationId, text, now)
                    : fact),
                  resumeDrafts: upsertProfileResumeDraft(experience.resumeDrafts, existingRef.factId, text, entitySuffix, now),
                  updatedAt: now
                }
              : experience),
            updatedAt: now
          });
        } else if (existingRef?.type === "skill_fact") {
          nextProfile = CareerProfileSchema.parse({
            ...profile,
            version: profile.version + 1,
            skills: profile.skills.map((skill) => skill.id === existingRef.skillId
              ? {
                  ...skill,
                  name: text.split("\n")[0].slice(0, 80),
                  fact: skill.fact ? confirmedUserFact({ ...skill.fact, statement: text }, input.operationId, text, now) : skill.fact,
                  updatedAt: now
                }
              : skill),
            updatedAt: now
          });
        } else if (existingRef?.type === "certificate_fact") {
          nextProfile = CareerProfileSchema.parse({
            ...profile,
            version: profile.version + 1,
            certificates: profile.certificates.map((certificate) => certificate.id === existingRef.certificateId
              ? {
                  ...certificate,
                  name: text.split("\n")[0].slice(0, 120),
                  fact: certificate.fact ? confirmedUserFact({ ...certificate.fact, statement: text }, input.operationId, text, now) : certificate.fact,
                  updatedAt: now
                }
              : certificate),
            updatedAt: now
          });
        } else {
          const factId = `fact-user-${entitySuffix}`;
          const fact = confirmedUserFact({
            id: factId,
            statement: text,
            category: profileFactCategory(item.sourceSectionId, item.itemType),
            provenance: [],
            confirmedByUser: true,
            riskLevel: "medium",
            createdAt: now,
            updatedAt: now
          }, input.operationId, text, now);

          if (item.itemType === "skill") {
            const skillId = `skill-user-${entitySuffix}`;
            nextProfile = CareerProfileSchema.parse({
              ...profile,
              version: profile.version + 1,
              skills: [...profile.skills, {
                id: skillId,
                name: text.split("\n")[0].slice(0, 80),
                evidenceIds: [],
                fact,
                createdAt: now,
                updatedAt: now
              }],
              updatedAt: now
            });
            factRefs = [{ type: "skill_fact", skillId, factId }];
          } else if (item.itemType === "certificate") {
            const certificateId = `cert-user-${entitySuffix}`;
            nextProfile = CareerProfileSchema.parse({
              ...profile,
              version: profile.version + 1,
              certificates: [...profile.certificates, {
                id: certificateId,
                name: text.split("\n")[0].slice(0, 120),
                evidenceIds: [],
                fact,
                createdAt: now,
                updatedAt: now
              }],
              updatedAt: now
            });
            factRefs = [{ type: "certificate_fact", certificateId, factId }];
          } else {
            const experienceId = `exp-user-${entitySuffix}`;
            nextProfile = CareerProfileSchema.parse({
              ...profile,
              version: profile.version + 1,
              experiences: [...profile.experiences, {
                id: experienceId,
                type: profileExperienceType(item.sourceSectionId),
                organization: input.organization?.trim() || inferredFields.organization || sectionProfileLabel(item.sourceSectionId ?? "custom"),
                role: input.role?.trim() || inferredFields.role || sectionProfileLabel(item.sourceSectionId ?? "custom"),
                startDate: input.startDate || inferredFields.startDate || undefined,
                endDate: input.endDate || inferredFields.endDate || undefined,
                facts: [fact],
                resumeDrafts: [{
                  id: `draft-user-${entitySuffix}`,
                  text,
                  factIds: [factId],
                  createdAt: now,
                  updatedAt: now
                }],
                tags: [item.sourceSectionId ?? "custom"],
                evidenceIds: [],
                createdAt: now,
                updatedAt: now
              }],
              updatedAt: now
            });
            factRefs = [{ type: "experience_fact", experienceId, factId }];
          }
        }

        const guardResult = runRuleFactGuard({
          originalText: text,
          checkedText: text,
          usedEvidenceRefs: resolveBranchFactRefs(nextProfile, factRefs),
          now
        });
        const nextItems = branch.contentItems.map((candidate) => candidate.id === item.id
          ? BranchContentItemSchema.parse({
              ...candidate,
              originalText: text,
              factRefs,
              guardMode: "rule_verified",
              guardStatus: "pass",
              guardRiskLevel: guardResult.riskLevel,
              guardFindings: [],
              guardedAt: guardResult.checkedAt,
              guardVersion: guardResult.guardVersion,
              userConfirmation: undefined
            })
          : candidate);
        await this.db.profiles.put(nextProfile);
        return ResumeBranchSchema.parse({
          ...branch,
          sourceProfileVersion: nextProfile.version,
          contentItems: nextItems,
          structuredContentItems: syncStructuredContentItems(branch, nextItems)
        });
      }
    });
  }

  async addResumeContentItemFromProfile(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    section: string;
    experienceId: string;
    factId: string;
  }) {
    const newItemId = `branch-item-profile-use-${stableHashText(`${input.branchId}:${input.operationId}`).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 28)}`;
    const result = await this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "manual_edit",
      source: "manual_edit",
      mutate: async ({ branch, profile, now }) => {
        if (branch.contentItems.some((item) => item.id === newItemId)) return branch;
        const experience = profile.experiences.find((candidate) => candidate.id === input.experienceId);
        const fact = experience?.facts.find((candidate) => candidate.id === input.factId);
        if (!experience || !fact || !fact.confirmedByUser || fact.riskLevel === "high") {
          throw new Error("profile_experience_fact_unavailable");
        }
        const draft = experience.resumeDrafts.find((candidate) => candidate.factIds.includes(fact.id));
        const description = draft?.text.trim() || fact.statement.trim();
        const category: ResumeFieldCategoryId = experience.type === "education" ? "education"
          : experience.type === "project" ? "project"
            : experience.type === "internship" ? "internship"
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
          description: parsedDraft.organization ? parsedDraft.description : description,
          highlights: []
        }, category);
        const factRefs: ResumeBranch["contentItems"][number]["factRefs"] = [{
          type: "experience_fact",
          experienceId: experience.id,
          factId: fact.id
        }];
        const guardResult = runRuleFactGuard({
          originalText: text,
          checkedText: text,
          usedEvidenceRefs: resolveBranchFactRefs(profile, factRefs),
          now
        });
        const orderedItems = [...branch.contentItems].sort((a, b) => a.order - b.order);
        const nextItem = BranchContentItemSchema.parse({
          id: newItemId,
          itemType: "experience",
          source: "user_manual",
          sourceSectionId: input.section,
          text,
          originalText: text,
          order: orderedItems.length,
          visible: true,
          requirementIds: [],
          sourceSuggestionIds: [],
          factRefs,
          guardMode: "rule_verified",
          guardStatus: "pass",
          guardRiskLevel: guardResult.riskLevel,
          guardFindings: [],
          guardedAt: guardResult.checkedAt,
          guardVersion: guardResult.guardVersion
        });
        return ResumeBranchSchema.parse({
          ...branch,
          sourceProfileVersion: profile.version,
          contentItems: [...orderedItems, nextItem].map((item, order) => ({ ...item, order })),
          structuredContentItems: syncStructuredContentItems(
            branch,
            [...orderedItems, nextItem].map((item, order) => ({ ...item, order }))
          )
        });
      }
    });
    return { ...result, newItemId };
  }

  async addResumeContentItemFromProfileReference(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    section: string;
    reference:
      | { type: "experience"; experienceId: string; factId: string }
      | { type: "skill"; skillId: string; factId: string }
      | { type: "certificate"; certificateId: string; factId: string }
      | { type: "canonical"; itemId: string; sectionType: string };
  }) {
    const reference = input.reference;
    const newItemId = `branch-item-profile-use-${stableHashText(`${input.branchId}:${input.operationId}`).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 28)}`;
    const result = await this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "manual_edit",
      source: "manual_edit",
      mutate: async ({ branch, profile, now }) => {
        if (branch.contentItems.some((item) => item.id === newItemId)) return branch;
        let text = "";
        let itemType: "experience" | "skill" | "certificate" | "custom" = "custom";
        let factRefs: ResumeBranch["contentItems"][number]["factRefs"] = [];
        let canonicalEntry: NonNullable<CareerProfile["structuredFacts"]>[number] | undefined;

        if (reference.type === "canonical") {
          canonicalEntry = profile.structuredFacts?.find((entry) => entry.data.id === reference.itemId && entry.data.sectionType === reference.sectionType);
          if (!canonicalEntry || input.section !== reference.sectionType) throw new Error("profile_canonical_item_unavailable");
          factRefs = resolveStructuredProfileFactRefs(profile, canonicalEntry.factIds);
          const isConfirmedNarrative = canonicalEntry.data.sectionType === "summary" && canonicalEntry.factIds.length === 0;
          if (!isConfirmedNarrative && (!factRefs.length || factRefs.length !== canonicalEntry.factIds.length)) throw new Error("profile_canonical_fact_unavailable");
          text = projectResumeItemV2(canonicalEntry.data);
          itemType = canonicalBranchItemType(canonicalEntry.data.sectionType);
        } else if (reference.type === "experience") {
          const experience = profile.experiences.find((candidate) => candidate.id === reference.experienceId);
          const fact = experience?.facts.find((candidate) => candidate.id === reference.factId);
          if (!experience || !fact || !fact.confirmedByUser || fact.riskLevel === "high") throw new Error("profile_experience_fact_unavailable");
          const draft = experience.resumeDrafts.find((candidate) => candidate.factIds.includes(fact.id));
          const description = draft?.text.trim() || fact.statement.trim();
          const category: ResumeFieldCategoryId = experience.type === "education" ? "education"
            : experience.type === "project" ? "project"
              : experience.type === "internship" ? "internship"
                : experience.type === "campus" || experience.type === "volunteer" ? "campus" : "work";
          const parsedDraft = parseStructuredExperienceText(description);
          text = serializeStructuredExperienceText({
            organization: experience.organization,
            role: experience.role,
            location: experience.location ?? parsedDraft.location,
            degree: experience.degree ?? (experience.type === "education" ? experience.role : ""),
            major: experience.major ?? parsedDraft.major,
            courses: (experience.courses ?? []).join("、") || parsedDraft.courses,
            startDate: experience.startDate ?? parsedDraft.startDate,
            endDate: experience.endDate ?? parsedDraft.endDate,
            current: Boolean(experience.startDate && !experience.endDate),
            description: parsedDraft.organization ? parsedDraft.description : description,
            highlights: []
          }, category);
          itemType = input.section === "awards" ? "custom" : "experience";
          factRefs = [{ type: "experience_fact", experienceId: experience.id, factId: fact.id }];
        } else if (reference.type === "skill") {
          const skill = profile.skills.find((candidate) => candidate.id === reference.skillId);
          if (!skill?.fact || skill.fact.id !== reference.factId || !skill.fact.confirmedByUser || skill.fact.riskLevel === "high") throw new Error("profile_skill_fact_unavailable");
          text = skill.fact.statement.includes(skill.name) ? skill.fact.statement : `${skill.name}\n${skill.fact.statement}`;
          itemType = input.section === "skills" ? "skill" : "custom";
          factRefs = [{ type: "skill_fact", skillId: skill.id, factId: skill.fact.id }];
        } else {
          const certificate = profile.certificates.find((candidate) => candidate.id === reference.certificateId);
          if (!certificate?.fact || certificate.fact.id !== reference.factId || !certificate.fact.confirmedByUser || certificate.fact.riskLevel === "high") throw new Error("profile_certificate_fact_unavailable");
          const metadata = [certificate.issuer, certificate.issuedAt].filter(Boolean).join(" · ");
          text = [certificate.name, metadata, certificate.fact.statement === certificate.name ? "" : certificate.fact.statement].filter(Boolean).join("\n");
          itemType = "certificate";
          factRefs = [{ type: "certificate_fact", certificateId: certificate.id, factId: certificate.fact.id }];
        }

        const duplicate = branch.contentItems.some((item) => item.factRefs.some((ref) => factRefs.some((candidate) => profileFactReferenceEquals(ref, candidate))));
        if (duplicate) throw new Error("profile_item_already_used");
        const isConfirmedNarrative = canonicalEntry?.data.sectionType === "summary" && factRefs.length === 0;
        const guardResult = runRuleFactGuard({
          originalText: text,
          checkedText: text,
          usedEvidenceRefs: resolveBranchFactRefs(profile, factRefs),
          now
        });
        const orderedItems = [...branch.contentItems].sort((a, b) => a.order - b.order);
        const nextItem = BranchContentItemSchema.parse({
          id: newItemId,
          itemType,
          source: "user_manual",
          sourceSectionId: input.section,
          text,
          originalText: text,
          order: orderedItems.length,
          visible: true,
          requirementIds: [],
          sourceSuggestionIds: [],
          factRefs,
          guardMode: isConfirmedNarrative ? "not_fact" : "rule_verified",
          guardStatus: "pass",
          guardRiskLevel: guardResult.riskLevel,
          guardFindings: [],
          guardedAt: now,
          guardVersion: guardResult.guardVersion,
          userConfirmation: isConfirmedNarrative ? { scope: "resume_only", confirmedTextHash: stableHashText(text), confirmedAt: now } : undefined
        });
        const nextContentItems = [...orderedItems, nextItem].map((item, order) => ({ ...item, order }));
        const syncedStructuredItems = syncStructuredContentItems(branch, nextContentItems);
        const nextStructuredItems = canonicalEntry ? syncedStructuredItems.map((item) => item.id === newItemId ? ResumeContentItemV2Schema.parse({
          id: newItemId, schemaVersion: "resume-content-item-v2", data: canonicalEntry!.data, factRefs,
          source: nextItem.source, order: nextItem.order, visible: true, guardMode: nextItem.guardMode,
          guardStatus: nextItem.guardStatus, guardFindings: nextItem.guardFindings, legacyTextProjection: text,
          sourceBlockIds: canonicalEntry!.sourceBlockIds, sourceRanges: canonicalEntry!.sourceRanges,
          sourceExcerpt: canonicalEntry!.sourceExcerpt, mappingTrace: canonicalEntry!.mappingTrace
        }) : item) : syncedStructuredItems;
        return ResumeBranchSchema.parse({
          ...branch,
          sourceProfileVersion: profile.version,
          contentItems: nextContentItems,
          structuredContentItems: nextStructuredItems
        });
      }
    });
    return { ...result, newItemId };
  }

  async restoreResumeRevision(input: {
    branchId: string;
    revisionId: string;
    expectedRevision: number;
    operationId: string;
  }) {
    return this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "restore",
      source: "restore",
      restoredFromRevisionId: input.revisionId,
      mutate: async ({ branch }) => {
        const revision = await this.db.resumeRevisions.get(input.revisionId);
        if (!revision || revision.branchId !== branch.id) {
          throw new Error("restore_revision_missing");
        }

        const parsedRevision = ResumeRevisionSchema.parse(revision);
        return ResumeBranchSchema.parse({
          ...branch,
          name: parsedRevision.snapshot.name,
          lifecycleStatus: parsedRevision.snapshot.lifecycleStatus,
          resumeBasics: parsedRevision.snapshot.resumeBasics,
          contentItems: parsedRevision.snapshot.contentItems,
          structuredContentItems: parsedRevision.snapshot.structuredContentItems
        });
      }
    });
  }

  async undoResumeBranch(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
  }) {
    return this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "undo",
      source: "undo",
      mutate: async ({ branch }) => {
        if (!branch.currentRevisionId) {
          throw new Error("branch_current_revision_missing");
        }

        const currentRevision = await this.db.resumeRevisions.get(branch.currentRevisionId);
        if (!currentRevision?.previousRevisionId) {
          throw new Error("branch_undo_previous_revision_missing");
        }

        const previousRevision = await this.db.resumeRevisions.get(currentRevision.previousRevisionId);
        if (!previousRevision || previousRevision.branchId !== branch.id) {
          throw new Error("branch_undo_target_missing");
        }

        const parsedPrevious = ResumeRevisionSchema.parse(previousRevision);
        return ResumeBranchSchema.parse({
          ...branch,
          name: parsedPrevious.snapshot.name,
          lifecycleStatus: parsedPrevious.snapshot.lifecycleStatus,
          resumeBasics: parsedPrevious.snapshot.resumeBasics,
          contentItems: parsedPrevious.snapshot.contentItems,
          structuredContentItems: parsedPrevious.snapshot.structuredContentItems
        });
      }
    });
  }

  async refreshResumeBranchSyncStatus(input: {
    branchId: string;
    operationId: string;
  }) {
    return this.db.transaction("rw", this.db.resumeBranches, this.db.resumeBranchOperations, this.db.profiles, this.db.jobDescriptions, async () => {
      const existingOperation = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
      if (existingOperation) {
        const branch = await this.db.resumeBranches.get(input.branchId);
        if (!branch) {
          throw new Error("resume_branch_missing");
        }
        return { branch: ResumeBranchSchema.parse(branch), idempotent: true };
      }

      const branch = await this.requireEditableResumeBranch(input.branchId, { allowInvalidReference: true });
      const [profile, job] = await Promise.all([
        this.db.profiles.get(branch.profileId),
        branch.jobId ? this.db.jobDescriptions.get(branch.jobId) : Promise.resolve(undefined)
      ]);
      if (!profile || (branch.branchPurpose !== "general" && !job)) {
        throw new Error("branch_source_missing");
      }

      const now = new Date().toISOString();
      const nextBranch = ResumeBranchSchema.parse({
        ...branch,
        syncStatusCache: branch.branchPurpose === "general"
          ? computeGeneralBranchSyncStatus({
              branch,
              profile: CareerProfileSchema.parse(profile),
              now
            })
          : computeBranchSyncStatus({
              branch,
              profile: CareerProfileSchema.parse(profile),
              job: JobDescriptionSchema.parse(job!),
              now
            }),
        updatedAt: now
      });
      const operation = ResumeBranchOperationSchema.parse({
        id: `resume-branch-op-${input.operationId}`,
        operationId: input.operationId,
        branchId: branch.id,
        type: "refresh_sync_status",
        beforeRevision: branch.revision,
        afterRevision: branch.revision,
        occurredAt: now,
        createdAt: now,
        updatedAt: now
      });
      await this.db.resumeBranches.put(nextBranch);
      await this.db.resumeBranchOperations.put(operation);
      return { branch: nextBranch, idempotent: false };
    });
  }

  async archiveResumeBranch(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    confirmedImpact: true;
  }) {
    return this.transitionResumeBranchLifecycle({
      ...input,
      from: "active",
      to: "archived",
      type: "archive",
      source: "archive"
    });
  }

  async restoreArchivedResumeBranch(input: { branchId: string; expectedRevision: number; operationId: string }) {
    return this.transitionResumeBranchLifecycle({
      ...input,
      from: "archived",
      to: "active",
      type: "restore",
      source: "restore"
    });
  }

  async moveResumeBranchToTrash(input: { branchId: string; expectedRevision: number; operationId: string }) {
    return this.transitionResumeBranchLifecycle({
      ...input,
      from: "archived",
      to: "trashed",
      type: "trash",
      source: "trash"
    });
  }

  async restoreResumeBranchFromTrash(input: { branchId: string; expectedRevision: number; operationId: string }) {
    return this.transitionResumeBranchLifecycle({
      ...input,
      from: "trashed",
      to: "archived",
      type: "restore",
      source: "restore"
    });
  }

  async deleteResumeBranchPermanently(input: { branchId: string; expectedRevision: number }) {
    const branch = await this.db.resumeBranches.get(input.branchId);
    if (!branch) return { deleted: true as const, blockers: { applications: 0, derivedBranches: 0 } };
    const parsed = ResumeBranchSchema.parse(branch);
    if (parsed.revision !== input.expectedRevision) throw new RevisionConflictError();
    if (parsed.lifecycleStatus !== "trashed") throw new Error("resume_branch_not_in_trash");
    const [applications, derivedBranches] = await Promise.all([
      this.db.applications.where("jobSpecificBranchId").equals(parsed.id).count(),
      this.db.resumeBranches.filter((candidate) => candidate.sourceBranchId === parsed.id).count()
    ]);
    const blockers = { applications, derivedBranches };
    if (applications > 0 || derivedBranches > 0) return { deleted: false as const, blockers };
    await this.db.transaction(
      "rw",
      this.db.resumeBranches,
      this.db.resumeRevisions,
      this.db.resumeBranchOperations,
      this.db.exportRecords,
      this.db.appMeta,
      async () => {
        await this.db.resumeRevisions.where("branchId").equals(parsed.id).delete();
        await this.db.resumeBranchOperations.where("branchId").equals(parsed.id).delete();
        await this.db.exportRecords.where("branchId").equals(parsed.id).delete();
        await this.db.appMeta.delete(resumePresentationConfigKey(parsed.id));
        await this.db.appMeta.delete(`resumeDiagnosticsIgnored:${parsed.id}`);
        await this.db.resumeBranches.delete(parsed.id);
      }
    );
    return { deleted: true as const, blockers };
  }

  async saveAiLogs(logs: AiLog[]) {
    const parsed = logs.map((log) => AiLogSchema.parse(log));
    await this.db.aiLogs.bulkPut(parsed);
    return parsed;
  }

  async saveExportRecord(record: ExportRecord) {
    const parsed = ExportRecordSchema.parse(record);
    await this.db.exportRecords.put(parsed);
    return parsed;
  }

  async createResumeExportRecord(input: {
    operationId: string;
    branchId: string;
    expectedBranchRevision: number;
    expectedRevisionId: string;
    templateId: string;
    overflowStatus: ExportOverflowStatus;
    exportStatus: ExportStatus;
    fileName: string;
    displayName?: string;
    errorCode?: string;
    presentationRevision?: number;
    presentationSnapshot?: {
      templateId: string;
      sectionOrder?: string[];
      itemOrderBySection: Record<string, string[]>;
      hiddenItemIds: string[];
      typography?: ResumePresentationConfig["typography"];
      spacing?: ResumePresentationConfig["spacing"];
      theme?: ResumePresentationConfig["theme"];
      pagination?: ResumePresentationConfig["pagination"];
      sectionStyleOverrides?: ResumePresentationConfig["sectionStyleOverrides"];
    };
    exportMethod?: ExportRecord["exportMethod"];
    mimeType?: string;
    fileSize?: number;
    startedAt?: string;
    completedAt?: string;
    failureCode?: string;
    snapshotHash?: string;
    pdfContentHash?: string;
    pagePolicy?: ExportRecord["pagePolicy"];
    actualPageCount?: number;
    requestedMaxPages?: number;
    paginationHash?: string;
    paginationSnapshot?: unknown;
    exceededPageLimit?: boolean;
    continuationHeader?: ExportRecord["continuationHeader"];
    pageSize?: ExportRecord["pageSize"];
    pageDimensions?: ExportRecord["pageDimensions"];
    diagnosticsEngineVersion?: string;
    diagnosticsSnapshotHash?: string;
    criticalIssueCount?: number;
    warningIssueCount?: number;
    requirementCoverageSummary?: ExportRecord["requirementCoverageSummary"];
    allowHistoricalRevision?: boolean;
  }) {
    return this.db.transaction("rw", this.db.resumeBranches, this.db.resumeRevisions, this.db.exportRecords, async () => {
      const existing = await this.db.exportRecords.where("operationId").equals(input.operationId).first();
      if (existing) {
        return {
          record: ExportRecordSchema.parse(existing),
          idempotent: true
        };
      }

      const branch = await this.db.resumeBranches.get(input.branchId);
      if (!branch) {
        throw new Error("export_branch_missing");
      }
      const parsedBranch = ResumeBranchSchema.parse(branch);
      if (parsedBranch.migrationStatus !== "verified") {
        throw new Error("legacy_branch_cannot_export");
      }
      if (parsedBranch.lifecycleStatus !== "active") {
        throw new Error("archived_branch_cannot_export");
      }
      if (parsedBranch.revision !== input.expectedBranchRevision || parsedBranch.currentRevisionId !== input.expectedRevisionId) {
        if (!input.allowHistoricalRevision) {
          throw new RevisionConflictError();
        }
        const historicalRevision = await this.db.resumeRevisions.get(input.expectedRevisionId);
        const parsedRevision = historicalRevision ? ResumeRevisionSchema.parse(historicalRevision) : undefined;
        if (!parsedRevision || parsedRevision.branchId !== parsedBranch.id || parsedRevision.revisionNumber !== input.expectedBranchRevision) {
          throw new RevisionConflictError();
        }
      }
      if (
        (input.exportStatus === "print_invoked" || input.exportStatus === "direct_pdf_success")
        && (input.overflowStatus === "overflow" || input.overflowStatus === "exceeds_two_pages" || input.overflowStatus === "measurement_failed" || input.exceededPageLimit)
      ) {
        throw new Error("export_overflow_blocked");
      }
      if (parsedBranch.syncStatusCache.status === "invalid_reference") {
        throw new Error("export_invalid_reference");
      }

      const now = new Date().toISOString();
      const record = ExportRecordSchema.parse({
        id: `export-${input.operationId}`,
        operationId: input.operationId,
        branchId: parsedBranch.id,
        revisionId: input.expectedRevisionId,
        branchRevision: input.expectedBranchRevision,
        templateId: input.templateId,
        format: "pdf",
        fileName: input.fileName,
        displayName: input.displayName ?? input.fileName,
        exportStatus: input.exportStatus,
        overflowStatus: input.overflowStatus,
        exportedAt: now,
        errorCode: input.errorCode,
        presentationRevision: input.presentationRevision,
        presentationSnapshot: input.presentationSnapshot,
        exportMethod: input.exportMethod,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        failureCode: input.failureCode,
        snapshotHash: input.snapshotHash,
        pdfContentHash: input.pdfContentHash,
        pagePolicy: input.pagePolicy,
        actualPageCount: input.actualPageCount,
        requestedMaxPages: input.requestedMaxPages,
        paginationHash: input.paginationHash,
        paginationSnapshot: input.paginationSnapshot,
        exceededPageLimit: input.exceededPageLimit,
        continuationHeader: input.continuationHeader,
        pageSize: input.pageSize,
        pageDimensions: input.pageDimensions,
        diagnosticsEngineVersion: input.diagnosticsEngineVersion,
        diagnosticsSnapshotHash: input.diagnosticsSnapshotHash,
        criticalIssueCount: input.criticalIssueCount,
        warningIssueCount: input.warningIssueCount,
        requirementCoverageSummary: input.requirementCoverageSummary,
        createdAt: now,
        updatedAt: now
      });

      await this.db.exportRecords.put(record);
      return { record, idempotent: false };
    });
  }

  async listApplicationsByProfile(profileId: string) {
    const rows = await this.db.applications.where("profileId").equals(profileId).toArray();
    return rows
      .map((row) => ApplicationRecordSchema.safeParse(row))
      .filter((result): result is { success: true; data: ApplicationRecord } => result.success)
      .map((result) => result.data)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getApplication(applicationId: string) {
    const row = await this.db.applications.get(applicationId);
    return row ? ApplicationRecordSchema.parse(row) : undefined;
  }

  async listExportRecordsForBranch(branchId: string) {
    const records = await this.db.exportRecords.where("branchId").equals(branchId).toArray();
    return records
      .map((record) => ExportRecordSchema.parse(record))
      .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
  }

  async getApplicationContext(applicationId: string): Promise<ApplicationContext | undefined> {
    const application = await this.getApplication(applicationId);
    if (!application) {
      return undefined;
    }

    const [
      profile,
      job,
      sourceGeneralBranch,
      jobSpecificBranch,
      selectedRevision,
      selectedExportRecord,
      presentationConfig,
      revisions,
      exportRecords
    ] = await Promise.all([
      this.db.profiles.get(application.profileId),
      this.db.jobDescriptions.get(application.jobId),
      application.sourceGeneralBranchId ? this.db.resumeBranches.get(application.sourceGeneralBranchId) : Promise.resolve(undefined),
      this.db.resumeBranches.get(application.jobSpecificBranchId),
      this.db.resumeRevisions.get(application.selectedRevisionId),
      application.selectedExportRecordId ? this.db.exportRecords.get(application.selectedExportRecordId) : Promise.resolve(undefined),
      this.getResumePresentationConfig(application.jobSpecificBranchId).catch(() => undefined),
      this.listResumeRevisions(application.jobSpecificBranchId).catch(() => []),
      this.listExportRecordsForBranch(application.jobSpecificBranchId).catch(() => [])
    ]);

    const parsedExportRecords = exportRecords.filter((record) => record.branchId === application.jobSpecificBranchId);
    return {
      application,
      profile: profile ? CareerProfileSchema.parse(profile) : undefined,
      job: job ? JobDescriptionSchema.parse(job) : undefined,
      sourceGeneralBranch: sourceGeneralBranch ? ResumeBranchSchema.parse(sourceGeneralBranch) : undefined,
      jobSpecificBranch: jobSpecificBranch ? ResumeBranchSchema.parse(jobSpecificBranch) : undefined,
      selectedRevision: selectedRevision ? ResumeRevisionSchema.parse(selectedRevision) : undefined,
      selectedExportRecord: selectedExportRecord ? ExportRecordSchema.parse(selectedExportRecord) : undefined,
      latestExportRecord: parsedExportRecords.find((record) => isSuccessfulApplicationExport(record)),
      presentationConfig,
      revisions,
      exportRecords: parsedExportRecords
    };
  }

  async getApplicationPreparationContext(applicationId: string): Promise<ApplicationPreparationContext | undefined> {
    const context = await this.getApplicationContext(applicationId);
    if (!context?.profile || !context.job || !context.jobSpecificBranch || !context.selectedRevision) {
      return undefined;
    }
    const requirementMatches = await this.listRequirementMatches(context.application.profileId, context.application.jobId);
    return buildApplicationPreparationContext({
      application: context.application,
      profile: context.profile,
      job: context.job,
      branch: context.jobSpecificBranch,
      selectedRevision: context.selectedRevision,
      requirementMatches,
      exportRecord: context.selectedExportRecord
    });
  }

  async loadApplicationPreparationPack(applicationId: string): Promise<{
    context?: ApplicationPreparationContext;
    pack?: ApplicationPreparationPack;
    corrupted: boolean;
  }> {
    const preparationContext = await this.getApplicationPreparationContext(applicationId);
    if (!preparationContext) {
      return { corrupted: false };
    }
    const key = applicationPreparationPackKey(applicationId);
    const stored = await this.db.appMeta.get(key);
    let corrupted = false;
    let pack = stored ? ApplicationPreparationPackSchema.safeParse(stored.value).data : undefined;
    if (stored && !pack) {
      corrupted = true;
    }
    pack = pack ?? createEmptyApplicationPreparationPack(preparationContext);
    const rebased = withUpdatedApplicationPreparationChecklist(
      rebaseApplicationPreparationPack({ pack, context: preparationContext })
    );
    if (!stored || corrupted || JSON.stringify(rebased) !== JSON.stringify(pack)) {
      await this.db.appMeta.put({
        key,
        value: rebased,
        updatedAt: rebased.updatedAt
      });
    }
    return {
      context: preparationContext,
      pack: rebased,
      corrupted
    };
  }

  async saveApplicationPreparationPack(input: {
    applicationId: string;
    expectedVersion: number;
    operationId: string;
    pack: ApplicationPreparationPack;
  }) {
    return this.db.transaction("rw", this.db.applications, this.db.appMeta, async () => {
      const application = await this.db.applications.get(input.applicationId);
      if (!application) {
        throw new Error("application_not_found");
      }
      const parsedApplication = ApplicationRecordSchema.parse(application);
      const operationKey = applicationPreparationOperationKey(input.operationId);
      const existingOperation = await this.db.appMeta.get(operationKey);
      if (existingOperation) {
        const existing = await this.getApplicationPreparationPackInTransaction(input.applicationId);
        if (!existing) {
          throw new Error("invalid_preparation_pack");
        }
        return {
          pack: existing,
          idempotent: true
        };
      }

      const existing = await this.getApplicationPreparationPackInTransaction(input.applicationId);
      if (existing && existing.version !== input.expectedVersion) {
        throw new Error("version_conflict");
      }
      if (!existing && input.expectedVersion !== 0) {
        throw new Error("version_conflict");
      }
      const now = new Date().toISOString();
      assertNoForbiddenPreparationPayload(input.pack);
      const parsedPack = withUpdatedApplicationPreparationChecklist(
        ApplicationPreparationPackSchema.parse({
          ...input.pack,
          applicationId: parsedApplication.id,
          profileId: parsedApplication.profileId,
          jobId: parsedApplication.jobId,
          updatedAt: now
        }),
        now
      );
      await this.db.appMeta.put({
        key: applicationPreparationPackKey(input.applicationId),
        value: parsedPack,
        updatedAt: now
      });
      await this.db.appMeta.put({
        key: operationKey,
        value: {
          applicationId: input.applicationId,
          operationId: input.operationId,
          packVersion: parsedPack.version
        },
        updatedAt: now
      });
      return {
        pack: parsedPack,
        idempotent: false
      };
    });
  }

  private async getApplicationPreparationPackInTransaction(applicationId: string) {
    const stored = await this.db.appMeta.get(applicationPreparationPackKey(applicationId));
    if (!stored) {
      return undefined;
    }
    const parsed = ApplicationPreparationPackSchema.safeParse(stored.value);
    return parsed.success ? parsed.data : undefined;
  }

  async getApplicationReadiness(applicationId: string): Promise<ApplicationReadiness | undefined> {
    const context = await this.getApplicationContext(applicationId);
    if (!context) {
      return undefined;
    }

    const preparation = await this.loadApplicationPreparationPack(applicationId).catch(() => undefined);

    return computeApplicationReadiness({
      application: context.application,
      job: context.job,
      branch: context.jobSpecificBranch,
      revision: context.selectedRevision,
      exportRecord: context.selectedExportRecord,
      preparationChecklist: preparation?.pack?.checklist
    });
  }

  async createApplicationFromBranch(input: {
    branchId: string;
    expectedBranchRevision: number;
    expectedRevisionId: string;
    operationId: string;
    initialStatus?: Extract<ApplicationStatus, "discovered" | "preparing">;
    priority?: ApplicationPriority;
    allowDuplicate?: boolean;
  }) {
    return this.db.transaction(
      "rw",
      [
        this.db.applications,
        this.db.profiles,
        this.db.jobDescriptions,
        this.db.resumeBranches,
        this.db.resumeRevisions,
        this.db.exportRecords,
        this.db.appMeta
      ],
      async () => {
        const existingByOperation = await this.findApplicationByOperationInTransaction(input.operationId);
        if (existingByOperation) {
          return {
            application: existingByOperation,
            duplicate: false,
            idempotent: true
          };
        }

        const branch = await this.db.resumeBranches.get(input.branchId);
        if (!branch) {
          throw new Error("branch_not_found");
        }
        const parsedBranch = ResumeBranchSchema.parse(branch);
        if (parsedBranch.branchPurpose !== "job_specific") {
          throw new Error("invalid_branch_purpose");
        }
        if (!parsedBranch.jobId) {
          throw new Error("job_not_found");
        }
        if (parsedBranch.lifecycleStatus !== "active" || parsedBranch.migrationStatus !== "verified" || parsedBranch.syncStatusCache.status === "invalid_reference") {
          throw new Error("branch_not_editable");
        }
        if (parsedBranch.revision !== input.expectedBranchRevision || parsedBranch.currentRevisionId !== input.expectedRevisionId) {
          throw new RevisionConflictError();
        }

        const [profile, job, revision, presentationConfig] = await Promise.all([
          this.db.profiles.get(parsedBranch.profileId),
          this.db.jobDescriptions.get(parsedBranch.jobId),
          this.db.resumeRevisions.get(input.expectedRevisionId),
          this.getResumePresentationConfig(parsedBranch.id)
        ]);
        if (!profile) {
          throw new Error("no_profile");
        }
        if (!job) {
          throw new Error("job_not_found");
        }
        if (!revision) {
          throw new Error("revision_not_found");
        }
        const parsedProfile = CareerProfileSchema.parse(profile);
        const parsedJob = JobDescriptionSchema.parse(job);
        const parsedRevision = ResumeRevisionSchema.parse(revision);
        if (parsedRevision.branchId !== parsedBranch.id) {
          throw new Error("revision_not_found");
        }
        if (parsedBranch.profileId !== parsedProfile.id) {
          throw new Error("profile_mismatch");
        }
        if (parsedBranch.jobId !== parsedJob.id) {
          throw new Error("job_mismatch");
        }

        const duplicate = (await this.db.applications
          .where("jobSpecificBranchId")
          .equals(parsedBranch.id)
          .toArray())
          .map((row) => ApplicationRecordSchema.safeParse(row))
          .filter((result): result is { success: true; data: ApplicationRecord } => result.success)
          .map((result) => result.data)
          .find((application) =>
            application.profileId === parsedBranch.profileId
            && application.jobId === parsedBranch.jobId
            && application.status !== "archived"
          );
        if (duplicate && !input.allowDuplicate) {
          return {
            application: duplicate,
            duplicate: true,
            idempotent: true
          };
        }

        const now = new Date().toISOString();
        const latestExport = await this.findLatestSuccessfulExportForSelection({
          branchId: parsedBranch.id,
          revisionId: parsedRevision.id,
          branchRevision: parsedBranch.revision
        });
        const sourceGeneralBranchId = await this.resolveSourceGeneralBranchId(parsedBranch);
        const applicationId = `application-${stableHashText(input.operationId).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24)}`;
        const createdEvent = createApplicationTimelineEvent({
          applicationId,
          type: "created",
          operationId: input.operationId,
          summary: `已从岗位分支创建投递记录：${parsedJob.company} / ${parsedJob.title}`,
          now
        });
        const application = ApplicationRecordSchema.parse({
          schemaVersion: "application-v1",
          id: applicationId,
          profileId: parsedProfile.id,
          jobId: parsedJob.id,
          jobTitleSnapshot: parsedJob.title,
          companySnapshot: parsedJob.company,
          sourceGeneralBranchId,
          jobSpecificBranchId: parsedBranch.id,
          selectedRevisionId: parsedRevision.id,
          selectedBranchRevision: parsedBranch.revision,
          selectedPresentationRevision: presentationConfig.presentationRevision,
          selectedTemplateId: presentationConfig.templateId,
          selectedPagePolicy: presentationConfig.pagination.pagePolicy,
          selectedActualPageCount: latestExport?.actualPageCount,
          selectedExportRecordId: latestExport?.id,
          diagnosticSummary: latestExport ? diagnosticSummaryFromExport(latestExport) : undefined,
          status: input.initialStatus ?? "preparing",
          priority: input.priority ?? "normal",
          tags: [],
          timeline: [createdEvent],
          version: 1,
          createdAt: now,
          updatedAt: now
        });

        await this.db.applications.put(application);
        return {
          application,
          duplicate: false,
          idempotent: false
        };
      }
    );
  }

  async updateApplicationStatus(input: {
    applicationId: string;
    expectedVersion: number;
    operationId: string;
    nextStatus: ApplicationStatus;
    appliedAt?: string;
  }) {
    return this.db.transaction("rw", this.db.applications, async () => {
      const application = await this.requireApplicationForWrite(input.applicationId, input.operationId);
      if (application.idempotent) {
        return { application: application.record, idempotent: true };
      }
      const current = application.record;
      assertExpectedApplicationVersion(current, input.expectedVersion);
      if (current.status === input.nextStatus) {
        return { application: current, idempotent: true };
      }
      assertApplicationStatusTransition(current.status, input.nextStatus);

      const now = new Date().toISOString();
      const appliedAt = input.nextStatus === "applied" ? normalizeApplicationDate(input.appliedAt ?? now, "appliedAt") : current.appliedAt;
      const timelineType: ApplicationTimelineEventType = input.nextStatus === "archived" ? "archived" : "status_changed";
      const event = createApplicationTimelineEvent({
        applicationId: current.id,
        type: timelineType,
        operationId: input.operationId,
        summary: input.nextStatus === "archived"
          ? "Application 已归档。"
          : `状态已更新：${current.status} -> ${input.nextStatus}`,
        fromStatus: current.status,
        toStatus: input.nextStatus,
        now
      });
      const next = ApplicationRecordSchema.parse({
        ...current,
        status: input.nextStatus,
        appliedAt,
        appliedSnapshot: input.nextStatus === "applied"
          ? {
              revisionId: current.selectedRevisionId,
              branchRevision: current.selectedBranchRevision,
              presentationRevision: current.selectedPresentationRevision,
              templateId: current.selectedTemplateId,
              exportRecordId: current.selectedExportRecordId,
              lockedAt: now
            }
          : current.appliedSnapshot,
        previousStatusBeforeArchive: input.nextStatus === "archived" ? current.status : current.previousStatusBeforeArchive,
        archivedAt: input.nextStatus === "archived" ? now : current.archivedAt,
        version: current.version + 1,
        updatedAt: now,
        timeline: appendApplicationTimeline(current.timeline, event)
      });
      await this.db.applications.put(next);
      return { application: next, idempotent: false };
    });
  }

  async updateApplicationDetails(input: {
    applicationId: string;
    expectedVersion: number;
    operationId: string;
    priority?: ApplicationPriority;
    sourceChannel?: ApplicationSourceChannel;
    sourceUrl?: string;
    deadlineAt?: string;
    plannedApplyAt?: string;
    appliedAt?: string;
    nextFollowUpAt?: string;
    note?: string;
    tags?: string[];
  }) {
    return this.db.transaction("rw", this.db.applications, async () => {
      const application = await this.requireApplicationForWrite(input.applicationId, input.operationId);
      if (application.idempotent) {
        return { application: application.record, idempotent: true };
      }
      const current = application.record;
      assertExpectedApplicationVersion(current, input.expectedVersion);

      const now = new Date().toISOString();
      const patch: Partial<ApplicationRecord> = {};
      const events: ApplicationTimelineEvent[] = [];

      if (Object.prototype.hasOwnProperty.call(input, "priority") && input.priority !== current.priority) {
        patch.priority = input.priority;
        events.push(createApplicationTimelineEvent({
          applicationId: current.id,
          type: "priority_changed",
          operationId: input.operationId,
          summary: `优先级已更新：${current.priority} -> ${input.priority}`,
          now
        }));
      }
      if (Object.prototype.hasOwnProperty.call(input, "sourceChannel") && input.sourceChannel !== current.sourceChannel) {
        patch.sourceChannel = input.sourceChannel;
      }
      if (Object.prototype.hasOwnProperty.call(input, "sourceUrl")) {
        patch.sourceUrl = sanitizeApplicationUrl(input.sourceUrl);
      }
      if (Object.prototype.hasOwnProperty.call(input, "deadlineAt")) {
        const nextDate = normalizeApplicationDate(input.deadlineAt, "deadlineAt");
        if (nextDate !== current.deadlineAt) {
          patch.deadlineAt = nextDate;
          events.push(createApplicationTimelineEvent({
            applicationId: current.id,
            type: "deadline_changed",
            operationId: input.operationId,
            summary: nextDate ? "截止日期已更新。" : "截止日期已清除。",
            now
          }));
        }
      }
      if (Object.prototype.hasOwnProperty.call(input, "plannedApplyAt")) {
        patch.plannedApplyAt = normalizeApplicationDate(input.plannedApplyAt, "plannedApplyAt");
      }
      if (Object.prototype.hasOwnProperty.call(input, "appliedAt")) {
        patch.appliedAt = normalizeApplicationDate(input.appliedAt, "appliedAt");
      }
      if (Object.prototype.hasOwnProperty.call(input, "nextFollowUpAt")) {
        const nextDate = normalizeApplicationDate(input.nextFollowUpAt, "nextFollowUpAt");
        if (nextDate !== current.nextFollowUpAt) {
          patch.nextFollowUpAt = nextDate;
          events.push(createApplicationTimelineEvent({
            applicationId: current.id,
            type: "follow_up_changed",
            operationId: input.operationId,
            summary: nextDate ? "下次跟进日期已更新。" : "下次跟进日期已清除。",
            now
          }));
        }
      }
      if (Object.prototype.hasOwnProperty.call(input, "note")) {
        const note = sanitizeApplicationText(input.note, 4000);
        if (note !== current.note) {
          patch.note = note;
          events.push(createApplicationTimelineEvent({
            applicationId: current.id,
            type: "note_added",
            operationId: input.operationId,
            summary: note ? "备注已更新。" : "备注已清除。",
            now
          }));
        }
      }
      if (Object.prototype.hasOwnProperty.call(input, "tags")) {
        patch.tags = sanitizeApplicationTags(input.tags);
      }

      const hasPatch = Object.keys(patch).length > 0;
      if (!hasPatch) {
        return { application: current, idempotent: true };
      }
      if (events.length === 0) {
        events.push(createApplicationTimelineEvent({
          applicationId: current.id,
          type: "details_updated",
          operationId: input.operationId,
          summary: "Application 详情已更新。",
          now
        }));
      }

      const next = ApplicationRecordSchema.parse({
        ...current,
        ...patch,
        version: current.version + 1,
        updatedAt: now,
        timeline: events.reduce((timeline, event) => appendApplicationTimeline(timeline, event), current.timeline)
      });
      await this.db.applications.put(next);
      return { application: next, idempotent: false };
    });
  }

  async linkApplicationRevision(input: {
    applicationId: string;
    expectedVersion: number;
    operationId: string;
    revisionId: string;
  }) {
    return this.db.transaction("rw", this.db.applications, this.db.resumeBranches, this.db.resumeRevisions, this.db.exportRecords, this.db.appMeta, async () => {
      const application = await this.requireApplicationForWrite(input.applicationId, input.operationId);
      if (application.idempotent) {
        return { application: application.record, idempotent: true };
      }
      const current = application.record;
      assertExpectedApplicationVersion(current, input.expectedVersion);
      if (current.appliedSnapshot) {
        throw new Error("application_revision_locked");
      }
      const branch = await this.db.resumeBranches.get(current.jobSpecificBranchId);
      if (!branch) {
        throw new Error("branch_not_found");
      }
      const parsedBranch = ResumeBranchSchema.parse(branch);
      const revision = await this.db.resumeRevisions.get(input.revisionId);
      if (!revision) {
        throw new Error("revision_not_found");
      }
      const parsedRevision = ResumeRevisionSchema.parse(revision);
      if (parsedRevision.branchId !== parsedBranch.id) {
        throw new Error("revision_not_found");
      }
      if (parsedBranch.profileId !== current.profileId || parsedBranch.jobId !== current.jobId) {
        throw new Error("job_mismatch");
      }
      const presentationConfig = await this.getResumePresentationConfig(parsedBranch.id);
      const latestExport = await this.findLatestSuccessfulExportForSelection({
        branchId: parsedBranch.id,
        revisionId: parsedRevision.id,
        branchRevision: parsedRevision.revisionNumber
      });
      const now = new Date().toISOString();
      const event = createApplicationTimelineEvent({
        applicationId: current.id,
        type: "revision_selected",
        operationId: input.operationId,
        summary: `已选择 revision ${parsedRevision.revisionNumber}。`,
        now
      });
      const next = ApplicationRecordSchema.parse({
        ...current,
        selectedRevisionId: parsedRevision.id,
        selectedBranchRevision: parsedRevision.revisionNumber,
        selectedPresentationRevision: presentationConfig.presentationRevision,
        selectedTemplateId: presentationConfig.templateId,
        selectedPagePolicy: presentationConfig.pagination.pagePolicy,
        selectedActualPageCount: latestExport?.actualPageCount,
        selectedExportRecordId: latestExport?.id,
        diagnosticSummary: latestExport ? diagnosticSummaryFromExport(latestExport) : undefined,
        version: current.version + 1,
        updatedAt: now,
        timeline: appendApplicationTimeline(current.timeline, event)
      });
      await this.db.applications.put(next);
      return { application: next, idempotent: false };
    });
  }

  async attachApplicationExport(input: {
    applicationId: string;
    expectedVersion: number;
    operationId: string;
    exportRecordId: string;
  }) {
    return this.db.transaction("rw", this.db.applications, this.db.exportRecords, async () => {
      const application = await this.requireApplicationForWrite(input.applicationId, input.operationId);
      if (application.idempotent) {
        return { application: application.record, idempotent: true };
      }
      const current = application.record;
      assertExpectedApplicationVersion(current, input.expectedVersion);
      const exportRecord = await this.db.exportRecords.get(input.exportRecordId);
      if (!exportRecord) {
        throw new Error("export_not_found");
      }
      const parsedExport = ExportRecordSchema.parse(exportRecord);
      if (parsedExport.branchId !== current.jobSpecificBranchId) {
        throw new Error("export_branch_mismatch");
      }
      if (parsedExport.revisionId !== current.selectedRevisionId || parsedExport.branchRevision !== current.selectedBranchRevision) {
        throw new Error("export_revision_mismatch");
      }
      if (!isSuccessfulApplicationExport(parsedExport)) {
        throw new Error("export_not_ready");
      }
      if (current.appliedSnapshot && current.appliedSnapshot.exportRecordId && current.appliedSnapshot.exportRecordId !== parsedExport.id) {
        throw new Error("application_export_locked");
      }
      const now = new Date().toISOString();
      const event = createApplicationTimelineEvent({
        applicationId: current.id,
        type: "export_attached",
        operationId: input.operationId,
        summary: `已关联导出记录：${parsedExport.displayName}`,
        now
      });
      const next = ApplicationRecordSchema.parse({
        ...current,
        selectedExportRecordId: parsedExport.id,
        selectedActualPageCount: parsedExport.actualPageCount,
        diagnosticSummary: diagnosticSummaryFromExport(parsedExport),
        appliedSnapshot: current.appliedSnapshot && !current.appliedSnapshot.exportRecordId
          ? { ...current.appliedSnapshot, exportRecordId: parsedExport.id }
          : current.appliedSnapshot,
        version: current.version + 1,
        updatedAt: now,
        timeline: appendApplicationTimeline(current.timeline, event)
      });
      await this.db.applications.put(next);
      return { application: next, idempotent: false };
    });
  }

  async archiveApplication(input: {
    applicationId: string;
    expectedVersion: number;
    operationId: string;
  }) {
    return this.updateApplicationStatus({
      applicationId: input.applicationId,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
      nextStatus: "archived"
    });
  }

  async restoreApplication(input: {
    applicationId: string;
    expectedVersion: number;
    operationId: string;
  }) {
    return this.db.transaction("rw", this.db.applications, async () => {
      const application = await this.requireApplicationForWrite(input.applicationId, input.operationId);
      if (application.idempotent) {
        return { application: application.record, idempotent: true };
      }
      const current = application.record;
      assertExpectedApplicationVersion(current, input.expectedVersion);
      if (current.status !== "archived") {
        return { application: current, idempotent: true };
      }
      const now = new Date().toISOString();
      const restoredStatus = current.previousStatusBeforeArchive ?? "preparing";
      const event = createApplicationTimelineEvent({
        applicationId: current.id,
        type: "restored",
        operationId: input.operationId,
        summary: `Application 已恢复到 ${restoredStatus}。`,
        fromStatus: "archived",
        toStatus: restoredStatus,
        now
      });
      const next = ApplicationRecordSchema.parse({
        ...current,
        status: restoredStatus,
        archivedAt: undefined,
        previousStatusBeforeArchive: undefined,
        version: current.version + 1,
        updatedAt: now,
        timeline: appendApplicationTimeline(current.timeline, event)
      });
      await this.db.applications.put(next);
      return { application: next, idempotent: false };
    });
  }

  async setMeta(key: string, value: unknown) {
    const meta = {
      key,
      value,
      updatedAt: new Date().toISOString()
    };

    await this.db.appMeta.put(meta);
    return meta;
  }

  async getMeta(key: string) {
    return this.db.appMeta.get(key);
  }

  async getRecycleBinState() {
    const stored = await this.db.appMeta.get(RECYCLE_BIN_META_KEY);
    const parsed = RecycleBinStateSchema.safeParse(stored?.value);
    return parsed.success ? parsed.data : EMPTY_RECYCLE_BIN;
  }

  async addProfileRecycleItem(item: ProfileRecycleItem) {
    const parsedItem = ProfileRecycleItemSchema.parse(item);
    const current = await this.getRecycleBinState();
    const next = RecycleBinStateSchema.parse({
      ...current,
      profileItems: [parsedItem, ...current.profileItems.filter((entry) => !(entry.kind === parsedItem.kind && entry.id === parsedItem.id))]
    });
    await this.setMeta(RECYCLE_BIN_META_KEY, next);
    return next;
  }

  async restoreProfileRecycleItem(kind: ProfileRecycleItem["kind"], itemId: string) {
    return this.db.transaction("rw", this.db.profiles, this.db.appMeta, async () => {
      const current = await this.getRecycleBinState();
      const item = current.profileItems.find((entry) => entry.kind === kind && entry.id === itemId);
      if (!item) throw new Error("profile_recycle_item_missing");
      const storedProfile = await this.db.profiles.get(item.profileId);
      if (!storedProfile) throw new Error("profile_recycle_profile_missing");
      const profile = CareerProfileSchema.parse(storedProfile);
      const now = new Date().toISOString();
      const nextProfile = CareerProfileSchema.parse(item.kind === "experience"
        ? { ...profile, experiences: [...profile.experiences.filter((entry) => entry.id !== item.id), { ...item.value, updatedAt: now }], version: profile.version + 1, updatedAt: now }
        : item.kind === "certificate"
          ? { ...profile, certificates: [...profile.certificates.filter((entry) => entry.id !== item.id), { ...item.value, updatedAt: now }], version: profile.version + 1, updatedAt: now }
          : item.kind === "skill"
            ? { ...profile, skills: [...profile.skills.filter((entry) => entry.id !== item.id), { ...item.value, updatedAt: now }], version: profile.version + 1, updatedAt: now }
            : { ...profile, unclassifiedBlocks: [...profile.unclassifiedBlocks, item.value], version: profile.version + 1, updatedAt: now });
      const nextState = RecycleBinStateSchema.parse({
        ...current,
        profileItems: current.profileItems.filter((entry) => !(entry.kind === kind && entry.id === itemId))
      });
      await this.db.profiles.put(nextProfile);
      await this.db.appMeta.put({ key: RECYCLE_BIN_META_KEY, value: nextState, updatedAt: now });
      return { profile: nextProfile, state: nextState };
    });
  }

  async deleteProfileRecycleItemPermanently(kind: ProfileRecycleItem["kind"], itemId: string) {
    const current = await this.getRecycleBinState();
    const next = RecycleBinStateSchema.parse({
      ...current,
      profileItems: current.profileItems.filter((entry) => !(entry.kind === kind && entry.id === itemId))
    });
    await this.setMeta(RECYCLE_BIN_META_KEY, next);
    return next;
  }

  async getProfileItemReferenceCount(item: { kind: "experience" | "certificate" | "skill" | "custom"; id: string }) {
    if (item.kind === "custom") return 0;
    return this.db.resumeBranches.filter((branch) => branch.contentItems.some((content) => content.factRefs.some((ref) =>
      item.kind === "experience" ? ref.type === "experience_fact" && ref.experienceId === item.id
        : item.kind === "certificate" ? ref.type === "certificate_fact" && ref.certificateId === item.id
          : ref.type === "skill_fact" && ref.skillId === item.id
    ))).count();
  }

  async moveJobToRecycleBin(jobId: string) {
    if (!await this.db.jobDescriptions.get(jobId)) throw new Error("job_missing");
    const current = await this.getRecycleBinState();
    const next = RecycleBinStateSchema.parse({ ...current, jobIds: Array.from(new Set([jobId, ...current.jobIds])) });
    await this.setMeta(RECYCLE_BIN_META_KEY, next);
    return next;
  }

  async restoreJobFromRecycleBin(jobId: string) {
    const current = await this.getRecycleBinState();
    const next = RecycleBinStateSchema.parse({ ...current, jobIds: current.jobIds.filter((id) => id !== jobId) });
    await this.setMeta(RECYCLE_BIN_META_KEY, next);
    return next;
  }

  async deleteJobPermanently(jobId: string) {
    const [branches, applications, matches, drafts] = await Promise.all([
      this.db.resumeBranches.where("jobId").equals(jobId).count(),
      this.db.applications.where("jobId").equals(jobId).count(),
      this.db.requirementMatches.filter((item) => item.jobId === jobId).count(),
      this.db.jobAdaptationDrafts.filter((item) => item.jobId === jobId).count()
    ]);
    const blockers = { branches, applications, matches, drafts };
    if (Object.values(blockers).some((count) => count > 0)) return { deleted: false as const, blockers };
    const current = await this.getRecycleBinState();
    const next = RecycleBinStateSchema.parse({ ...current, jobIds: current.jobIds.filter((id) => id !== jobId) });
    await this.db.transaction("rw", this.db.jobDescriptions, this.db.appMeta, async () => {
      await this.db.jobDescriptions.delete(jobId);
      await this.db.appMeta.put({ key: RECYCLE_BIN_META_KEY, value: next, updatedAt: new Date().toISOString() });
    });
    return { deleted: true as const, blockers };
  }

  async exportWorkspaceJson(): Promise<WorkspaceExport> {
    return {
      schemaVersion: "stage-e-e1-v1",
      exportedAt: new Date().toISOString(),
      profiles: await this.listProfiles(),
      jobDescriptions: await this.listJobDescriptions(),
      rawInputs: await this.listRawInputs(),
      pdfImportSessions: (await this.db.pdfImportSessions.toArray()).map((session) => PdfImportSessionSchema.parse(session)),
      pdfPageTexts: (await this.db.pdfPageTexts.toArray()).map((page) => PdfPageTextSchema.parse(page)),
      profileImportDrafts: (await this.db.profileImportDrafts.toArray()).map((draft) => ProfileImportDraftSchema.parse(draft)),
      jobAnalysisDrafts: (await this.db.jobAnalysisDrafts.toArray()).map((draft) => JobAnalysisDraftSchema.parse(draft)),
      draftCommits: (await this.db.draftCommits.toArray()).map((commit) => DraftCommitSchema.parse(commit)),
      requirementMatches: (await this.db.requirementMatches.toArray()).map((match) => RequirementMatchSchema.parse(match)),
      matchOperations: (await this.db.matchOperations.toArray()).map((operation) => MatchOperationSchema.parse(operation)),
      jobAdaptationDrafts: (await this.db.jobAdaptationDrafts.toArray()).map((draft) => JobAdaptationDraftSchema.parse(draft)),
      aiSuggestions: (await this.db.aiSuggestions.toArray()).map((suggestion) => AiSuggestionSchema.parse(suggestion)),
      adaptationSnapshots: (await this.db.adaptationSnapshots.toArray()).map((snapshot) => JobAdaptationSnapshotSchema.parse(snapshot)),
      suggestionOperations: (await this.db.suggestionOperations.toArray()).map((operation) => SuggestionOperationSchema.parse(operation)),
      resumeBranches: await this.listResumeBranches(),
      resumeRevisions: (await this.db.resumeRevisions.toArray()).map((revision) => ResumeRevisionSchema.parse(revision)),
      resumeBranchOperations: (await this.db.resumeBranchOperations.toArray()).map((operation) => ResumeBranchOperationSchema.parse(operation)),
      aiLogs: (await this.db.aiLogs.toArray()).map((log) => AiLogSchema.parse(log)),
      exportRecords: (await this.db.exportRecords.toArray()).map((record) => ExportRecordSchema.parse(record)),
      applications: (await this.db.applications.toArray())
        .map((application) => ApplicationRecordSchema.safeParse(application))
        .filter((result): result is { success: true; data: ApplicationRecord } => result.success)
        .map((result) => result.data),
      appMeta: await this.db.appMeta.toArray()
    };
  }

  private async findApplicationByOperationInTransaction(operationId: string) {
    const rows = await this.db.applications.toArray();
    for (const row of rows) {
      const parsed = ApplicationRecordSchema.safeParse(row);
      if (!parsed.success) {
        continue;
      }
      if (parsed.data.timeline.some((event) => event.operationId === operationId)) {
        return parsed.data;
      }
    }
    return undefined;
  }

  private async requireApplicationForWrite(applicationId: string, operationId: string) {
    const existingByOperation = await this.findApplicationByOperationInTransaction(operationId);
    if (existingByOperation) {
      if (existingByOperation.id !== applicationId) {
        throw new Error("operation_conflict");
      }
      return {
        record: existingByOperation,
        idempotent: true
      };
    }

    const row = await this.db.applications.get(applicationId);
    if (!row) {
      throw new Error("application_not_found");
    }
    return {
      record: ApplicationRecordSchema.parse(row),
      idempotent: false
    };
  }

  private async findLatestSuccessfulExportForSelection(input: {
    branchId: string;
    revisionId: string;
    branchRevision: number;
  }) {
    const records = await this.db.exportRecords.where("branchId").equals(input.branchId).toArray();
    return records
      .map((record) => ExportRecordSchema.parse(record))
      .filter((record) =>
        record.revisionId === input.revisionId
        && record.branchRevision === input.branchRevision
        && isSuccessfulApplicationExport(record)
      )
      .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))[0];
  }

  private async resolveSourceGeneralBranchId(branch: ResumeBranch) {
    if (!branch.sourceBranchId) {
      return undefined;
    }
    const source = await this.db.resumeBranches.get(branch.sourceBranchId);
    if (!source) {
      return undefined;
    }
    const parsed = ResumeBranchSchema.parse(source);
    return parsed.branchPurpose === "general" && parsed.profileId === branch.profileId
      ? parsed.id
      : undefined;
  }

  private async transitionResumeBranchLifecycle(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    from: ResumeBranch["lifecycleStatus"];
    to: ResumeBranch["lifecycleStatus"];
    type: ResumeBranchOperation["type"];
    source: ResumeRevision["source"];
  }) {
    return this.db.transaction("rw", this.db.resumeBranches, this.db.resumeRevisions, this.db.resumeBranchOperations, async () => {
      const existingOperation = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
      if (existingOperation) {
        const existingBranch = await this.db.resumeBranches.get(input.branchId);
        if (!existingBranch) throw new Error("resume_branch_missing_for_operation");
        return {
          branch: ResumeBranchSchema.parse(existingBranch),
          revision: existingOperation.revisionId ? await this.getResumeRevisionInTransaction(existingOperation.revisionId) : undefined,
          idempotent: true
        };
      }
      const stored = await this.db.resumeBranches.get(input.branchId);
      if (!stored) throw new Error("resume_branch_missing");
      const branch = ResumeBranchSchema.parse(stored);
      if (branch.migrationStatus !== "verified" || !branch.currentRevisionId) throw new Error("resume_branch_lifecycle_read_only");
      if (branch.revision !== input.expectedRevision) throw new RevisionConflictError();
      if (branch.lifecycleStatus !== input.from) throw new Error("resume_branch_lifecycle_transition_invalid");
      const now = new Date().toISOString();
      const nextBase = ResumeBranchSchema.parse({
        ...branch,
        lifecycleStatus: input.to,
        revision: branch.revision + 1,
        updatedAt: now
      });
      const revision = createResumeRevision({
        branch: nextBase,
        source: input.source,
        operationId: input.operationId,
        previousRevisionId: branch.currentRevisionId,
        now
      });
      const nextBranch = ResumeBranchSchema.parse({ ...nextBase, currentRevisionId: revision.id });
      const operation = ResumeBranchOperationSchema.parse({
        id: `resume-branch-op-${input.operationId}`,
        operationId: input.operationId,
        branchId: branch.id,
        sourceAdaptationDraftId: branch.sourceAdaptationDraftId,
        type: input.type,
        expectedRevision: input.expectedRevision,
        beforeRevision: branch.revision,
        afterRevision: nextBranch.revision,
        revisionId: revision.id,
        occurredAt: now,
        createdAt: now,
        updatedAt: now
      });
      await this.db.resumeBranches.put(nextBranch);
      await this.db.resumeRevisions.put(revision);
      await this.db.resumeBranchOperations.put(operation);
      return { branch: nextBranch, revision, idempotent: false };
    });
  }

  private async mutateResumeBranch(input: {
    branchId: string;
    expectedRevision: number;
    operationId: string;
    type: ResumeBranchOperation["type"];
    source: ResumeRevision["source"];
    restoredFromRevisionId?: string;
    mutate: (context: {
      branch: ResumeBranch;
      profile: CareerProfile;
      job?: JobDescription;
      now: string;
    }) => Promise<ResumeBranch>;
  }) {
    return this.db.transaction("rw", this.db.resumeBranches, this.db.resumeRevisions, this.db.resumeBranchOperations, this.db.profiles, this.db.jobDescriptions, async () => {
      const existingOperation = await this.db.resumeBranchOperations.where("operationId").equals(input.operationId).first();
      if (existingOperation) {
        const branch = await this.db.resumeBranches.get(input.branchId);
        if (!branch) {
          throw new Error("resume_branch_missing_for_operation");
        }
        return {
          branch: ResumeBranchSchema.parse(branch),
          revision: existingOperation.revisionId ? await this.getResumeRevisionInTransaction(existingOperation.revisionId) : undefined,
          idempotent: true
        };
      }

      const branch = await this.requireEditableResumeBranch(input.branchId);
      if (branch.revision !== input.expectedRevision) {
        throw new RevisionConflictError();
      }

      const [profile, job] = await Promise.all([
        this.db.profiles.get(branch.profileId),
        branch.jobId ? this.db.jobDescriptions.get(branch.jobId) : Promise.resolve(undefined)
      ]);
      if (!profile || (branch.branchPurpose !== "general" && !job)) {
        throw new Error("branch_source_missing");
      }

      const now = new Date().toISOString();
      const parsedProfile = CareerProfileSchema.parse(profile);
      const parsedJob = job ? JobDescriptionSchema.parse(job) : undefined;
      const changed = await input.mutate({ branch, profile: parsedProfile, job: parsedJob, now });
      const latestProfileRecord = await this.db.profiles.get(branch.profileId);
      const latestProfile = latestProfileRecord ? CareerProfileSchema.parse(latestProfileRecord) : parsedProfile;
      const nextBranchBase = ResumeBranchSchema.parse({
        ...changed,
        revision: branch.revision + 1,
        updatedAt: now
      });
      const nextBranchWithSync = ResumeBranchSchema.parse({
        ...nextBranchBase,
        syncStatusCache: nextBranchBase.branchPurpose === "general"
          ? computeGeneralBranchSyncStatus({
              branch: nextBranchBase,
              profile: latestProfile,
              now
            })
          : computeBranchSyncStatus({
              branch: nextBranchBase,
              profile: latestProfile,
              job: parsedJob!,
              now
            })
      });
      const revision = createResumeRevision({
        branch: nextBranchWithSync,
        source: input.source,
        operationId: input.operationId,
        previousRevisionId: branch.currentRevisionId ?? undefined,
        restoredFromRevisionId: input.restoredFromRevisionId ?? undefined,
        now
      });
      const nextBranch = ResumeBranchSchema.parse({
        ...nextBranchWithSync,
        currentRevisionId: revision.id
      });
      const operation = ResumeBranchOperationSchema.parse({
        id: `resume-branch-op-${input.operationId}`,
        operationId: input.operationId,
        branchId: branch.id,
        sourceAdaptationDraftId: branch.sourceAdaptationDraftId,
        type: input.type,
        expectedRevision: input.expectedRevision,
        beforeRevision: branch.revision,
        afterRevision: nextBranch.revision,
        revisionId: revision.id,
        occurredAt: now,
        createdAt: now,
        updatedAt: now
      });

      await this.db.resumeBranches.put(nextBranch);
      await this.db.resumeRevisions.put(revision);
      await this.db.resumeBranchOperations.put(operation);
      return { branch: nextBranch, revision, idempotent: false };
    });
  }

  private async requireEditableResumeBranch(branchId: string, options: { allowInvalidReference?: boolean } = {}) {
    const branch = await this.db.resumeBranches.get(branchId);
    if (!branch) {
      throw new Error("resume_branch_missing");
    }

    const parsed = ResumeBranchSchema.parse(branch);
    if (parsed.migrationStatus === "legacy_unverified") {
      throw new Error("legacy_resume_branch_read_only");
    }
    if (parsed.lifecycleStatus !== "active") {
      throw new Error("archived_resume_branch_read_only");
    }
    if (!parsed.currentRevisionId) {
      throw new Error("resume_branch_current_revision_missing");
    }
    if (parsed.syncStatusCache.status === "invalid_reference" && !options.allowInvalidReference) {
      throw new Error("invalid_reference_resume_branch_read_only");
    }
    return parsed;
  }

  private async getResumeRevisionInTransaction(revisionId: string) {
    const revision = await this.db.resumeRevisions.get(revisionId);
    return revision ? ResumeRevisionSchema.parse(revision) : undefined;
  }

  private async requireDraftRevision(draftId: string, expectedRevision: number) {
    const draft = await this.db.jobAdaptationDrafts.get(draftId);
    if (!draft || draft.revision !== expectedRevision) {
      throw new RevisionConflictError();
    }
    return JobAdaptationDraftSchema.parse(draft);
  }

  private createAdaptationSnapshot(
    draft: JobAdaptationDraft,
    source: JobAdaptationSnapshot["source"],
    operationId: string,
    now: string
  ) {
    return JobAdaptationSnapshotSchema.parse({
      id: `adapt-snapshot-${operationId}`,
      draftId: draft.id,
      revision: draft.revision,
      source,
      operationId,
      sectionTexts: draft.sectionTexts,
      appliedSuggestionIds: draft.appliedSuggestionIds,
      createdAt: now,
      updatedAt: now
    });
  }

  private createSuggestionOperation(input: {
    operationId: string;
    draftId: string;
    suggestionId?: string;
    type: SuggestionOperation["type"];
    expectedRevision: number;
    beforeRevision: number;
    afterRevision: number;
    snapshotId: string;
    now: string;
  }) {
    return SuggestionOperationSchema.parse({
      id: `suggestion-op-${input.operationId}`,
      operationId: input.operationId,
      draftId: input.draftId,
      suggestionId: input.suggestionId,
      type: input.type,
      expectedRevision: input.expectedRevision,
      beforeRevision: input.beforeRevision,
      afterRevision: input.afterRevision,
      snapshotId: input.snapshotId,
      occurredAt: input.now,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  private async mutateSuggestion(
    input: {
      draftId: string;
      suggestionId: string;
      expectedRevision: number;
      operationId: string;
    },
    type: SuggestionOperation["type"],
    mutate: (draft: JobAdaptationDraft, suggestion: AiSuggestion, now: string) => { draft: JobAdaptationDraft; suggestion: AiSuggestion }
  ) {
    return this.db.transaction("rw", this.db.jobAdaptationDrafts, this.db.aiSuggestions, this.db.adaptationSnapshots, this.db.suggestionOperations, async () => {
      const existingOperation = await this.db.suggestionOperations.where("operationId").equals(input.operationId).first();
      if (existingOperation) {
        const draft = await this.db.jobAdaptationDrafts.get(input.draftId);
        const suggestion = await this.db.aiSuggestions.get(input.suggestionId);
        if (!draft || !suggestion) {
          throw new Error("suggestion_operation_target_missing");
        }
        return {
          draft: JobAdaptationDraftSchema.parse(draft),
          suggestion: AiSuggestionSchema.parse(suggestion),
          idempotent: true
        };
      }

      const draft = await this.requireDraftRevision(input.draftId, input.expectedRevision);
      const suggestion = await this.db.aiSuggestions.get(input.suggestionId);
      if (!suggestion || suggestion.draftId !== draft.id) {
        throw new Error("suggestion_missing");
      }

      const now = new Date().toISOString();
      const changed = mutate(draft, AiSuggestionSchema.parse(suggestion), now);
      const nextDraft = JobAdaptationDraftSchema.parse({
        ...changed.draft,
        revision: draft.revision + 1,
        updatedAt: now
      });
      const snapshot = this.createAdaptationSnapshot(
        nextDraft,
        type === "accept"
          ? "suggestion_applied"
          : type === "reject"
            ? "suggestion_rejected"
            : type === "ignore"
              ? "suggestion_ignored"
              : type === "edit"
                ? "suggestion_edited"
                : type === "rerun_guard"
                  ? "guard_rerun"
                  : "undo",
        input.operationId,
        now
      );
      const nextDraftWithSnapshot = JobAdaptationDraftSchema.parse({
        ...nextDraft,
        snapshots: [...nextDraft.snapshots, snapshot]
      });
      const operation = this.createSuggestionOperation({
        operationId: input.operationId,
        draftId: draft.id,
        suggestionId: suggestion.id,
        type,
        expectedRevision: input.expectedRevision,
        beforeRevision: draft.revision,
        afterRevision: nextDraftWithSnapshot.revision,
        snapshotId: snapshot.id,
        now
      });

      await this.db.aiSuggestions.put(changed.suggestion);
      await this.db.jobAdaptationDrafts.put(nextDraftWithSnapshot);
      await this.db.adaptationSnapshots.put(snapshot);
      await this.db.suggestionOperations.put(operation);
      return { draft: nextDraftWithSnapshot, suggestion: changed.suggestion, idempotent: false };
    });
  }
}

export class RevisionConflictError extends Error {
  constructor() {
    super("revision_conflict");
    this.name = "RevisionConflictError";
  }
}

function assertExpectedApplicationVersion(application: ApplicationRecord, expectedVersion: number) {
  if (application.version !== expectedVersion) {
    throw new Error("version_conflict");
  }
}

function createApplicationTimelineEvent(input: {
  applicationId: string;
  type: ApplicationTimelineEventType;
  operationId: string;
  summary: string;
  now: string;
  fromStatus?: ApplicationStatus;
  toStatus?: ApplicationStatus;
  note?: string;
}): ApplicationTimelineEvent {
  return {
    id: `application-event-${stableHashText(`${input.applicationId}:${input.operationId}:${input.type}`).slice(0, 28)}`,
    type: input.type,
    occurredAt: input.now,
    createdAt: input.now,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    summary: input.summary,
    note: sanitizeApplicationText(input.note, 2000),
    operationId: input.operationId
  };
}

function appendApplicationTimeline(
  timeline: ApplicationTimelineEvent[],
  event: ApplicationTimelineEvent
) {
  const next = [...timeline, event]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  return next.slice(Math.max(0, next.length - 200));
}

function isSuccessfulApplicationExport(record: ExportRecord) {
  return (record.exportStatus === "direct_pdf_success" || record.exportStatus === "print_invoked")
    && !record.exceededPageLimit
    && record.overflowStatus !== "overflow"
    && record.overflowStatus !== "exceeds_two_pages"
    && record.overflowStatus !== "measurement_failed";
}

function diagnosticSummaryFromExport(record: ExportRecord): ApplicationDiagnosticSummary | undefined {
  if (
    !record.diagnosticsEngineVersion
    && !record.diagnosticsSnapshotHash
    && record.criticalIssueCount === undefined
    && record.warningIssueCount === undefined
    && !record.requirementCoverageSummary
  ) {
    return undefined;
  }

  return {
    diagnosticsEngineVersion: record.diagnosticsEngineVersion,
    diagnosticsSnapshotHash: record.diagnosticsSnapshotHash,
    criticalIssueCount: record.criticalIssueCount ?? 0,
    warningIssueCount: record.warningIssueCount ?? 0,
    requirementCoverageSummary: record.requirementCoverageSummary
  };
}

function normalizeApplicationDate(value: string | undefined, field: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00.000Z`
    : trimmed;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid_date:${field}`);
  }
  return date.toISOString();
}

function sanitizeApplicationUrl(value: string | undefined) {
  const sanitized = sanitizeApplicationText(value, 2048);
  if (!sanitized) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(sanitized);
  } catch {
    throw new Error("invalid_url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("invalid_url");
  }
  return sanitized;
}

function sanitizeApplicationTags(values: string[] | undefined) {
  if (!values) {
    return undefined;
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const tag = sanitizeApplicationText(value, 40);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 12) {
      break;
    }
  }
  return tags;
}

function applicationPreparationPackKey(applicationId: string) {
  return `applicationPreparationPack:${applicationId}`;
}

function applicationPreparationOperationKey(operationId: string) {
  return `applicationPreparationOperation:${operationId}`;
}

function assertNoForbiddenPreparationPayload(value: unknown) {
  const stack: Array<{ path: string; value: unknown }> = [{ path: "", value }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.value && typeof current.value === "object") {
      for (const [key, child] of Object.entries(current.value as Record<string, unknown>)) {
        const path = current.path ? `${current.path}.${key}` : key;
        const normalizedKey = key.toLowerCase();
        if (
          normalizedKey.includes("pdfblob")
          || normalizedKey === "blob"
          || normalizedKey.includes("apikey")
          || normalizedKey.includes("api_key")
          || normalizedKey.includes("prompt")
        ) {
          throw new Error("forbidden_preparation_payload");
        }
        stack.push({ path, value: child });
      }
    }
    if (typeof current.value === "string" && /sk-[A-Za-z0-9_-]{20,}/.test(current.value)) {
      throw new Error("forbidden_preparation_payload");
    }
  }
}

function sanitizeApplicationText(value: string | undefined, maxLength: number) {
  const trimmed = value
    ?.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|api[_-]?key\s*[:=]\s*[\w.-]+/gi, "[redacted-secret]")
    .trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, maxLength);
}

function resumePresentationConfigKey(branchId: string) {
  return `resumePresentationConfig:${branchId}`;
}

function resumePresentationOperationKey(operationId: string) {
  return `resumePresentationOperation:${operationId}`;
}

const IMPORTED_RESUME_DRAFT_KEY_PREFIX = "importedResumeDraft:";

function importedResumeDraftKey(importId: string) {
  return `${IMPORTED_RESUME_DRAFT_KEY_PREFIX}${importId}`;
}

function resumeWorkbenchStateKey(profileId: string) {
  return `resumeWorkbenchState:${profileId}`;
}

function parseLegacyWorkbenchTemplateId(value: unknown): ResumePresentationConfig["templateId"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as { templateId?: unknown };
  const parsed = TemplateIdSchema.safeParse(candidate.templateId);
  return parsed.success ? parsed.data : undefined;
}

function createDefaultPresentationConfig(input: {
  branch: ResumeBranch;
  templateId?: ResumePresentationConfig["templateId"];
  now: string;
}): ResumePresentationConfig {
  if (!input.branch.currentRevisionId) {
    throw new Error("resume_presentation_branch_current_revision_missing");
  }

  return ResumePresentationConfigSchema.parse({
    schemaVersion: "resume-presentation-v1",
    branchId: input.branch.id,
    templateId: input.templateId ?? "classic-technical",
    contentRevision: {
      branchRevision: input.branch.revision,
      currentRevisionId: input.branch.currentRevisionId
    },
    sectionOrder: defaultResumeSectionOrder(),
    itemOrderBySection: defaultItemOrderBySection(input.branch),
    hiddenItemIds: [],
    presentationRevision: 0,
    updatedAt: input.now
  });
}

function sanitizePresentationConfigForBranch(config: ResumePresentationConfig, branch: ResumeBranch): ResumePresentationConfig {
  if (config.branchId !== branch.id) {
    throw new Error("resume_presentation_branch_mismatch");
  }
  if (!branch.currentRevisionId) {
    throw new Error("resume_presentation_branch_current_revision_missing");
  }

  const itemIds = new Set(branch.contentItems.map((item) => item.id));
  const hiddenItemIds = uniqueStrings(config.hiddenItemIds).filter((itemId) => itemIds.has(itemId));
  const branchVisibleItemIds = branch.contentItems.filter((item) => item.visible).map((item) => item.id);
  if (branchVisibleItemIds.length > 0 && branchVisibleItemIds.every((itemId) => hiddenItemIds.includes(itemId))) {
    throw new Error("resume_presentation_requires_visible_content");
  }
  const visibleSectionTypes = defaultResumeSectionOrder().filter((section) =>
    branch.contentItems.some((item) =>
      item.visible
      && !hiddenItemIds.includes(item.id)
      && contentItemSectionType(item) === section
    )
  );

  return ResumePresentationConfigSchema.parse({
    ...config,
    contentRevision: {
      branchRevision: branch.revision,
      currentRevisionId: branch.currentRevisionId
    },
    sectionOrder: sanitizeSectionOrder(config.sectionOrder),
    itemOrderBySection: sanitizeItemOrderBySection(config.itemOrderBySection, branch),
    hiddenItemIds,
    pagination: {
      ...config.pagination,
      pageBreakBeforeSections: sanitizePageBreakBeforeSections(config.pagination.pageBreakBeforeSections, visibleSectionTypes)
    }
  });
}

function defaultResumeSectionOrder(): ResumeRenderSectionType[] {
  return [...defaultResumeRenderSectionOrder];
}

function sanitizeSectionOrder(sectionOrder: ResumeRenderSectionType[]) {
  const defaults = defaultResumeSectionOrder();
  const seen = new Set<ResumeRenderSectionType>();
  const next = sectionOrder.filter((section) => {
    if (seen.has(section)) {
      return false;
    }
    seen.add(section);
    return true;
  });
  return [...next, ...defaults.filter((section) => !seen.has(section))];
}

function defaultItemOrderBySection(branch: ResumeBranch): ResumePresentationConfig["itemOrderBySection"] {
  return sanitizeItemOrderBySection({}, branch);
}

function sanitizeItemOrderBySection(
  itemOrderBySection: ResumePresentationConfig["itemOrderBySection"],
  branch: ResumeBranch
): ResumePresentationConfig["itemOrderBySection"] {
  const result: ResumePresentationConfig["itemOrderBySection"] = {};
  for (const section of defaultResumeSectionOrder()) {
    const sectionItems = branch.contentItems
      .filter((item) => contentItemSectionType(item) === section)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const sectionItemIds = new Set(sectionItems.map((item) => item.id));
    const configured = uniqueStrings(itemOrderBySection[section] ?? []).filter((itemId) => sectionItemIds.has(itemId));
    const missing = sectionItems.map((item) => item.id).filter((itemId) => !configured.includes(itemId));
    result[section] = [...configured, ...missing];
  }
  return result;
}

function sanitizePageBreakBeforeSections(
  pageBreakBeforeSections: ResumePresentationConfig["pagination"]["pageBreakBeforeSections"],
  visibleSectionTypes: ResumeRenderSectionType[]
) {
  const firstVisible = visibleSectionTypes[0];
  return uniqueStrings(pageBreakBeforeSections)
    .filter((section): section is ResumeRenderSectionType =>
      defaultResumeSectionOrder().includes(section as ResumeRenderSectionType)
      && visibleSectionTypes.includes(section as ResumeRenderSectionType)
      && section !== firstVisible
    );
}

function contentItemSectionType(item: ResumeBranch["contentItems"][number]): ResumeRenderSectionType {
  if (item.itemType === "summary") {
    return "summary";
  }
  if (item.itemType === "skill") {
    return "skills";
  }
  if (item.itemType === "certificate") {
    return "certificates";
  }
  return "experience";
}

function sectionProfileLabel(section: string) {
  const labels: Record<string, string> = {
    summary: "自我评价",
    experience: "工作经历",
    education: "教育经历",
    projects: "项目经历",
    campus: "校园经历",
    awards: "奖项",
    language: "语言能力",
    custom: "自定义内容"
  };
  return labels[section] ?? "简历内容";
}

function profileExperienceType(section?: string): CareerProfile["experiences"][number]["type"] {
  if (section === "education") return "education";
  if (section === "projects") return "project";
  if (section === "campus") return "campus";
  if (section === "experience") return "work";
  return "other";
}

function profileFactCategory(
  section: string | undefined,
  itemType: ResumeBranch["contentItems"][number]["itemType"]
): CareerProfile["experiences"][number]["facts"][number]["category"] {
  if (section === "education") return "education";
  if (section === "skills" || itemType === "skill") return "skill";
  if (section === "certificates" || itemType === "certificate") return "certificate";
  if (section === "awards") return "achievement";
  if (section === "language") return "language";
  if (itemType === "experience") return "experience";
  return "other";
}

function confirmedUserFact(
  fact: CareerProfile["experiences"][number]["facts"][number],
  operationId: string,
  text: string,
  now: string
): CareerProfile["experiences"][number]["facts"][number] {
  return {
    ...fact,
    statement: text,
    confirmedByUser: true,
    riskLevel: "medium",
    provenance: [
      ...fact.provenance,
      {
        sourceType: "user_input",
        sourceId: operationId,
        sourceText: text,
        confidence: 1,
        confirmedByUser: true,
        riskLevel: "medium",
        createdAt: now
      }
    ],
    updatedAt: now
  };
}

function upsertProfileResumeDraft(
  drafts: CareerProfile["experiences"][number]["resumeDrafts"],
  factId: string,
  text: string,
  entitySuffix: string,
  now: string
) {
  const matchingIndex = drafts.findIndex((draft) => draft.factIds.includes(factId));
  if (matchingIndex < 0) {
    return [...drafts, {
      id: `draft-user-${entitySuffix}`,
      text,
      factIds: [factId],
      createdAt: now,
      updatedAt: now
    }];
  }
  return drafts.map((draft, index) => index === matchingIndex
    ? { ...draft, text, updatedAt: now }
    : draft);
}

function inferProfileFieldsFromResumeText(text: string) {
  const parsed = parseStructuredExperienceText(text);
  return {
    organization: parsed.organization,
    role: parsed.role,
    location: parsed.location,
    degree: parsed.degree,
    major: parsed.major,
    courses: parsed.courses,
    startDate: normalizeProfileDate(parsed.startDate),
    endDate: parsed.current ? undefined : normalizeProfileDate(parsed.endDate)
  };
}

function profileFactReferenceEquals(
  left: ResumeBranch["contentItems"][number]["factRefs"][number],
  right: ResumeBranch["contentItems"][number]["factRefs"][number]
) {
  if (left.type !== right.type) return false;
  if (left.type === "experience_fact" && right.type === "experience_fact") {
    return left.experienceId === right.experienceId && left.factId === right.factId;
  }
  if (left.type === "skill_fact" && right.type === "skill_fact") {
    return left.skillId === right.skillId && left.factId === right.factId;
  }
  if (left.type === "certificate_fact" && right.type === "certificate_fact") {
    return left.certificateId === right.certificateId && left.factId === right.factId;
  }
  if (left.type === "evidence_file" && right.type === "evidence_file") {
    return left.evidenceId === right.evidenceId && left.linkedFactId === right.linkedFactId;
  }
  return false;
}

function canonicalBranchItemType(sectionType: ResumeItemV2["sectionType"]): "experience" | "skill" | "certificate" | "custom" {
  if (sectionType === "skills") return "skill";
  if (sectionType === "certificates") return "certificate";
  return ["education", "work", "internship", "project", "research", "campus", "volunteer"].includes(sectionType) ? "experience" : "custom";
}

function resolveStructuredProfileFactRefs(profile: CareerProfile, factIds: string[]): ResumeBranch["contentItems"][number]["factRefs"] {
  const refs: ResumeBranch["contentItems"][number]["factRefs"] = [];
  for (const factId of factIds) {
    const experience = profile.experiences.find((item) => item.facts.some((fact) => fact.id === factId && fact.confirmedByUser && fact.riskLevel !== "high"));
    if (experience) { refs.push({ type: "experience_fact", experienceId: experience.id, factId }); continue; }
    const skill = profile.skills.find((item) => item.fact?.id === factId && item.fact.confirmedByUser && item.fact.riskLevel !== "high");
    if (skill) { refs.push({ type: "skill_fact", skillId: skill.id, factId }); continue; }
    const certificate = profile.certificates.find((item) => item.fact?.id === factId && item.fact.confirmedByUser && item.fact.riskLevel !== "high");
    if (certificate) refs.push({ type: "certificate_fact", certificateId: certificate.id, factId });
  }
  return refs;
}

function normalizeProfileDate(value?: string) {
  if (!value) return undefined;
  const parts = value.split(/[./-]/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]}-${parts[1].padStart(2, "0")}`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function isPresentationOperationValue(value: unknown): value is {
  branchId: string;
  presentationRevision: number;
  operationId: string;
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    branchId?: unknown;
    presentationRevision?: unknown;
    operationId?: unknown;
  };
  return typeof candidate.branchId === "string"
    && typeof candidate.presentationRevision === "number"
    && typeof candidate.operationId === "string";
}

function applySuggestionToSections(
  sections: JobAdaptationSectionText[],
  suggestion: AiSuggestion,
  now: string
) {
  if (suggestion.type === "risk_warning" || suggestion.type === "follow_up_question") {
    return sections;
  }

  if (suggestion.type === "reorder") {
    return sections
      .map((section) => section.sectionId === suggestion.targetSectionId ? { ...section, order: 0, updatedAt: now } : { ...section, order: section.order + 1 })
      .sort((a, b) => a.order - b.order);
  }

  const nextText = suggestion.editedText ?? suggestion.suggestedText;
  return sections.map((section) =>
    section.sectionId === suggestion.targetSectionId
      ? { ...section, text: nextText, updatedAt: now }
      : section
  );
}
