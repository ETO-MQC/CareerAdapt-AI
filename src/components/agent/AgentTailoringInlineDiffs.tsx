"use client";

import { useState } from "react";
import type { AgentArtifactAction } from "@/agent/contracts/agentActions";
import type { AgentTaskState } from "@/agent/contracts/agentSession";
import { ResumeTailoringDiffSchema } from "@/domain/schemas";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";
import { TailoringDiffRecord } from "./artifacts/AgentArtifactContent";

export function AgentTailoringInlineDiffs({
  taskState,
  onArtifactAction
}: {
  taskState: AgentTaskState;
  onArtifactAction?(action: AgentArtifactAction): Promise<unknown> | void;
}) {
  const tailoring = asRecord(taskState.knownSlots.tailoringSession);
  const plan = asRecord(tailoring.plan);
  const diffs = Array.isArray(plan.diffs) ? plan.diffs : [];
  const generatedDiffRevision = typeof (tailoring.generatedDiffRevision ?? plan.generatedDiffRevision) === "number"
    ? tailoring.generatedDiffRevision ?? plan.generatedDiffRevision
    : 0;
  const [open, setOpen] = useState(true);
  const [activeDiffState, setActiveDiffState] = useState<{ revision: unknown; index: number }>({
    revision: generatedDiffRevision,
    index: 0
  });
  const [submitting, setSubmitting] = useState(false);
  const [localDraftState, setLocalDraftState] = useState<{
    revision: unknown;
    reviews: TailoringDraftReview[];
  }>({ revision: generatedDiffRevision, reviews: [] });
  const localDraftReviews = String(localDraftState.revision) === String(generatedDiffRevision)
    ? localDraftState.reviews
    : [];
  const reviews = Array.isArray(plan.diffReviews) ? plan.diffReviews.map(asRecord) : [];
  if (taskState.stage !== "preview_changes") return null;
  if (!diffs.length) return null;
  const submittedDiffRevision = taskState.knownSlots.tailoringReviewSubmittedDiffRevision;
  if (
    submittedDiffRevision !== undefined
    && generatedDiffRevision !== undefined
    && String(submittedDiffRevision) === String(generatedDiffRevision)
  ) return null;
  if (reviews.some((review) => ["accepted", "edited", "rejected"].includes(String(review.status)))) return null;
  const reviewsById = new Map(reviews.flatMap((review) => typeof review.diffId === "string" ? [[review.diffId, review] as const] : []));
  const stagedReviews = Array.isArray(taskState.knownSlots.tailoringDraftDiffReviews)
    ? taskState.knownSlots.tailoringDraftDiffReviews.map(asRecord)
    : [];
  const stagedById = new Map([
    ...stagedReviews.flatMap((review) => typeof review.diffId === "string" ? [[review.diffId, review] as const] : []),
    ...localDraftReviews.map((review) => [review.diffId, review] as const)
  ]);
  const feedback = asRecord(taskState.knownSlots.artifactActionFeedback);
  const activeDiffIndex = String(activeDiffState.revision) === String(generatedDiffRevision)
    ? Math.min(activeDiffState.index, diffs.length - 1)
    : 0;
  const activeDiff = diffs[activeDiffIndex];
  const activeDiffEntry = activeDiff
    ? (() => {
        const parsed = ResumeTailoringDiffSchema.safeParse(activeDiff);
        return {
          item: activeDiff,
          index: activeDiffIndex,
          diff: asRecord(activeDiff),
          diffId: parsed.success ? tailoringDiffId(parsed.data) : undefined
        };
      })()
    : undefined;
  const stagedReviewsForCurrentRevision = diffs.flatMap((item) => {
    const parsed = ResumeTailoringDiffSchema.safeParse(item);
    if (!parsed.success) return [];
    const review = stagedById.get(tailoringDiffId(parsed.data));
    return review
      && (review.generatedDiffRevision === undefined || String(review.generatedDiffRevision) === String(generatedDiffRevision))
      ? [review]
      : [];
  });
  const shownStagedReviews = stagedReviewsForCurrentRevision;
  const unresolvedDiffCount = Math.max(diffs.length - shownStagedReviews.length, 0);
  const allDiffsResolved = unresolvedDiffCount === 0;
  const activeDiffReview = activeDiffEntry?.diffId
    ? reviewForDiff(
        reviewsById.get(activeDiffEntry.diffId) ?? {},
        stagedById.get(activeDiffEntry.diffId)
      )
    : {};
  const stageNextDiff = () => {
    setActiveDiffState((current) => {
      const currentIndex = String(current.revision) === String(generatedDiffRevision)
        ? Math.min(current.index, diffs.length - 1)
        : 0;
      return currentIndex >= diffs.length - 1
        ? current
        : { revision: generatedDiffRevision, index: currentIndex + 1 };
    });
  };
  const stagePreviousDiff = () => {
    setActiveDiffState((current) => {
      const currentIndex = String(current.revision) === String(generatedDiffRevision)
        ? Math.min(current.index, diffs.length - 1)
        : 0;
      return currentIndex <= 0
        ? current
        : { revision: generatedDiffRevision, index: currentIndex - 1 };
    });
  };
  const shownDiffDetails = activeDiffEntry ? [activeDiffEntry] : [];
  const submit = async () => {
    if (!onArtifactAction || !allDiffsResolved || submitting) return;
    setSubmitting(true);
    try {
      await onArtifactAction({
        type: "tailoring_diff_submit",
        reviews: shownStagedReviews.map((review) => ({
          diffId: String(review.diffId),
          decision: review.decision as "accept" | "edit" | "reject",
          ...(review.editedValue !== undefined ? { editedValue: review.editedValue as string | string[] } : {}),
          ...(typeof review.generatedDiffRevision === "number" ? { generatedDiffRevision: review.generatedDiffRevision } : {})
        }))
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <details
      className="agent-tailoring-inline"
      aria-label="岗位定制修改预览"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>岗位定制修改</strong>
          <small>逐项核对，共 {diffs.length} 项</small>
        </span>
        <span className="agent-tailoring-draft-state">
          {shownStagedReviews.length}/{diffs.length} 项已暂存
        </span>
      </summary>
      <div className="agent-tailoring-diff-navigator" aria-label="修改意见导航">
        <button type="button" aria-label="上一条修改意见" disabled={activeDiffIndex <= 0} onClick={stagePreviousDiff}>←</button>
        <span>修改意见 {activeDiffIndex + 1} / {diffs.length}</span>
        <button type="button" aria-label="下一条修改意见" disabled={activeDiffIndex >= diffs.length - 1} onClick={stageNextDiff}>→</button>
      </div>
      <div className="agent-diff-list">
        {shownDiffDetails.map(({ index, diff, diffId }) => {
          const review = activeDiffReview;
          return (
            <TailoringDiffRecord
              key={diffId ?? `inline-invalid-diff-${index}`}
              diff={diff}
              review={review}
              diffId={diffId}
              feedback={feedback.entityId === diffId ? feedback : undefined}
              onDecision={async (decision, editedValue) => {
                if (!diffId || !onArtifactAction) return;
                setLocalDraftState((current) => {
                  const existing = String(current.revision) === String(generatedDiffRevision) ? current.reviews : [];
                  return {
                    revision: generatedDiffRevision,
                    reviews: [
                      ...existing.filter((review) => review.diffId !== diffId),
                      {
                        diffId,
                        decision,
                        ...(editedValue !== undefined ? { editedValue } : {}),
                        ...(typeof generatedDiffRevision === "number" ? { generatedDiffRevision } : {})
                      }
                    ]
                  };
                });
                await onArtifactAction({
                  type: "tailoring_diff_stage_decision",
                  diffId,
                  decision,
                  editedValue,
                  ...(typeof generatedDiffRevision === "number" ? { generatedDiffRevision } : {})
                });
                stageNextDiff();
              }}
            />
          );
        })}
      </div>
      <footer className="agent-tailoring-submit-row">
        <span className="agent-diff-feedback" role="status">
          {allDiffsResolved
            ? "已完成全部修改选择，提交后才会统一交给岗位定制流程处理。"
            : `还有 ${unresolvedDiffCount} 项修改未处理，请先选择“采用、编辑后采用”或“忽略”。`}
        </span>
        <button
          className="is-primary"
          type="button"
          disabled={!onArtifactAction || !allDiffsResolved || submitting}
          aria-busy={submitting}
          onClick={() => void submit()}
        >
          {submitting ? "提交中…" : "提交本次选择"}
        </button>
      </footer>
      {feedback.entityId === "submit" && typeof feedback.message === "string" ? (
        <span className="agent-diff-feedback" role="status">{feedback.message}</span>
      ) : null}
    </details>
  );
}

type TailoringDraftReview = {
  diffId: string;
  decision: "accept" | "edit" | "reject";
  editedValue?: string | string[];
  generatedDiffRevision?: number;
};

function reviewForDiff(stored: Record<string, unknown>, staged?: Record<string, unknown>) {
  if (!staged) return stored;
  return {
    ...stored,
    ...staged,
    status: staged.status ?? reviewStatusForDecision(staged.decision)
  };
}

function reviewStatusForDecision(value: unknown) {
  if (value === "accept") return "accepted";
  if (value === "edit") return "edited";
  if (value === "reject") return "rejected";
  return "suggested";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
