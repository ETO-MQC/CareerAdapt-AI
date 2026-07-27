import Link from "next/link";
import type { TailorWorkflowViewState } from "@/agent/workflows/tailorExistingResumeWorkflow";
import type { AgentTaskState } from "@/agent/contracts/agentSession";

export function AgentArtifactContent({
  state,
  taskState,
  onImportAction
}: {
  state: TailorWorkflowViewState;
  taskState?: AgentTaskState;
  onImportAction?(message: string): void;
}) {
  const graph = asRecord(state.jobGraph);
  const requirements = Array.isArray(graph.requirements) ? graph.requirements : [];
  const analysis = asRecord(state.fitAnalysis);
  const plan = asRecord(asRecord(state.tailoringSession).plan);
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];
  const importArtifact = asRecord(taskState?.knownSlots.importArtifact);
  const importReview = asRecord(taskState?.knownSlots.importReviewSummary);
  const importReconciliation = asRecord(taskState?.knownSlots.importReconciliation);
  const reconciliationSummary = asRecord(importReconciliation.summary);
  const unresolvedReconciliation = Array.isArray(importReconciliation.unresolved)
    ? importReconciliation.unresolved.map(asRecord)
    : [];

  return (
    <div className="agent-artifact-content">
      {taskState?.rootGoal === "import_resume" && Object.keys(importArtifact).length ? (
        <section className="agent-artifact agent-import-review-artifact" aria-label="简历导入核对">
          <header>
            <div>
              <strong>{String(importArtifact.sourceFile ?? taskState.attachment?.fileName ?? "简历文件")}</strong>
              <span>{sourceTypeLabel(importArtifact.sourceType)}</span>
            </div>
            <span className="agent-import-review-state">
              {taskState.knownSlots.reviewStatus === "reviewed" ? "已核对" : "待核对"}
            </span>
          </header>
          <dl>
            {Object.keys(reconciliationSummary).length ? (
              <>
                <div><dt>新增</dt><dd>{numberValue(reconciliationSummary.newFacts)} 项</dd></div>
                <div><dt>已存在</dt><dd>{numberValue(reconciliationSummary.existing)} 项</dd></div>
                <div><dt>融合来源</dt><dd>{numberValue(reconciliationSummary.mergedEvidence)} 项</dd></div>
                <div><dt>需确认</dt><dd>{numberValue(reconciliationSummary.requiresReview)} 项</dd></div>
              </>
            ) : (
              <>
                <div><dt>识别内容</dt><dd>{numberValue(importReview.itemCount)} 项</dd></div>
                <div><dt>来源明确</dt><dd>{numberValue(importReview.highConfidenceCount)} 项</dd></div>
                <div><dt>需要确认</dt><dd>{numberValue(importReview.needsReviewCount)} 项</dd></div>
                <div><dt>未分类</dt><dd>{numberValue(importReview.unclassifiedCount)} 项</dd></div>
              </>
            )}
          </dl>
          {unresolvedReconciliation.length ? (
            <div className="agent-reconciliation-list">
              {unresolvedReconciliation.map((item) => (
                <article key={String(item.incomingItemId)}>
                  <div><strong>{String(item.label ?? "待核对内容")}</strong><span>{item.state === "conflict" ? "字段冲突" : "可能重复"}</span></div>
                  <div className="agent-import-review-actions">
                    <button type="button" onClick={() => onImportAction?.(`对“${String(item.label ?? "这项内容")}”保留资料库原数据`)}>保留原数据</button>
                    <button type="button" onClick={() => onImportAction?.(`对“${String(item.label ?? "这项内容")}”采用本次导入`)}>采用本次</button>
                    <button type="button" onClick={() => onImportAction?.(`将“${String(item.label ?? "这项内容")}”视为不同经历并分别保留`)}>视为不同经历</button>
                    <button type="button" onClick={() => onImportAction?.(`我要编辑“${String(item.label ?? "这项内容")}”的冲突值`)}>编辑</button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {Array.isArray(importArtifact.warnings) && importArtifact.warnings.length ? (
            <details>
              <summary>提示与冲突 <span>{importArtifact.warnings.length}</span></summary>
              <ul>
                {importArtifact.warnings.slice(0, 8).map((warning, index) => (
                  <li key={`${index}-${String(warning)}`}>{String(warning)}</li>
                ))}
              </ul>
            </details>
          ) : (
            <p>来源与结构检查未发现阻断项。</p>
          )}
          <div className="agent-import-review-actions">
            <button type="button" onClick={() => onImportAction?.("查看这份导入草稿的来源证据")}>查看来源</button>
            <button type="button" onClick={() => onImportAction?.("打开导入草稿进行编辑")}>编辑</button>
            <button type="button" onClick={() => onImportAction?.("确认这些信息，采用所有来源明确的内容并继续导入")}>采用</button>
            <button type="button" onClick={() => onImportAction?.("忽略所有未分类内容，保留来源明确的内容并继续导入")}>忽略</button>
            <button className="is-primary" type="button" onClick={() => onImportAction?.("核对完成，确认导入")}>确认导入</button>
          </div>
        </section>
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
          <Link href={state.jobId ? `/jobs?jobId=${encodeURIComponent(state.jobId)}` : "/jobs"}>打开岗位页</Link>
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
          <summary>定制修改 <span>{state.diffs.length} 项</span></summary>
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
          <p>版本：{state.appliedRevisionId}</p>
          <Link href={`/resume?branchId=${encodeURIComponent(state.resumeId)}`}>打开编辑器</Link>
        </div>
      ) : null}
    </div>
  );
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sourceTypeLabel(value: unknown) {
  const labels: Record<string, string> = {
    text_pdf: "PDF",
    digital_pdf: "PDF",
    complex_digital_pdf: "PDF",
    docx: "DOCX",
    standard_json: "JSON v2",
    external_json: "外部 JSON"
  };
  return labels[String(value)] ?? String(value ?? "待识别");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function fitSummary(analysis: Record<string, unknown>) {
  const summary = asRecord(analysis.summary);
  const score = analysis.fitScore ?? summary.fitScore ?? summary.score;
  return typeof score === "number"
    ? `当前岗位匹配度为 ${Math.round(score)} 分。请结合差距和证据逐项核对。`
    : "匹配分析已完成，请核对证据覆盖与待补充项。";
}

function renderValue(value: unknown) {
  return Array.isArray(value) ? value.join("；") : String(value ?? "");
}
