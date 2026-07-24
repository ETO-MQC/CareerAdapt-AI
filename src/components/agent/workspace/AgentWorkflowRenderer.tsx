import { ArrowLeft } from "lucide-react";
import type {
  TailorExistingResumeWorkflowController,
  TailorWorkflowViewState
} from "@/agent/workflows/tailorExistingResumeWorkflow";
import { AgentConfirmationCard } from "@/components/agent/AgentConfirmationCard";
import { AgentProgressTimeline } from "@/components/agent/AgentProgressTimeline";

type ResumeSummary = {
  id: string;
  profileId: string;
  name: string;
  purpose: string;
  revision: number;
};

export function AgentWorkflowRenderer({
  state,
  resumes,
  selectedResume,
  jobTitle,
  jobCompany,
  jobText,
  answer,
  onSelectedResumeChange,
  onSelectResume,
  onJobTitleChange,
  onJobCompanyChange,
  onJobTextChange,
  onParseJob,
  onAnswerChange,
  onAnswer,
  onAnalyze,
  onPreview,
  onConfirm,
  onChooseAnotherTask
}: {
  state: TailorWorkflowViewState;
  resumes: ResumeSummary[];
  selectedResume: string;
  jobTitle: string;
  jobCompany: string;
  jobText: string;
  answer: string;
  onSelectedResumeChange(value: string): void;
  onSelectResume(): void;
  onJobTitleChange(value: string): void;
  onJobCompanyChange(value: string): void;
  onJobTextChange(value: string): void;
  onParseJob(): void;
  onAnswerChange(value: string): void;
  onAnswer(questionId: string): void;
  onAnalyze(): void;
  onPreview(): void;
  onConfirm(confirmed: boolean): void;
  onChooseAnotherTask(): void;
}) {
  const pending = state.pendingConfirmation;
  const firstQuestion = firstClarification(state.tailoringSession);

  return (
    <article className="agent-interactive-card" aria-labelledby="agent-task-title" data-workflow-step={state.step}>
      <div className="agent-section-heading">
        <div>
          <button className="agent-back-button" type="button" onClick={onChooseAnotherTask}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>选择其他任务</span>
          </button>
          <h2 id="agent-task-title">生成岗位定制简历</h2>
        </div>
      </div>
      <AgentProgressTimeline currentStep={state.step} />

      {state.step === "select_resume" ? (
        <form className="agent-task-form" onSubmit={(event) => {
          event.preventDefault();
          onSelectResume();
        }}>
          <label htmlFor="agent-resume-select">选择已有简历</label>
          <select
            id="agent-resume-select"
            name="resumeId"
            value={selectedResume}
            onChange={(event) => onSelectedResumeChange(event.target.value)}
          >
            <option value="">请选择…</option>
            {resumes.map((resume) => (
              <option key={resume.id} value={resume.id}>{resume.name} · v{resume.revision}</option>
            ))}
          </select>
          {resumes.length === 0 ? <p className="agent-inline-note">还没有可用简历，请先在“我的简历”中创建或导入。</p> : null}
          <button className="primary-button" type="submit" disabled={!selectedResume}>使用这份简历</button>
        </form>
      ) : null}

      {state.step === "collect_job" ? (
        <form className="agent-task-form" onSubmit={(event) => {
          event.preventDefault();
          onParseJob();
        }}>
          <div className="agent-inline-fields">
            <label>
              岗位名称
              <input name="jobTitle" value={jobTitle} onChange={(event) => onJobTitleChange(event.target.value)} autoComplete="off" placeholder="例如：高级产品经理…" />
            </label>
            <label>
              公司
              <input name="jobCompany" value={jobCompany} onChange={(event) => onJobCompanyChange(event.target.value)} autoComplete="organization" placeholder="例如：目标公司…" />
            </label>
          </div>
          <label htmlFor="agent-jd-input">岗位描述</label>
          <textarea id="agent-jd-input" name="jobDescription" rows={9} value={jobText} onChange={(event) => onJobTextChange(event.target.value)} placeholder="粘贴完整 JD，系统会保留来源并生成语义核对结果…" />
          <button className="primary-button" type="submit" disabled={state.busy || jobTitle.trim().length === 0 || jobCompany.trim().length === 0 || jobText.trim().length < 20}>
            {state.busy ? "解析中…" : "解析岗位"}
          </button>
        </form>
      ) : null}

      {state.step === "analyze_fit" && !pending ? (
        <div className="agent-next-action">
          <p>岗位已保存。下一步会只读分析匹配情况，并生成安全改写建议。</p>
          <button className="primary-button" type="button" disabled={state.busy} onClick={onAnalyze}>
            分析匹配并生成建议
          </button>
        </div>
      ) : null}

      {state.step === "answer_questions" && firstQuestion ? (
        <form className="agent-task-form" onSubmit={(event) => {
          event.preventDefault();
          onAnswer(firstQuestion.id);
        }}>
          <label htmlFor="agent-question-answer">{firstQuestion.question}</label>
          <textarea id="agent-question-answer" name="tailoringAnswer" rows={4} value={answer} onChange={(event) => onAnswerChange(event.target.value)} placeholder="只填写你能确认的真实经历或能力…" />
          <button className="primary-button" type="submit" disabled={!answer.trim()}>提交回答</button>
        </form>
      ) : null}

      {state.step === "preview_changes" && !pending ? (
        <div className="agent-next-action">
          <p>修改差异已显示在右侧。预览会再次执行本地字段与事实边界校验。</p>
          <button className="primary-button" type="button" disabled={state.busy || state.diffs.length === 0} onClick={onPreview}>
            预览将应用的修改
          </button>
        </div>
      ) : null}

      {state.error ? <p className="agent-error" role="alert">{state.error}</p> : null}
      {pending ? (
        <AgentConfirmationCard
          busy={state.busy}
          title={confirmationCopy(pending).title}
          description={confirmationCopy(pending).description}
          onCancel={() => onConfirm(false)}
          onConfirm={() => onConfirm(true)}
        />
      ) : null}
    </article>
  );
}

function firstClarification(session: unknown) {
  if (typeof session !== "object" || session === null) return undefined;
  const plan = (session as Record<string, unknown>).plan;
  if (typeof plan !== "object" || plan === null) return undefined;
  const questions = (plan as Record<string, unknown>).clarificationQuestions;
  if (!Array.isArray(questions) || !questions[0] || typeof questions[0] !== "object") return undefined;
  const question = questions[0] as Record<string, unknown>;
  return { id: String(question.id), question: String(question.question) };
}

function confirmationCopy(
  name: NonNullable<ReturnType<TailorExistingResumeWorkflowController["getSnapshot"]>["pendingConfirmation"]>
) {
  const copy = {
    commit_job: { title: "保存这个岗位？", description: "确认后会把核对结果写入岗位库。你仍可在岗位页继续编辑。" },
    answer_tailoring_question: { title: "使用这项补充信息？", description: "这属于你主动声明的能力信息。确认后只用于当前岗位定制，不会隐式写回个人资料库。" },
    apply_tailoring_changes: { title: "应用这些简历修改？", description: "确认后会创建一个新的 ResumeRevision；来源简历和个人资料库不会被覆盖。" }
  };
  return copy[name];
}
