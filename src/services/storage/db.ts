import Dexie, { type Table } from "dexie";
import type {
  AiLog,
  AiSuggestion,
  ApplicationRecord,
  CareerProfile,
  DraftCommit,
  ExportRecord,
  JobAdaptationDraft,
  JobAdaptationSnapshot,
  JobAnalysisDraft,
  JobDescription,
  MatchOperation,
  PdfImportSession,
  PdfPageText,
  ProfileImportDraft,
  RawInputDocument,
  RequirementMatch,
  ResumeBranch,
  ResumeBranchOperation,
  ResumeRevision,
  SuggestionOperation
} from "@/domain/schemas";
import type { AgentSession } from "@/agent/contracts/agentSession";

export type AppMeta = {
  key: string;
  value: unknown;
  updatedAt: string;
};

export class CareerAdaptDb extends Dexie {
  profiles!: Table<CareerProfile, string>;
  jobDescriptions!: Table<JobDescription, string>;
  rawInputs!: Table<RawInputDocument, string>;
  pdfImportSessions!: Table<PdfImportSession, string>;
  pdfPageTexts!: Table<PdfPageText, string>;
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
  resumeRevisions!: Table<ResumeRevision, string>;
  resumeBranchOperations!: Table<ResumeBranchOperation, string>;
  aiLogs!: Table<AiLog, string>;
  exportRecords!: Table<ExportRecord, string>;
  applications!: Table<ApplicationRecord, string>;
  agentSessions!: Table<AgentSession, string>;
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

    this.version(5).stores({
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
      resumeBranches: "id, profileId, jobId, sourceAdaptationDraftId, lifecycleStatus, migrationStatus, updatedAt",
      resumeRevisions: "id, branchId, revisionNumber, operationId, source, createdAt",
      resumeBranchOperations: "id, &operationId, branchId, sourceAdaptationDraftId, type, occurredAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, branchId, revisionId, createdAt",
      appMeta: "key"
    }).upgrade(async (tx) => {
      const table = tx.table("resumeBranches");
      const branches = await table.toArray();
      const now = new Date().toISOString();

      for (const branch of branches) {
        if (branch && typeof branch === "object" && "migrationStatus" in branch) {
          continue;
        }

        const legacy = branch as {
          id?: string;
          profileId?: string;
          jobId?: string;
          name?: string;
          profileVersion?: number;
          updatedAt?: string;
          createdAt?: string;
        };
        await table.put({
          id: legacy.id ?? `legacy-branch-${crypto.randomUUID()}`,
          profileId: legacy.profileId ?? "legacy-profile",
          jobId: legacy.jobId ?? "legacy-job",
          name: legacy.name ?? "Legacy resume branch",
          sourceProfileVersion: legacy.profileVersion ?? 1,
          sourceJobVersion: legacy.updatedAt ?? now,
          sourceAdaptationDraftId: "legacy-unverified",
          sourceDraftRevision: 0,
          matcherVersion: "legacy-unverified",
          sourceMatchSetHash: "legacy-unverified",
          requirementMatchIds: [],
          revision: 0,
          lifecycleStatus: "archived",
          migrationStatus: "legacy_unverified",
          syncStatusCache: {
            status: "invalid_reference",
            sourceProfileVersion: legacy.profileVersion ?? 1,
            currentProfileVersion: legacy.profileVersion ?? 1,
            sourceJobVersion: legacy.updatedAt ?? now,
            currentJobVersion: legacy.updatedAt ?? now,
            invalidFactRefs: [],
            checkedAt: now,
            message: "Legacy placeholder branch preserved as read-only unverified data."
          },
          contentItems: [],
          legacyPayload: branch,
          createdAt: legacy.createdAt ?? now,
          updatedAt: legacy.updatedAt ?? now
        });
      }
    });

    this.version(6).stores({
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
      resumeBranches: "id, profileId, jobId, sourceAdaptationDraftId, lifecycleStatus, migrationStatus, updatedAt",
      resumeRevisions: "id, branchId, revisionNumber, operationId, source, createdAt",
      resumeBranchOperations: "id, &operationId, branchId, sourceAdaptationDraftId, type, occurredAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, &operationId, branchId, branchRevision, templateId, exportStatus, exportedAt",
      appMeta: "key"
    }).upgrade(async (tx) => {
      const table = tx.table("exportRecords");
      const records = await table.toArray();
      const now = new Date().toISOString();

      for (const record of records) {
        const legacy = record as {
          id?: string;
          operationId?: string;
          branchId?: string;
          revisionId?: string;
          branchRevision?: number;
          templateId?: string;
          format?: "pdf" | "json";
          fileName?: string;
          displayName?: string;
          exportStatus?: string;
          overflowStatus?: string;
          exportedAt?: string;
          createdAt?: string;
          updatedAt?: string;
        };
        const id = legacy.id ?? `export-${crypto.randomUUID()}`;
        const fileName = legacy.fileName ?? "resume-export.pdf";
        await table.put({
          ...record,
          id,
          operationId: legacy.operationId ?? id,
          branchId: legacy.branchId ?? "legacy-branch",
          revisionId: legacy.revisionId ?? "legacy-revision",
          branchRevision: legacy.branchRevision ?? 0,
          templateId: legacy.templateId ?? "legacy-template",
          format: legacy.format ?? "pdf",
          fileName,
          displayName: legacy.displayName ?? fileName,
          exportStatus: legacy.exportStatus ?? "print_invoked",
          overflowStatus: legacy.overflowStatus ?? "fits",
          exportedAt: legacy.exportedAt ?? legacy.createdAt ?? now,
          createdAt: legacy.createdAt ?? now,
          updatedAt: legacy.updatedAt ?? now
        });
      }
    });

    this.version(7).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      rawInputs: "id, kind, inputHash, sourceSessionId, updatedAt",
      pdfImportSessions: "id, status, fileHash, normalizedTextHash, rawInputId, draftId, updatedAt",
      pdfPageTexts: "id, sessionId, [sessionId+pageNumber], pageNumber, updatedAt",
      profileImportDrafts: "id, rawInputId, status, updatedAt",
      jobAnalysisDrafts: "id, rawInputId, status, updatedAt",
      draftCommits: "commitId, draftId, kind, entityId",
      requirementMatches: "id, [profileId+jobId], requirementId, isStale, updatedAt",
      matchOperations: "id, operationId, requirementMatchId, [profileId+jobId], type, occurredAt",
      jobAdaptationDrafts: "id, [profileId+jobId], status, updatedAt",
      aiSuggestions: "id, draftId, status, type, updatedAt",
      adaptationSnapshots: "id, draftId, revision, operationId, updatedAt",
      suggestionOperations: "id, operationId, draftId, suggestionId, type, occurredAt",
      resumeBranches: "id, profileId, jobId, sourceAdaptationDraftId, lifecycleStatus, migrationStatus, updatedAt",
      resumeRevisions: "id, branchId, revisionNumber, operationId, source, createdAt",
      resumeBranchOperations: "id, &operationId, branchId, sourceAdaptationDraftId, type, occurredAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, &operationId, branchId, branchRevision, templateId, exportStatus, exportedAt",
      appMeta: "key"
    });

    this.version(8).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      rawInputs: "id, kind, inputHash, sourceSessionId, updatedAt",
      pdfImportSessions: "id, status, fileHash, normalizedTextHash, rawInputId, draftId, updatedAt",
      pdfPageTexts: "id, sessionId, [sessionId+pageNumber], pageNumber, updatedAt",
      profileImportDrafts: "id, rawInputId, status, updatedAt",
      jobAnalysisDrafts: "id, rawInputId, status, updatedAt",
      draftCommits: "commitId, draftId, kind, entityId",
      requirementMatches: "id, [profileId+jobId], requirementId, isStale, updatedAt",
      matchOperations: "id, operationId, requirementMatchId, [profileId+jobId], type, occurredAt",
      jobAdaptationDrafts: "id, [profileId+jobId], status, updatedAt",
      aiSuggestions: "id, draftId, status, type, updatedAt",
      adaptationSnapshots: "id, draftId, revision, operationId, updatedAt",
      suggestionOperations: "id, operationId, draftId, suggestionId, type, occurredAt",
      resumeBranches: "id, profileId, jobId, sourceAdaptationDraftId, lifecycleStatus, migrationStatus, updatedAt",
      resumeRevisions: "id, branchId, revisionNumber, operationId, source, createdAt",
      resumeBranchOperations: "id, &operationId, branchId, sourceAdaptationDraftId, type, occurredAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, &operationId, branchId, branchRevision, templateId, exportStatus, exportedAt",
      applications: "id, profileId, jobId, jobSpecificBranchId, status, updatedAt, [profileId+status]",
      appMeta: "key"
    });

    this.version(9).stores({
      profiles: "id, name, updatedAt",
      jobDescriptions: "id, title, company, updatedAt",
      rawInputs: "id, kind, inputHash, sourceSessionId, updatedAt",
      pdfImportSessions: "id, status, fileHash, normalizedTextHash, rawInputId, draftId, updatedAt",
      pdfPageTexts: "id, sessionId, [sessionId+pageNumber], pageNumber, updatedAt",
      profileImportDrafts: "id, rawInputId, status, updatedAt",
      jobAnalysisDrafts: "id, rawInputId, status, updatedAt",
      draftCommits: "commitId, draftId, kind, entityId",
      requirementMatches: "id, [profileId+jobId], requirementId, isStale, updatedAt",
      matchOperations: "id, operationId, requirementMatchId, [profileId+jobId], type, occurredAt",
      jobAdaptationDrafts: "id, [profileId+jobId], status, updatedAt",
      aiSuggestions: "id, draftId, status, type, updatedAt",
      adaptationSnapshots: "id, draftId, revision, operationId, updatedAt",
      suggestionOperations: "id, operationId, draftId, suggestionId, type, occurredAt",
      resumeBranches: "id, profileId, jobId, sourceAdaptationDraftId, lifecycleStatus, migrationStatus, updatedAt",
      resumeRevisions: "id, branchId, revisionNumber, operationId, source, createdAt",
      resumeBranchOperations: "id, &operationId, branchId, sourceAdaptationDraftId, type, occurredAt",
      aiLogs: "id, task, provider, createdAt",
      exportRecords: "id, &operationId, branchId, branchRevision, templateId, exportStatus, exportedAt",
      applications: "id, profileId, jobId, jobSpecificBranchId, status, updatedAt, [profileId+status]",
      agentSessions: "id, updatedAt, createdAt, [workflowState.status+updatedAt]",
      appMeta: "key"
    });
  }
}

export const careerAdaptDb = new CareerAdaptDb();
