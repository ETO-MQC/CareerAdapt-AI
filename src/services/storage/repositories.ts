import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import {
  AiLogSchema,
  AiSuggestionSchema,
  BranchContentItemSchema,
  CareerProfileSchema,
  DraftCommitSchema,
  ExportRecordSchema,
  JobAdaptationDraftSchema,
  JobAdaptationSnapshotSchema,
  JobAnalysisDraftSchema,
  JobDescriptionSchema,
  MatchOperationSchema,
  PdfImportSessionSchema,
  PdfPageTextSchema,
  ProfileImportDraftSchema,
  RawInputDocumentSchema,
  RequirementMatchSchema,
  ResumeBranchSchema,
  ResumeBranchOperationSchema,
  ResumePresentationConfigSchema,
  ResumeRevisionSchema,
  TemplateIdSchema,
  SuggestionOperationSchema,
  type AiLog,
  type AiSuggestion,
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
  type MatchEvaluation,
  type MatchOperation,
  type PdfImportSession,
  type PdfPageText,
  type ProfileImportDraft,
  type RawInputDocument,
  type RequirementMatch,
  type ResumeBranch,
  type ResumeBranchOperation,
  type ResumePresentationConfig,
  type ResumeRenderSectionType,
  type ResumeRevision,
  type SuggestionOperation
} from "@/domain/schemas";
import { mapAdaptationDraftToResumeBranch } from "@/domain/branch/mapper";
import { createResumeRevision } from "@/domain/branch/revision";
import { computeBranchSyncStatus, resolveBranchFactRefs } from "@/domain/branch/validation";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import {
  AdaptationDraftError,
  assertC2MatchesUsable,
  createJobAdaptationDraft
} from "@/domain/adaptation/draft";
import {
  resolveEffectiveMatch,
  validateRequirementMatchReferences,
  withResolvedEffectiveMatch
} from "@/domain/match/matcher";
import { CareerAdaptDb, careerAdaptDb, type AppMeta } from "./db";

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
  appMeta: AppMeta[];
};

export class WorkspaceRepository {
  constructor(private readonly db: CareerAdaptDb = careerAdaptDb) {}

  async seedDemoWorkspace() {
    await this.saveProfile(demoCareerProfile);
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
    const parsed = CareerProfileSchema.parse(profile);
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

  async getProfile(id: string) {
    const profile = await this.db.profiles.get(id);
    return profile ? CareerProfileSchema.parse(profile) : undefined;
  }

  async listProfiles() {
    const profiles = await this.db.profiles.toArray();
    return profiles.map((profile) => CareerProfileSchema.parse(profile));
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
        const jobDescription = await this.db.jobDescriptions.get(existingCommit.entityId);
        if (!jobDescription) {
          throw new Error("committed_job_missing");
        }

        return {
          jobDescription: JobDescriptionSchema.parse(jobDescription),
          commit: DraftCommitSchema.parse(existingCommit),
          idempotent: true
        };
      }

      const draft = await this.db.jobAnalysisDrafts.get(input.draftId);

      if (!draft || draft.revision !== input.expectedRevision) {
        throw new RevisionConflictError();
      }

      const now = new Date().toISOString();
      const jobDescription = JobDescriptionSchema.parse(input.jobDescription);
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
      await this.db.jobAnalysisDrafts.put(
        JobAnalysisDraftSchema.parse({
          ...draft,
          revision: draft.revision + 1,
          status: "committed",
          committedJobId: jobDescription.id,
          committedAt: now,
          updatedAt: now
        })
      );

      return { jobDescription, commit, idempotent: false };
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
    const parsed = ResumeBranchSchema.parse(branch);
    await this.db.resumeBranches.put(parsed);
    return parsed;
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

        await this.db.resumeBranches.put(mapped.branch);
        await this.db.resumeRevisions.put(mapped.firstRevision);
        await this.db.resumeBranchOperations.put(operation);
        return {
          branch: mapped.branch,
          revision: mapped.firstRevision,
          idempotent: false,
          warnings: mapped.warnings
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
        status: input.guardResult.status === "pass" ? "edited_guarded" : input.guardResult.status === "blocked_high_risk" ? "blocked_high_risk" : "edited_pending_guard",
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
        status: input.guardResult.status === "pass" ? "edited_guarded" : input.guardResult.status === "blocked_high_risk" ? "blocked_high_risk" : "edited_pending_guard",
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
    return branches.map((branch) => ResumeBranchSchema.parse(branch));
  }

  async getResumeBranch(branchId: string) {
    const branch = await this.db.resumeBranches.get(branchId);
    return branch ? ResumeBranchSchema.parse(branch) : undefined;
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
    edits: Array<{
      itemId: string;
      text?: string;
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
          if (textChanged && item.itemType !== "structural") {
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
            guardVersion: guardResult?.guardVersion ?? item.guardVersion
          });
        }).sort((a, b) => a.order - b.order);

        return ResumeBranchSchema.parse({
          ...branch,
          contentItems: nextItems
        });
      }
    });
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
          contentItems: parsedRevision.snapshot.contentItems
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
          contentItems: parsedPrevious.snapshot.contentItems
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
        this.db.jobDescriptions.get(branch.jobId)
      ]);
      if (!profile || !job) {
        throw new Error("branch_source_missing");
      }

      const now = new Date().toISOString();
      const nextBranch = ResumeBranchSchema.parse({
        ...branch,
        syncStatusCache: computeBranchSyncStatus({
          branch,
          profile: CareerProfileSchema.parse(profile),
          job: JobDescriptionSchema.parse(job),
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
    return this.mutateResumeBranch({
      branchId: input.branchId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      type: "archive",
      source: "archive",
      mutate: async ({ branch }) => ResumeBranchSchema.parse({
        ...branch,
        lifecycleStatus: "archived"
      })
    });
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
      itemOrderBySection: Record<string, string[]>;
      hiddenItemIds: string[];
      typography?: ResumePresentationConfig["typography"];
      spacing?: ResumePresentationConfig["spacing"];
      theme?: ResumePresentationConfig["theme"];
      sectionStyleOverrides?: ResumePresentationConfig["sectionStyleOverrides"];
    };
  }) {
    return this.db.transaction("rw", this.db.resumeBranches, this.db.exportRecords, async () => {
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
        throw new RevisionConflictError();
      }
      if (input.exportStatus === "print_invoked" && input.overflowStatus === "overflow") {
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
        revisionId: parsedBranch.currentRevisionId,
        branchRevision: parsedBranch.revision,
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
        createdAt: now,
        updatedAt: now
      });

      await this.db.exportRecords.put(record);
      return { record, idempotent: false };
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
      appMeta: await this.db.appMeta.toArray()
    };
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
      job: JobDescription;
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
        this.db.jobDescriptions.get(branch.jobId)
      ]);
      if (!profile || !job) {
        throw new Error("branch_source_missing");
      }

      const now = new Date().toISOString();
      const parsedProfile = CareerProfileSchema.parse(profile);
      const parsedJob = JobDescriptionSchema.parse(job);
      const changed = await input.mutate({ branch, profile: parsedProfile, job: parsedJob, now });
      const nextBranchBase = ResumeBranchSchema.parse({
        ...changed,
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
        type === "accept" ? "suggestion_applied" : type === "reject" ? "suggestion_rejected" : type === "edit" ? "suggestion_edited" : type === "rerun_guard" ? "guard_rerun" : "undo",
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

function resumePresentationConfigKey(branchId: string) {
  return `resumePresentationConfig:${branchId}`;
}

function resumePresentationOperationKey(operationId: string) {
  return `resumePresentationOperation:${operationId}`;
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

  return ResumePresentationConfigSchema.parse({
    ...config,
    contentRevision: {
      branchRevision: branch.revision,
      currentRevisionId: branch.currentRevisionId
    },
    sectionOrder: sanitizeSectionOrder(config.sectionOrder),
    itemOrderBySection: sanitizeItemOrderBySection(config.itemOrderBySection, branch),
    hiddenItemIds
  });
}

function defaultResumeSectionOrder(): ResumeRenderSectionType[] {
  return ["summary", "skills", "experience", "certificates"];
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
