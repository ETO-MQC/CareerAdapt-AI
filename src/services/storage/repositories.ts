import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import {
  AiLogSchema,
  CareerProfileSchema,
  DraftCommitSchema,
  ExportRecordSchema,
  JobAnalysisDraftSchema,
  JobDescriptionSchema,
  ProfileImportDraftSchema,
  RawInputDocumentSchema,
  ResumeBranchSchema,
  type AiLog,
  type CareerProfile,
  type DraftCommit,
  type ExportRecord,
  type JobAnalysisDraft,
  type JobDescription,
  type ProfileImportDraft,
  type RawInputDocument,
  type ResumeBranch
} from "@/domain/schemas";
import { CareerAdaptDb, careerAdaptDb, type AppMeta } from "./db";

export type WorkspaceExport = {
  schemaVersion: "stage-b-v1";
  exportedAt: string;
  profiles: CareerProfile[];
  jobDescriptions: JobDescription[];
  rawInputs: RawInputDocument[];
  profileImportDrafts: ProfileImportDraft[];
  jobAnalysisDrafts: JobAnalysisDraft[];
  draftCommits: DraftCommit[];
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
      schemaVersion: "stage-b-v1",
      exportedAt: new Date().toISOString(),
      profiles: await this.listProfiles(),
      jobDescriptions: await this.listJobDescriptions(),
      rawInputs: await this.listRawInputs(),
      profileImportDrafts: (await this.db.profileImportDrafts.toArray()).map((draft) => ProfileImportDraftSchema.parse(draft)),
      jobAnalysisDrafts: (await this.db.jobAnalysisDrafts.toArray()).map((draft) => JobAnalysisDraftSchema.parse(draft)),
      draftCommits: (await this.db.draftCommits.toArray()).map((commit) => DraftCommitSchema.parse(commit)),
      resumeBranches: await this.listResumeBranches(),
      aiLogs: (await this.db.aiLogs.toArray()).map((log) => AiLogSchema.parse(log)),
      exportRecords: (await this.db.exportRecords.toArray()).map((record) => ExportRecordSchema.parse(record)),
      appMeta: await this.db.appMeta.toArray()
    };
  }
}

export class RevisionConflictError extends Error {
  constructor() {
    super("revision_conflict");
    this.name = "RevisionConflictError";
  }
}
