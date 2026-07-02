import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import {
  AiLogSchema,
  AiSuggestionSchema,
  CareerProfileSchema,
  DraftCommitSchema,
  ExportRecordSchema,
  JobAdaptationDraftSchema,
  JobAdaptationSnapshotSchema,
  JobAnalysisDraftSchema,
  JobDescriptionSchema,
  MatchOperationSchema,
  ProfileImportDraftSchema,
  RawInputDocumentSchema,
  RequirementMatchSchema,
  ResumeBranchSchema,
  SuggestionOperationSchema,
  type AiLog,
  type AiSuggestion,
  type CareerProfile,
  type DraftCommit,
  type ExportRecord,
  type FactGuardResult,
  type JobAdaptationDraft,
  type JobAdaptationSectionText,
  type JobAdaptationSnapshot,
  type JobAnalysisDraft,
  type JobDescription,
  type MatchEvaluation,
  type MatchOperation,
  type ProfileImportDraft,
  type RawInputDocument,
  type RequirementMatch,
  type ResumeBranch,
  type SuggestionOperation
} from "@/domain/schemas";
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
  schemaVersion: "stage-c-c2-v1";
  exportedAt: string;
  profiles: CareerProfile[];
  jobDescriptions: JobDescription[];
  rawInputs: RawInputDocument[];
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

  async saveResumeBranch(branch: ResumeBranch) {
    const parsed = ResumeBranchSchema.parse(branch);
    await this.db.resumeBranches.put(parsed);
    return parsed;
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

  async listResumeBranches() {
    const branches = await this.db.resumeBranches.toArray();
    return branches.map((branch) => ResumeBranchSchema.parse(branch));
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
      schemaVersion: "stage-c-c2-v1",
      exportedAt: new Date().toISOString(),
      profiles: await this.listProfiles(),
      jobDescriptions: await this.listJobDescriptions(),
      rawInputs: await this.listRawInputs(),
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
      aiLogs: (await this.db.aiLogs.toArray()).map((log) => AiLogSchema.parse(log)),
      exportRecords: (await this.db.exportRecords.toArray()).map((record) => ExportRecordSchema.parse(record)),
      appMeta: await this.db.appMeta.toArray()
    };
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
