import Link from "next/link";
import type { TailorWorkflowViewState } from "@/agent/workflows/tailorExistingResumeWorkflow";

export function AgentArtifactPanel({ state }: { state: TailorWorkflowViewState }) {
  const graph = asRecord(state.jobGraph);
  const requirements = Array.isArray(graph.requirements) ? graph.requirements : [];
  const analysis = asRecord(state.fitAnalysis);
  const plan = asRecord(asRecord(state.tailoringSession).plan);
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];

  return (
    <aside className="agent-artifact-panel" aria-label="任务产物">
      <header>
        <div>
          <p className="eyebrow">任务产物</p>
          <h2>核对与预览</h2>
        </div>
      </header>
      {!state.jobGraph && !state.fitAnalysis && !state.tailoringSession ? (
        <div className="agent-artifact-empty">
          <strong>这里会展示结构化结果</strong>
          <p>岗位语义、匹配概览、澄清问题和修改差异不会挤进长对话。</p>
        </div>
      ) : null}
      {state.jobGraph ? (
        <details className="agent-artifact" open>
          <summary>岗位语义核对 <span>{requirements.length} 项要求</span></summary>
          <ul>
            {requirements.slice(0, 8).map((item, index) => {
              const requirement = asRecord(item);
              return <li key={String(requirement.id ?? index)}>{String(requirement.statement ?? requirement.description ?? "待核对要求")}</li>;
            })}
          </ul>
          <Link href="/jobs">打开岗位页</Link>
        </details>
      ) : null}
      {state.fitAnalysis ? (
        <details className="agent-artifact" open>
          <summary>匹配概览</summary>
          <p>{fitSummary(analysis)}</p>
          <Link href={state.jobId ? `/jobs?jobId=${encodeURIComponent(state.jobId)}` : "/jobs"}>打开原功能页</Link>
        </details>
      ) : null}
      {questions.length ? (
        <details className="agent-artifact">
          <summary>澄清问题 <span>{questions.length} 项</span></summary>
          <ul>{questions.map((item, index) => <li key={String(asRecord(item).id ?? index)}>{String(asRecord(item).question ?? "")}</li>)}</ul>
        </details>
      ) : null}
      {state.diffs.length ? (
        <details className="agent-artifact" open>
          <summary>Tailoring Diff <span>{state.diffs.length} 项修改</span></summary>
          <div className="agent-diff-list">
            {state.diffs.slice(0, 8).map((item, index) => {
              const diff = asRecord(item);
              return (
                <article key={index}>
                  <small>{String(asRecord(diff.target).fieldPath ?? "字段")}</small>
                  <p><del>{renderValue(diff.original)}</del></p>
                  <p><ins>{renderValue(diff.value)}</ins></p>
                </article>
              );
            })}
          </div>
          {state.resumeId ? <Link href={`/resume?branchId=${encodeURIComponent(state.resumeId)}`}>打开简历编辑器</Link> : null}
        </details>
      ) : null}
      {state.appliedRevisionId && state.resumeId ? (
        <div className="agent-artifact agent-artifact-success">
          <strong>新版本已创建</strong>
          <p>Revision：{state.appliedRevisionId}</p>
          <Link href={`/resume?branchId=${encodeURIComponent(state.resumeId)}`}>打开编辑器</Link>
        </div>
      ) : null}
    </aside>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function fitSummary(analysis: Record<string, unknown>) {
  const summary = asRecord(analysis.summary);
  const score = analysis.fitScore ?? summary.fitScore ?? summary.score;
  return typeof score === "number" ? `当前岗位匹配度为 ${Math.round(score)} 分。请结合差距和证据逐项核对。` : "匹配分析已完成，请核对证据覆盖与待补充项。";
}

function renderValue(value: unknown) {
  return Array.isArray(value) ? value.join("；") : String(value ?? "");
}
