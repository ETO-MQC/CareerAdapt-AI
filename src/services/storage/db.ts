import Dexie, { type Table } from "dexie";
import type {
  AiLog,
  AiSuggestion,
  CareerProfile,
  DraftCommit,
  ExportRecord,
  JobAdaptationDraft,
  JobAdaptationSnapshot,
  JobAnalysisDraft,
  JobDescription,
  MatchOperation,
  ProfileImportDraft,
  RawInputDocument,
  RequirementMatch,
  ResumeBranch,
  SuggestionOperation
} from "@/domain/schemas";

export type AppMeta = {
  key: string;
  value: unknown;
  updatedAt: string;
};

export class CareerAdaptDb extends Dexie {
  profiles!: Table<CareerProfile, string>;
  jobDescriptions!: Table<JobDescription, string>;
  rawInputs!: Table<RawInputDocument, string>;
  profileImportDrafts!: Table<ProfileImportDraft, string>;
  jobAnalysisDrafts!: Table<JobAnalysisDraft, string>;
  draftCommits!: Table<DraftCommit, string>;
  requirementMatches!: Table<RequirementMatch, string>;
  matchOperations!: Table<MatchOperation, string>;
  jobAdaptationDrafts!: Table<JobAdaptationDraft, string>;
  aiSuggestions!: Table<AiSuggestion, string>;
  adaptationSnapshots!: Table<JobAdaptationSnapshot, string>;
  suggestionOperations!: Table<SuggestionOperation, string>;
  resumeBranches!: Table<ResumeBranch, string>;
  aiLogs!: Table<AiLog, string>;
  exportRecords!: Table<ExportRecord, string>;
  appMeta!: Table<AppMeta, string>;

  constructor(name = "CareerAdaptDb") {
    super(name);

    this.version(1).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      resumeBranches: "id, profileId, jobId, updatedAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, branchId, revisionId, createdAt",
      appMeta: "key"
    });

    this.version(2).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      rawInputs: "id, kind, inputHash, updatedAt",
      profileImportDrafts: "id, rawInputId, status, updatedAt",
      jobAnalysisDrafts: "id, rawInputId, status, updatedAt",
      draftCommits: "commitId, draftId, kind, entityId",
      resumeBranches: "id, profileId, jobId, updatedAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, branchId, revisionId, createdAt",
      appMeta: "key"
    });

    this.version(3).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      rawInputs: "id, kind, inputHash, updatedAt",
      profileImportDrafts: "id, rawInputId, status, updatedAt",
      jobAnalysisDrafts: "id, rawInputId, status, updatedAt",
      draftCommits: "commitId, draftId, kind, entityId",
      requirementMatches: "id, [profileId+jobId], requirementId, isStale, updatedAt",
      matchOperations: "id, operationId, requirementMatchId, [profileId+jobId], type, occurredAt",
      resumeBranches: "id, profileId, jobId, updatedAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, branchId, revisionId, createdAt",
      appMeta: "key"
    });

    this.version(4).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      rawInputs: "id, kind, inputHash, updatedAt",
      profileImportDrafts: "id, rawInputId, status, updatedAt",
      jobAnalysisDrafts: "id, rawInputId, status, updatedAt",
      draftCommits: "commitId, draftId, kind, entityId",
      requirementMatches: "id, [profileId+jobId], requirementId, isStale, updatedAt",
      matchOperations: "id, operationId, requirementMatchId, [profileId+jobId], type, occurredAt",
      jobAdaptationDrafts: "id, [profileId+jobId], status, updatedAt",
      aiSuggestions: "id, draftId, status, type, updatedAt",
      adaptationSnapshots: "id, draftId, revision, operationId, updatedAt",
      suggestionOperations: "id, operationId, draftId, suggestionId, type, occurredAt",
      resumeBranches: "id, profileId, jobId, updatedAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, branchId, revisionId, createdAt",
      appMeta: "key"
    });
  }
}

export const careerAdaptDb = new CareerAdaptDb();
