"use client";

import Link from "next/link";
import { useState } from "react";
import type { AgentArtifactRef } from "@/agent/contracts/agentArtifact";
import type { TailorWorkflowViewState } from "@/agent/workflows/tailorExistingResumeWorkflow";
import type { AgentTaskState } from "@/agent/contracts/agentSession";
import type { AgentArtifactAction, AgentUiAction } from "@/agent/contracts/agentActions";
import type { ProfileIntakeStructuredPatch } from "@/domain/profileIntake/ProfileIntakeNormalizer";
import { ResumeTailoringDiffSchema } from "@/domain/schemas";
import { RESUME_SECTION_TYPES_V2, resumeFieldCatalog, resumeSectionById, type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";
import { ProfileIntakeReviewProjectionSchema, type ProfileIntakeReviewProjection } from "@/domain/profileIntake/ProfileIntakeReviewProjection";

export function AgentArtifactContent({
  artifact,
  state,
  taskState,
  onImportAction,
  onArtifactAction,
  onUiAction
}: {
  artifact?: AgentArtifactRef;
  state: TailorWorkflowViewState;
  taskState?: AgentTaskState;
  onImportAction?(message: string): void;
  onArtifactAction?(action: AgentArtifactAction): Promise<unknown> | void;
  onUiAction?(action: AgentUiAction): void;
}) {
  const graph = asRecord(state.jobGraph);
  const compositionResumeId = state.resumeId
    ?? (typeof taskState?.selectedEntities?.resumeId === "string" ? taskState.selectedEntities.resumeId : undefined);
  const requirements = Array.isArray(graph.requirements) ? graph.requirements : [];
  const analysis = asRecord(state.fitAnalysis);
  const plan = asRecord(asRecord(state.tailoringSession).plan);
  const isTailoringWorkspace = artifact?.kind === "tailoring_workspace";
  const tailoringSession = asRecord(state.tailoringSession);
  const generatedDiffRevision = typeof (tailoringSession.generatedDiffRevision ?? plan.generatedDiffRevision) === "number"
    ? tailoringSession.generatedDiffRevision ?? plan.generatedDiffRevision
    : 0;
  const submittedDiffRevision = taskState?.knownSlots.tailoringReviewSubmittedDiffRevision;
  const reviewSubmittedInConversation = Boolean(
    isTailoringWorkspace
    && taskState
    && String(submittedDiffRevision) === String(generatedDiffRevision)
  );
  const reviewPendingInConversation = Boolean(
    isTailoringWorkspace
    && taskState
    && String(submittedDiffRevision) !== String(generatedDiffRevision)
  );
  const initialWorkspaceView = taskState?.knownSlots.tailoringWorkspaceView === "questions"
    || (taskState?.knownSlots.activeQuestionId && !state.diffs.length) ? "questions"
    : taskState?.knownSlots.tailoringWorkspaceView === "diffs" || state.diffs.length ? "diffs" : "fit";
  const [workspaceView, setWorkspaceView] = useState<"fit" | "questions" | "diffs">(initialWorkspaceView);
  const externalWorkspaceView = taskState?.knownSlots.tailoringWorkspaceView === "fit"
    || taskState?.knownSlots.tailoringWorkspaceView === "questions"
    || taskState?.knownSlots.tailoringWorkspaceView === "diffs"
    ? taskState.knownSlots.tailoringWorkspaceView
    : undefined;
  const activeWorkspaceView = externalWorkspaceView ?? workspaceView;
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];
  const questionPlan = asRecord(plan.questionPlan);
  const questionIds = stringArray(questionPlan.questionIds);
  const answeredQuestionIds = new Set(stringArray(questionPlan.answeredQuestionIds));
  const skippedQuestionIds = new Set(stringArray(questionPlan.skippedQuestionIds));
  const activeQuestionId = typeof questionPlan.activeQuestionId === "string" ? questionPlan.activeQuestionId : undefined;
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    typeof taskState?.knownSlots.selectedQuestionId === "string"
      ? taskState.knownSlots.selectedQuestionId
      : activeQuestionId
  );
  const answeredQuestions = questions.map(asRecord).filter((question) => answeredQuestionIds.has(String(question.id)) || skippedQuestionIds.has(String(question.id)));
  const activeQuestion = questions.map(asRecord).find((question) => question.id === activeQuestionId);
  const activeSelectedQuestionId = typeof taskState?.knownSlots.selectedQuestionId === "string"
    ? taskState.knownSlots.selectedQuestionId
    : selectedQuestionId;
  const selectedQuestion = questions.map(asRecord).find((question) => question.id === activeSelectedQuestionId) ?? activeQuestion;
  const selectedQuestionIndex = selectedQuestion
    ? questionIds.indexOf(String(selectedQuestion.id))
    : activeQuestionId
      ? questionIds.indexOf(activeQuestionId)
      : -1;
  const selectedQuestionResolved = selectedQuestion
    ? answeredQuestionIds.has(String(selectedQuestion.id)) || skippedQuestionIds.has(String(selectedQuestion.id))
    : false;
  const diffReviews = arrayOfRecords(plan.diffReviews);
  const generationStale = plan.generationStatus !== "completed"
    || plan.generatedDiffsBasedOnQuestionPlanRevision !== questionPlan.revision
    || plan.generatedDiffsBasedOnAnswerRevisionHash !== plan.answerRevisionHash;
  const reviewsById = new Map(diffReviews.flatMap((review) => typeof review.diffId === "string" ? [[review.diffId, review]] : []));
  const artifactActionFeedback = asRecord(taskState?.knownSlots.artifactActionFeedback);
  const stagedDiffReviews = Array.isArray(taskState?.knownSlots.tailoringDraftDiffReviews)
    ? taskState.knownSlots.tailoringDraftDiffReviews.map(asRecord)
    : [];
  const stagedDiffReviewsById = new Map(stagedDiffReviews.flatMap((review) =>
    typeof review.diffId === "string" ? [[review.diffId, review] as const] : []
  ));
  const resolvedTailoringDiffIds = new Set([
    ...diffReviews
      .filter((review) => ["accepted", "edited", "rejected"].includes(String(review.status)))
      .flatMap((review) => typeof review.diffId === "string" ? [review.diffId] : []),
    ...stagedDiffReviews.flatMap((review) => typeof review.diffId === "string" ? [review.diffId] : [])
  ]);
  const unresolvedTailoringDiffCount = state.diffs.filter((item) => {
    const parsed = ResumeTailoringDiffSchema.safeParse(item);
    return !parsed.success || !resolvedTailoringDiffIds.has(tailoringDiffId(parsed.data));
  }).length;
  const allTailoringDiffsResolved = state.diffs.length > 0 && unresolvedTailoringDiffCount === 0;
  const tailoringReviewReadOnly = isTailoringWorkspace && (
    reviewPendingInConversation
    || taskState?.completionStatus === "waiting_for_confirmation"
    || taskState?.stage === "confirm_apply"
  );
  const canSubmitTailoringReview = !tailoringReviewReadOnly
    && (!isTailoringWorkspace || taskState?.stage === "preview_changes");
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
  const intakeProjectionResult = ProfileIntakeReviewProjectionSchema.safeParse(taskState?.knownSlots.profileIntakeReviewProjection);
  const intakeProjection = intakeProjectionResult.success ? intakeProjectionResult.data : undefined;
  const intakePhase = typeof taskState?.knownSlots.profileIntakePhase === "string"
    ? taskState.knownSlots.profileIntakePhase
    : intakeProjection?.phase ?? "collecting";
  const isFinalIntakeReview = Boolean(intakeProjection?.finalSynthesis)
    || ["ready_for_review", "reviewing", "committing"].includes(intakePhase);
  const [showProvisionalDraft, setShowProvisionalDraft] = useState(false);
  const intakeArtifact = intakeProjection
    ? projectionArtifact(intakeProjection)
    : asRecord(taskState?.knownSlots.intakeArtifact);
  const richIntakeCandidates = arrayOfRecords(intakeArtifact.candidates);
  const recognizedIntake = arrayOfRecords(intakeArtifact.recognized);
  const uncertainIntake = arrayOfRecords(intakeArtifact.needsConfirmation);
  const duplicateIntake = arrayOfRecords(intakeArtifact.duplicates);
  const additionIntake = arrayOfRecords(intakeArtifact.additions);
  const intakeSources = arrayOfRecords(intakeArtifact.sources);

  return (
    <div className="agent-artifact-content">
      {isTailoringWorkspace ? (
        <nav className="agent-tailoring-workspace-tabs" role="tablist" aria-label="岗位定制工作区视图">
          {([
            ["fit", "匹配概览"],
            ["questions", `问答记录${questionIds.length ? ` · ${answeredQuestions.length}/${questionIds.length}` : ""}`],
            ["diffs", `修改预览${state.diffs.length ? ` · ${state.diffs.length}` : ""}`]
          ] as const).map(([view, label]) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={activeWorkspaceView === view}
              onClick={() => setWorkspaceView(view)}
            >{label}</button>
          ))}
        </nav>
      ) : null}
      {taskState?.rootGoal === "profile_intake" && Object.keys(intakeArtifact).length ? (
        <section className="agent-artifact agent-import-review-artifact" aria-label="经历核对">
          <header>
            <div>
                <strong>{isFinalIntakeReview ? "最终资料草稿" : "访谈整理进度"}</strong>
                <span>{recognizedIntake.length + uncertainIntake.length} 项已记录</span>
            </div>
            <span className="agent-import-review-state">
              {isFinalIntakeReview ? "待一次性审核" : "已保存到本地草稿"}
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
            isFinalIntakeReview ? null : (
            <details
              className="agent-intake-provisional-details"
              open={showProvisionalDraft}
              onToggle={(event) => setShowProvisionalDraft(event.currentTarget.open)}
            >
              <summary>查看当前整理草稿 <span>{richIntakeCandidates.length} 项</span></summary>
            <div className="agent-career-asset-list">
              {richIntakeCandidates.map((item) => {
                const highlights = stringArray(item.highlights);
                const tools = stringArray(item.toolsOrMethods);
                const outcomes = stringArray(item.outcomes);
                const sources = stringArray(item.sources);
                const structuredItem = asRecord(item.structuredItem);
                const accepted = item.decision === "accept" || item.status === "confirmed";
                const status = intakeStatusLabel(item.status, item.decision);
                const needsNormalization = item.needsNormalization === true;
                const canAccept = item.canAccept !== false && !needsNormalization;
                return (
                  <article key={String(item.id)} className="agent-career-asset" data-candidate-id={String(item.id)}>
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
                    {typedResumeFields(structuredItem).length ? (
                      <dl className="agent-career-asset-typed-fields">
                        {typedResumeFields(structuredItem).map(([field, value]) => (
                          <div key={field}><dt>{field}</dt><dd>{value}</dd></div>
                        ))}
                      </dl>
                    ) : null}
                    <p className="agent-career-asset-description">{String(item.professionalDescription ?? "职业化表达待整理")}</p>
                    <details>
                      <summary>查看细节与来源</summary>
                      {highlights.length ? <DetailList title="要点" values={highlights} /> : null}
                      {tools.length ? <DetailList title="方法 / 工具" values={tools} /> : null}
                      {outcomes.length ? <DetailList title="结果" values={outcomes} /> : null}
                      <DetailList title="来源" values={sources.length ? sources : ["原始对话已保留"]} />
                    </details>
                    <div className="agent-import-review-actions" aria-label={`${String(item.label ?? "经历")}操作`}>
                      {taskState?.knownSlots.intakeImportId && typeof taskState.knownSlots.expectedIntakeDraftRevision === "number" ? (
                        accepted ? (
                          <>
                            <IntakeCandidateEditor
                              key={`${String(item.id)}-${JSON.stringify(structuredItem)}`}
                              item={structuredItem}
                              label={String(item.label ?? "这项经历")}
                              buttonLabel="重新编辑"
                              onSave={(fieldPatch) => onArtifactAction?.({
                                type: "profile_intake_candidate_edit",
                                importId: String(taskState.knownSlots.intakeImportId),
                                expectedDraftRevision: taskState.knownSlots.expectedIntakeDraftRevision as number,
                                candidateId: String(item.id),
                                fieldPatch,
                                decision: "accept"
                              })}
                            />
                            <button type="button" onClick={() => onArtifactAction?.({
                              type: "profile_intake_candidate_decision",
                              candidateId: String(item.id),
                              decision: "reopen"
                            })}>撤销采用</button>
                          </>
                        ) : (
                          <>
                            {needsNormalization && intakeProjection ? (
                              <>
                                {intakeProjection?.failedExtraction?.actions.includes("retry") ? (
                                  <button type="button" onClick={() => onArtifactAction?.({
                                    type: "profile_intake_retry_extraction",
                                    importId: intakeProjection.importId,
                                    sourceMessageId: intakeProjection.sourceMessageId,
                                    expectedDraftRevision: intakeProjection.draftRevision
                                  })}>重新解析</button>
                                ) : null}
                                {intakeProjection?.failedExtraction?.actions.includes("manual") ? (
                                  <button type="button" onClick={() => onArtifactAction?.({
                                    type: "profile_intake_extraction_recovery",
                                    importId: intakeProjection.importId,
                                    sourceMessageId: intakeProjection.sourceMessageId,
                                    expectedDraftRevision: intakeProjection.draftRevision,
                                    decision: "manual_review"
                                  })}>手动整理</button>
                                ) : null}
                                {intakeProjection?.failedExtraction?.actions.includes("preserve") ? (
                                  <button type="button" onClick={() => onArtifactAction?.({
                                    type: "profile_intake_extraction_recovery",
                                    importId: intakeProjection.importId,
                                    sourceMessageId: intakeProjection.sourceMessageId,
                                    expectedDraftRevision: intakeProjection.draftRevision,
                                    decision: "preserve_source"
                                  })}>保留为来源</button>
                                ) : null}
                              </>
                            ) : needsNormalization ? (
                              <>
                                <button type="button" onClick={() => onImportAction?.(`重试整理“${String(item.label ?? "这项经历")}”`)}>重试整理</button>
                                <IntakeCandidateEditor
                                  key={`${String(item.id)}-${JSON.stringify(structuredItem)}`}
                                  item={structuredItem}
                                  label={String(item.label ?? "这项经历")}
                                  buttonLabel="编辑后采用"
                                  onSave={(fieldPatch) => onArtifactAction?.({
                                    type: "profile_intake_candidate_edit",
                                    importId: String(taskState.knownSlots.intakeImportId),
                                    expectedDraftRevision: taskState.knownSlots.expectedIntakeDraftRevision as number,
                                    candidateId: String(item.id),
                                    fieldPatch,
                                    decision: "accept"
                                  })}
                                />
                                <button type="button" onClick={() => onImportAction?.(`补充“${String(item.label ?? "这项经历")}”最有价值的细节`)}>补充细节</button>
                                <button type="button" onClick={() => onArtifactAction?.({
                                  type: "profile_intake_candidate_decision",
                                  candidateId: String(item.id),
                                  decision: "reject"
                                })}>忽略</button>
                              </>
                            ) : canAccept ? (
                              <>
                                <button type="button" onClick={() => onArtifactAction?.({
                                  type: "profile_intake_candidate_decision",
                                  candidateId: String(item.id),
                                  decision: "accept"
                                })}>采用</button>
                                <IntakeCandidateEditor
                                  key={`${String(item.id)}-${JSON.stringify(structuredItem)}`}
                                  item={structuredItem}
                                  label={String(item.label ?? "这项经历")}
                                  buttonLabel="编辑后采用"
                                  onSave={(fieldPatch) => onArtifactAction?.({
                                    type: "profile_intake_candidate_edit",
                                    importId: String(taskState.knownSlots.intakeImportId),
                                    expectedDraftRevision: taskState.knownSlots.expectedIntakeDraftRevision as number,
                                    candidateId: String(item.id),
                                    fieldPatch,
                                    decision: "accept"
                                  })}
                                />
                                {!intakeProjection ? (
                                  <button type="button" onClick={() => onImportAction?.(`补充“${String(item.label ?? "这项经历")}”最有价值的细节`)}>补充细节</button>
                                ) : null}
                                <button type="button" onClick={() => onArtifactAction?.({
                                  type: "profile_intake_candidate_decision",
                                  candidateId: String(item.id),
                                  decision: "reject"
                                })}>忽略</button>
                              </>
                            ) : null}
                          </>
                        )
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
            </details>
            )
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
          {isFinalIntakeReview ? (
            <ProfileIntakeFinalReview
              taskState={taskState}
              projection={intakeProjection}
              onImportAction={onImportAction}
              onArtifactAction={onArtifactAction}
            />
          ) : null}
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
      {state.jobGraph && (!isTailoringWorkspace || activeWorkspaceView === "fit") ? (
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
      {state.fitAnalysis && (!isTailoringWorkspace || activeWorkspaceView === "fit") ? (
        <details className="agent-artifact" open>
          <summary>匹配概览</summary>
          <p>{fitSummary(analysis)}</p>
          <Link href={state.jobId ? `/jobs?jobId=${encodeURIComponent(state.jobId)}` : "/jobs"}>打开原功能页</Link>
        </details>
      ) : null}
      {questionIds.length && (!isTailoringWorkspace || activeWorkspaceView === "questions") ? (
        <section className="agent-artifact agent-tailoring-questions" aria-label="岗位定制问答记录">
          <header>
            <strong>问答记录</strong>
            <span>{answeredQuestions.length} / {questionIds.length}</span>
          </header>
          <div className="agent-tailoring-question-navigator" aria-label="问题导航">
            <button
              type="button"
              aria-label="上一个问题"
              disabled={selectedQuestionIndex <= 0}
              onClick={() => {
                const id = questionIds[selectedQuestionIndex - 1];
                if (!id) return;
                setSelectedQuestionId(id);
                onUiAction?.({ type: "select_tailoring_question", questionId: id });
              }}
            >←</button>
            <span>问题 {selectedQuestionIndex >= 0 ? selectedQuestionIndex + 1 : 0} / {questionIds.length}</span>
            <button
              type="button"
              aria-label="下一个问题"
              disabled={selectedQuestionIndex < 0 || selectedQuestionIndex >= questionIds.length - 1}
              onClick={() => {
                const id = questionIds[selectedQuestionIndex + 1];
                if (!id) return;
                setSelectedQuestionId(id);
                onUiAction?.({ type: "select_tailoring_question", questionId: id });
              }}
            >→</button>
          </div>
          {selectedQuestion && selectedQuestionResolved ? (
            <TailoringAnswerRecord
              question={selectedQuestion}
              skipped={skippedQuestionIds.has(String(selectedQuestion.id))}
              onSave={(answer) => onArtifactAction?.({
                type: "tailoring_answer_edit",
                questionId: String(selectedQuestion.id),
                answer
              })}
            />
          ) : selectedQuestion ? (
            <div className="agent-tailoring-current-question">
              <small>{selectedQuestion.id === activeQuestionId ? "当前问题" : "已选问题"}</small>
              <strong>{String(selectedQuestion.shortLabel ?? selectedQuestion.question)}</strong>
              <p>{String(selectedQuestion.question)}</p>
            </div>
          ) : <p>回答会在这里同步记录，不会写回个人资料库。</p>}
          {questionIds.length - answeredQuestions.length - (activeQuestion ? 1 : 0) > 0 ? (
            <p className="agent-tailoring-remaining">剩余 {questionIds.length - answeredQuestions.length - 1} 项将在对话中逐个显示</p>
          ) : null}
        </section>
      ) : null}
      {(state.diffs.length || (isTailoringWorkspace && activeWorkspaceView === "diffs" && generationStale)) && (!isTailoringWorkspace || activeWorkspaceView === "diffs") ? (
        <details className="agent-artifact" open>
          <summary>修改预览 <span>{state.diffs.length ? `${state.diffs.length} 项` : "待重新生成"}</span></summary>
          {isTailoringWorkspace && generationStale ? (
            <div className="agent-import-review-actions">
              <p>回答或问题计划已变化，当前修改建议已失效。</p>
              <button type="button" onClick={() => onArtifactAction?.({ type: "tailoring_regenerate" })}>重新生成修改建议</button>
            </div>
          ) : null}
          {reviewPendingInConversation ? (
            <p className="agent-tailoring-review-handoff" role="status">
              先在对话区逐项核对；提交后这里会接管全部 {state.diffs.length} 项修改。
            </p>
          ) : null}
          <div className={`agent-diff-list${tailoringReviewReadOnly ? " is-read-only" : ""}`}>
            {state.diffs.map((item, index) => {
              const parsedDiff = ResumeTailoringDiffSchema.safeParse(item);
              const diff = asRecord(item);
              const diffId = parsedDiff.success ? tailoringDiffId(parsedDiff.data) : undefined;
              const storedReview = diffId ? reviewsById.get(diffId) ?? {} : {};
              const stagedReview = diffId ? stagedDiffReviewsById.get(diffId) : undefined;
              const review = stagedReview
                ? { ...storedReview, ...stagedReview, status: stagedReview.status ?? reviewStatusForDecision(stagedReview.decision) }
                : storedReview;
              return (
                <TailoringDiffRecord
                  key={diffId ?? `invalid-diff-${index}`}
                  diff={diff}
                  review={review}
                  diffId={diffId}
                  readOnly={tailoringReviewReadOnly}
                  feedback={artifactActionFeedback.entityId === diffId ? artifactActionFeedback : undefined}
                  onDecision={async (decision, editedValue) => {
                    if (!diffId) return;
                    await onArtifactAction?.({
                      type: "tailoring_diff_stage_decision",
                      diffId,
                      decision,
                      editedValue
                    });
                  }}
                />
              );
            })}
          </div>
          {isTailoringWorkspace && reviewSubmittedInConversation && !canSubmitTailoringReview ? (
            <p className="agent-tailoring-review-handoff" role="status">
              本轮选择已提交；确认后会创建独立岗位简历，来源简历和资料库不会被覆盖。
            </p>
          ) : null}
          {canSubmitTailoringReview ? (
            <div className="agent-tailoring-submit-row">
              <span className="agent-diff-feedback" role="status">
                {stagedDiffReviews.length
                  ? allTailoringDiffsResolved
                    ? `已完成 ${state.diffs.length} 项选择，提交后才会统一处理。`
                    : `还有 ${unresolvedTailoringDiffCount} 项修改未处理，请先逐项选择“采用、编辑后采用”或“忽略”。`
                  : "先选择采用、编辑后采用或忽略；选择不会立即调度 AI。"}
              </span>
              <button
                className="is-primary"
                type="button"
                disabled={!onArtifactAction || !stagedDiffReviews.length || !allTailoringDiffsResolved}
                onClick={() => void onArtifactAction?.({ type: "tailoring_diff_submit" })}
              >
                提交本次选择
              </button>
            </div>
          ) : null}
          {artifactActionFeedback.entityId === "submit" && typeof artifactActionFeedback.message === "string" ? (
            <span className="agent-diff-feedback" role="status">{artifactActionFeedback.message}</span>
          ) : null}
          {state.resumeId ? <Link href={`/resume?branchId=${encodeURIComponent(state.resumeId)}`}>打开简历编辑器</Link> : null}
        </details>
      ) : null}
      {taskState?.rootGoal === "create_resume_from_profile" && taskState.knownSlots.resumeFromProfileResult && compositionResumeId ? (
        <div className="agent-artifact agent-artifact-success">
          <strong>独立通用简历已创建</strong>
          <p>已经生成可编辑版本，内容未写回个人资料库。</p>
          <Link href={`/resume?branchId=${encodeURIComponent(compositionResumeId)}`}>打开简历编辑器</Link>
        </div>
      ) : null}
      {taskState?.workflowId === "compose_resume" && taskState.knownSlots.resumeCompositionResult && compositionResumeId ? (
        <div className="agent-artifact agent-artifact-success">
          <strong>简历预览已就绪</strong>
          <p>已生成可编辑版本；你可以先查看版面，再补充联系方式或继续调整内容。</p>
          <Link href={`/resume?branchId=${encodeURIComponent(compositionResumeId)}`}>打开简历编辑器</Link>
        </div>
      ) : null}
      {taskState?.rootGoal !== "create_resume_from_profile"
        && taskState?.workflowId !== "compose_resume"
        && state.appliedRevisionId
        && compositionResumeId ? (
        <div className="agent-artifact agent-artifact-success">
          <strong>新版本已创建</strong>
          <p>已经生成可编辑版本。</p>
          <Link href={`/resume?branchId=${encodeURIComponent(compositionResumeId)}`}>打开编辑器</Link>
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

function projectionArtifact(projection: ProfileIntakeReviewProjection) {
  const candidates = projection.candidates.map((candidate) => {
    const item = asRecord(candidate.structuredItem);
    const date = candidate.sectionType === "awards"
      ? item.awardedAt
      : [item.startDate, item.current === true ? "至今" : item.endDate].filter(Boolean).join(" — ") || undefined;
    const organization = item.organization ?? item.institution ?? item.school ?? item.issuer;
    const role = item.role ?? item.authorRole ?? (candidate.sectionType === "education" ? item.major : undefined);
    const status = candidate.status === "accepted"
      ? "confirmed"
      : candidate.status === "ignored"
        ? "ai_review"
        : candidate.status === "failed"
          ? "insufficient"
          : "ai_review";
    return {
      id: candidate.id,
      sectionType: candidate.sectionType,
      label: candidate.sectionType === "education"
        ? [item.school, item.degree, item.major].filter(Boolean).join(" / ") || "教育经历"
        : String(item.title ?? item.name ?? item.organization ?? item.role ?? "待核对经历"),
      sourceQuote: candidate.sourceQuote,
      time: typeof date === "string" ? date : undefined,
      organization: typeof organization === "string" ? organization : undefined,
      role: typeof role === "string" ? role : undefined,
      professionalDescription: candidate.professionalText,
      highlights: arrayStrings(item.highlights),
      toolsOrMethods: arrayStrings(item.tools ?? item.methods),
      outcomes: arrayStrings(item.outcomes),
      sources: [candidate.sourceQuote],
      status,
      confidence: candidate.confidence,
      reason: candidate.reason,
      needsNormalization: candidate.status === "failed",
      canAccept: candidate.canAccept,
      structuredItem: candidate.structuredItem,
      decision: candidate.decision,
      fieldEvidence: candidate.fieldEvidence
    };
  });
  const recognized = projection.candidates.filter((candidate) => candidate.status === "accepted").map((candidate) => ({
    id: candidate.id,
    label: candidateLabelForProjection(candidate)
  }));
  const needsConfirmation = projection.candidates
    .filter((candidate) => candidate.status === "uncertain" || candidate.status === "failed" || candidate.status === "proposed")
    .map((candidate) => ({
      id: candidate.id,
      label: candidateLabelForProjection(candidate),
      reason: candidate.reason ?? (candidate.status === "failed" ? projection.failedExtraction?.message ?? "结构化未完成" : "有字段需要确认")
    }));
  return {
    title: "经历核对",
    followUpQuestion: projection.followUpQuestion,
    candidates,
    recognized,
    needsConfirmation,
    duplicates: [],
    additions: projection.candidates.map((candidate) => ({ id: candidate.id, label: candidateLabelForProjection(candidate) })),
    sources: [{
      sessionId: "conversation",
      messageId: projection.sourceMessageId,
      turnId: projection.sourceTurnId,
      sourceContentHash: projection.sourceContentHash,
      capturedAt: ""
    }]
  };
}

function candidateLabelForProjection(candidate: ProfileIntakeReviewProjection["candidates"][number]) {
  const item = asRecord(candidate.structuredItem);
  if (candidate.status === "failed") return "这段回答";
  if (candidate.sectionType === "education") return [item.school, item.degree, item.major].filter(Boolean).join(" / ") || "教育经历";
  return String(item.title ?? item.name ?? item.organization ?? item.role ?? "待核对经历");
}

function arrayStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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

function ProfileIntakeFinalReview({
  taskState,
  projection,
  onImportAction,
  onArtifactAction
}: {
  taskState: AgentTaskState;
  projection?: ProfileIntakeReviewProjection;
  onImportAction?(message: string): void;
  onArtifactAction?(action: AgentArtifactAction): Promise<unknown> | void;
}) {
  const candidates = projection?.candidates
    ?? arrayOfRecords(taskState.knownSlots.intakeCandidates) as ProfileIntakeReviewProjection["candidates"];
  const synthesis = projection?.finalSynthesis;
  const assets = synthesis?.assets ?? [];
  const accepted = candidates.filter((item) => item.status === "accepted" || item.decision === "accept");
  const ignored = candidates.filter((item) => item.status === "ignored" || item.decision === "reject");
  const reviewed = candidates.filter((item) => item.status === "accepted" || item.status === "ignored" || item.decision === "accept" || item.decision === "reject");
  const counts = candidates.reduce<Record<string, number>>((result, item) => {
    const section = item.sectionType;
    result[section] = (result[section] ?? 0) + 1;
    return result;
  }, {});
  const assetById = new Map(assets.map((asset) => [asset.candidateId, asset]));
  const grouped = new Map<string, ProfileIntakeReviewProjection["candidates"]>();
  for (const candidate of candidates) {
    const section = grouped.get(candidate.sectionType) ?? [];
    section.push(candidate);
    grouped.set(candidate.sectionType, section);
  }
  const profileName = typeof taskState.knownSlots.targetProfileName === "string"
    ? taskState.knownSlots.targetProfileName
    : typeof taskState.knownSlots.targetProfileLabel === "string"
      ? taskState.knownSlots.targetProfileLabel
      : "人物 · Vn";
  const importId = projection?.importId ?? (typeof taskState.knownSlots.intakeImportId === "string" ? taskState.knownSlots.intakeImportId : undefined);
  const revision = projection?.draftRevision ?? (typeof taskState.knownSlots.expectedIntakeDraftRevision === "number" ? taskState.knownSlots.expectedIntakeDraftRevision : undefined);
  const canAct = Boolean(importId && revision !== undefined);
  const allReviewed = candidates.length > 0 && reviewed.length === candidates.length;

  return (
    <section className="agent-final-review" aria-label="最终资料草稿审核">
      <header>
        <div>
          <strong>最终资料草稿</strong>
          <span>{reviewed.length}/{candidates.length} 项已处理</span>
        </div>
        <span className="agent-import-review-state">确认前不会写入</span>
      </header>
      <p className="agent-final-review-heading">
        最终资料草稿 共 {candidates.length} 项，AI 已根据本次完整访谈进行整理。确认后才会写入‘{profileName}’资料库。
      </p>
      <dl>
        {Object.entries(counts).map(([section, count]) => (
          <div key={section}><dt>{sectionTypeLabel(section)}</dt><dd>{count} 项</dd></div>
        ))}
        <div><dt>已采用</dt><dd>{accepted.length} 项</dd></div>
        <div><dt>已忽略</dt><dd>{ignored.length} 项</dd></div>
        <div><dt>待处理</dt><dd>{Math.max(0, candidates.length - reviewed.length)} 项</dd></div>
      </dl>
      {synthesis?.conflictCount ? (
        <p className="agent-final-review-note">已保留 {synthesis.conflictCount} 项字段差异，编辑时请以你的明确修正为准。</p>
      ) : null}
      <div className="agent-final-review-groups">
        {[...grouped.entries()].map(([section, sectionCandidates]) => (
          <section key={section} aria-labelledby={`final-review-${section}`}>
            <h4 id={`final-review-${section}`}>{sectionTypeLabel(section)} <span>{sectionCandidates.length}</span></h4>
            <div className="agent-final-review-items">
              {sectionCandidates.map((candidate) => {
                const structuredItem = asRecord(candidate.structuredItem);
                const asset = assetById.get(candidate.id);
                const candidateAccepted = candidate.status === "accepted" || candidate.decision === "accept";
                const candidateIgnored = candidate.status === "ignored" || candidate.decision === "reject";
                const candidateHighlights = asset?.highlights ?? stringArray(structuredItem.highlights);
                return (
                  <article key={candidate.id} className="agent-final-review-item" data-candidate-id={candidate.id}>
                    <header>
                      <div>
                        <span className="agent-career-asset-type">{sectionTypeLabel(candidate.sectionType)}</span>
                        <strong>{finalCandidateLabel(candidate)}</strong>
                      </div>
                      <span className={`agent-career-asset-status is-${candidate.status}`}>{candidateAccepted ? "已采用" : candidateIgnored ? "已忽略" : "待处理"}</span>
                    </header>
                    <p className="agent-career-asset-meta">{finalCandidateMeta(candidate)}</p>
                    {candidateHighlights.length ? <DetailList title="证据亮点" values={candidateHighlights} /> : null}
                    {asset?.missingDimensions.length ? <p className="agent-final-review-note">待补充：{asset.missingDimensions.join("、")}</p> : null}
                    {asset?.conflictFields.length ? <p className="agent-final-review-note">字段差异：{asset.conflictFields.join("、")}</p> : null}
                    <details>
                      <summary>查看原始来源</summary>
                      <p className="agent-career-asset-description">{candidate.sourceQuote}</p>
                    </details>
                    {canAct ? (
                      <div className="agent-import-review-actions" aria-label={`${finalCandidateLabel(candidate)}操作`}>
                        <IntakeCandidateEditor
                          key={`${candidate.id}-${JSON.stringify(structuredItem)}`}
                          item={structuredItem}
                          sectionType={candidate.sectionType}
                          label={finalCandidateLabel(candidate)}
                          buttonLabel="编辑"
                          userCorrection
                          onSave={(fieldPatch, nextSectionType) => onArtifactAction?.({
                            type: "profile_intake_candidate_edit",
                            importId: importId as string,
                            expectedDraftRevision: revision as number,
                            candidateId: candidate.id,
                            ...(nextSectionType ? { sectionType: nextSectionType } : {}),
                            fieldPatch,
                            userCorrection: true,
                            decision: "accept"
                          })}
                        />
                        {candidateAccepted ? (
                          <button type="button" onClick={() => onArtifactAction?.({ type: "profile_intake_candidate_decision", candidateId: candidate.id, decision: "reopen" })}>撤销采用</button>
                        ) : (
                          <button type="button" onClick={() => onArtifactAction?.({ type: "profile_intake_candidate_decision", candidateId: candidate.id, decision: "accept" })}>逐项采用</button>
                        )}
                        {!candidateIgnored ? (
                          <button type="button" onClick={() => onArtifactAction?.({ type: "profile_intake_candidate_decision", candidateId: candidate.id, decision: "reject" })}>忽略</button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="agent-final-review-actions agent-import-review-actions">
        {canAct ? (
          <button
            className="is-primary"
            type="button"
            disabled={!candidates.length}
            onClick={() => onArtifactAction?.({
              type: "profile_intake_final_review_decision",
              importId: importId as string,
              expectedDraftRevision: revision as number,
              decision: "accept_all"
            })}
          >全部采用</button>
        ) : null}
        <button type="button" onClick={() => onImportAction?.("新增一项经历")}>新增一项</button>
        <button type="button" onClick={() => onImportAction?.("返回继续补充经历")}>返回继续补充</button>
        {allReviewed ? (
          <button className="is-primary" type="button" onClick={() => onImportAction?.("完成整理并保存到资料库")}>确认并写入个人资料库</button>
        ) : null}
      </div>
      {taskState.knownSlots.profileIntakePhase === "committing" ? <p role="status">正在核对并写入已确认的资料…</p> : null}
    </section>
  );
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

export function TailoringDiffRecord({
  diff,
  review,
  diffId,
  feedback,
  readOnly = false,
  onDecision
}: {
  diff: Record<string, unknown>;
  review: Record<string, unknown>;
  diffId?: string;
  feedback?: Record<string, unknown>;
  readOnly?: boolean;
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
      {readOnly ? (
        <span className="agent-diff-feedback">{status === "suggested" ? "待在对话区核对" : "已暂存本轮选择"}</span>
      ) : editing ? (
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

function reviewStatusForDecision(value: unknown) {
  if (value === "accept") return "accepted";
  if (value === "edit") return "edited";
  if (value === "reject") return "rejected";
  return "suggested";
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

function typedResumeFields(item: Record<string, unknown>) {
  const labels: Record<string, string> = {
    school: "学校", degree: "学位", major: "专业", department: "院系", startDate: "开始时间", endDate: "结束时间",
    organization: "组织", role: "角色", title: "名称", name: "名称", category: "分类", level: "熟练度"
  };
  return ["school", "degree", "major", "department", "startDate", "endDate", "organization", "role", "title", "name", "category", "level"]
    .flatMap((field) => typeof item[field] === "string" && item[field] ? [[labels[field] ?? field, item[field] as string] as [string, string]] : []);
}

function IntakeCandidateEditor({
  item,
  sectionType,
  label,
  buttonLabel = "编辑字段",
  userCorrection = false,
  onSave
}: {
  item: Record<string, unknown>;
  sectionType?: ResumeItemSectionType;
  label: string;
  buttonLabel?: string;
  userCorrection?: boolean;
  onSave(patch: ProfileIntakeStructuredPatch, sectionType?: ResumeItemSectionType): Promise<unknown> | void;
}) {
  const itemSectionType = isResumeItemSectionType(item.sectionType) ? item.sectionType : "other";
  const initialSectionType = sectionType ?? itemSectionType;
  const [selectedSectionType, setSelectedSectionType] = useState<ResumeItemSectionType>(initialSectionType);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() => editorDraft(item, initialSectionType));
  const fields = editorFields(selectedSectionType);
  if (!editing) {
    return <button type="button" onClick={() => { setError(undefined); setEditing(true); }}>{buttonLabel}</button>;
  }
  return (
    <form className="agent-career-asset-editor" onSubmit={(event) => {
      event.preventDefault();
      const patchEntries: Array<[string, unknown]> = [];
      let customFieldsInvalid = false;
      fields.forEach((field) => {
        const value = draft[field.name];
        if (field.name === "customFields") {
          const raw = String(value ?? "").trim();
          if (!raw) {
            patchEntries.push([field.name, []]);
            return;
          }
          try {
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) throw new Error("custom_fields_array_required");
            patchEntries.push([field.name, parsed]);
          } catch {
            customFieldsInvalid = true;
          }
          return;
        }
        if (field.valueType === "boolean") {
          if (typeof value === "boolean") patchEntries.push([field.name, value]);
          return;
        }
        if (field.valueType === "string_list") {
          const values = String(value ?? "").split(/[\n,，；;]+/u).map((entry) => entry.trim()).filter(Boolean);
          if (values.length) patchEntries.push([field.name, values]);
          return;
        }
        if (field.valueType === "number") {
          const number = Number(value);
          if (String(value ?? "").trim() && Number.isFinite(number)) patchEntries.push([field.name, number]);
          return;
        }
        const text = String(value ?? "").trim();
          if (text) patchEntries.push([field.name, text]);
      });
      if (customFieldsInvalid) {
        setError("自定义字段必须是有效的 JSON 数组。");
        return;
      }
      const patch = Object.fromEntries(patchEntries) as ProfileIntakeStructuredPatch;
      if (!Object.keys(patch).length) return;
      if (saving) return;
      setError(undefined);
      setSaving(true);
      Promise.resolve(onSave(patch, selectedSectionType !== itemSectionType ? selectedSectionType : undefined)).then((result) => {
        if (artifactActionFailed(result)) {
          setError(artifactActionFeedbackMessage(result) ?? "保存失败，请检查字段格式后重试。");
          return;
        }
        setEditing(false);
      }).catch(() => setError("保存失败，请重试。"))
        .finally(() => setSaving(false));
    }}>
      <strong>{userCorrection ? "用户修正" : "编辑"} {label}</strong>
      <label>栏目
        <select
          disabled={saving}
          value={selectedSectionType}
          onChange={(event) => {
            const next = event.target.value as ResumeItemSectionType;
            setSelectedSectionType(next);
            setDraft((current) => editorFields(next).reduce<Record<string, string | boolean>>((result, field) => {
              result[field.name] = current[field.name] ?? editorValue(item[field.name], field.valueType, field.name);
              return result;
            }, {}));
          }}
        >
          {RESUME_SECTION_TYPES_V2.filter((value) => value !== "basics").map((value) => (
            <option key={value} value={value}>{resumeSectionById.get(value)?.label ?? sectionTypeLabel(value)}</option>
          ))}
        </select>
      </label>
      {fields.map((field) => {
        const value = draft[field.name] ?? "";
        if (field.valueType === "boolean") {
          return <label key={field.name} className="agent-career-asset-editor-checkbox"><input type="checkbox" disabled={saving} checked={value === true} onChange={(event) => setDraft((current) => ({ ...current, [field.name]: event.target.checked }))} />{field.label}</label>;
        }
        if (field.uiControl === "textarea" || field.valueType === "text" || field.valueType === "string_list") {
          return <label key={field.name}>{field.label}<textarea disabled={saving} rows={field.valueType === "string_list" ? 2 : 3} value={String(value)} onChange={(event) => setDraft((current) => ({ ...current, [field.name]: event.target.value }))} placeholder={field.valueType === "string_list" ? "每行一项" : undefined} /></label>;
        }
        if (field.uiControl === "select") {
          const options = editorSelectOptions(field.name, String(value));
          return <label key={field.name}>{field.label}<select disabled={saving} value={String(value)} onChange={(event) => setDraft((current) => ({ ...current, [field.name]: event.target.value }))}>{options.map((option) => <option key={option} value={option}>{option || "未填写"}</option>)}</select></label>;
        }
        return <label key={field.name}>{field.label}<input disabled={saving} type={field.valueType === "number" ? "number" : field.valueType === "date" ? "month" : field.valueType === "url" ? "url" : "text"} value={String(value)} onChange={(event) => setDraft((current) => ({ ...current, [field.name]: event.target.value }))} /></label>;
      })}
      <div>
        <button type="submit" disabled={saving}>{saving ? "正在保存…" : "保存并采用"}</button>
        <button type="button" disabled={saving} onClick={() => setEditing(false)}>取消</button>
      </div>
      {selectedSectionType !== itemSectionType ? <span className="agent-diff-feedback">栏目变更会先执行兼容性迁移；不兼容字段不会被静默丢弃。</span> : null}
      {error ? <span className="agent-diff-feedback is-error" role="status">{error}</span> : null}
    </form>
  );
}

type IntakeEditorField = {
  name: string;
  label: string;
  valueType: "string" | "text" | "number" | "boolean" | "date" | "url" | "string_list";
  uiControl?: "text" | "textarea" | "date" | "checkbox" | "number" | "url" | "tags" | "select";
};

type ResumeItemSectionType = Exclude<ResumeSectionTypeV2, "basics">;

function editorFields(sectionType: ResumeItemSectionType): IntakeEditorField[] {
  if (sectionType === "custom") {
    return [
      { name: "title", label: "标题", valueType: "string", uiControl: "text" },
      { name: "description", label: "内容", valueType: "text", uiControl: "textarea" },
      { name: "highlights", label: "要点", valueType: "string_list", uiControl: "tags" },
      { name: "customFields", label: "自定义字段（JSON）", valueType: "text", uiControl: "textarea" }
    ];
  }
  return [
    ...resumeFieldCatalog
    .filter((field) => field.sectionType === sectionType)
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((field) => ({
      name: field.id.slice(sectionType.length + 1),
      label: field.label,
      valueType: field.valueType,
      uiControl: field.uiControl
    })),
    { name: "customFields", label: "自定义字段（JSON）", valueType: "text", uiControl: "textarea" }
  ];
}

function editorValue(value: unknown, valueType: IntakeEditorField["valueType"], fieldName?: string): string | boolean {
  if (valueType === "boolean") return value === true;
  if (fieldName === "customFields") return JSON.stringify(value ?? [], null, 2);
  if (valueType === "string_list") return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").join("\n") : String(value ?? "");
  return value === undefined || value === null ? "" : String(value);
}

function editorDraft(item: Record<string, unknown>, sectionType: ResumeItemSectionType) {
  return Object.fromEntries(editorFields(sectionType).map((field) => [field.name, editorValue(item[field.name], field.valueType, field.name)])) as Record<string, string | boolean>;
}

function isResumeItemSectionType(value: unknown): value is ResumeItemSectionType {
  return typeof value === "string" && value !== "basics" && RESUME_SECTION_TYPES_V2.includes(value as ResumeSectionTypeV2);
}

function editorSelectOptions(field: string, current: string) {
  const common: Record<string, string[]> = {
    level: ["熟练", "熟悉", "了解", "入门"],
    status: ["有效", "进行中", "已完成", "已发表", "已授权", "已过期"],
    publicationStatus: ["计划中", "投稿中", "已发表", "已接收"],
    category: ["技术", "工具", "语言", "平台", "其他"]
  };
  return [...new Set(["", ...(current ? [current] : []), ...(common[field] ?? [])])];
}

function artifactActionFailed(result: unknown) {
  const session = asRecord(result);
  const taskState = asRecord(session.taskState);
  const feedback = asRecord(taskState.knownSlots && asRecord(taskState.knownSlots).artifactActionFeedback);
  return ["rejected", "failed", "invalid_target"].includes(String(feedback.result));
}

function artifactActionFeedbackMessage(result: unknown) {
  const session = asRecord(result);
  const taskState = asRecord(session.taskState);
  const feedback = asRecord(asRecord(taskState.knownSlots).artifactActionFeedback);
  return typeof feedback.message === "string" ? feedback.message : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function intakeStatusLabel(value: unknown, decision?: unknown) {
  if (decision === "accept") return "已采用";
  if (decision === "reject") return "已忽略";
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

function finalCandidateLabel(candidate: ProfileIntakeReviewProjection["candidates"][number]) {
  const item = asRecord(candidate.structuredItem);
  if (candidate.sectionType === "education") {
    return [item.school, item.degree, item.major].filter(Boolean).map(String).join(" / ") || "教育经历";
  }
  const identity = ["work", "internship", "campus", "volunteer"].includes(candidate.sectionType)
    ? item.organization
    : item.title ?? item.name;
  return typeof identity === "string" && identity.trim()
    ? identity
    : `待补充${sectionTypeLabel(candidate.sectionType)}名称`;
}

function finalCandidateMeta(candidate: ProfileIntakeReviewProjection["candidates"][number]) {
  const item = asRecord(candidate.structuredItem);
  const dates = [item.startDate, item.current === true ? "至今" : item.endDate].filter(Boolean).map(String).join(" — ");
  return [item.organization ?? item.institution, item.role ?? item.authorRole, dates].filter(Boolean).map(String).join(" · ") || "时间 / 组织 / 角色待补充";
}
