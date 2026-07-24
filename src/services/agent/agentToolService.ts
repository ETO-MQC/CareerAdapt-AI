import {
  ImportedResumeDraftSchema,
  JobAnalysisDraftSchema,
  JobRequirementGraphV4Schema,
  RawInputDocumentSchema,
  ResumeTailoringDiffSchema,
  TailoringIntensitySchema
} from "@/domain/schemas";
import { projectJobGraphV4ToAnalyzerOutput } from "@/domain/jobOptimization/v3/project";
import { createImportedResumeDraftFromText } from "@/domain/resumeImport/parser";
import {
  analyzeJobCommand,
  answerTailoringQuestionCommand,
  applyTailoringSessionCommand,
  createTailoringSessionCommand,
  generateTailoringDiffsCommand,
  previewTailoringChangesCommand,
  TailoringSessionSchema,
  type TailoringSession
} from "@/services/jobs/tailoringCommands";
import { invokeStructuredAi } from "@/ai/client";
import { ResumeTailoringDiffModelOutputSchema, type ResumeTailoringDiffTaskInput } from "@/domain/schemas";
import { commitParsedJob } from "@/services/jobs/jobWorkflow";
import { analyzeJobFit } from "@/services/jobs/tailoringService";
import { hashText, stableHashText } from "@/services/security/text";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type { AgentToolServices } from "@/agent/tools/registry";

export class BrowserAgentToolService implements AgentToolServices {
  constructor(private readonly repository = new WorkspaceRepository()) {}

  async listResumes(signal?: AbortSignal) {
    assertNotAborted(signal);
    const branches = await this.repository.listResumeBranches();
    return {
      resumes: branches
        .filter((branch) => branch.lifecycleStatus === "active" && branch.migrationStatus === "verified")
        .map((branch) => ({
          id: branch.id,
          profileId: branch.profileId,
          jobId: branch.jobId,
          name: branch.name,
          purpose: branch.branchPurpose,
          revision: branch.revision,
          updatedAt: branch.updatedAt
        }))
    };
  }

  async listProfiles(signal?: AbortSignal) {
    assertNotAborted(signal);
    const profiles = await this.repository.listProfiles();
    return {
      profiles: profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        version: profile.version,
        experienceCount: profile.experiences.length,
        skillCount: profile.skills.length,
        updatedAt: profile.updatedAt
      }))
    };
  }

  async listJobs(signal?: AbortSignal) {
    assertNotAborted(signal);
    const jobs = await this.repository.listJobDescriptions();
    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        requirementCount: job.requirements.length,
        analysisStatus: job.analysisStatus,
        updatedAt: job.updatedAt
      }))
    };
  }

  async parseResumeFile(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { fileName: string; mimeType: string; text: string };
    if (input.mimeType === "application/pdf") {
      throw toolError("pdf_text_required", "PDF must first be converted to page text by the existing PDF import flow.");
    }
    const now = new Date().toISOString();
    const text = input.text.replace(/\r\n/g, "\n").trim();
    const draft = createImportedResumeDraftFromText({
      source: {
        fileName: input.fileName,
        mimeType: input.mimeType as "text/plain",
        fileHash: stableHashText(input.text),
        normalizedTextHash: stableHashText(text),
        pageCount: 1,
        extractedAt: now
      },
      pages: [{
        pageNumber: 1,
        extractedPageText: input.text,
        cleanedPageText: text,
        charStart: 0,
        charEnd: text.length
      }],
      sourceKind: input.mimeType === "application/json" ? "standard_json" : "docx",
      now
    });
    return { parsedResume: draft };
  }

  async createResumeImportDraft(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { parsedResume: unknown };
    const draft = ImportedResumeDraftSchema.parse(input.parsedResume);
    const saved = await this.repository.saveImportedResumeDraft(draft, 0);
    return {
      importId: saved.importId,
      revision: saved.revision,
      status: saved.status,
      sectionCount: saved.sections.length,
      warningCount: saved.warnings.length
    };
  }

  async commitResumeImport(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      importId: string;
      expectedDraftRevision: number;
      target?: { mode: "existing"; profileId: string } | { mode: "new"; profileName: string; createGeneralResume: true };
    };
    return this.repository.confirmImportedResume({ ...input, operationId });
  }

  async parseJobDescription(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = rawInput as { rawText: string };
    return analyzeJobCommand({ operationId, rawText: input.rawText }, signal);
  }

  async commitJob(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { title: string; company: string; rawText: string; graph: unknown };
    const graph = JobRequirementGraphV4Schema.parse(input.graph);
    const now = new Date().toISOString();
    const rawInputId = `raw-agent-job-${stableHashText(operationId).slice(0, 20)}`;
    const draftId = `job-draft-agent-${stableHashText(operationId).slice(0, 20)}`;
    const rawDocument = RawInputDocumentSchema.parse({
      id: rawInputId,
      kind: "job_jd",
      rawText: input.rawText,
      inputHash: await hashText(input.rawText),
      title: `${input.company} ${input.title}`,
      createdAt: now,
      updatedAt: now
    });
    const analyzerOutput = projectJobGraphV4ToAnalyzerOutput({
      graph,
      title: input.title,
      company: input.company,
      now
    });
    const draft = JobAnalysisDraftSchema.parse({
      id: draftId,
      rawInputId,
      revision: 0,
      title: input.title,
      company: input.company,
      status: graph.needsReview ? "needs_review" : "ai_validated",
      promptVersion: "agent-command.v1",
      attemptCount: 1,
      analyzerOutput,
      requirementGraph: graph,
      analysisIssues: graph.sourceCoverage.unclassifiedSpans.map((span) => span.text),
      manualRequirements: [],
      riskNotes: analyzerOutput.riskNotes,
      createdAt: now,
      updatedAt: now
    });
    await this.repository.saveRawInput(rawDocument);
    await this.repository.createJobAnalysisDraft(draft);
    return commitParsedJob({ repository: this.repository, draft, rawInput: rawDocument });
  }

  async analyzeJobFit(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const { profile, branch, job } = await this.loadSelection(rawInput);
    return { operationId, analysis: analyzeJobFit({ profile, branch, job }) };
  }

  async createTailoringSession(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = rawInput as { intensity?: unknown };
    const { profile, branch, job } = await this.loadSelection(rawInput);
    const created = createTailoringSessionCommand({
      operationId,
      profile,
      branch,
      job,
      intensity: input.intensity ? TailoringIntensitySchema.parse(input.intensity) : undefined
    }, signal);
    return this.generateDiffs(operationId, created.session, signal);
  }

  async answerTailoringQuestion(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = rawInput as { session: unknown; questionId: string; answer: string | string[] | boolean; proficiency?: "proficient" | "familiar" | "aware" | "learning" };
    const answered = answerTailoringQuestionCommand({
      operationId,
      session: TailoringSessionSchema.parse(input.session),
      questionId: input.questionId,
      answer: input.answer,
      proficiency: input.proficiency
    }, signal);
    return this.generateDiffs(operationId, answered.session, signal);
  }

  async previewTailoringChanges(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = parseTailoringChanges(rawInput);
    return previewTailoringChangesCommand({ operationId, ...input }, signal);
  }

  async applyTailoringChanges(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = parseTailoringChanges(rawInput);
    let session = input.session;

    if (session.branch.branchPurpose === "general") {
      if (!session.branch.currentRevisionId) {
        throw toolError("source_revision_missing", "The selected resume does not have a source revision.");
      }
      const derived = await this.repository.deriveJobSpecificBranchFromBranch({
        sourceBranchId: session.branch.id,
        jobId: session.job.id,
        expectedSourceRevision: session.branch.revision,
        expectedSourceRevisionId: session.branch.currentRevisionId,
        operationId: childOperationId(operationId, "derive"),
        name: `${session.branch.name} · ${session.job.title}`.slice(0, 120)
      });
      session = TailoringSessionSchema.parse({
        ...session,
        branch: derived.branch
      });
    }

    return applyTailoringSessionCommand({
      repository: this.repository,
      operationId: childOperationId(operationId, "apply"),
      session,
      selectedDiffs: input.selectedDiffs,
      confirmedRequirementIds: input.confirmedRequirementIds,
      signal
    });
  }

  async exportResume(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { resumeId: string; templateId?: string };
    const branch = await this.repository.getResumeBranch(input.resumeId);
    if (!branch) throw toolError("resume_not_found", "Resume no longer exists.");
    await this.repository.getResumePresentationConfig(branch.id);
    return {
      exportId: `agent-export-${stableHashText(operationId).slice(0, 20)}`,
      branchId: branch.id,
      route: `/resume?branchId=${encodeURIComponent(branch.id)}&export=pdf`,
      status: "ready_for_preview"
    };
  }

  private async loadSelection(rawInput: unknown) {
    const input = rawInput as { profileId: string; resumeId: string; jobId: string };
    const [profile, branch, job] = await Promise.all([
      this.repository.getProfile(input.profileId),
      this.repository.getResumeBranch(input.resumeId),
      this.repository.getJobDescription(input.jobId)
    ]);
    if (!profile) throw toolError("profile_not_found", "Profile no longer exists.");
    if (!branch) throw toolError("resume_not_found", "Resume no longer exists.");
    if (!job) throw toolError("job_not_found", "Job no longer exists.");
    if (branch.profileId !== profile.id) throw toolError("resume_profile_mismatch", "Resume does not belong to the selected profile.");
    return { profile, branch, job };
  }

  private generateDiffs(operationId: string, session: TailoringSession, signal?: AbortSignal) {
    return generateTailoringDiffsCommand({
      operationId,
      session,
      signal,
      generate: async (request: ResumeTailoringDiffTaskInput, requestSignal?: AbortSignal) => {
        const result = await invokeStructuredAi({
          task: "resume-tailor-diff",
          businessInput: request,
          outputSchema: ResumeTailoringDiffModelOutputSchema,
          signal: requestSignal
        });
        if (!result.ok) throw toolError(result.errorCode, "AI could not generate a validated tailoring diff.");
        return result.data;
      }
    });
  }
}

function parseTailoringChanges(rawInput: unknown) {
  const input = rawInput as { session: unknown; selectedDiffs: unknown[]; confirmedRequirementIds?: string[] };
  return {
    session: TailoringSessionSchema.parse(input.session),
    selectedDiffs: input.selectedDiffs.map((diff) => ResumeTailoringDiffSchema.parse(diff)),
    confirmedRequirementIds: input.confirmedRequirementIds ?? []
  };
}

function childOperationId(operationId: string, suffix: string) {
  return `${operationId.slice(0, 150 - suffix.length)}-${suffix}`;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw toolError("operation_cancelled", "Operation was cancelled.");
}

function toolError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
