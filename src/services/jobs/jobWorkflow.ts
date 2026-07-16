import { z } from "zod";
import {
  CommittedJobDescriptionSchema,
  JobWorkflowErrorStateSchema,
  type JobAnalysisDraft,
  type JobWorkflowErrorCode,
  type JobWorkflowErrorState,
  type RawInputDocument
} from "@/domain/schemas";
import { mapJobDraftToJobDescription } from "@/domain/mappers/jobDraftMapper";
import { RevisionConflictError, type WorkspaceRepository } from "@/services/storage/repositories";

export const MIN_JD_TEXT_LENGTH = 20;

type JobCommitRepository = Pick<WorkspaceRepository, "commitJobDraft">;

export class JobWorkflowError extends Error {
  readonly state: JobWorkflowErrorState;

  constructor(state: JobWorkflowErrorState) {
    super(state.message);
    this.name = "JobWorkflowError";
    this.state = JobWorkflowErrorStateSchema.parse(state);
  }
}

export function validateJobInput(input: { title: string; company: string; rawText: string }) {
  const title = input.title.trim();
  const company = input.company.trim();
  const rawText = input.rawText.trim();

  if (!title || !company || !rawText) {
    throw createJobWorkflowError(
      "empty_input",
      "input",
      !rawText ? "请粘贴岗位 JD 原文后再解析。" : "请填写岗位名称和公司名称后再解析。"
    );
  }

  if (rawText.length < MIN_JD_TEXT_LENGTH) {
    throw createJobWorkflowError(
      "text_too_short",
      "input",
      `JD 文本过短，请至少提供 ${MIN_JD_TEXT_LENGTH} 个字符，以便识别岗位要求。`
    );
  }

  return { title, company, rawText };
}

export function classifyJobAiFailure(errorCode?: string) {
  const normalized = errorCode?.toLowerCase() ?? "";
  if (normalized.includes("schema") || normalized.includes("validation")) {
    return createJobWorkflowError(
      "schema_validation_failed",
      "validate",
      "AI 返回内容未通过岗位 Schema 校验。请重试，或保留原始 JD 并改用手动分类。"
    );
  }

  return createJobWorkflowError(
    "ai_invalid_output",
    "parse",
    "AI 未返回有效的岗位解析结果。请重试，或保留原始 JD 并改用手动分类。"
  );
}

export async function commitParsedJob(input: {
  repository: JobCommitRepository;
  draft: JobAnalysisDraft;
  rawInput: RawInputDocument;
}) {
  try {
    const jobDescription = mapJobDraftToJobDescription({
      draft: input.draft,
      rawInput: input.rawInput,
      jobId: input.draft.committedJobId
    });
    const committedJob = CommittedJobDescriptionSchema.parse(jobDescription);
    return await input.repository.commitJobDraft({
      draftId: input.draft.id,
      expectedRevision: input.draft.revision,
      commitId: `commit-job-${input.draft.id}-${input.draft.revision}`,
      jobDescription: committedJob
    });
  } catch (error) {
    if (error instanceof JobWorkflowError) {
      throw error;
    }
    if (error instanceof RevisionConflictError) {
      throw createJobWorkflowError(
        "revision_conflict",
        "save",
        "岗位草稿已发生变化，请重试保存。"
      );
    }
    if (error instanceof z.ZodError) {
      throw createJobWorkflowError(
        "schema_validation_failed",
        "validate",
        "岗位草稿未通过 Schema 校验。请检查已确认要求及其原文位置。"
      );
    }
    throw createJobWorkflowError(
      "repository_save_failed",
      "save",
      "岗位保存失败，原始 JD 和当前分类已保留。请重试。"
    );
  }
}

export function updateRequirementConfirmation(
  draft: JobAnalysisDraft,
  requirementId: string,
  confirmedByUser: boolean
): JobAnalysisDraft {
  const updateRequirements = (requirements: JobAnalysisDraft["manualRequirements"]) =>
    requirements.map((requirement) =>
      requirement.id === requirementId
        ? { ...requirement, confirmedByUser, needsConfirmation: !confirmedByUser }
        : requirement
    );

  return {
    ...draft,
    status: "editing",
    analyzerOutput: draft.analyzerOutput
      ? { ...draft.analyzerOutput, requirements: updateRequirements(draft.analyzerOutput.requirements) }
      : undefined,
    manualRequirements: draft.analyzerOutput
      ? draft.manualRequirements
      : updateRequirements(draft.manualRequirements)
  };
}

export function jobWorkflowErrorState(
  error: unknown,
  fallbackCode: "repository_save_failed" | "unknown_error" = "unknown_error"
): JobWorkflowErrorState {
  if (error instanceof JobWorkflowError) {
    return error.state;
  }
  if (error instanceof RevisionConflictError) {
    return createJobWorkflowError(
      "revision_conflict",
      "save",
      "岗位草稿已发生变化，请重试。"
    ).state;
  }
  if (error instanceof z.ZodError) {
    return createJobWorkflowError(
      "schema_validation_failed",
      "validate",
      "岗位数据未通过 Schema 校验，请检查后重试。"
    ).state;
  }
  return createJobWorkflowError(
    fallbackCode,
    "save",
    fallbackCode === "repository_save_failed"
      ? "岗位保存失败，原始 JD 和当前分类已保留。请重试。"
      : "发生未知错误，原始 JD 已保留。请重试。"
  ).state;
}

function createJobWorkflowError(
  code: JobWorkflowErrorCode,
  stage: JobWorkflowErrorState["stage"],
  message: string
) {
  return new JobWorkflowError({
    code,
    stage,
    message,
    retryable: true
  });
}
