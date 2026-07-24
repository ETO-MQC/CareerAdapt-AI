import { z } from "zod";
import type { AgentPlannerAction } from "../runtime/agentRuntime";
import { nanoid } from "nanoid";
import { AgentExecutor } from "../runtime/agentExecutor";

export const TailorExistingResumeStepSchema = z.enum([
  "select_resume",
  "collect_job",
  "analyze_job",
  "review_job",
  "analyze_fit",
  "generate_plan",
  "answer_questions",
  "preview_changes",
  "confirm_apply",
  "completed"
]);

export type TailorExistingResumeStep = z.infer<typeof TailorExistingResumeStepSchema>;

export const tailorExistingResumeTransitions: Record<TailorExistingResumeStep, TailorExistingResumeStep[]> = {
  select_resume: ["collect_job"],
  collect_job: ["analyze_job"],
  analyze_job: ["review_job"],
  review_job: ["analyze_fit", "collect_job"],
  analyze_fit: ["generate_plan"],
  generate_plan: ["answer_questions", "preview_changes"],
  answer_questions: ["preview_changes", "generate_plan"],
  preview_changes: ["confirm_apply", "generate_plan"],
  confirm_apply: ["completed", "preview_changes"],
  completed: []
};

export function transitionTailorExistingResume(
  current: TailorExistingResumeStep,
  next: TailorExistingResumeStep
) {
  if (!tailorExistingResumeTransitions[current].includes(next)) {
    throw Object.assign(new Error(`Invalid tailoring workflow transition: ${current} -> ${next}`), {
      code: "invalid_tailoring_workflow_transition"
    });
  }
  return next;
}

export const tailorExistingResumeWorkflow = {
  id: "tailor_existing_resume",
  initialStep: "select_resume" as const,
  maximumToolCalls: 12,
  steps: TailorExistingResumeStepSchema.options,
  requiredTools: [
    "list_resumes",
    "list_profiles",
    "parse_job_description",
    "commit_job",
    "analyze_job_fit",
    "create_tailoring_session",
    "answer_tailoring_question",
    "preview_tailoring_changes",
    "apply_tailoring_changes"
  ] as const,
  actionForStep(step: TailorExistingResumeStep): AgentPlannerAction {
    switch (step) {
      case "select_resume":
        return { type: "ask_user", message: "先选择一份已有简历。", field: "resumeId" };
      case "collect_job":
        return { type: "ask_user", message: "粘贴目标岗位描述，并补充岗位名称和公司。", field: "jobDescription" };
      case "review_job":
        return { type: "ask_user", message: "请核对岗位语义结果；确认后继续匹配分析。", field: "jobReview" };
      case "answer_questions":
        return { type: "ask_user", message: "回答一项澄清问题后，我会重新校验建议。", field: "tailoringAnswer" };
      case "confirm_apply":
        return { type: "assistant_message", message: "修改预览已就绪，应用前需要你的明确确认。" };
      case "completed":
        return { type: "workflow_complete", message: "岗位简历已创建新版本。" };
      default:
        return { type: "assistant_message", message: "正在准备下一步。" };
    }
  }
};

export type TailorWorkflowViewState = {
  step: TailorExistingResumeStep;
  busy: boolean;
  error?: string;
  profileId?: string;
  resumeId?: string;
  jobId?: string;
  jobGraph?: unknown;
  fitAnalysis?: unknown;
  tailoringSession?: unknown;
  diffs: unknown[];
  confirmedRequirementIds: string[];
  pendingConfirmation?: "commit_job" | "answer_tailoring_question" | "apply_tailoring_changes";
  appliedRevisionId?: string;
};

export class TailorExistingResumeWorkflowController {
  private state: TailorWorkflowViewState = { step: "select_resume", busy: false, diffs: [], confirmedRequirementIds: [] };
  private listeners = new Set<() => void>();
  private pending?: { toolName: string; input: Record<string, unknown>; operationId: string; next: TailorExistingResumeStep };
  private pendingRequirementIds: string[] = [];

  constructor(private readonly executor: AgentExecutor) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  restore(input: {
    step: string;
    profileId?: string;
    resumeId?: string;
    jobId?: string;
    revisionId?: string;
  }) {
    const step = TailorExistingResumeStepSchema.parse(input.step);
    this.patch({
      step,
      profileId: input.profileId,
      resumeId: input.resumeId,
      jobId: input.jobId,
      appliedRevisionId: input.revisionId,
      busy: false,
      error: undefined
    });
  }

  selectResume(profileId: string, resumeId: string) {
    this.patch({ profileId, resumeId, step: transitionTailorExistingResume(this.state.step, "collect_job"), error: undefined });
  }

  async parseJob(input: { title: string; company: string; rawText: string }) {
    this.patch({ step: transitionTailorExistingResume(this.state.step, "analyze_job") });
    await this.run("parse_job_description", input, "review_job", (data) => ({ jobGraph: record(data).graph }));
    this.pending = {
      toolName: "commit_job",
      input: { ...input, graph: this.state.jobGraph },
      operationId: operationId("commit-job"),
      next: "analyze_fit"
    };
    this.patch({ pendingConfirmation: "commit_job" });
  }

  async confirmPending(confirmed: boolean) {
    const pending = this.pending;
    if (!pending) return;
    if (!confirmed) {
      this.pending = undefined;
      this.pendingRequirementIds = [];
      this.patch({ pendingConfirmation: undefined, busy: false });
      return;
    }
    await this.run(pending.toolName, pending.input, pending.next, (data) => {
      if (pending.toolName === "commit_job") return { jobId: String(record(record(data).jobDescription).id) };
      if (pending.toolName === "answer_tailoring_question") {
        const session = record(data).session;
        const diffs = readDiffs(session);
        return {
          tailoringSession: session,
          diffs,
          error: diffs.length ? undefined : rejectionSummary(data),
          confirmedRequirementIds: [...new Set([...this.state.confirmedRequirementIds, ...this.pendingRequirementIds])]
        };
      }
      if (pending.toolName === "apply_tailoring_changes") {
        return {
          appliedRevisionId: String(record(record(data).revision).id ?? ""),
          resumeId: String(record(record(data).branch).id ?? this.state.resumeId ?? "")
        };
      }
      return {};
    }, true, pending.operationId);
    this.pending = undefined;
    this.pendingRequirementIds = [];
    this.patch({ pendingConfirmation: undefined });
  }

  async analyzeFitAndPlan() {
    const selection = this.requireSelection();
    await this.run("analyze_job_fit", selection, "generate_plan", (data) => ({ fitAnalysis: record(data).analysis }));
    await this.run("create_tailoring_session", selection, "answer_questions", (data) => {
      const session = record(data).session;
      const diffs = Array.isArray(record(data).appliedDiffs) ? record(data).appliedDiffs as unknown[] : readDiffs(session);
      return {
        tailoringSession: session,
        diffs,
        step: readQuestions(session).length ? "answer_questions" as const : diffs.length ? "preview_changes" as const : "answer_questions" as const
      };
    });
  }

  requestAnswer(questionId: string, answer: string, proficiency?: "proficient" | "familiar" | "aware" | "learning") {
    if (!this.state.tailoringSession) throw new Error("tailoring_session_missing");
    const question = readQuestions(this.state.tailoringSession).map(record).find((item) => item.id === questionId);
    this.pendingRequirementIds = Array.isArray(question?.requirementIds)
      ? question.requirementIds.filter((id): id is string => typeof id === "string")
      : [];
    this.pending = {
      toolName: "answer_tailoring_question",
      input: { session: this.state.tailoringSession, questionId, answer, proficiency },
      operationId: operationId("answer-question"),
      next: "preview_changes"
    };
    this.patch({ pendingConfirmation: "answer_tailoring_question" });
  }

  async preview() {
    if (!this.state.tailoringSession) throw new Error("tailoring_session_missing");
    await this.run("preview_tailoring_changes", {
      session: this.state.tailoringSession,
      selectedDiffs: this.state.diffs,
      confirmedRequirementIds: this.state.confirmedRequirementIds
    }, "confirm_apply");
    this.pending = {
      toolName: "apply_tailoring_changes",
      input: {
        session: this.state.tailoringSession,
        selectedDiffs: this.state.diffs,
        confirmedRequirementIds: this.state.confirmedRequirementIds
      },
      operationId: operationId("apply-changes"),
      next: "completed"
    };
    this.patch({ pendingConfirmation: "apply_tailoring_changes" });
  }

  private requireSelection() {
    if (!this.state.profileId || !this.state.resumeId || !this.state.jobId) throw new Error("workflow_selection_incomplete");
    return { profileId: this.state.profileId, resumeId: this.state.resumeId, jobId: this.state.jobId };
  }

  private async run(
    toolName: string,
    input: Record<string, unknown>,
    next: TailorExistingResumeStep,
    map: (data: unknown) => Partial<TailorWorkflowViewState> = () => ({}),
    confirmed = false,
    fixedOperationId = operationId(toolName)
  ) {
    this.patch({ busy: true, error: undefined });
    const result = await this.executor.execute({ toolName, toolInput: input, operationId: fixedOperationId, confirmed });
    if (!result.ok) {
      this.patch({ busy: false, error: result.error?.message ?? "操作失败" });
      return;
    }
    const mapped = map(result.data);
    const mappedStep = mapped.step;
    const targetStep = mappedStep ?? next;
    const current = this.state.step;
    const step = current === targetStep ? current : transitionTailorExistingResume(current, targetStep);
    this.patch({ ...mapped, step, busy: false });
  }

  private patch(value: Partial<TailorWorkflowViewState>) {
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener();
  }
}

function operationId(prefix: string) {
  return `${prefix}-${nanoid(12)}`;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function readDiffs(session: unknown) {
  const plan = record(record(session).plan);
  return Array.isArray(plan.diffs) ? plan.diffs : [];
}

function readQuestions(session: unknown) {
  const plan = record(record(session).plan);
  return Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];
}

function rejectionSummary(data: unknown) {
  const rejected = record(data).rejectedDiffs;
  if (!Array.isArray(rejected) || !rejected.length) return "没有生成可安全应用的修改，请调整岗位要求或补充真实证据后重试。";
  return `没有生成可安全应用的修改：${[...new Set(rejected.map((item) => String(record(item).reasonCode ?? "unknown")))].join("、")}`;
}
