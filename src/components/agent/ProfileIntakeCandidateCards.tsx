"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentArtifactAction } from "@/agent/contracts/agentActions";
import type { ProfileIntakeReviewCandidate, ProfileIntakeReviewProjection } from "@/domain/profileIntake/ProfileIntakeReviewProjection";
import type { ProfileIntakeStructuredPatch } from "@/domain/profileIntake/ProfileIntakeNormalizer";

const EDITABLE_FIELDS = [
  "school", "degree", "major", "title", "name", "organization", "institution", "role", "startDate", "endDate"
] as const;

export function ProfileIntakeCandidateCards({
  projection,
  onAction
}: {
  projection?: ProfileIntakeReviewProjection;
  onAction?(action: AgentArtifactAction): Promise<unknown> | void;
}) {
  const candidates = projection?.candidates ?? [];
  const activeCandidates = candidates.filter((candidate) =>
    candidate.status === "proposed" || candidate.status === "uncertain" || candidate.status === "failed"
  );
  const historyCandidates = candidates.filter((candidate) =>
    candidate.status === "accepted" || candidate.status === "ignored"
  );
  const progress = projection?.reviewProgress;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeCandidates.slice(0, 1).map((candidate) => candidate.id)));
  const [allExpanded, setAllExpanded] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(() => activeCandidates.length > 0);
  const allIds = activeCandidates.map((candidate) => candidate.id);
  const candidateSignature = allIds.join("\u0000");
  const reviewSignature = `${candidateSignature}\u0000${progress?.reviewed ?? 0}\u0000${progress?.total ?? 0}`;
  const previousCandidateSignature = useRef("");
  const previousReviewSignature = useRef("");
  useEffect(() => {
    if (!allIds.length || candidateSignature === previousCandidateSignature.current) return;
    previousCandidateSignature.current = candidateSignature;
    setExpanded(new Set(allIds.slice(0, 1)));
    setAllExpanded(false);
  }, [allIds, candidateSignature]);
  const reviewNeedsAttention = Boolean(progress && progress.reviewed < progress.total);
  useEffect(() => {
    if (!projection || reviewSignature === previousReviewSignature.current) return;
    previousReviewSignature.current = reviewSignature;
    setReviewOpen(reviewNeedsAttention);
  }, [projection, reviewNeedsAttention, reviewSignature]);
  if (!projection || (!activeCandidates.length && !historyCandidates.length)) return null;
  const reviewProgress = projection.reviewProgress;
  const toggleAll = () => {
    setAllExpanded((current) => {
      const next = !current;
      setExpanded(next ? new Set(allIds) : new Set(allIds.slice(0, 1)));
      return next;
    });
  };
  const reviewStatus = reviewNeedsAttention
    ? projection.extractionStatus === "structured_local"
      ? "本地规则已整理，AI 服务暂不可用，请核对"
      : projection.extractionStatus === "failed"
        ? "暂未生成可用候选，原文已保留"
        : "部分字段需要核对"
    : undefined;
  return (
    <section className="profile-intake-inline-review" aria-label="经历候选核对" aria-live="polite">
      <header className="profile-intake-inline-review-header">
        <button
          type="button"
          className="profile-intake-inline-review-toggle"
          aria-expanded={reviewOpen}
          aria-controls="profile-intake-review-content"
          onClick={() => setReviewOpen((current) => !current)}
        >
          <span className="profile-intake-inline-review-toggle-copy">
            <strong>经历候选</strong>
            <span className="profile-intake-inline-review-count">{reviewProgress.total} 项 · 已核对 {reviewProgress.reviewed}/{reviewProgress.total}</span>
            <ChevronDown className="profile-intake-inline-review-chevron" aria-hidden="true" />
            {reviewStatus ? <small className="profile-intake-provider-status">{reviewStatus}</small> : null}
          </span>
        </button>
        {reviewOpen && activeCandidates.length > 1 ? (
          <button type="button" onClick={toggleAll}>{allExpanded ? "收起全部" : "展开全部"}</button>
        ) : null}
      </header>
      {reviewOpen ? (
        <div id="profile-intake-review-content" className="profile-intake-inline-review-content">
          {projection.failedExtraction ? (
            <p className="profile-intake-inline-review-failure" role="status">
              {projection.failedExtraction.message}
            </p>
          ) : null}
          <div className="profile-intake-inline-review-list">
            {activeCandidates.map((candidate) => (
              <ProfileIntakeCandidateCard
                key={candidate.id}
                candidate={candidate}
                projection={projection}
                open={expanded.has(candidate.id)}
                onToggle={(open) => setExpanded((current) => {
                  const next = new Set(current);
                  if (open) next.add(candidate.id);
                  else next.delete(candidate.id);
                  return next;
                })}
                onAction={onAction}
              />
            ))}
          </div>
          {historyCandidates.length ? (
            <div className="profile-intake-review-history" aria-label="已处理的经历">
              {historyCandidates.map((candidate) => (
                <div className="profile-intake-compact-receipt" key={candidate.id} data-candidate-id={candidate.id}>
                  <span>{candidate.status === "accepted" ? "✓" : "—"} {candidate.status === "accepted" ? acceptedReceipt(candidate) : ignoredReceipt(candidate)}</span>
                  <button
                    type="button"
                    onClick={() => onAction?.({ type: "profile_intake_candidate_decision", candidateId: candidate.id, decision: "reopen" })}
                  >重新打开</button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function ProfileIntakeCandidateCard({
  candidate,
  projection,
  open,
  onToggle,
  onAction
}: {
  candidate: ProfileIntakeReviewCandidate;
  projection: ProfileIntakeReviewProjection;
  open: boolean;
  onToggle(open: boolean): void;
  onAction?(action: AgentArtifactAction): Promise<unknown> | void;
}) {
  const item = asRecord(candidate.structuredItem);
  const [editing, setEditing] = useState(false);
  const fields = useMemo(() => EDITABLE_FIELDS.filter((field) => field in item || field === (candidate.sectionType === "education" ? "school" : "title")), [candidate.sectionType, item]);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field, String(item[field] ?? "")]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const accepted = candidate.status === "accepted" || candidate.decision === "accept";
  const failed = candidate.status === "failed" || projection.extractionStatus === "failed";
  const label = candidateLabel(candidate);
  const status = failed ? "未完成结构化" : accepted ? "已采用" : candidate.status === "ignored" ? "已忽略" : candidate.status === "uncertain" ? "待确认" : "待核对";

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    const fieldPatch = Object.fromEntries(
      Object.entries(draft).filter(([, value]) => value.trim())
    ) as ProfileIntakeStructuredPatch;
    if (!Object.keys(fieldPatch).length || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await onAction?.({
        type: "profile_intake_candidate_edit",
        importId: projection.importId,
        expectedDraftRevision: projection.draftRevision,
        candidateId: candidate.id,
        fieldPatch,
        decision: "accept"
      });
      if (artifactActionFailed(result)) {
        setError(artifactActionFeedbackMessage(result) ?? "保存失败，请检查来源证据后重试。");
        return;
      }
      setEditing(false);
    } catch {
      setError("保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`profile-intake-candidate-card is-${candidate.status}`} data-candidate-id={candidate.id}>
      <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
        <summary>
          <span className="profile-intake-candidate-summary">
            <span className="profile-intake-candidate-type">{sectionTypeLabel(candidate.sectionType)}</span>
            <strong>{label}</strong>
            <span className={`profile-intake-candidate-status is-${candidate.status}`}>{status}</span>
          </span>
        </summary>
        <div className="profile-intake-candidate-body">
          {candidate.uncertainFields.length ? (
            <p className="profile-intake-candidate-uncertainty">需要确认：{candidate.uncertainFields.join("、")}</p>
          ) : null}
          {candidate.professionalText ? <p className="profile-intake-candidate-text">{candidate.professionalText}</p> : null}
          {Object.keys(item).length ? (
            <dl className="profile-intake-candidate-fields">
              {typedFields(item).map(([field, value]) => <div key={field}><dt>{field}</dt><dd>{value}</dd></div>)}
            </dl>
          ) : null}
          <details className="profile-intake-candidate-source">
            <summary>查看来源</summary>
            <blockquote>{candidate.sourceQuote}</blockquote>
            <small>来源字符 {candidate.sourceSpan.start}–{candidate.sourceSpan.end}</small>
          </details>
          {editing ? (
            <form className="profile-intake-candidate-editor" onSubmit={(event) => void saveEdit(event)}>
              <strong>编辑后采用</strong>
              {fields.map((field) => (
                <label key={field}>{fieldLabel(field)}
                  <input
                    name={field}
                    autoComplete="off"
                    disabled={saving}
                    value={draft[field] ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
                  />
                </label>
              ))}
              <div className="profile-intake-candidate-actions">
                <button type="submit" disabled={saving}>{saving ? "保存中…" : "保存并采用"}</button>
                <button type="button" disabled={saving} onClick={() => setEditing(false)}>取消</button>
              </div>
              {error ? <span className="profile-intake-candidate-error" role="status">{error}</span> : null}
            </form>
          ) : (
            <div className="profile-intake-candidate-actions" aria-label={`${label}操作`}>
              {failed ? (
                <>
                  {projection.failedExtraction?.actions.includes("retry") ? (
                    <button type="button" onClick={() => onAction?.({
                      type: "profile_intake_retry_extraction",
                      importId: projection.importId,
                      sourceMessageId: projection.sourceMessageId,
                      expectedDraftRevision: projection.draftRevision
                    })}>重新解析</button>
                  ) : null}
                  {projection.failedExtraction?.actions.includes("manual") ? (
                    <button type="button" onClick={() => onAction?.({
                      type: "profile_intake_extraction_recovery",
                      importId: projection.importId,
                      sourceMessageId: projection.sourceMessageId,
                      expectedDraftRevision: projection.draftRevision,
                      decision: "manual_review"
                    })}>手动整理</button>
                  ) : null}
                  {projection.failedExtraction?.actions.includes("preserve") ? (
                    <button type="button" onClick={() => onAction?.({
                      type: "profile_intake_extraction_recovery",
                      importId: projection.importId,
                      sourceMessageId: projection.sourceMessageId,
                      expectedDraftRevision: projection.draftRevision,
                      decision: "preserve_source"
                    })}>保留为来源</button>
                  ) : null}
                </>
              ) : accepted ? (
                <>
                  <button type="button" onClick={() => setEditing(true)}>编辑</button>
                  <button type="button" onClick={() => onAction?.({ type: "profile_intake_candidate_decision", candidateId: candidate.id, decision: "reopen" })}>撤销采用</button>
                </>
              ) : (
                <>
                  {candidate.canAccept ? <button type="button" onClick={() => onAction?.({ type: "profile_intake_candidate_decision", candidateId: candidate.id, decision: "accept" })}>采用</button> : null}
                  {Object.keys(item).length ? <button type="button" onClick={() => setEditing(true)}>编辑后采用</button> : null}
                  <button type="button" onClick={() => onAction?.({ type: "profile_intake_candidate_decision", candidateId: candidate.id, decision: "reject" })}>忽略</button>
                </>
              )}
            </div>
          )}
        </div>
      </details>
    </article>
  );
}

function candidateLabel(candidate: ProfileIntakeReviewCandidate) {
  const item = asRecord(candidate.structuredItem);
  if (candidate.status === "failed") return "这段回答";
  if (candidate.sectionType === "education") return [item.school, item.degree, item.major].filter(Boolean).join(" / ") || "教育经历";
  return String(item.title ?? item.name ?? item.organization ?? item.role ?? `${sectionTypeLabel(candidate.sectionType)}候选`);
}

function acceptedReceipt(candidate: ProfileIntakeReviewCandidate) {
  return `已记录${sectionTypeLabel(candidate.sectionType)}经历：${receiptLabel(candidate)}`;
}

function ignoredReceipt(candidate: ProfileIntakeReviewCandidate) {
  return `已忽略${sectionTypeLabel(candidate.sectionType)}经历：${receiptLabel(candidate)}`;
}

function receiptLabel(candidate: ProfileIntakeReviewCandidate) {
  const item = asRecord(candidate.structuredItem);
  if (candidate.sectionType === "education") {
    return [item.school, item.degree, item.major].filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join(" · ") || "教育经历";
  }
  return candidateLabel(candidate);
}

function typedFields(item: Record<string, unknown>) {
  const fields = ["school", "degree", "major", "organization", "role", "title", "name", "startDate", "endDate", "current", "tools", "methods", "outcomes"];
  return fields.flatMap((field) => {
    const value = item[field];
    if (Array.isArray(value) && value.length) return [[fieldLabel(field), value.join("、")] as [string, string]];
    if (typeof value === "string" && value) return [[fieldLabel(field), value] as [string, string]];
    if (value === true) return [[fieldLabel(field), "至今"] as [string, string]];
    return [];
  });
}

function fieldLabel(field: string) {
  return ({ school: "学校", degree: "学位", major: "专业", title: "标题", name: "名称", organization: "组织", institution: "机构", role: "角色", startDate: "开始时间", endDate: "结束时间", current: "状态", tools: "工具", methods: "方法", outcomes: "成果" } as Record<string, string>)[field] ?? field;
}

function sectionTypeLabel(value: string) {
  return ({ education: "教育", work: "工作", internship: "实习", project: "项目", research: "科研", campus: "校园", volunteer: "志愿", awards: "奖项", skills: "技能", certificates: "证书", languages: "语言", publications: "出版物", patents: "专利", portfolio: "作品", other: "其他", custom: "自定义" } as Record<string, string>)[value] ?? "经历";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function artifactActionFailed(result: unknown) {
  const session = asRecord(result);
  const taskState = asRecord(session.taskState);
  const feedback = asRecord(asRecord(taskState.knownSlots).artifactActionFeedback);
  return ["rejected", "failed", "invalid_target", "missing_revision"].includes(String(feedback.result));
}

function artifactActionFeedbackMessage(result: unknown) {
  const session = asRecord(result);
  const taskState = asRecord(session.taskState);
  const feedback = asRecord(asRecord(taskState.knownSlots).artifactActionFeedback);
  return typeof feedback.message === "string" ? feedback.message : undefined;
}
