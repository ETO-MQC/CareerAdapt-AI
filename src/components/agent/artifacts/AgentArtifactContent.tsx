"use client";

import Link from "next/link";
import { useState } from "react";
import type { TailorWorkflowViewState } from "@/agent/workflows/tailorExistingResumeWorkflow";
import type { AgentTaskState } from "@/agent/contracts/agentSession";
import type { AgentArtifactAction, AgentUiAction } from "@/agent/contracts/agentActions";
import { ResumeTailoringDiffSchema } from "@/domain/schemas";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";

export function AgentArtifactContent({
  state,
  taskState,
  onImportAction,
  onArtifactAction,
  onUiAction
}: {
  state: TailorWorkflowViewState;
  taskState?: AgentTaskState;
  onImportAction?(message: string): void;
  onArtifactAction?(action: AgentArtifactAction): Promise<unknown> | void;
  onUiAction?(action: AgentUiAction): void;
}) {
  const graph = asRecord(state.jobGraph);
  const requirements = Array.isArray(graph.requirements) ? graph.requirements : [];
  const analysis = asRecord(state.fitAnalysis);
  const plan = asRecord(asRecord(state.tailoringSession).plan);
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];
  const questionPlan = asRecord(plan.questionPlan);
  const questionIds = stringArray(questionPlan.questionIds);
  const answeredQuestionIds = new Set(stringArray(questionPlan.answeredQuestionIds));
  const skippedQuestionIds = new Set(stringArray(questionPlan.skippedQuestionIds));
  const activeQuestionId = typeof questionPlan.activeQuestionId === "string" ? questionPlan.activeQuestionId : undefined;
  const answeredQuestions = questions.map(asRecord).filter((question) => answeredQuestionIds.has(String(question.id)) || skippedQuestionIds.has(String(question.id)));
  const activeQuestion = questions.map(asRecord).find((question) => question.id === activeQuestionId);
  const diffReviews = arrayOfRecords(plan.diffReviews);
  const reviewsById = new Map(diffReviews.flatMap((review) => typeof review.diffId === "string" ? [[review.diffId, review]] : []));
  const artifactActionFeedback = asRecord(taskState?.knownSlots.artifactActionFeedback);
  const importArtifact = asRecord(taskState?.knownSlots.importArtifact);
  const importReview = asRecord(taskState?.knownSlots.importReviewSummary);
  const importTarget = asRecord(taskState?.knownSlots.importTarget);
  const importId = typeof taskState?.knownSlots.importId === "string"
    ? taskState.knownSlots.importId
    : typeof importArtifact.importId === "string"
      ? importArtifact.importId
      : undefined;
  const targetMode = importTarget.mode === "new" || taskState?.knownSlots.importTargetIntent === "new"
    ? "new"
    : "existing";
  const importReviewHref = importId
    ? `/resume?importId=${encodeURIComponent(importId)}&importTarget=${
        targetMode
      }`
    : "/resume";
  const importReconciliation = asRecord(taskState?.knownSlots.importReconciliation);
  const reconciliationSummary = asRecord(importReconciliation.summary);
  const unresolvedReconciliation = Array.isArray(importReconciliation.unresolved)
    ? importReconciliation.unresolved.map(asRecord)
    : [];
  const intakeArtifact = asRecord(taskState?.knownSlots.intakeArtifact);
  const richIntakeCandidates = arrayOfRecords(intakeArtifact.candidates);
  const recognizedIntake = arrayOfRecords(intakeArtifact.recognized);
  const uncertainIntake = arrayOfRecords(intakeArtifact.needsConfirmation);
  const duplicateIntake = arrayOfRecords(intakeArtifact.duplicates);
  const additionIntake = arrayOfRecords(intakeArtifact.additions);
  const intakeSources = arrayOfRecords(intakeArtifact.sources);

  return (
    <div className="agent-artifact-content">
      {taskState?.rootGoal === "profile_intake" && Object.keys(intakeArtifact).length ? (
        <section className="agent-artifact agent-import-review-artifact" aria-label="经历核对">
          <header>
            <div>
              <strong>经历核对</strong>
              <span>{recognizedIntake.length + uncertainIntake.length} 项候选</span>
            </div>
            <span className="agent-import-review-state">
              {uncertainIntake.length ? `${uncertainIntake.length} 项待确认` : "可对账"}
            </span>
          </header>
          <dl>
            <div><dt>已识别</dt><dd>{recognizedIntake.length} 项</dd></div>
            <div><dt>需要确认</dt><dd>{uncertainIntake.length} 项</dd></div>
            <div><dt>与资料库重复</dt><dd>{duplicateIntake.length} 项</dd></div>
            <div><dt>将新增</dt><dd>{additionIntake.length} 项</dd></div>
          </dl>
          {typeof intakeArtifact.followUpQuestion === "string" ? (
            <p className="agent-career-follow-up">
              <strong>建议下一问：</strong>{intakeArtifact.followUpQuestion}
            </p>
          ) : null}
          {richIntakeCandidates.length ? (
            <div className="agent-career-asset-list">
              {richIntakeCandidates.map((item) => {
                const highlights = stringArray(item.highlights);
                const tools = stringArray(item.toolsOrMethods);
                const outcomes = stringArray(item.outcomes);
                const sources = stringArray(item.sources);
                const status = intakeStatusLabel(item.status);
                const needsNormalization = item.needsNormalization === true;
                const canAccept = item.canAccept !== false && !needsNormalization;
                return (
                  <article key={String(item.id)} className="agent-career-asset">
                    <header>
                      <div>
                        <span className="agent-career-asset-type">{sectionTypeLabel(item.sectionType)}</span>
                        <strong>{String(item.label ?? "待核对经历")}</strong>
                      </div>
                      <span className={`agent-career-asset-status is-${String(item.status ?? "insufficient")}`}>{status}</span>
                    </header>
                    <p className="agent-career-asset-meta">
                      {[item.time, item.organization, item.role].filter(Boolean).map(String).join(" · ") || "时间 / 组织 / 角色待补充"}
                    </p>
                    <p className="agent-career-asset-description">{String(item.professionalDescription ?? "职业化表达待整理")}</p>
                    <details>
                      <summary>查看细节与来源</summary>
                      {highlights.length ? <DetailList title="要点" values={highlights} /> : null}
                      {tools.length ? <DetailList title="方法 / 工具" values={tools} /> : null}
                      {outcomes.length ? <DetailList title="结果" values={outcomes} /> : null}
                      <DetailList title="来源" values={sources.length ? sources : ["原始对话已保留"]} />
                    </details>
                    <div className="agent-import-review-actions" aria-label={`${String(item.label ?? "经历")}操作`}>
                      {needsNormalization ? (
                        <button type="button" onClick={() => onImportAction?.(`重试整理“${String(item.label ?? "这项经历")}”`)}>重试整理</button>
                      ) : canAccept ? (
                        <button type="button" onClick={() => onArtifactAction?.({
                          type: "profile_intake_candidate_decision",
                          candidateId: String(item.id),
                          decision: "accept"
                        })}>采用</button>
                      ) : null}
                      <button type="button" onClick={() => onImportAction?.(`编辑“${String(item.label ?? "这项经历")}”后采用`)}>编辑后采用</button>
                      <button type="button" onClick={() => onImportAction?.(`补充“${String(item.label ?? "这项经历")}”最有价值的细节`)}>补充细节</button>
                      <button type="button" onClick={() => onArtifactAction?.({
                        type: "profile_intake_candidate_decision",
                        candidateId: String(item.id),
                        decision: "reject"
                      })}>忽略</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : recognizedIntake.length ? (
            <details open>
              <summary>已识别 <span>{recognizedIntake.length}</span></summary>
              <ul>{recognizedIntake.map((item) => <li key={String(item.id)}>{String(item.label)}</li>)}</ul>
            </details>
          ) : null}
          {!richIntakeCandidates.length && uncertainIntake.length ? (
            <div className="agent-reconciliation-list">
              {uncertainIntake.map((item) => (
                <article key={String(item.id)}>
                  <div><strong>{String(item.label)}</strong><span>需要确认</span></div>
                  <p>{String(item.reason ?? "名称或表述需要确认")}</p>
                  <div className="agent-import-review-actions">
                    <button type="button" onClick={() => onArtifactAction?.({
                      type: "profile_intake_candidate_decision",
                      candidateId: String(item.id),
                      decision: "accept"
                    })}>采用</button>
                    <button type="button" onClick={() => onArtifactAction?.({
                      type: "profile_intake_candidate_decision",
                      candidateId: String(item.id),
                      decision: "reject"
                    })}>忽略</button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          <details>
            <summary>来源 <span>{intakeSources.length}</span></summary>
            <ul>
              {intakeSources.map((source) => (
                <li key={`${String(source.sessionId)}:${String(source.messageId)}`}>
                  对话 {String(source.messageId)} · {formatArtifactDate(source.capturedAt)}
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
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
                    <button type="button" onClick={() => onArtifactAction?.({
                      type: "resume_import_reconciliation_decision",
                      incomingItemId: String(item.incomingItemId),
                      resolution: "keep_existing"
                    })}>保留原数据</button>
                    <button type="button" onClick={() => onArtifactAction?.({
                      type: "resume_import_reconciliation_decision",
                      incomingItemId: String(item.incomingItemId),
                      resolution: "use_imported"
                    })}>采用本次</button>
                    <button type="button" onClick={() => onArtifactAction?.({
                      type: "resume_import_reconciliation_decision",
                      incomingItemId: String(item.incomingItemId),
                      resolution: "keep_both_as_distinct"
                    })}>视为不同经历</button>
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
            {importId ? (
              <>
                <button type="button" onClick={() => onUiAction?.({ type: "open_import_review", importId, targetMode })}>查看来源与逐项核对</button>
                <button type="button" onClick={() => onUiAction?.({ type: "open_import_review", importId, targetMode })}>编辑导入内容</button>
              </>
            ) : (
              <Link href={importReviewHref}>在简历工作台恢复核对</Link>
            )}
            {taskState.knownSlots.reviewStatus !== "reviewed" ? (
              <>
                <button type="button" onClick={() => onArtifactAction?.({
                  type: "resume_import_review_decision",
                  decision: "accept_all"
                })}>采用全部来源明确内容</button>
                <button type="button" onClick={() => onArtifactAction?.({
                  type: "resume_import_review_decision",
                  decision: "ignore_uncertain"
                })}>忽略待确认项</button>
              </>
            ) : (
              <span role="status">核对决定已记录，请在对话区确认最终写入。</span>
            )}
          </div>
        </section>
      ) : null}
      {state.jobGraph && !state.tailoringSession ? (
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
      {questionIds.length ? (
        <section className="agent-artifact agent-tailoring-questions" aria-label="岗位定制问答记录">
          <header>
            <strong>问答记录</strong>
            <span>{answeredQuestions.length} / {questionIds.length}</span>
          </header>
          {answeredQuestions.length ? (
            <div className="agent-tailoring-answer-list">
              {answeredQuestions.map((question) => (
                <TailoringAnswerRecord
                  key={String(question.id)}
                  question={question}
                  skipped={skippedQuestionIds.has(String(question.id))}
                  onSave={(answer) => onArtifactAction?.({
                    type: "tailoring_answer_edit",
                    questionId: String(question.id),
                    answer
                  })}
                />
              ))}
            </div>
          ) : <p>回答会在这里同步记录，不会写回个人资料库。</p>}
          {activeQuestion ? (
            <div className="agent-tailoring-current-question">
              <small>当前问题</small>
              <strong>{String(activeQuestion.shortLabel ?? activeQuestion.question)}</strong>
              <p>{String(activeQuestion.question)}</p>
            </div>
          ) : null}
          {questionIds.length - answeredQuestions.length - (activeQuestion ? 1 : 0) > 0 ? (
            <p className="agent-tailoring-remaining">剩余 {questionIds.length - answeredQuestions.length - 1} 项将在对话中逐个显示</p>
          ) : null}
        </section>
      ) : null}
      {state.diffs.length ? (
        <details className="agent-artifact" open>
          <summary>修改预览 <span>{state.diffs.length} 项</span></summary>
          <div className="agent-diff-list">
            {state.diffs.slice(0, 8).map((item, index) => {
              const parsedDiff = ResumeTailoringDiffSchema.safeParse(item);
              const diff = asRecord(item);
              const diffId = parsedDiff.success ? tailoringDiffId(parsedDiff.data) : undefined;
              const review = diffId ? reviewsById.get(diffId) ?? {} : {};
              return (
                <TailoringDiffRecord
                  key={diffId ?? `invalid-diff-${index}`}
                  diff={diff}
                  review={review}
                  diffId={diffId}
                  feedback={artifactActionFeedback.entityId === diffId ? artifactActionFeedback : undefined}
                  onDecision={async (decision, editedValue) => {
                    if (!diffId) return;
                    await onArtifactAction?.({
                      type: "tailoring_diff_decision",
                      diffId,
                      decision,
                      editedValue
                    });
                  }}
                />
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

function arrayOfRecords(value: unknown) {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function formatArtifactDate(value: unknown) {
  if (typeof value !== "string") return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
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

function TailoringAnswerRecord({
  question,
  skipped,
  onSave
}: {
  question: Record<string, unknown>;
  skipped: boolean;
  onSave(answer: string): void;
}) {
  const initial = skipped ? "跳过" : renderValue(question.answer);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  return (
    <article>
      <div>
        <strong>{String(question.shortLabel ?? question.question ?? "已回答问题")}</strong>
        <span>{skipped ? "已跳过" : "已回答"}</span>
      </div>
      {editing ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          const answer = draft.trim();
          if (!answer) return;
          onSave(answer);
          setEditing(false);
        }}>
          <input aria-label={`编辑${String(question.shortLabel ?? "问题")}的回答`} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit">保存</button>
          <button type="button" onClick={() => { setDraft(initial); setEditing(false); }}>取消</button>
        </form>
      ) : (
        <>
          <p>{initial || "已记录"}</p>
          <button type="button" onClick={() => setEditing(true)}>编辑</button>
        </>
      )}
    </article>
  );
}

function TailoringDiffRecord({
  diff,
  review,
  diffId,
  feedback,
  onDecision
}: {
  diff: Record<string, unknown>;
  review: Record<string, unknown>;
  diffId?: string;
  feedback?: Record<string, unknown>;
  onDecision(decision: "accept" | "edit" | "reject", editedValue?: string): Promise<void> | void;
}) {
  const proposed = renderValue(diff.value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(renderValue(review.editedValue) || proposed);
  const [submitting, setSubmitting] = useState(false);
  const status = String(review.status ?? "suggested");
  const decide = async (decision: "accept" | "edit" | "reject", editedValue?: string) => {
    if (!diffId || submitting) return;
    setSubmitting(true);
    try { await onDecision(decision, editedValue); } finally { setSubmitting(false); }
  };
  return (
    <article>
      <small>{tailoringTargetLabel(asRecord(diff.target).fieldPath)}</small>
      <p><del>{renderValue(diff.original)}</del></p>
      <p><ins>{status === "edited" ? renderValue(review.editedValue) : proposed}</ins></p>
      {typeof diff.reason === "string" ? <p className="agent-diff-rationale">{diff.reason}</p> : null}
      {editing ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          void decide("edit", draft.trim());
          setEditing(false);
        }}>
          <textarea aria-label="编辑建议内容" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" disabled={submitting || !diffId}>采用编辑</button>
          <button type="button" onClick={() => setEditing(false)}>取消</button>
        </form>
      ) : (
        <div className="agent-diff-actions">
          <button type="button" disabled={submitting || !diffId} aria-pressed={status === "accepted"} onClick={() => void decide("accept")}>{status === "accepted" ? "已采用" : "采用"}</button>
          <button type="button" disabled={submitting || !diffId} aria-pressed={status === "edited"} onClick={() => setEditing(true)}>{status === "edited" ? "已编辑" : "编辑后采用"}</button>
          <button type="button" disabled={submitting || !diffId} aria-pressed={status === "rejected"} onClick={() => void decide("reject")}>{status === "rejected" ? "已忽略" : "忽略"}</button>
        </div>
      )}
      {submitting || feedback?.running === true ? <span className="agent-diff-feedback" role="status">正在保存这项核对…</span> : null}
      {!submitting && typeof feedback?.message === "string" ? (
        <span className={feedback.result === "rejected" ? "agent-diff-feedback is-error" : "agent-diff-feedback"} role="status">{feedback.message}</span>
      ) : null}
      {!diffId ? <span className="agent-diff-feedback is-error" role="status">这项修改缺少稳定标识，请刷新后重试。</span> : null}
    </article>
  );
}

function tailoringTargetLabel(value: unknown) {
  const path = String(value ?? "");
  if (path === "text") return "个人评价";
  if (path === "name" || path === "description") return "技能或经历描述";
  if (path === "highlights") return "经历要点";
  return "简历内容";
}

function DetailList({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="agent-career-asset-detail">
      <strong>{title}</strong>
      <ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul>
    </div>
  );
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function intakeStatusLabel(value: unknown) {
  const labels: Record<string, string> = {
    confirmed: "已确认",
    ai_review: "AI 整理待确认",
    insufficient: "信息不足",
    duplicate: "与资料库可能重复",
    conflict: "存在冲突"
  };
  return labels[String(value)] ?? "信息不足";
}

function sectionTypeLabel(value: unknown) {
  const labels: Record<string, string> = {
    education: "教育", work: "工作", internship: "实习", project: "项目", research: "科研",
    campus: "校园", volunteer: "志愿", awards: "奖项", skills: "技能", certificates: "证书",
    languages: "语言", publications: "出版物", patents: "专利", portfolio: "作品", other: "其他", custom: "自定义"
  };
  return labels[String(value)] ?? "经历";
}
