import { z } from "zod";
import {
  CommittedJobDescriptionSchema,
  JobWorkflowErrorStateSchema,
  type JobAnalysisDraft,
  type JobAnalysisRun,
  type JobAnalysisRunStatus,
  type JobWorkflowErrorCode,
  type JobWorkflowErrorState,
  type RawInputDocument
} from "@/domain/schemas";
import { mapJobDraftToJobDescription } from "@/domain/mappers/jobDraftMapper";
import { RevisionConflictError, type WorkspaceRepository } from "@/services/storage/repositories";

export const MIN_JD_TEXT_LENGTH = 20;
export const JOB_ANALYSIS_STALE_MS = 5 * 60 * 1000;

export function appendJobAnalysisRun(draft: JobAnalysisDraft, run: JobAnalysisRun): JobAnalysisDraft {
  return { ...draft, analysisRunStatus: run.status, analysisRuns: [...(draft.analysisRuns ?? []).filter((item) => item.id !== run.id), run].slice(-10) };
}

export function recoverInterruptedJobAnalysis(draft: JobAnalysisDraft, now = Date.now()): JobAnalysisDraft {
  const active: JobAnalysisRunStatus[] = ["local_analyzing", "ai_analyzing", "validating"];
  if (!draft.analysisRunStatus || !active.includes(draft.analysisRunStatus) || now - Date.parse(draft.updatedAt) <= JOB_ANALYSIS_STALE_MS) return draft;
  const runs = [...(draft.analysisRuns ?? [])];
  const last = runs.at(-1);
  if (last && active.includes(last.status)) runs[runs.length - 1] = { ...last, status: "interrupted", finishedAt: new Date(now).toISOString() };
  return { ...draft, analysisRunStatus: "interrupted", analysisRuns: runs };
}

export type JobAiFailureReason =
  | "provider_unavailable"
  | "provider_http_error"
  | "invalid_json"
  | "empty_output"
  | "schema_validation_failed"
  | "source_validation_failed"
  | "output_too_large"
  | "unknown";

export type JobResumeGenerationErrorCode =
  | "no_job_selected"
  | "no_source_selected"
  | "source_not_general"
  | "source_revision_changed"
  | "source_reference_invalid"
  | "job_missing"
  | "job_has_no_requirements"
  | "matches_missing"
  | "matches_incomplete"
  | "matches_stale"
  | "matches_have_no_evidence"
  | "repository_write_failed"
  | "unknown";

export type JobOperationFeedback = { title: string; message: string; nextStep: string };

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
  const reason = classifyJobAiFailureReason(errorCode);
  if (reason === "schema_validation_failed" || reason === "source_validation_failed") {
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

export function classifyJobAiFailureReason(errorCode?: string): JobAiFailureReason {
  const code = errorCode?.toLowerCase() ?? "";
  if (code.includes("missing_ai_config") || code.includes("protocol_mismatch") || code.includes("unavailable") || code.includes("timeout") || code.includes("provider_failed")) return "provider_unavailable";
  if (code.includes("http")) return "provider_http_error";
  if (code.includes("invalid_json")) return "invalid_json";
  if (code.includes("empty")) return "empty_output";
  if (code.includes("semantic") || code.includes("source")) return "source_validation_failed";
  if (code.includes("schema") || code.includes("validation")) return "schema_validation_failed";
  if (code.includes("too_large") || code.includes("output_limit")) return "output_too_large";
  return "unknown";
}

export function jobAiFailureFeedback(reason: JobAiFailureReason): JobOperationFeedback {
  if (reason === "provider_unavailable") return { title: "AI 服务暂时不可用", message: "原始 JD 已保留，并已使用本地规则整理岗位要求。", nextStep: "你可以稍后重试 AI 解析，或直接核对本地草稿。" };
  if (reason === "provider_http_error") return { title: "AI 服务请求失败", message: "服务提供方没有成功处理请求，原始 JD 已保留。", nextStep: "请检查服务地址与模型配置，或继续使用本地解析。" };
  if (reason === "invalid_json" || reason === "empty_output") return { title: "岗位解析结果无法读取", message: "AI 返回的内容为空或格式无法读取，系统已生成本地草稿。", nextStep: "你可以重试 AI 解析，或继续核对并提交本地草稿。" };
  if (reason === "schema_validation_failed" || reason === "source_validation_failed") return { title: "岗位解析格式不完整", message: "AI 返回的优先级或来源字段不符合要求，已保留原始 JD，并生成本地解析结果。", nextStep: "你可以重试 AI 解析，或继续使用本地解析。" };
  if (reason === "output_too_large") return { title: "岗位解析内容过长", message: "AI 返回内容超过安全限制，原始 JD 已保留并生成本地草稿。", nextStep: "请缩短 JD 后重试，或继续使用本地解析。" };
  return { title: "岗位解析未完成", message: "AI 解析没有完成，原始 JD 已保留并生成本地草稿。", nextStep: "请重试 AI 解析，或继续使用本地解析。" };
}

export function mapJobResumeGenerationError(error: unknown): JobResumeGenerationErrorCode {
  if (error instanceof RevisionConflictError) return "source_revision_changed";
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no_job_selected")) return "no_job_selected";
  if (message.includes("no_source_selected")) return "no_source_selected";
  if (message.includes("requires_general_source")) return "source_not_general";
  if (message.includes("job_has_no_requirements")) return "job_has_no_requirements";
  if (message === "job_missing") return "job_missing";
  if (message.includes("invalid_reference") || message.includes("branch_source_missing") || message.includes("derive_branch_source_missing")) return "source_reference_invalid";
  if (message.includes("revision") || message.includes("version_conflict")) return "source_revision_changed";
  if (message.includes("match_stale")) return "matches_stale";
  if (message.includes("match_requirement_missing") || message.includes("matches_incomplete")) return "matches_incomplete";
  if (message.includes("no_evidence") || message.includes("confirmed_evidence")) return "matches_have_no_evidence";
  if (message.includes("requirement_matches") || message.includes("requires_requirement_matches") || message.includes("no_matches")) return "matches_missing";
  if (message.includes("repository") || message.includes("database") || message.includes("indexeddb")) return "repository_write_failed";
  return "unknown";
}

export function jobResumeGenerationFeedback(code: JobResumeGenerationErrorCode): JobOperationFeedback {
  const feedback: Record<JobResumeGenerationErrorCode, JobOperationFeedback> = {
    no_job_selected: { title: "尚未选择岗位", message: "当前没有可用于生成简历的岗位。", nextStep: "请先选择或提交一个正式岗位。" },
    no_source_selected: { title: "尚未选择来源", message: "系统还不知道要基于哪些资料创建岗位简历。", nextStep: "请选择资料库或一份通用简历。" },
    source_not_general: { title: "来源简历类型不适用", message: "岗位简历只能从通用简历派生。", nextStep: "请选择一份可用的通用简历。" },
    source_revision_changed: { title: "来源简历已经更新", message: "当前岗位匹配基于旧版本，不能直接创建岗位简历。", nextStep: "请重新运行岗位匹配。" },
    source_reference_invalid: { title: "来源简历引用已失效", message: "部分经历或技能已被删除或修改。", nextStep: "请同步简历并重新匹配。" },
    job_missing: { title: "岗位已不存在", message: "当前选择的岗位已被删除或移动。", nextStep: "请重新选择一个正式岗位。" },
    job_has_no_requirements: { title: "岗位缺少有效要求", message: "当前岗位没有可用于匹配的已确认要求。", nextStep: "请重新编辑 JD 并提交岗位要求。" },
    matches_missing: { title: "尚未完成岗位匹配", message: "系统还不知道哪些经历支持该岗位。", nextStep: "请先运行匹配。" },
    matches_incomplete: { title: "岗位匹配尚不完整", message: "部分岗位要求还没有对应的匹配结果。", nextStep: "请重新运行岗位匹配。" },
    matches_stale: { title: "匹配结果已经过期", message: "资料、岗位或来源简历已发生变化。", nextStep: "请重新运行岗位匹配。" },
    matches_have_no_evidence: { title: "请选择真实来源内容", message: "当前没有选中可用于创建岗位简历的真实内容。", nextStep: "请至少选择一项资料；未覆盖的岗位要求会保留为可补充项。" },
    repository_write_failed: { title: "岗位简历保存失败", message: "系统未能写入新的岗位简历，现有资料没有被修改。", nextStep: "请稍后重试；若持续失败，请检查本地存储空间。" },
    unknown: { title: "岗位简历生成失败", message: "系统未能完成岗位简历创建，现有资料没有被修改。", nextStep: "请重新检查来源与匹配后再试。" }
  };
  return feedback[code];
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
